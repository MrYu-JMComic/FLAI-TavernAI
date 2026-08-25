import { buildCastPlanRepairMessages } from '../prompts/castPlanRepairPrompt.js';
import { parseAndValidateCastPlan } from './castPlanService.js';

const REPAIRABLE_PLAN_CODES = new Set([
  'CAST_PLAN_JSON',
  'CAST_PLAN_SCHEMA',
  'CAST_PLAN_LIMIT',
  'CAST_PLAN_FORBIDDEN_OPERATION',
  'CAST_PLAN_EVIDENCE',
  'CAST_PLAN_OPERATION',
]);

export async function parseOrRepairCastPlan(options = {}) {
  const {
    initialResult,
    generate,
    settings,
    messages,
    generationOptions,
    validationOptions,
    onRepair = async () => {},
  } = options;
  const initialContent = String(initialResult?.content || '');
  try {
    return {
      plan: parseAndValidateCastPlan(initialContent, validationOptions),
      result: initialResult,
      attempts: 1,
    };
  } catch (initialError) {
    if (!isRepairableCastPlanError(initialError) || typeof generate !== 'function') {
      throw initialError;
    }
    throwIfAborted(generationOptions?.signal);
    await onRepair(initialError);
    throwIfAborted(generationOptions?.signal);
    const repairResult = await generate(
      settings,
      buildCastPlanRepairMessages(messages, initialContent, initialError),
      generationOptions
    );
    try {
      return {
        plan: parseAndValidateCastPlan(repairResult?.content, validationOptions),
        result: repairResult,
        attempts: 2,
      };
    } catch (repairError) {
      repairError.repairAttempted = true;
      repairError.initialCode = String(initialError?.code || '');
      throw repairError;
    }
  }
}

export function serializeCastPlanError(error) {
  const details = normalizeErrorDetails(error?.details);
  return {
    error: String(error?.message || 'Cast plan validation failed').slice(0, 500),
    code: String(error?.code || 'CAST_PLAN_FAILED').slice(0, 100),
    details,
    repairAttempted: error?.repairAttempted === true,
  };
}

function isRepairableCastPlanError(error) {
  return REPAIRABLE_PLAN_CODES.has(String(error?.code || ''));
}

function normalizeErrorDetails(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((issue) => ({
    path: String(issue?.path || '').slice(0, 300),
    message: String(issue?.message || '').slice(0, 500),
  }));
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (typeof signal.throwIfAborted === 'function') signal.throwIfAborted();
  throw signal.reason || new DOMException('The cast plan repair was aborted', 'AbortError');
}
