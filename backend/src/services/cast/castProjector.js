import { normalizeAdvancedSettings } from '../../modules/advancedSettings.js';
import { generateCompletion } from '../providers.js';
import { getCastChangeBatchByKey } from '../../repositories/castRepository.js';
import { getCastReadModel } from './castQueryService.js';
import { applyCastChangePlan } from './castPlanService.js';
import { publishCastSyncStatus } from './castSyncStatus.js';
import { buildCastProjectionMessages } from '../prompts/castProjectionPrompt.js';
import { parseOrRepairCastPlan, serializeCastPlanError } from './castPlanGenerator.js';
import { resolveCastAgentOperations, resolveCastAgentSettings } from './castAgentSettings.js';
import { isTransientProviderError, retryProviderCall } from '../providerRetry.js';

export async function projectConversationCast(options = {}) {
  const {
    database,
    userId,
    conversation,
    userMessage,
    assistantMessage,
    settings,
    signal,
    generate = generateCompletion,
    publish = publishCastSyncStatus,
    config,
  } = options;
  const conversationId = String(conversation?.id || '');
  const messageId = String(assistantMessage?.id || '');
  const castTracking = normalizeAdvancedSettings(conversation?.settings || {}).castTracking;
  if (!castTracking.enabled) {
    return skip(publish, conversationId, messageId, 'Cast tracking is disabled');
  }
  if (!conversationId || !messageId || !String(assistantMessage?.content || '').trim()) {
    return skip(publish, conversationId, messageId, 'No completed assistant message');
  }
  const idempotencyKey = options.idempotencyKey || `cast-sync:${messageId}`;
  const existing = getCastChangeBatchByKey(database, conversationId, idempotencyKey);
  if (existing) {
    return skip(publish, conversationId, messageId, 'Cast turn already processed', existing);
  }

  publish(conversationId, { status: 'queued', messageId });
  try {
    publish(conversationId, { status: 'running', messageId });
    const castSnapshot = getCastReadModel(database, userId, conversationId, {
      includeHidden: false,
      memoryLimit: 8,
      behaviorLimit: 8,
      itemLimit: 30,
    });
    const observation = [userMessage, assistantMessage]
      .filter(Boolean)
      .map((message) => ({
        id: message.id,
        role: message.role,
        content: String(message.content || '').slice(0, 20_000),
      }));
    const allowedOperations = resolveCastAgentOperations(castTracking, 'auto_sync');
    const resolvedProvider = resolveCastAgentSettings(database, userId, settings, castTracking, {
      config,
      mainThinkingLevel: options.mainThinkingLevel ?? options.thinkingLevel,
      mainThinkingEnabled: options.mainThinkingEnabled ?? options.thinkingEnabled,
    });
    const projectionMessages = buildCastProjectionMessages({ observation, castSnapshot, allowedOperations });
    const generationOptions = {
      thinkingEnabled: resolvedProvider.thinkingEnabled,
      ...(resolvedProvider.thinkingLevel ? { thinkingLevel: resolvedProvider.thinkingLevel } : {}),
      temperature: 0,
      maxTokens: 4_000,
      timeoutMs: 60_000,
      signal,
    };
    // A momentary gateway outage (429/5xx, empty credential pool) must not lose the turn.
    const result = await retryProviderCall(
      () => generate(resolvedProvider.settings, projectionMessages, generationOptions),
      { signal, retryDelaysMs: options.retryDelaysMs, onRetry: (error, attempt) => publish(conversationId, { status: 'running', messageId, retrying: attempt, error: error?.publicMessage || error?.message }) }
    );
    const generatedPlan = await parseOrRepairCastPlan({
      initialResult: result,
      generate,
      settings: resolvedProvider.settings,
      messages: projectionMessages,
      generationOptions,
      validationOptions: {
        sourceKind: 'auto_sync',
        scope: 'conversation',
        allowedOperations,
      },
    });
    const plan = generatedPlan.plan;
    const applied = applyCastChangePlan(database, userId, conversationId, plan, {
      sourceKind: 'auto_sync',
      scope: 'conversation',
      idempotencyKey,
      evidenceMessageIds: observation.map((message) => message.id),
      allowedOperations,
    });
    const status = publish(conversationId, {
      status: 'applied',
      messageId,
      summary: plan.summary,
      applied: applied.batch.result.applied,
      skipped: applied.batch.result.skipped,
      repairAttempted: generatedPlan.attempts > 1,
      providerSource: resolvedProvider.source,
      model: resolvedProvider.settings?.model || '',
      thinkingLevel: resolvedProvider.thinkingLevel || '',
      thinkingSource: resolvedProvider.thinkingSource,
    });
    return { ok: true, status, plan, reviewRequired: applied.batch.result.skipped > 0, attempts: generatedPlan.attempts, ...applied };
  } catch (error) {
    const failure = serializeCastPlanError(error);
    const status = publish(conversationId, {
      status: 'error',
      messageId,
      ...failure,
    });
    return { ok: false, status, ...failure, retryable: isTransientProviderError(error) || error?.name === 'TimeoutError' };
  }
}

function skip(publish, conversationId, messageId, summary, batch = null) {
  const status = publish(conversationId, { status: 'skipped', messageId, summary });
  return { ok: true, skipped: true, status, batch };
}
