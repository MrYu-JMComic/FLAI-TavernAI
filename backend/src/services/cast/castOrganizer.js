import { generateCompletion } from '../providers.js';
import { newId } from '../../security.js';
import { CastDomainError } from '../../domain/cast/errors.js';
import { buildCastOrganizerMessages } from '../prompts/castOrganizerPrompt.js';
import { buildCastOrganizerSnapshot } from './castContextBuilder.js';
import { applyCastChangePlan } from './castPlanService.js';
import { parseOrRepairCastPlan } from './castPlanGenerator.js';

export async function organizeConversationCast(options = {}) {
  const {
    database,
    userId,
    conversationId,
    settings,
    scope = 'member',
    scopeMemberId = '',
    requirement = '',
    messages = [],
    idempotencyKey = '',
    signal,
    generate = generateCompletion,
    onProgress = async () => {},
  } = options;
  try {
    throwIfAborted(signal);
    await onProgress('context', { scope, scopeMemberId });
    throwIfAborted(signal);
    const castSnapshot = buildCastOrganizerSnapshot(database, userId, conversationId, { scopeMemberId });
    await onProgress('generating', { memberCount: castSnapshot.length });
    throwIfAborted(signal);
    const organizerMessages = buildCastOrganizerMessages({
      scope,
      requirement,
      castSnapshot,
      messages: normalizeEvidenceMessages(messages),
    });
    const generationOptions = {
      thinkingEnabled: false,
      temperature: 0,
      maxTokens: scope === 'member' ? 6_000 : 12_000,
      timeoutMs: 120_000,
      signal,
    };
    const result = await generate(
      settings,
      organizerMessages,
      generationOptions
    );
    throwIfAborted(signal);
    await onProgress('validating', {});
    throwIfAborted(signal);
    const generatedPlan = await parseOrRepairCastPlan({
      initialResult: result,
      generate,
      settings,
      messages: organizerMessages,
      generationOptions,
      validationOptions: {
        sourceKind: 'ai_organize',
        scope,
      },
      onRepair: () => onProgress('validating', { repairAttempted: true }),
    });
    const plan = generatedPlan.plan;
    await onProgress('applying', { operationCount: plan.operations.length });
    throwIfAborted(signal);
    const applied = applyCastChangePlan(database, userId, conversationId, plan, {
      sourceKind: 'ai_organize',
      scope,
      scopeMemberId,
      idempotencyKey: idempotencyKey || `cast-organize:${newId()}`,
    });
    const summary = {
      summary: plan.summary,
      applied: applied.batch.result.applied,
      deduplicated: applied.batch.result.deduplicated,
      batchId: applied.batch.id,
      repairAttempted: generatedPlan.attempts > 1,
      provider: result.provider || settings.gatewayName || '',
      providerType: result.providerType || settings.providerType || '',
      model: result.model || settings.model || '',
      usage: result.usage || null,
    };
    await onProgress('done', summary);
    return summary;
  } catch (error) {
    throw normalizeOrganizerError(error, signal);
  }
}

function normalizeEvidenceMessages(messages) {
  const source = Array.isArray(messages) ? messages.slice(-80) : [];
  return source.map((message) => ({
    id: String(message?.id || ''),
    role: String(message?.role || ''),
    content: String(message?.content || '').slice(0, 12_000),
  }));
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (typeof signal.throwIfAborted === 'function') signal.throwIfAborted();
  throw new DOMException('The cast organization was aborted', 'AbortError');
}

function normalizeOrganizerError(error, signal) {
  if (error instanceof CastDomainError) return error;
  const reason = signal?.aborted ? signal.reason : error;
  if (reason?.name === 'TimeoutError' || error?.name === 'TimeoutError') {
    return new CastDomainError('Cast organization timed out', {
      code: 'CAST_ORGANIZE_TIMEOUT',
      statusCode: 504,
    });
  }
  if (signal?.aborted || reason?.name === 'AbortError' || error?.name === 'AbortError') {
    return new CastDomainError('Cast organization was cancelled', {
      code: 'CAST_ORGANIZE_ABORTED',
      statusCode: 499,
    });
  }
  return error;
}
