import { castNotFound } from '../../domain/cast/errors.js';
import {
  castConversationBelongsToUser,
  getCastAppearance,
  getCastBehavior,
  getCastMember,
  getCastMemberUsageCounts,
  getCastMemory,
  getCastProtagonist,
  getLatestCastChangeBatch,
  listCastActivities,
  listCastBehaviors,
  listCastMembers,
  listCastMemories,
  countCastMemories,
} from '../../repositories/castRepository.js';
import { getCastItem, listCastItems, listWorldItems } from '../../repositories/castItemRepository.js';
import { getCastAuditEvent, listCastAuditEvents } from '../../repositories/auditRepository.js';
import {
  getCastActivity,
  getCastEmotionState,
  getCastPersonalityAnchor,
  listCastEmotionHistory,
  listCastOocValidations,
  listCastTurnQueue,
  listConversationTurns,
} from '../../repositories/castRuntimeRepository.js';
import { clampInteger } from '../../utils/number.js';

export function getCastRoster(database, userId, conversationId, options = {}) {
  assertAccess(database, userId, conversationId);
  const members = listCastMembers(database, conversationId, {
    includeHidden: options.includeHidden !== false,
  }).map((member) => ({
    ...member,
    counts: getCastMemberUsageCounts(database, conversationId, member.id),
  }));
  const protagonist = members.find((member) => member.memberType === 'protagonist') || null;
  const npcs = members.filter((member) => member.memberType === 'npc');
  const visibleNpcs = npcs.filter((member) => member.visibility === 'visible');
  const latestSync = getLatestCastChangeBatch(database, conversationId, 'auto_sync');
  return {
    protagonist,
    npcs,
    stats: {
      total: members.length,
      visibleNpcs: visibleNpcs.length,
      hiddenNpcs: npcs.length - visibleNpcs.length,
      sealed: members.filter((member) => member.memorySealed).length,
    },
    sync: latestSync ? {
      status: latestSync.status,
      appliedAt: latestSync.appliedAt,
      summary: latestSync.result?.summary || '',
    } : { status: 'idle', appliedAt: '', summary: '' },
  };
}

export function getCastMemberDetail(database, userId, conversationId, memberId) {
  assertAccess(database, userId, conversationId);
  const member = getCastMember(database, conversationId, memberId);
  if (!member) throw castNotFound('Cast member not found');
  return {
    member,
    appearance: getCastAppearance(database, conversationId, memberId),
    counts: getCastMemberUsageCounts(database, conversationId, memberId),
  };
}

export function getCastMemories(database, userId, conversationId, memberId, options = {}) {
  requireMemberAccess(database, userId, conversationId, memberId);
  const limit = clampInteger(options.limit, 1, 200, 100);
  const offset = clampInteger(options.offset, 0, 100_000, 0);
  return {
    items: listCastMemories(database, conversationId, memberId, {
      limit,
      offset,
      includeForgotten: options.includeForgotten === true,
    }),
    total: countCastMemories(database, conversationId, memberId, {
      includeForgotten: options.includeForgotten === true,
    }),
    limit,
    offset,
  };
}

export function getCastMemoryEntry(database, userId, conversationId, memberId, memoryId) {
  requireMemberAccess(database, userId, conversationId, memberId);
  const memory = getCastMemory(database, conversationId, memberId, memoryId);
  if (!memory) throw castNotFound('Memory not found');
  return memory;
}

export function getCastBehaviors(database, userId, conversationId, memberId) {
  requireMemberAccess(database, userId, conversationId, memberId);
  return listCastBehaviors(database, conversationId, memberId);
}

export function getCastBehaviorEntry(database, userId, conversationId, memberId, behaviorId) {
  requireMemberAccess(database, userId, conversationId, memberId);
  const behavior = getCastBehavior(database, conversationId, memberId, behaviorId);
  if (!behavior) throw castNotFound('Behavior not found');
  return behavior;
}

export function getCastItems(database, userId, conversationId, memberId, options = {}) {
  requireMemberAccess(database, userId, conversationId, memberId);
  return listCastItems(database, conversationId, memberId, {
    limit: clampInteger(options.limit, 1, 300, 200),
    offset: clampInteger(options.offset, 0, 100_000, 0),
  });
}

export function getCastItemEntry(database, userId, conversationId, itemId) {
  assertAccess(database, userId, conversationId);
  const item = getCastItem(database, conversationId, itemId);
  if (!item) throw castNotFound('Item not found');
  return item;
}

