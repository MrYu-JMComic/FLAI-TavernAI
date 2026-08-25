import {
  getCastActivities,
  getCastAudit,
  getCastBehaviors,
  getCastCognition,
  getCastConversationTurns,
  getCastEmotionTimeline,
  getCastItems,
  getCastMemories,
  getCastOocHistory,
  getCastRoster,
  getCastTurnQueue,
} from './castQueryService.js';

export function buildUserCastSnapshot(database, userId, conversationIds) {
  const conversations = [];
  for (const conversationId of conversationIds) {
    const roster = getCastRoster(database, userId, conversationId, { includeHidden: true });
    const members = [];
    for (const member of [roster.protagonist, ...roster.npcs].filter(Boolean)) {
      members.push({
        member,
        cognition: getCastCognition(database, userId, conversationId, member.id),
        memories: readAllMemories(database, userId, conversationId, member.id),
        behaviors: getCastBehaviors(database, userId, conversationId, member.id),
        items: readAllItems(database, userId, conversationId, member.id),
        emotionHistory: readAllEmotionHistory(database, userId, conversationId, member.id),
      });
    }
    conversations.push({
      conversationId,
      roster,
      members,
      activities: getCastActivities(database, userId, conversationId),
      turnQueue: getCastTurnQueue(database, userId, conversationId),
      turns: readAllTurns(database, userId, conversationId),
      oocValidations: readAllOocValidations(database, userId, conversationId),
      audit: readAllAudit(database, userId, conversationId),
    });
  }
  return { version: 1, conversations };
}

export function buildUserCastDiagnostics(database, userId, conversationIds) {
  const counts = {
    conversations: 0,
    members: 0,
    memories: 0,
    behaviors: 0,
    items: 0,
    appearances: 0,
    activities: 0,
  };
  for (const conversationId of conversationIds) {
    const roster = getCastRoster(database, userId, conversationId, { includeHidden: true });
    const members = [roster.protagonist, ...roster.npcs].filter(Boolean);
    counts.conversations += 1;
    counts.members += members.length;
    for (const member of members) {
      counts.memories += Number(member.counts?.memories || 0);
      counts.behaviors += Number(member.counts?.behaviors || 0);
      counts.items += Number(member.counts?.items || 0);
      counts.appearances += Number(member.counts?.appearances || 0);
      counts.activities += Number(member.counts?.activities || 0);
    }
  }
  return counts;
}

function readAllMemories(database, userId, conversationId, memberId) {
  const items = [];
  let offset = 0;
  while (true) {
    const page = getCastMemories(database, userId, conversationId, memberId, {
      limit: 200,
      offset,
      includeForgotten: true,
    });
    items.push(...page.items);
    offset += page.items.length;
    if (!page.items.length || offset >= page.total) return items;
  }
}

function readAllItems(database, userId, conversationId, memberId) {
  return readOffsetPages((offset) => getCastItems(
    database,
    userId,
    conversationId,
    memberId,
    { limit: 300, offset }
  ), 300);
}

function readAllEmotionHistory(database, userId, conversationId, memberId) {
  return readOffsetPages((offset) => getCastEmotionTimeline(
    database,
    userId,
    conversationId,
    memberId,
    { limit: 200, offset }
  ), 200);
}

function readAllTurns(database, userId, conversationId) {
  const turns = readOffsetPages((offset) => getCastConversationTurns(
    database,
    userId,
    conversationId,
    { limit: 500, offset }
  ), 500);
  return turns.sort((current, next) => (
    current.turnIndex - next.turnIndex
    || current.createdAt.localeCompare(next.createdAt)
    || current.id.localeCompare(next.id)
  ));
}

function readAllOocValidations(database, userId, conversationId) {
  return readOffsetPages((offset) => getCastOocHistory(
    database,
    userId,
    conversationId,
    { limit: 200, offset }
  ), 200);
}

function readOffsetPages(readPage, pageSize) {
  const items = [];
  let offset = 0;
  while (true) {
    const page = readPage(offset);
    items.push(...page);
    if (page.length < pageSize) return items;
    offset += page.length;
  }
}

function readAllAudit(database, userId, conversationId) {
  const items = [];
  let cursor = null;
  while (true) {
    const page = getCastAudit(database, userId, conversationId, {
      limit: 100,
      beforeCreatedAt: cursor?.createdAt,
      beforeId: cursor?.id,
    });
    items.push(...page.items);
    if (!page.hasMore || !page.nextCursor) return items;
    cursor = page.nextCursor;
  }
}
