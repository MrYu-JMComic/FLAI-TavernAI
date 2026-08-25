const MAX_TOOL_ERROR_MESSAGE_LENGTH = 500;

export async function executeProviderTool(executeTool, name, argumentsValue, call, signal) {
  rethrowProviderToolCancellation(undefined, signal);
  try {
    const value = await executeTool(name, argumentsValue, call);
    rethrowProviderToolCancellation(undefined, signal);
    return prepareProviderToolResult(value);
  } catch (error) {
    rethrowProviderToolCancellation(error, signal);
    return prepareProviderToolResult({
      ok: false,
      error: 'TOOL_EXECUTION_FAILED',
      errorName: readErrorText(error, 'name', 'Error'),
      message: readErrorMessage(error)
    });
  }
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