export function getWorldItems(database, userId, conversationId, nodeId = '') {
  assertAccess(database, userId, conversationId);
  return listWorldItems(database, conversationId, nodeId);
}

export function getCastAudit(database, userId, conversationId, options = {}) {
  assertAccess(database, userId, conversationId);
  if (options.memberId && !getCastMember(database, conversationId, options.memberId)) {
    throw castNotFound('Cast member not found');
  }
  return listCastAuditEvents(database, conversationId, {
    memberId: options.memberId,
    limit: clampInteger(options.limit, 1, 100, 50),
    beforeCreatedAt: options.beforeCreatedAt,
    beforeId: options.beforeId,
  });
}

export function getCastAuditEntry(database, userId, conversationId, eventId) {
  assertAccess(database, userId, conversationId);
  const event = getCastAuditEvent(database, conversationId, eventId);
  if (!event) throw castNotFound('Audit event not found');
  return event;
}

export function getCastActivities(database, userId, conversationId, options = {}) {
  assertAccess(database, userId, conversationId);
  return listCastActivities(database, conversationId, options);
}

export function getCastActivityEntry(database, userId, conversationId, activityId) {
  assertAccess(database, userId, conversationId);
  const activity = getCastActivity(database, conversationId, activityId);
  if (!activity) throw castNotFound('Activity not found');
  return activity;
}

export function getCastCognition(database, userId, conversationId, memberId) {
  requireMemberAccess(database, userId, conversationId, memberId);
  return {
    personality: getCastPersonalityAnchor(database, conversationId, memberId),
    emotion: getCastEmotionState(database, conversationId, memberId),
  };
}

export function getCastEmotionTimeline(database, userId, conversationId, memberId, options = {}) {
  requireMemberAccess(database, userId, conversationId, memberId);
  return listCastEmotionHistory(
    database,
    conversationId,
    memberId,
    {
      limit: clampInteger(options.limit, 1, 200, 50),
      offset: clampInteger(options.offset, 0, 100_000, 0),
    }
  );
}

export function getCastTurnQueue(database, userId, conversationId, options = {}) {
  assertAccess(database, userId, conversationId);
  return listCastTurnQueue(database, conversationId, {
    status: String(options.status || ''),
  });
}

export function getCastConversationTurns(database, userId, conversationId, options = {}) {
  assertAccess(database, userId, conversationId);
  return listConversationTurns(database, conversationId, {
    limit: clampInteger(options.limit, 1, 500, 100),
    offset: clampInteger(options.offset, 0, 100_000, 0),
  });
}

export function getCastOocHistory(database, userId, conversationId, options = {}) {
  assertAccess(database, userId, conversationId);
  if (options.memberId) requireMemberAccess(database, userId, conversationId, options.memberId);
  return listCastOocValidations(
    database,
    conversationId,
    String(options.memberId || ''),
    {
      limit: clampInteger(options.limit, 1, 200, 50),
      offset: clampInteger(options.offset, 0, 100_000, 0),
    }
  );
}

export function getCastReadModel(database, userId, conversationId, options = {}) {
  const roster = getCastRoster(database, userId, conversationId, options);
  const members = [roster.protagonist, ...roster.npcs].filter(Boolean);
  return members.map((member) => ({
    member,
    appearance: getCastAppearance(database, conversationId, member.id),
    memories: listCastMemories(database, conversationId, member.id, {
      limit: clampInteger(options.memoryLimit, 1, 50, 12),
      includeForgotten: false,
    }),
    behaviors: listCastBehaviors(database, conversationId, member.id)
      .filter((behavior) => behavior.enabled)
      .slice(0, clampInteger(options.behaviorLimit, 1, 50, 12)),
    items: listCastItems(database, conversationId, member.id, {
      limit: clampInteger(options.itemLimit, 1, 100, 30),
    }),
  }));
}

export function getProtagonist(database, userId, conversationId) {
  assertAccess(database, userId, conversationId);
  const member = getCastProtagonist(database, conversationId);
  if (!member) throw castNotFound('Protagonist not found');
  return member;
}

function requireMemberAccess(database, userId, conversationId, memberId) {
  assertAccess(database, userId, conversationId);
  const member = getCastMember(database, conversationId, memberId);
  if (!member) throw castNotFound('Cast member not found');
  return member;
}

function assertAccess(database, userId, conversationId) {
  if (!castConversationBelongsToUser(database, userId, conversationId)) {
    throw castNotFound('Conversation not found');
  }
}
