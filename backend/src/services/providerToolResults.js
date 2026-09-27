import { z } from 'zod';
import { finishToolExecution, startToolExecution } from './toolRegistry.js';

const MAX_TOOL_ERROR_MESSAGE_LENGTH = 500;
const MAX_TOOL_ARGUMENT_CHARACTERS = 128_000;
const toolValidators = new WeakMap();
const emptyParameters = { type: 'object', properties: {} };

export async function executeProviderTool(executeTool, name, argumentsValue, call, signal, tools, metadata = {}) {
  rethrowProviderToolCancellation(undefined, signal);
  const execution = startToolExecution(name, argumentsValue, metadata);
  let prepared;
  try {
    const checked = checkToolArguments(name, argumentsValue, call, tools);
    if (!checked.ok) prepared = prepareProviderToolResult(checked);
    else {
      const value = await executeTool(name, checked.arguments, call);
      rethrowProviderToolCancellation(undefined, signal);
      prepared = prepareProviderToolResult(value);
    }
  } catch (error) {
    if (['JOB_SOURCE_STALE', 'JOB_LEASE_LOST', 'JOB_STEP_SETTLED', 'JOB_CANCELLED', 'CONVERSATION_TIMELINE_CHANGED'].includes(error?.code)) {
      finishToolExecution(execution, { code: error.code, message: readErrorMessage(error) }, 'cancelled');
      throw error;
    }
    try { rethrowProviderToolCancellation(error, signal); } catch (cancellation) {
      try { finishToolExecution(execution, { message: readErrorMessage(error) }, 'cancelled'); } catch (auditError) {
        console.warn('[tool-audit] cancellation record could not be saved:', readErrorMessage(auditError));
      }
      throw cancellation;
    }
    prepared = prepareProviderToolResult({
      ok: false,
      error: 'TOOL_EXECUTION_FAILED',
      errorName: readErrorText(error, 'name', 'Error'),
      message: readErrorMessage(error)
    });
  }
  // Audit failures are fatal to this loop, not tool failures the model may repeat.
  return { ...prepared, policy: finishToolExecution(execution, prepared.result, prepared.result?.ok === false ? 'failed' : 'succeeded') };
}

function checkToolArguments(name, argumentsValue, call, tools) {
  let schema;
  if (Array.isArray(tools)) {
    let definition = null;
    for (const tool of tools) {
      if (tool?.type !== 'function' || tool.function?.name !== name) continue;
      if (definition) return { ok: false, error: 'TOOL_SCHEMA_INVALID', name };
      definition = tool.function;
    }
    if (!definition) return { ok: false, error: 'TOOL_NOT_AVAILABLE', name };
    const parameters = definition.parameters || emptyParameters;
    try {
      const source = JSON.stringify(parameters);
      let cached = toolValidators.get(parameters);
      if (!cached || cached.source !== source) {
        cached = { source, validator: z.fromJSONSchema(parameters) };
        toolValidators.set(parameters, cached);
      }
      schema = cached.validator;
    } catch {
      return { ok: false, error: 'TOOL_SCHEMA_INVALID', name };
    }
  }

  // Inspect the wire arguments before provider normalizers can turn invalid JSON into {}.
  let raw = argumentsValue;
  for (const [object, key] of [
    [call?.raw?.function, 'arguments'],
    [call?.raw, 'arguments'],
    [call?.raw, 'input']
  ]) {
    if (object && Object.hasOwn(object, key)) {
      raw = object[key];
      break;
    }
  }
  let args;
  try {
    const encoded = typeof raw === 'string' ? raw : JSON.stringify(raw);
    if (!encoded || encoded.length > MAX_TOOL_ARGUMENT_CHARACTERS) {
      return { ok: false, error: 'TOOL_ARGUMENTS_INVALID', message: 'Arguments are missing or too large.' };
    }
    args = JSON.parse(encoded);
  } catch {
    return { ok: false, error: 'TOOL_ARGUMENTS_INVALID', message: 'Arguments must be valid JSON.' };
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { ok: false, error: 'TOOL_ARGUMENTS_INVALID', message: 'Arguments must be a JSON object.' };
  }
  if (schema) {
    const validation = schema.safeParse(args);
    if (!validation.success) {
      return {
        ok: false,
        error: 'TOOL_ARGUMENTS_INVALID',
        issues: validation.error.issues.slice(0, 8).map((issue) => ({
          path: issue.path.join('.').slice(0, 160),
          message: issue.message.slice(0, MAX_TOOL_ERROR_MESSAGE_LENGTH)
        }))
      };
    }
  }
  return { ok: true, arguments: args };
}

export function prepareProviderToolResult(value) {
  const stop = Boolean(value && typeof value === 'object' && value.stop === true);
  try {
    const content = JSON.stringify(value);
    if (content === undefined) {
      return failedToolResult(value, stop, 'UNSUPPORTED_TOP_LEVEL_RESULT');
    }
    return {
      result: JSON.parse(content),
      content,
      stop
    };
  } catch (error) {
    return failedToolResult(value, stop, error?.name || 'Error');
  }
}

function rethrowProviderToolCancellation(error, signal) {
  if (signal?.aborted) {
    const reason = signal.reason ?? error;
    if (reason !== undefined) {
      throw reason;
    }
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    throw abortError;
  }
  if (
    hasErrorValue(error, 'name', 'AbortError')
    || hasErrorValue(error, 'name', 'TimeoutError')
    || hasErrorValue(error, 'code', 'ABORT_ERR')
  ) {
    throw error;
  }
}

function hasErrorValue(error, property, expected) {
  try {
    return error?.[property] === expected;
  } catch {
    return false;
  }
}

function boundedErrorText(value, fallback) {
  const text = typeof value === 'string' ? value.trim() : '';
  return (text || fallback).slice(0, MAX_TOOL_ERROR_MESSAGE_LENGTH);
}

function readErrorMessage(error) {
  if (typeof error === 'string') {
    return boundedErrorText(error, 'Tool execution failed');
  }
  return readErrorText(error, 'message', 'Tool execution failed');
}

function readErrorText(error, property, fallback) {
  try {
    return boundedErrorText(error?.[property], fallback);
  } catch {
    return fallback;
  }
}

function failedToolResult(value, stop, cause) {
  const result = {
    ok: false,
    error: 'TOOL_RESULT_SERIALIZATION_FAILED',
    valueType: describeValueType(value),
    cause
  };
  if (stop) {
    result.stop = true;
  }
  return {
    result,
    content: JSON.stringify(result),
    stop
  };
}

function describeValueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
