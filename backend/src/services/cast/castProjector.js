import { normalizeAdvancedSettings } from '../../modules/advancedSettings.js';
import { generateCompletion } from '../providers.js';
import { getCastChangeBatchByKey } from '../../repositories/castRepository.js';
import { getCastReadModel } from './castQueryService.js';
import { applyCastChangePlan } from './castPlanService.js';
import { publishCastSyncStatus } from './castSyncStatus.js';
import { buildCastProjectionMessages } from '../prompts/castProjectionPrompt.js';
import { parseOrRepairCastPlan, serializeCastPlanError } from './castPlanGenerator.js';

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
  const idempotencyKey = `cast-sync:${messageId}`;
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
    const projectionMessages = buildCastProjectionMessages({ observation, castSnapshot });
    const generationOptions = {
      thinkingEnabled: false,
      temperature: 0,
      maxTokens: 4_000,
      timeoutMs: 60_000,
      signal,
    };
    const result = await generate(
      settings,
      projectionMessages,
      generationOptions
    );
    const generatedPlan = await parseOrRepairCastPlan({
      initialResult: result,
      generate,
      settings,
      messages: projectionMessages,
      generationOptions,
      validationOptions: {
        sourceKind: 'auto_sync',
        scope: 'conversation',
      },
    });
    const plan = generatedPlan.plan;
    const applied = applyCastChangePlan(database, userId, conversationId, plan, {
      sourceKind: 'auto_sync',
      scope: 'conversation',
      idempotencyKey,
      evidenceMessageIds: observation.map((message) => message.id),
    });
    const status = publish(conversationId, {
      status: 'applied',
      messageId,
      summary: plan.summary,
      applied: applied.batch.result.applied,
      repairAttempted: generatedPlan.attempts > 1,
    });
    return { ok: true, status, plan, attempts: generatedPlan.attempts, ...applied };
  } catch (error) {
    const failure = serializeCastPlanError(error);
    const status = publish(conversationId, {
      status: 'error',
      messageId,
      ...failure,
    });
    return { ok: false, status, ...failure };
  }
}

function skip(publish, conversationId, messageId, summary, batch = null) {
  const status = publish(conversationId, { status: 'skipped', messageId, summary });
  return { ok: true, skipped: true, status, batch };
}
