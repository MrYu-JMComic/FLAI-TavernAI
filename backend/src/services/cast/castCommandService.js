import { isDeepStrictEqual } from 'node:util';
import { newId, nowIso } from '../../security.js';
import { withSavepoint } from '../../modules/savepoint.js';
import {
  castBehaviorRuleKey,
  castContentKey,
  castNameKey,
  normalizeCastName,
  normalizeCastText,
  normalizeItemCode,
} from '../../domain/cast/normalization.js';
import { CAST_SOURCE_KINDS } from '../../domain/cast/constants.js';
import {
  CastDomainError,
  castConflict,
  castForbidden,
  castNotFound,
} from '../../domain/cast/errors.js';
import {
  castConversationBelongsToUser,
  deleteCastAppearance,
  deleteCastBehavior,
  deleteCastMember,
  deleteCastMemory,
  findCastBehaviorByRuleKey,
  findCastMemberByNameKey,
  findCastMemoryByContentKey,
  findCastNameClaim,
  getCastAppearance,
  getCastBehavior,
  getCastMember,
  getCastMemberUsageCounts,
  getCastMemory,
  getCastProtagonist,
  getConversationCharacter,
  insertCastActivity,
  insertCastBehavior,
  insertCastMember,
  insertCastMemory,
  listCastMembers,
  replaceCastAliases,
  updateCastBehavior,
  updateCastMember,
  updateCastMemory,
  upsertCastAppearance,
} from '../../repositories/castRepository.js';
import {
  deleteCastItem,
  findCastItemByCode,
  getCastItem,
  insertCastItem,
  sceneNodeBelongsToConversation,
  updateCastItem,
} from '../../repositories/castItemRepository.js';
import {
  findRollbackForEvent,
  getCastAuditEvent,
  insertCastAuditEvent,
} from '../../repositories/auditRepository.js';
import {
  getCastActivity,
  getCastEmotionState,
  getCastPersonalityAnchor,
  getCastTurnQueueEntry,
  getNextConversationTurnIndex,
  insertCastEmotionHistory,
  insertConversationTurn,
  insertCastOocValidation,
  replaceCastTurnQueueRecords,
  updateCastActivityRecord,
  updateCastTurnQueueRecord,
  upsertCastEmotionState,
  upsertCastPersonalityAnchor,
} from '../../repositories/castRuntimeRepository.js';

export function assertCastConversationAccess(database, userId, conversationId) {
  if (!castConversationBelongsToUser(database, userId, conversationId)) {
    throw castNotFound('Conversation not found');
  }
}

export function ensureConversationProtagonist(database, userId, conversationId, options = {}) {
  assertCastConversationAccess(database, userId, conversationId);
  const existing = getCastProtagonist(database, conversationId);
  if (existing) return existing;
  const character = getConversationCharacter(database, conversationId);
  if (!character) throw castNotFound('Conversation character not found');
  return createCastMember(database, userId, conversationId, {
    canonicalName: character.name || 'Protagonist',
    memberType: 'protagonist',
    confidence: 1,
  }, {
    sourceKind: 'manual',
    actor: options.actor || 'system',
    allowProtagonist: true,
  });
}

export function resolveCastMember(database, userId, conversationId, reference) {
  assertCastConversationAccess(database, userId, conversationId);
  const memberId = normalizeCastText(reference?.memberId, 160);
  if (memberId) {
    const member = getCastMember(database, conversationId, memberId);
    if (!member) throw castNotFound('Cast member not found');
    return member;
  }
  const nameKey = castNameKey(reference?.name);
  if (!nameKey) throw new CastDomainError('Cast member reference is required');
  const member = findCastMemberByNameKey(database, conversationId, nameKey);
  if (!member) throw castNotFound('Cast member not found');
  return member;
}

export function createCastMember(database, userId, conversationId, payload = {}, options = {}) {
  assertCastConversationAccess(database, userId, conversationId);
  return runCastMutation(database, () => {
    const context = normalizeCommandContext(userId, options);
    const canonicalName = normalizeCastName(payload.canonicalName ?? payload.name);
    if (!canonicalName) throw new CastDomainError('Cast member name is required');
    const memberType = payload.memberType === 'protagonist' ? 'protagonist' : 'npc';
    if (memberType === 'protagonist' && options.allowProtagonist !== true) {
      throw castForbidden('Protagonist identity cannot be created through this operation');
    }
    if (memberType === 'protagonist' && getCastProtagonist(database, conversationId)) {
      throw castConflict('Conversation already has a protagonist');
    }
    assertNameAvailable(database, conversationId, castNameKey(canonicalName));
    const aliases = normalizeAliases(payload.aliases, canonicalName);
    assertAliasesAvailable(database, conversationId, aliases);
    const currentSceneNodeId = normalizeSceneNodeId(database, conversationId, payload.currentSceneNodeId);
    const timestamp = nowIso();
    const member = insertCastMember(database, {
      id: normalizeCastText(payload.id, 160) || newId(),
      conversationId,
      memberType,
      canonicalName,
      nameKey: castNameKey(canonicalName),
      source: normalizeCastText(payload.source, 80) || context.sourceKind,
      evidence: normalizeCastText(payload.evidence ?? context.evidence?.quote, 4_000),
      confidence: clampUnit(payload.confidence, memberType === 'protagonist' ? 1 : 0),
      visibility: payload.visibility === 'hidden' ? 'hidden' : 'visible',
      status: normalizeCastText(payload.status, 80) || 'active',
      customStatus: normalizeCastText(payload.customStatus, 500),
      relationship: normalizeCastText(payload.relationship, 1_000),
      currentLocationLabel: normalizeCastText(payload.currentLocationLabel, 500),
      currentSceneNodeId,
      memorySealed: Boolean(payload.memorySealed),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    replaceCastAliases(database, conversationId, member.id, aliases.map((alias) => ({
      id: newId(),
      alias: alias.name,
      aliasKey: alias.key,
      createdAt: timestamp,
    })));
    const created = getCastMember(database, conversationId, member.id);
    recordAudit(database, context, {
      conversationId,
      memberId: created.id,
      subjectType: 'member',
      subjectId: created.id,
      action: 'member.create',
      before: null,
      after: created,
      beforeRevision: null,
      afterRevision: created.revision,
    });
    return created;
  });
}

export function updateCastMemberProfile(database, userId, conversationId, memberId, payload = {}, options = {}) {
  assertCastConversationAccess(database, userId, conversationId);
  return runCastMutation(database, () => {
    const context = normalizeCommandContext(userId, options);
    const before = requireMember(database, conversationId, memberId);
    if (before.memberType === 'protagonist' && payload.memberType && payload.memberType !== 'protagonist') {
      throw castForbidden('Protagonist identity cannot be changed');
    }
    const canonicalName = payload.canonicalName === undefined
      ? before.canonicalName
      : normalizeCastName(payload.canonicalName);
    if (!canonicalName) throw new CastDomainError('Cast member name is required');
    const nameKey = castNameKey(canonicalName);
    assertNameAvailable(database, conversationId, nameKey, before.id);
    const aliases = payload.aliases === undefined
      ? normalizeAliases(before.aliases, canonicalName)
      : normalizeAliases(payload.aliases, canonicalName);
    assertAliasesAvailable(database, conversationId, aliases, before.id);
    const currentSceneNodeId = payload.currentSceneNodeId === undefined
      ? before.currentSceneNodeId
      : normalizeSceneNodeId(database, conversationId, payload.currentSceneNodeId);
    const candidate = {
      ...before,
      canonicalName,
      nameKey,
      aliases: aliases.map((entry) => entry.name),
      source: context.sourceKind === 'manual' ? before.source : context.sourceKind,
      evidence: context.evidence?.quote
        ? normalizeCastText(context.evidence.quote, 4_000)
        : before.evidence,
      confidence: payload.confidence === undefined ? before.confidence : clampUnit(payload.confidence, before.confidence),
      visibility: normalizeVisibility(payload.visibility, before.visibility),
      status: payload.status === undefined ? before.status : normalizeCastText(payload.status, 80) || 'active',
      customStatus: payload.customStatus === undefined ? before.customStatus : normalizeCastText(payload.customStatus, 500),
      relationship: payload.relationship === undefined ? before.relationship : normalizeCastText(payload.relationship, 1_000),
      currentLocationLabel: payload.currentLocationLabel === undefined
        ? before.currentLocationLabel
        : normalizeCastText(payload.currentLocationLabel, 500),
      currentSceneNodeId,
      memorySealed: payload.memorySealed === undefined ? before.memorySealed : Boolean(payload.memorySealed),
      updatedAt: nowIso(),
    };
    if (sameResource(before, candidate)) return before;
    const expectedRevision = normalizeExpectedRevision(payload.revision, before.revision);
    const updated = updateCastMember(database, candidate, expectedRevision);
    if (!updated) throw castConflict('Cast member changed before this update was applied');
    replaceCastAliases(database, conversationId, before.id, aliases.map((alias) => ({
      id: newId(),
      alias: alias.name,
      aliasKey: alias.key,
      createdAt: candidate.updatedAt,
    })));
    const after = getCastMember(database, conversationId, before.id);
    recordAudit(database, context, {
      conversationId,
      memberId: before.id,
      subjectType: 'member',
      subjectId: before.id,
      action: 'member.update',
      before,
      after,
      beforeRevision: before.revision,
      afterRevision: after.revision,
    });
    return after;
  });
}

export function setCastMemberVisibility(database, userId, conversationId, memberId, visibility, options = {}) {
  const member = requireMemberWithAccess(database, userId, conversationId, memberId);
  if (member.memberType === 'protagonist' && visibility === 'hidden') {
    throw castForbidden('Protagonist cannot be hidden');
  }
  return updateCastMemberProfile(database, userId, conversationId, memberId, {
    visibility,
    revision: options.expectedRevision,
  }, options);
}

export function cleanupEmptyCastMembers(database, userId, conversationId, options = {}) {
  assertCastConversationAccess(database, userId, conversationId);
  const members = listCastMembers(database, conversationId, { includeHidden: false });
  const hiddenMemberIds = [];
  return runCastMutation(database, () => {
    for (const member of members) {
      if (member.memberType !== 'npc' || !isEmptyCastMember(database, conversationId, member)) continue;
      setCastMemberVisibility(database, userId, conversationId, member.id, 'hidden', options);
      hiddenMemberIds.push(member.id);
    }
    return { hiddenMemberIds, count: hiddenMemberIds.length };
  });
}

export function createCastMemory(database, userId, conversationId, memberId, payload = {}, options = {}) {
  assertCastConversationAccess(database, userId, conversationId);
  return runCastMutation(database, () => {
    const context = normalizeCommandContext(userId, options);
    const member = requireMember(database, conversationId, memberId);
    assertMemoryWritable(member, context);
    const content = normalizeCastText(payload.content, 20_000);
    if (!content) throw new CastDomainError('Memory content is required');
    const contentKey = castContentKey(content);
    const duplicate = findCastMemoryByContentKey(database, conversationId, member.id, contentKey);
    if (duplicate) {
      const reinforced = {
        ...duplicate,
        importance: Math.max(duplicate.importance, clampUnit(payload.importance, duplicate.importance)),
        emotionalIntensity: Math.max(
          duplicate.emotionalIntensity,
          clampUnit(payload.emotionalIntensity, duplicate.emotionalIntensity)
        ),
        lastReinforcedAt: nowIso(),
        reinforcementCount: duplicate.reinforcementCount + 1,
        forgottenAt: duplicate.forgottenAt || null,
        updatedAt: nowIso(),
      };
      const after = updateCastMemory(database, reinforced, duplicate.revision);
      if (!after) throw castConflict('Memory changed before it could be reinforced');
      recordAudit(database, context, {
        conversationId,
        memberId,
        subjectType: 'memory',
        subjectId: after.id,
        action: 'memory.reinforce',
        before: duplicate,
        after,
        beforeRevision: duplicate.revision,
        afterRevision: after.revision,
      });
      return after;
    }
    const timestamp = nowIso();
    const memory = normalizeMemoryPayload(database, conversationId, member, {
      ...payload,
      id: normalizeCastText(payload.id, 160) || newId(),
      content,
      contentKey,
      sourceKind: context.sourceKind,
      sourceMessageId: context.evidence?.messageId || payload.sourceMessageId,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const created = insertCastMemory(database, memory);
    recordAudit(database, context, {
      conversationId,
      memberId,
      subjectType: 'memory',
      subjectId: created.id,
      action: 'memory.create',
      before: null,
      after: created,
      beforeRevision: null,
      afterRevision: created.revision,
    });
    return created;
  });
}

export function updateCastMemoryEntry(
  database,
  userId,
  conversationId,
  memberId,
  memoryId,
  payload = {},
  options = {}
) {
  assertCastConversationAccess(database, userId, conversationId);
  return runCastMutation(database, () => {
    const context = normalizeCommandContext(userId, options);
    const member = requireMember(database, conversationId, memberId);
    assertMemoryWritable(member, context);
    const before = getCastMemory(database, conversationId, memberId, memoryId);
    if (!before) throw castNotFound('Memory not found');
    const content = payload.content === undefined
      ? before.content
      : normalizeCastText(payload.content, 20_000);
    if (!content) throw new CastDomainError('Memory content is required');
    const contentKey = castContentKey(content);
    const duplicate = findCastMemoryByContentKey(database, conversationId, memberId, contentKey);
    if (duplicate && duplicate.id !== before.id) throw castConflict('A matching memory already exists');
    const candidate = normalizeMemoryPayload(database, conversationId, member, {
      ...before,
      ...payload,
      id: before.id,
      content,
      contentKey,
      sourceKind: context.sourceKind === 'manual' ? before.sourceKind : context.sourceKind,
      sourceMessageId: context.evidence?.messageId || payload.sourceMessageId || before.sourceMessageId,
      createdAt: before.createdAt,
      updatedAt: nowIso(),
    });
    if (sameResource(before, candidate)) return before;
    const expectedRevision = normalizeExpectedRevision(payload.revision, before.revision);
    const after = updateCastMemory(database, candidate, expectedRevision);
    if (!after) throw castConflict('Memory changed before this update was applied');
    recordAudit(database, context, {
      conversationId,
      memberId,
      subjectType: 'memory',
      subjectId: memoryId,
      action: 'memory.update',
      before,
      after,
      beforeRevision: before.revision,
      afterRevision: after.revision,
    });
    return after;
  });
}

export function deleteCastMemoryEntry(
  database,
  userId,
  conversationId,
  memberId,
  memoryId,
  options = {}
) {
  assertCastConversationAccess(database, userId, conversationId);
  return runCastMutation(database, () => {
    const context = normalizeCommandContext(userId, options);
    const member = requireMember(database, conversationId, memberId);
    assertMemoryWritable(member, context);
    const before = getCastMemory(database, conversationId, memberId, memoryId);
    if (!before) throw castNotFound('Memory not found');
    const expectedRevision = normalizeExpectedRevision(options.expectedRevision, before.revision);
    if (!deleteCastMemory(database, conversationId, memberId, memoryId, expectedRevision)) {
      throw castConflict('Memory changed before it could be deleted');
    }
    recordAudit(database, context, {
      conversationId,
      memberId,
      subjectType: 'memory',
      subjectId: memoryId,
      action: 'memory.delete',
      before,
      after: null,
      beforeRevision: before.revision,
      afterRevision: null,
    });
    return { deletedId: memoryId };
  });
}

export function createCastBehavior(database, userId, conversationId, memberId, payload = {}, options = {}) {
  assertCastConversationAccess(database, userId, conversationId);
  return runCastMutation(database, () => {
    const context = normalizeCommandContext(userId, options);
    requireMember(database, conversationId, memberId);
    const triggerCondition = normalizeCastText(payload.triggerCondition, 2_000);
    const action = normalizeCastText(payload.action, 4_000);
    if (!action) throw new CastDomainError('Behavior action is required');
    const ruleKey = castBehaviorRuleKey(triggerCondition, action);
    const duplicate = findCastBehaviorByRuleKey(database, conversationId, memberId, ruleKey);
    if (duplicate) return duplicate;
    const timestamp = nowIso();
    const created = insertCastBehavior(database, {
      id: normalizeCastText(payload.id, 160) || newId(),
      conversationId,
      memberId,
      behaviorType: normalizeCastText(payload.behaviorType, 80) || 'reaction',
      triggerCondition,
      action,
      ruleKey,
      priority: clampInteger(payload.priority, -1_000, 1_000, 0),
      enabled: payload.enabled !== false,
      sourceKind: context.sourceKind,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    recordAudit(database, context, {
      conversationId,
      memberId,
      subjectType: 'behavior',
      subjectId: created.id,
      action: 'behavior.create',
      before: null,
      after: created,
      beforeRevision: null,
      afterRevision: created.revision,
    });
    return created;
  });
}

export function updateCastBehaviorEntry(
  database,
  userId,
  conversationId,
  memberId,
  behaviorId,
  payload = {},
  options = {}
) {
  assertCastConversationAccess(database, userId, conversationId);
  return runCastMutation(database, () => {
    const context = normalizeCommandContext(userId, options);
    requireMember(database, conversationId, memberId);
    const before = getCastBehavior(database, conversationId, memberId, behaviorId);
    if (!before) throw castNotFound('Behavior not found');
    const triggerCondition = payload.triggerCondition === undefined
      ? before.triggerCondition
      : normalizeCastText(payload.triggerCondition, 2_000);
    const action = payload.action === undefined
      ? before.action
      : normalizeCastText(payload.action, 4_000);
    if (!action) throw new CastDomainError('Behavior action is required');
    const ruleKey = castBehaviorRuleKey(triggerCondition, action);
    const duplicate = findCastBehaviorByRuleKey(database, conversationId, memberId, ruleKey);
    if (duplicate && duplicate.id !== before.id) throw castConflict('A matching behavior already exists');
    const candidate = {
      ...before,
      behaviorType: payload.behaviorType === undefined
        ? before.behaviorType
        : normalizeCastText(payload.behaviorType, 80) || 'reaction',
      triggerCondition,
      action,
      ruleKey,
      priority: payload.priority === undefined
        ? before.priority
        : clampInteger(payload.priority, -1_000, 1_000, before.priority),
      enabled: payload.enabled === undefined ? before.enabled : Boolean(payload.enabled),
      sourceKind: context.sourceKind === 'manual' ? before.sourceKind : context.sourceKind,
      updatedAt: nowIso(),
    };
    if (sameResource(before, candidate)) return before;
    const expectedRevision = normalizeExpectedRevision(payload.revision, before.revision);
    const after = updateCastBehavior(database, candidate, expectedRevision);
    if (!after) throw castConflict('Behavior changed before this update was applied');
    recordAudit(database, context, {
      conversationId,
      memberId,
      subjectType: 'behavior',
      subjectId: behaviorId,
      action: 'behavior.update',
      before,
      after,
      beforeRevision: before.revision,
      afterRevision: after.revision,
    });
    return after;
  });
}

export function deleteCastBehaviorEntry(
  database,
  userId,
  conversationId,
  memberId,
  behaviorId,
  options = {}
) {
  assertCastConversationAccess(database, userId, conversationId);
  return runCastMutation(database, () => {
    const context = normalizeCommandContext(userId, options);
    requireMember(database, conversationId, memberId);
    const before = getCastBehavior(database, conversationId, memberId, behaviorId);
    if (!before) throw castNotFound('Behavior not found');
    const expectedRevision = normalizeExpectedRevision(options.expectedRevision, before.revision);
    if (!deleteCastBehavior(database, conversationId, memberId, behaviorId, expectedRevision)) {
      throw castConflict('Behavior changed before it could be deleted');
    }
    recordAudit(database, context, {
      conversationId,
      memberId,
      subjectType: 'behavior',
      subjectId: behaviorId,
      action: 'behavior.delete',
      before,
      after: null,
      beforeRevision: before.revision,
      afterRevision: null,
    });
    return { deletedId: behaviorId };
  });
}

export function upsertCastMemberItem(database, userId, conversationId, memberId, payload = {}, options = {}) {
  assertCastConversationAccess(database, userId, conversationId);
  return runCastMutation(database, () => {
    const context = normalizeCommandContext(userId, options);
    requireMember(database, conversationId, memberId);
    const requestedId = normalizeCastText(payload.id ?? payload.itemId, 160);
    let before = requestedId ? getCastItem(database, conversationId, requestedId) : null;
    const name = normalizeCastText(payload.name ?? before?.name, 500);
    if (!name) throw new CastDomainError('Item name is required');
    const itemCode = normalizeItemCode(
      payload.itemCode ?? before?.itemCode,
      `${conversationId}:${memberId}:${requestedId || name}`
    );
    const codeMatch = findCastItemByCode(database, conversationId, itemCode);
    if (!before && codeMatch) before = codeMatch;
    if (before && before.ownerKind === 'cast' && before.ownerMemberId !== memberId) {
      throw castConflict('Item belongs to another cast member');
    }
    if (before && before.ownerKind === 'world' && options.allowWorldTransfer !== true) {
      throw castConflict('World item must be transferred explicitly');
    }
    if (codeMatch && before && codeMatch.id !== before.id) {
      throw castConflict('Item code is already in use');
    }
    const timestamp = nowIso();
    const candidate = normalizeItemPayload({
      ...before,
      ...payload,
      id: before?.id || requestedId || newId(),
      conversationId,
      nodeId: '',
      ownerKind: 'cast',
      ownerMemberId: memberId,
      itemCode,
      name,
      createdAt: before?.createdAt || timestamp,
      updatedAt: timestamp,
    });
    if (before && sameResource(before, candidate)) return before;
    const after = before
      ? updateCastItem(database, candidate, normalizeExpectedRevision(payload.revision, before.revision))
      : insertCastItem(database, candidate);
    if (!after) throw castConflict('Item changed before this update was applied');
    recordAudit(database, context, {
      conversationId,
      memberId,
      subjectType: 'item',
      subjectId: after.id,
      action: before ? 'item.update' : 'item.create',
      before,
      after,
      beforeRevision: before?.revision ?? null,
      afterRevision: after.revision,
    });
    return after;
  });
}

export function upsertWorldItem(database, userId, conversationId, payload = {}, options = {}) {
  assertCastConversationAccess(database, userId, conversationId);
  return runCastMutation(database, () => {
    const context = normalizeCommandContext(userId, options);
    const requestedId = normalizeCastText(payload.id ?? payload.itemId, 160);
    let before = requestedId ? getCastItem(database, conversationId, requestedId) : null;
    const name = normalizeCastText(payload.name ?? before?.name, 500);
    if (!name) throw new CastDomainError('Item name is required');
    const itemCode = normalizeItemCode(
      payload.itemCode ?? before?.itemCode,
      `${conversationId}:world:${requestedId || name}`
    );
    const codeMatch = findCastItemByCode(database, conversationId, itemCode);
    if (!before && codeMatch) before = codeMatch;
    if (before && before.ownerKind !== 'world') {
      throw castConflict('Cast item must be transferred explicitly');
    }
    if (codeMatch && before && codeMatch.id !== before.id) {
      throw castConflict('Item code is already in use');
    }
    const nodeId = normalizeSceneNodeId(database, conversationId, payload.nodeId ?? before?.nodeId);
    if (!nodeId) throw new CastDomainError('World item needs a scene node');
    const timestamp = nowIso();
    const candidate = normalizeItemPayload({
      ...before,
      ...payload,
      id: before?.id || requestedId || newId(),
      conversationId,
      nodeId,
      ownerKind: 'world',
      ownerMemberId: '',
      itemCode,
      name,
      equipped: false,
      createdAt: before?.createdAt || timestamp,
      updatedAt: timestamp,
    });
    if (before && sameResource(before, candidate)) return before;
    const after = before
      ? updateCastItem(database, candidate, normalizeExpectedRevision(payload.revision, before.revision))
      : insertCastItem(database, candidate);
    if (!after) throw castConflict('Item changed before this update was applied');
    recordAudit(database, context, {
      conversationId,
      memberId: '',
      subjectType: 'item',
      subjectId: after.id,
      action: before ? 'item.update' : 'item.create',
      before,
      after,
      beforeRevision: before?.revision ?? null,
      afterRevision: after.revision,
    });
    return after;
  });
}

export function transferCastItem(database, userId, conversationId, itemId, destination = {}, options = {}) {
  assertCastConversationAccess(database, userId, conversationId);
  return runCastMutation(database, () => {
    const context = normalizeCommandContext(userId, options);
    const before = getCastItem(database, conversationId, itemId);
    if (!before) throw castNotFound('Item not found');
    const memberId = normalizeCastText(destination.memberId, 160);
    const nodeId = normalizeCastText(destination.nodeId, 160);
    if (Boolean(memberId) === Boolean(nodeId)) {
      throw new CastDomainError('Item transfer needs exactly one destination');
    }
    let candidate;
    let auditMemberId = before.ownerMemberId;
    if (memberId) {
      requireMember(database, conversationId, memberId);
      auditMemberId = memberId;
      candidate = {
        ...before,
        nodeId: '',
        ownerKind: 'cast',
        ownerMemberId: memberId,
        updatedAt: nowIso(),
      };
    } else {
      if (!sceneNodeBelongsToConversation(database, conversationId, nodeId)) {
        throw castNotFound('Scene node not found');
      }
      candidate = {
        ...before,
        nodeId,
        ownerKind: 'world',
        ownerMemberId: '',
        equipped: false,
        updatedAt: nowIso(),
      };
    }
    if (sameResource(before, candidate)) return before;
    const after = updateCastItem(
      database,
      candidate,
      normalizeExpectedRevision(destination.revision ?? options.expectedRevision, before.revision)
    );
    if (!after) throw castConflict('Item changed before it could be transferred');
    recordAudit(database, context, {
      conversationId,
      memberId: auditMemberId,
      subjectType: 'item',
      subjectId: itemId,
      action: 'item.transfer',
      before,
      after,
      beforeRevision: before.revision,
      afterRevision: after.revision,
    });
    return after;
  });
}

export function deleteCastMemberItem(database, userId, conversationId, memberId, itemId, options = {}) {
  assertCastConversationAccess(database, userId, conversationId);
  return runCastMutation(database, () => {
    const context = normalizeCommandContext(userId, options);
    requireMember(database, conversationId, memberId);
    const before = getCastItem(database, conversationId, itemId);
    if (!before || before.ownerKind !== 'cast' || before.ownerMemberId !== memberId) {
      throw castNotFound('Item not found');
    }
    if (!deleteCastItem(
      database,
      conversationId,
      itemId,
      normalizeExpectedRevision(options.expectedRevision, before.revision)
    )) {
      throw castConflict('Item changed before it could be deleted');
    }
    recordAudit(database, context, {
      conversationId,
      memberId,
      subjectType: 'item',
      subjectId: itemId,
      action: 'item.delete',
      before,
      after: null,
      beforeRevision: before.revision,
      afterRevision: null,
    });
    return { deletedId: itemId };
  });
}

export function deleteWorldItem(database, userId, conversationId, itemId, options = {}) {
  assertCastConversationAccess(database, userId, conversationId);
  return runCastMutation(database, () => {
    const context = normalizeCommandContext(userId, options);
    const before = getCastItem(database, conversationId, itemId);
    if (!before || before.ownerKind !== 'world') throw castNotFound('World item not found');
    if (!deleteCastItem(
      database,
      conversationId,
      itemId,
      normalizeExpectedRevision(options.expectedRevision, before.revision)
    )) {
      throw castConflict('Item changed before it could be deleted');
    }
    recordAudit(database, context, {
      conversationId,
      memberId: '',
      subjectType: 'item',
      subjectId: itemId,
      action: 'item.delete',
      before,
      after: null,
      beforeRevision: before.revision,
      afterRevision: null,
    });
    return { deletedId: itemId };
  });
}

export function updateCastMemberAppearance(database, userId, conversationId, memberId, payload = {}, options = {}) {
  assertCastConversationAccess(database, userId, conversationId);
  return runCastMutation(database, () => {
    const context = normalizeCommandContext(userId, options);
    requireMember(database, conversationId, memberId);
    const before = getCastAppearance(database, conversationId, memberId);
    const timestamp = nowIso();
    const candidate = {
      memberId,
      conversationId,
      summary: payload.summary === undefined ? (before?.summary || '') : normalizeCastText(payload.summary, 8_000),
      outfit: payload.outfit === undefined ? (before?.outfit || '') : normalizeCastText(payload.outfit, 4_000),
      injuries: normalizeArray(payload.injuries, before?.injuries || [], 64),
      transformations: normalizeArray(payload.transformations, before?.transformations || [], 64),
      details: normalizeObject(payload.details, before?.details || {}),
      createdAt: before?.createdAt || timestamp,
      updatedAt: timestamp,
    };
    if (before && sameResource(before, candidate)) return before;
    const after = upsertCastAppearance(
      database,
      candidate,
      before ? normalizeExpectedRevision(payload.revision, before.revision) : null
    );
    if (!after) throw castConflict('Appearance changed before this update was applied');
    recordAudit(database, context, {
      conversationId,
      memberId,
      subjectType: 'appearance',
      subjectId: memberId,
      action: before ? 'appearance.update' : 'appearance.create',
      before,
      after,
      beforeRevision: before?.revision ?? null,
      afterRevision: after.revision,
    });
    return after;
  });
}

export function createCastActivity(database, userId, conversationId, memberId, payload = {}, options = {}) {
  assertCastConversationAccess(database, userId, conversationId);
  return runCastMutation(database, () => {
    const context = normalizeCommandContext(userId, options);
    requireMember(database, conversationId, memberId);
    const title = normalizeCastText(payload.title, 500);
    if (!title) throw new CastDomainError('Activity title is required');
    const locationNodeId = normalizeSceneNodeId(database, conversationId, payload.locationNodeId);
    const startTick = clampInteger(payload.startTick, 0, Number.MAX_SAFE_INTEGER, 0);
    const endTick = clampInteger(payload.endTick, startTick, Number.MAX_SAFE_INTEGER, startTick);
    const timestamp = nowIso();
    const activity = {
      id: normalizeCastText(payload.id, 160) || newId(),
      conversationId,
      memberId,
      title,
      locationNodeId,
      status: normalizeActivityStatus(payload.status, 'scheduled'),
      startTick,
      endTick,
      sourceKind: context.sourceKind,
      metadata: normalizeObject(payload.metadata, {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    insertCastActivity(database, activity);
    recordAudit(database, context, {
      conversationId,
      memberId,
      subjectType: 'activity',
      subjectId: activity.id,
      action: 'activity.create',
      before: null,
      after: activity,
      beforeRevision: null,
      afterRevision: 1,
      metadata: { rollbackable: false },
    });
    return activity;
  });
}

export function updateCastActivity(database, userId, conversationId, activityId, payload = {}, options = {}) {
  assertCastConversationAccess(database, userId, conversationId);
  return runCastMutation(database, () => {
    const context = normalizeCommandContext(userId, options);
    const before = getCastActivity(database, conversationId, activityId);
    if (!before) throw castNotFound('Activity not found');
    requireMember(database, conversationId, before.memberId);
    const startTick = payload.startTick === undefined
      ? before.startTick
      : clampInteger(payload.startTick, 0, Number.MAX_SAFE_INTEGER, before.startTick);
    const endTick = payload.endTick === undefined
      ? before.endTick
      : clampInteger(payload.endTick, startTick, Number.MAX_SAFE_INTEGER, before.endTick);
    const status = normalizeActivityStatus(payload.status, before.status);
    const candidate = {
      ...before,
      title: payload.title === undefined
        ? before.title
        : normalizeCastText(payload.title, 500),
      locationNodeId: payload.locationNodeId === undefined
        ? before.locationNodeId
        : normalizeSceneNodeId(database, conversationId, payload.locationNodeId),
      status,
      startTick,
      endTick,
      metadata: payload.metadata === undefined
        ? before.metadata
        : normalizeObject(payload.metadata, {}),
      updatedAt: nowIso(),
    };
    if (!candidate.title) throw new CastDomainError('Activity title is required');
    if (sameResource(before, candidate)) return before;
    const after = updateCastActivityRecord(database, candidate);
    if (!after) throw castConflict('Activity changed before this update was applied');
    recordAudit(database, context, {
      conversationId,
      memberId: before.memberId,
      subjectType: 'activity',
      subjectId: before.id,
      action: 'activity.update',
      before,
      after,
      beforeRevision: null,
      afterRevision: null,
      metadata: { rollbackable: false },
    });
    return after;
  });
}

export function setCastPersonalityAnchor(database, userId, conversationId, memberId, anchor, options = {}) {
  assertCastConversationAccess(database, userId, conversationId);
  return runCastMutation(database, () => {
    const context = normalizeCommandContext(userId, options);
    requireMember(database, conversationId, memberId);
    const before = getCastPersonalityAnchor(database, conversationId, memberId);
    const normalizedAnchor = normalizeStructuredPayload(anchor, 64_000, 'Personality anchor');
    if (before && isDeepStrictEqual(before.anchor, normalizedAnchor)) return before;
    const timestamp = nowIso();
    const after = upsertCastPersonalityAnchor(database, {
      memberId,
      conversationId,
      anchor: normalizedAnchor,
      createdAt: before?.createdAt || timestamp,
      updatedAt: timestamp,
    }, before ? normalizeExpectedRevision(options.expectedRevision, before.revision) : null);
    if (!after) throw castConflict('Personality anchor changed before this update was applied');
    recordAudit(database, context, {
      conversationId,
      memberId,
      subjectType: 'personality_anchor',
      subjectId: memberId,
      action: before ? 'personality.update' : 'personality.create',
      before,
      after,
      beforeRevision: before?.revision ?? null,
      afterRevision: after.revision,
      metadata: { rollbackable: false },
    });
    return after;
  });
}

export function setCastEmotionState(database, userId, conversationId, memberId, emotion, options = {}) {
  assertCastConversationAccess(database, userId, conversationId);
  return runCastMutation(database, () => {
    const context = normalizeCommandContext(userId, options);
    requireMember(database, conversationId, memberId);
    const before = getCastEmotionState(database, conversationId, memberId);
    const normalizedEmotion = normalizeStructuredPayload(emotion, 16_000, 'Emotion state');
    const timestamp = nowIso();
    let after = before;
    if (!before || !isDeepStrictEqual(before.emotion, normalizedEmotion)) {
      after = upsertCastEmotionState(database, {
        memberId,
        conversationId,
        emotion: normalizedEmotion,
        updatedAt: timestamp,
      }, before ? normalizeExpectedRevision(options.expectedRevision, before.revision) : null);
      if (!after) throw castConflict('Emotion state changed before this update was applied');
      recordAudit(database, context, {
        conversationId,
        memberId,
        subjectType: 'emotion_state',
        subjectId: memberId,
        action: before ? 'emotion.update' : 'emotion.create',
        before,
        after,
        beforeRevision: before?.revision ?? null,
        afterRevision: after.revision,
        metadata: { rollbackable: false },
      });
    }
    if (options.recordHistory === true) {
      insertCastEmotionHistory(database, {
        id: newId(),
        conversationId,
        memberId,
        emotion: normalizedEmotion,
        impact: normalizeStructuredPayload(options.impact || {}, 16_000, 'Emotion impact'),
        trigger: normalizeCastText(options.trigger, 2_000),
        createdAt: timestamp,
      });
    }
    return after;
  });
}

export function replaceCastTurnQueue(database, userId, conversationId, memberIds = [], options = {}) {
  assertCastConversationAccess(database, userId, conversationId);
  return runCastMutation(database, () => {
    const context = normalizeCommandContext(userId, options);
    const uniqueMemberIds = uniqueStrings(memberIds, 24, 160);
    if (!uniqueMemberIds.length) throw new CastDomainError('Turn queue needs at least one cast member');
    const timestamp = nowIso();
    const entries = uniqueMemberIds.map((memberId, orderIndex) => {
      const member = requireMember(database, conversationId, memberId);
      if (member.memberType !== 'npc') throw castForbidden('Only NPC members can enter the turn queue');
      if (member.visibility !== 'visible') throw castForbidden('Hidden cast members cannot enter the turn queue');
      return {
        id: newId(),
        conversationId,
        memberId,
        status: 'pending',
        orderIndex,
        payload: normalizeStructuredPayload(options.payloadByMember?.[memberId] || {}, 8_000, 'Turn payload'),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    });
    const after = replaceCastTurnQueueRecords(database, conversationId, entries);
    recordAudit(database, context, {
      conversationId,
      memberId: '',
      subjectType: 'turn_queue',
      subjectId: conversationId,
      action: 'turn_queue.replace',
      before: null,
      after,
      beforeRevision: null,
      afterRevision: null,
      metadata: { rollbackable: false },
    });
    return after;
  });
}

export function updateCastTurnQueueEntry(database, userId, conversationId, entryId, payload = {}, options = {}) {
  assertCastConversationAccess(database, userId, conversationId);
  return runCastMutation(database, () => {
    const context = normalizeCommandContext(userId, options);
    const before = getCastTurnQueueEntry(database, conversationId, entryId);
    if (!before) throw castNotFound('Turn queue entry not found');
    requireMember(database, conversationId, before.memberId);
    const candidate = {
      ...before,
      status: normalizeTurnStatus(payload.status, before.status),
      orderIndex: payload.orderIndex === undefined
        ? before.orderIndex
        : clampInteger(payload.orderIndex, 0, 10_000, before.orderIndex),
      payload: payload.payload === undefined
        ? before.payload
        : normalizeStructuredPayload(payload.payload, 8_000, 'Turn payload'),
      updatedAt: nowIso(),
    };
    if (sameResource(before, candidate)) return before;
    const after = updateCastTurnQueueRecord(database, candidate);
    if (!after) throw castConflict('Turn queue entry changed before this update was applied');
    recordAudit(database, context, {
      conversationId,
      memberId: before.memberId,
      subjectType: 'turn_queue',
      subjectId: before.id,
      action: 'turn_queue.update',
      before,
      after,
      beforeRevision: null,
      afterRevision: null,
      metadata: { rollbackable: false },
    });
    return after;
  });
}

export function recordCastConversationTurn(database, userId, conversationId, payload = {}) {
  assertCastConversationAccess(database, userId, conversationId);
  return runCastMutation(database, () => {
    const speakerKind = normalizeSpeakerKind(payload.speakerKind);
    const speakerMemberId = normalizeCastText(payload.speakerMemberId, 160);
    let speakerName = normalizeCastText(payload.speakerName, 160);
    if (speakerKind === 'cast') {
      const member = requireMember(database, conversationId, speakerMemberId);
      speakerName = member.canonicalName;
    } else if (speakerMemberId) {
      throw new CastDomainError('Only cast turns may reference a cast member');
    }
    const content = normalizeCastText(payload.content, 50_000);
    if (!content) throw new CastDomainError('Turn content is required');
    return insertConversationTurn(database, {
      id: normalizeCastText(payload.id, 160) || newId(),
      conversationId,
      speakerKind,
      speakerMemberId,
      speakerName,
      content,
      turnIndex: payload.turnIndex === undefined
        ? getNextConversationTurnIndex(database, conversationId)
        : clampInteger(payload.turnIndex, 0, Number.MAX_SAFE_INTEGER, 0),
      metadata: normalizeStructuredPayload(payload.metadata || {}, 16_000, 'Turn metadata'),
      createdAt: nowIso(),
    });
  });
}

export function recordCastOocValidation(database, userId, conversationId, memberId, payload = {}) {
  assertCastConversationAccess(database, userId, conversationId);
  return runCastMutation(database, () => {
    requireMember(database, conversationId, memberId);
    return insertCastOocValidation(database, {
      id: newId(),
      conversationId,
      memberId,
      responseText: normalizeCastText(payload.responseText, 50_000),
      matchScore: Math.min(100, Math.max(0, Number(payload.matchScore) || 0)),
      passed: Boolean(payload.passed),
      violations: uniqueStrings(payload.violations, 100, 2_000),
      createdAt: nowIso(),
    });
  });
}

export function rollbackCastAuditEvent(database, userId, conversationId, eventId, options = {}) {
  assertCastConversationAccess(database, userId, conversationId);
  return runCastMutation(database, () => {
    const event = getCastAuditEvent(database, conversationId, eventId);
    if (!event) throw castNotFound('Audit event not found');
    if (event.rollbackOfEventId || event.action === 'rollback') {
      throw castConflict('Rollback events cannot be rolled back again');
    }
    if (findRollbackForEvent(database, conversationId, eventId)) {
      throw castConflict('Audit event has already been rolled back');
    }
    if (event.afterRevision == null && event.after !== null) {
      throw castConflict('Legacy audit event has no revision and cannot be rolled back safely');
    }
    const context = normalizeCommandContext(userId, { ...options, actor: options.actor || `user:${userId}` });
    const current = getRollbackSubject(database, conversationId, event);
    if (event.after === null) {
      if (current) throw castConflict('Deleted resource has been recreated; rollback would overwrite it');
      const restored = restoreDeletedSubject(database, conversationId, event);
      const rollbackEvent = recordRollbackAudit(database, context, event, null, restored);
      return { event: rollbackEvent, resource: restored };
    }
    if (!current || current.revision !== event.afterRevision) {
      throw castConflict('Resource changed after this audit event');
    }
    if (event.before === null) {
      removeCreatedSubject(database, conversationId, event, current);
      const rollbackEvent = recordRollbackAudit(database, context, event, current, null);
      return { event: rollbackEvent, resource: null };
    }
    const restored = restoreUpdatedSubject(database, conversationId, event, current);
    const rollbackEvent = recordRollbackAudit(database, context, event, current, restored);
    return { event: rollbackEvent, resource: restored };
  });
}

function getRollbackSubject(database, conversationId, event) {
  if (event.subjectType === 'member') return getCastMember(database, conversationId, event.subjectId);
  if (event.subjectType === 'memory') {
    return getCastMemory(database, conversationId, event.memberId, event.subjectId);
  }
  if (event.subjectType === 'behavior') {
    return getCastBehavior(database, conversationId, event.memberId, event.subjectId);
  }
  if (event.subjectType === 'item') return getCastItem(database, conversationId, event.subjectId);
  if (event.subjectType === 'appearance') {
    return getCastAppearance(database, conversationId, event.memberId || event.subjectId);
  }
  throw castConflict(`Rollback is not supported for ${event.subjectType}`);
}

function restoreUpdatedSubject(database, conversationId, event, current) {
  const snapshot = { ...event.before, updatedAt: nowIso() };
  if (event.subjectType === 'member') {
    const after = updateCastMember(database, snapshot, current.revision);
    if (!after) throw castConflict('Member changed during rollback');
    const aliases = normalizeAliases(event.before.aliases, event.before.canonicalName);
    assertAliasesAvailable(database, conversationId, aliases, current.id);
    replaceCastAliases(database, conversationId, current.id, aliases.map((alias) => ({
      id: newId(), alias: alias.name, aliasKey: alias.key, createdAt: snapshot.updatedAt,
    })));
    return getCastMember(database, conversationId, current.id);
  }
  if (event.subjectType === 'memory') {
    const after = updateCastMemory(database, snapshot, current.revision);
    if (!after) throw castConflict('Memory changed during rollback');
    return after;
  }
  if (event.subjectType === 'behavior') {
    const after = updateCastBehavior(database, snapshot, current.revision);
    if (!after) throw castConflict('Behavior changed during rollback');
    return after;
  }
  if (event.subjectType === 'item') {
    const after = updateCastItem(database, snapshot, current.revision);
    if (!after) throw castConflict('Item changed during rollback');
    return after;
  }
  if (event.subjectType === 'appearance') {
    const after = upsertCastAppearance(database, snapshot, current.revision);
    if (!after) throw castConflict('Appearance changed during rollback');
    return after;
  }
  throw castConflict('Unsupported rollback subject');
}

function restoreDeletedSubject(database, conversationId, event) {
  const snapshot = { ...event.before, conversationId, updatedAt: nowIso() };
  if (event.subjectType === 'memory') return insertCastMemory(database, snapshot);
  if (event.subjectType === 'behavior') return insertCastBehavior(database, snapshot);
  if (event.subjectType === 'item') return insertCastItem(database, snapshot);
  if (event.subjectType === 'appearance') return upsertCastAppearance(database, snapshot, null);
  throw castConflict(`Deleted ${event.subjectType} resources cannot be restored`);
}

function removeCreatedSubject(database, conversationId, event, current) {
  if (event.subjectType === 'member') {
    const usage = getCastMemberUsageCounts(database, conversationId, current.id);
    if (Object.values(usage).some((count) => count > 0)) {
      throw castConflict('Member has dependent data and cannot be removed by rollback');
    }
    if (current.memberType === 'protagonist') {
      throw castForbidden('Protagonist creation cannot be rolled back');
    }
    if (!deleteCastMember(database, conversationId, current.id, current.revision)) {
      throw castConflict('Member changed during rollback');
    }
    return;
  }
  let removed = false;
  if (event.subjectType === 'memory') {
    removed = deleteCastMemory(database, conversationId, event.memberId, event.subjectId, current.revision);
  } else if (event.subjectType === 'behavior') {
    removed = deleteCastBehavior(database, conversationId, event.memberId, event.subjectId, current.revision);
  } else if (event.subjectType === 'item') {
    removed = deleteCastItem(database, conversationId, event.subjectId, current.revision);
  } else if (event.subjectType === 'appearance') {
    removed = deleteCastAppearance(database, conversationId, event.memberId || event.subjectId, current.revision);
  }
  if (!removed) throw castConflict('Resource changed during rollback');
}

function recordRollbackAudit(database, context, original, before, after) {
  return recordAudit(database, context, {
    conversationId: original.conversationId,
    memberId: original.memberId,
    subjectType: original.subjectType,
    subjectId: original.subjectId,
    action: 'rollback',
    before,
    after,
    beforeRevision: before?.revision ?? null,
    afterRevision: after?.revision ?? null,
    rollbackOfEventId: original.id,
    metadata: { originalAction: original.action },
  });
}

function normalizeMemoryPayload(database, conversationId, member, payload) {
  const linkedMemoryIds = uniqueStrings(payload.linkedMemoryIds, 32, 160);
  const sharedMemberIds = uniqueStrings(payload.sharedMemberIds, 32, 160);
  for (const memoryId of linkedMemoryIds) {
    if (memoryId !== payload.id && !getCastMemory(database, conversationId, member.id, memoryId)) {
      throw castNotFound('Linked memory not found');
    }
  }
  for (const sharedMemberId of sharedMemberIds) {
    if (!getCastMember(database, conversationId, sharedMemberId)) {
      throw castNotFound('Shared cast member not found');
    }
  }
  return {
    id: payload.id,
    conversationId,
    memberId: member.id,
    memoryType: normalizeCastText(payload.memoryType, 80) || 'event',
    content: payload.content,
    contentKey: payload.contentKey,
    layer: normalizeCastText(payload.layer, 80) || 'short_term',
    importance: clampUnit(payload.importance, 0.5),
    emotionalIntensity: clampUnit(payload.emotionalIntensity, 0),
    decayRate: clampUnit(payload.decayRate, 0),
    lastReinforcedAt: normalizeNullableText(payload.lastReinforcedAt, 80),
    reinforcementCount: clampInteger(payload.reinforcementCount, 0, 1_000_000, 0),
    forgottenAt: normalizeNullableText(payload.forgottenAt, 80),
    linkedMemoryIds,
    sharedMemberIds,
    sourceKind: normalizeSourceKind(payload.sourceKind),
    sourceMessageId: normalizeCastText(payload.sourceMessageId, 160),
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
  };
}

function normalizeItemPayload(payload) {
  return {
    id: payload.id,
    conversationId: payload.conversationId,
    nodeId: normalizeCastText(payload.nodeId, 160),
    ownerKind: payload.ownerKind === 'world' ? 'world' : 'cast',
    ownerMemberId: normalizeCastText(payload.ownerMemberId, 160),
    itemCode: payload.itemCode,
    name: payload.name,
    description: normalizeCastText(payload.description, 8_000),
    state: normalizeObject(payload.state, {}),
    position: normalizeObject(payload.position, {}),
    movable: payload.movable !== false,
    itemKind: normalizeCastText(payload.itemKind, 80) || 'item',
    quantity: clampInteger(payload.quantity, 0, 1_000_000, 1),
    clothingSlot: normalizeCastText(payload.clothingSlot, 80),
    equipped: Boolean(payload.equipped),
    coverage: uniqueStrings(payload.coverage, 32, 120),
    iconKey: normalizeCastText(payload.iconKey, 120),
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
  };
}

function normalizeCommandContext(userId, options) {
  const sourceKind = normalizeSourceKind(options.sourceKind);
  return {
    sourceKind,
    actor: normalizeCastText(options.actor, 120) || (sourceKind === 'manual' ? `user:${userId}` : sourceKind),
    batchId: normalizeCastText(options.batchId, 160),
    evidence: options.evidence || null,
  };
}

function normalizeSourceKind(value) {
  const normalized = String(value || 'manual');
  return CAST_SOURCE_KINDS.includes(normalized) ? normalized : 'manual';
}

function normalizeAliases(values, canonicalName) {
  const canonicalKey = castNameKey(canonicalName);
  const seen = new Set();
  const aliases = [];
  for (const value of Array.isArray(values) ? values.slice(0, 24) : []) {
    const name = normalizeCastName(value);
    const key = castNameKey(name);
    if (!name || key === canonicalKey || seen.has(key)) continue;
    seen.add(key);
    aliases.push({ name, key });
  }
  return aliases;
}

function assertAliasesAvailable(database, conversationId, aliases, ignoredMemberId = '') {
  for (const alias of aliases) {
    assertNameAvailable(database, conversationId, alias.key, ignoredMemberId);
  }
}

function assertNameAvailable(database, conversationId, nameKey, ignoredMemberId = '') {
  const claim = findCastNameClaim(database, conversationId, nameKey);
  if (claim && claim.memberId !== ignoredMemberId) {
    throw castConflict('Cast name or alias is already in use');
  }
}

function normalizeSceneNodeId(database, conversationId, value) {
  const nodeId = normalizeCastText(value, 160);
  if (!nodeId) return '';
  if (!sceneNodeBelongsToConversation(database, conversationId, nodeId)) {
    throw castNotFound('Scene node not found');
  }
  return nodeId;
}

function requireMember(database, conversationId, memberId) {
  const member = getCastMember(database, conversationId, memberId);
  if (!member) throw castNotFound('Cast member not found');
  return member;
}

function requireMemberWithAccess(database, userId, conversationId, memberId) {
  assertCastConversationAccess(database, userId, conversationId);
  return requireMember(database, conversationId, memberId);
}

function assertMemoryWritable(member, context) {
  if (member.memorySealed && context.sourceKind !== 'manual') {
    throw castForbidden('Sealed memories can only be changed manually');
  }
}

function isEmptyCastMember(database, conversationId, member) {
  const usage = getCastMemberUsageCounts(database, conversationId, member.id);
  const hasProfile = Boolean(
    member.evidence
    || member.customStatus
    || member.relationship
    || member.currentLocationLabel
    || member.aliases.length
    || member.memorySealed
  );
  return !hasProfile && Object.values(usage).every((count) => count === 0);
}

function recordAudit(database, context, data) {
  return insertCastAuditEvent(database, {
    id: newId(),
    batchId: context.batchId,
    actor: context.actor,
    createdAt: nowIso(),
    ...data,
    metadata: {
      ...(data.metadata || {}),
      sourceKind: context.sourceKind,
      evidence: context.evidence || null,
    },
  });
}

function runCastMutation(database, operation) {
  try {
    return withSavepoint(database, 'sp_cast_command', operation);
  } catch (error) {
    if (error instanceof CastDomainError) throw error;
    const message = String(error?.message || '');
    if (message.includes('UNIQUE constraint failed')) {
      throw castConflict('Cast data conflicts with an existing record');
    }
    if (message.includes('CHECK constraint failed') || message.includes('FOREIGN KEY constraint failed')) {
      throw new CastDomainError('Cast data violates a storage constraint');
    }
    throw error;
  }
}

function sameResource(before, candidate) {
  return isDeepStrictEqual(stripResourceMeta(before), stripResourceMeta(candidate));
}

function stripResourceMeta(value) {
  if (!value) return value;
  const clone = { ...value };
  delete clone.revision;
  delete clone.createdAt;
  delete clone.updatedAt;
  return clone;
}

function normalizeExpectedRevision(value, fallback) {
  const revision = Number(value ?? fallback);
  if (!Number.isInteger(revision) || revision < 1) {
    throw new CastDomainError('A valid resource revision is required');
  }
  return revision;
}

function normalizeVisibility(value, fallback) {
  if (value === undefined) return fallback;
  if (value !== 'visible' && value !== 'hidden') {
    throw new CastDomainError('Visibility must be visible or hidden');
  }
  return value;
}

function normalizeActivityStatus(value, fallback) {
  const status = normalizeCastText(value, 80) || fallback;
  if (!['scheduled', 'active', 'completed', 'cancelled', 'blocked'].includes(status)) {
    throw new CastDomainError('Invalid activity status');
  }
  return status;
}

function normalizeTurnStatus(value, fallback) {
  const status = normalizeCastText(value, 80) || fallback;
  if (!['pending', 'active', 'completed', 'skipped', 'failed'].includes(status)) {
    throw new CastDomainError('Invalid turn queue status');
  }
  return status;
}

function normalizeSpeakerKind(value) {
  const kind = normalizeCastText(value, 40) || 'system';
  if (!['user', 'assistant', 'cast', 'system'].includes(kind)) {
    throw new CastDomainError('Invalid turn speaker kind');
  }
  return kind;
}

function normalizeStructuredPayload(value, maxCharacters, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CastDomainError(`${label} must be an object`);
  }
  let json;
  try {
    json = JSON.stringify(value);
  } catch {
    throw new CastDomainError(`${label} must be JSON serializable`);
  }
  if (json.length > maxCharacters) {
    throw new CastDomainError(`${label} is too large`);
  }
  return JSON.parse(json);
}

function normalizeNullableText(value, maxLength) {
  if (value == null || value === '') return null;
  return normalizeCastText(value, maxLength);
}

function normalizeArray(value, fallback, limit) {
  if (value === undefined) return structuredClone(fallback);
  if (!Array.isArray(value)) throw new CastDomainError('Expected an array');
  return structuredClone(value.slice(0, limit));
}

function normalizeObject(value, fallback) {
  if (value === undefined) return structuredClone(fallback);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CastDomainError('Expected an object');
  }
  return structuredClone(value);
}

function uniqueStrings(value, limit, maxLength) {
  const seen = new Set();
  const result = [];
  for (const entry of Array.isArray(value) ? value.slice(0, limit) : []) {
    const normalized = normalizeCastText(entry, maxLength);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function clampUnit(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(1, Math.max(0, numeric)) : fallback;
}

function clampInteger(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}
