import { measureSync } from './performanceMetrics.js';

const SEARCH_TYPES = new Set(['message', 'memory', 'world-book']);

export function searchUserContent(database, userId, query, options = {}) {
  return measureSync('sqlite.fts.search', () => searchUserContentUnmeasured(database, userId, query, options));
}

function searchUserContentUnmeasured(database, userId, query, options = {}) {
  const limit = clampInteger(options.limit, 1, 100, 20);
  const types = normalizeTypes(options.types);
  const matchQuery = buildFtsQuery(query);
  if (!matchQuery) {
    return {
      query: String(query || ''),
      results: [],
      sources: buildSourceSummaries(types, new Map(), [], limit),
      truncated: false,
      truncationReason: ''
    };
  }
  const perTypeLimit = Math.min(101, limit + 1);
  const results = [];
  const candidatesByType = new Map();
  if (types.has('message')) {
    const messages = searchMessages(database, userId, matchQuery, perTypeLimit, options);
    candidatesByType.set('message', messages);
    results.push(...messages);
  }
  if (types.has('memory')) {
    const memories = searchMemories(database, userId, matchQuery, perTypeLimit, options);
    candidatesByType.set('memory', memories);
    results.push(...memories);
  }
  if (types.has('world-book')) {
    const worldBooks = searchWorldBooks(database, userId, matchQuery, perTypeLimit);
    candidatesByType.set('world-book', worldBooks);
    results.push(...worldBooks);
  }
  results.sort((left, right) => right.score - left.score || right.createdAt.localeCompare(left.createdAt));
  const truncated = results.length > limit;
  const page = truncated ? results.slice(0, limit) : results;
  return {
    query: String(query || '').trim(),
    results: page,
    sources: buildSourceSummaries(types, candidatesByType, page, limit),
    truncated,
    truncationReason: truncated ? 'result-limit' : ''
  };
}

export function buildFtsQuery(value) {
  const source = String(value || '').normalize('NFKC').slice(0, 1000);
  const tokens = source.match(/[\p{L}\p{N}_-]+/gu) || [];
  const unique = [];
  const seen = new Set();
  for (const token of tokens) {
    const normalized = token.toLocaleLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      unique.push(`"${normalized.replace(/"/g, '""')}"`);
    }
    if (unique.length >= 12) break;
  }
  return unique.join(' OR ');
}

function searchMessages(database, userId, matchQuery, limit, options) {
  const conversationId = String(options.conversationId || '').trim();
  return database.prepare(
    `SELECT source.entity_id, source.conversation_id, source.role, source.content,
            messages.created_at, bm25(fts_messages, 0, 0, 0, 1.0) AS text_rank
     FROM fts_messages source
     JOIN messages ON messages.id = source.entity_id
     WHERE fts_messages MATCH ? AND source.user_id = ?
       AND (? = '' OR source.conversation_id = ?)
     ORDER BY text_rank ASC LIMIT ?`
  ).all(matchQuery, userId, conversationId, conversationId, limit).map((row) => ({
    id: row.entity_id,
    type: 'message',
    conversationId: row.conversation_id,
    role: row.role,
    title: row.role,
    excerpt: excerpt(row.content),
    score: combinedScore(row.text_rank, row.created_at, 0),
    createdAt: row.created_at,
    evidence: { source: 'messages', id: row.entity_id }
  }));
}

function searchMemories(database, userId, matchQuery, limit, options) {
  const conversationId = String(options.conversationId || '').trim();
  return database.prepare(
    `SELECT source.entity_id, source.conversation_id, source.subject, source.content,
            memories.importance, memories.updated_at,
            bm25(fts_memories, 0, 0, 1.5, 1.0) AS text_rank
     FROM fts_memories source
     JOIN conversation_memories memories ON memories.id = source.entity_id
     WHERE fts_memories MATCH ? AND source.user_id = ?
       AND memories.enabled = 1 AND memories.archived = 0
       AND (? = '' OR source.conversation_id = ?)
     ORDER BY text_rank ASC LIMIT ?`
  ).all(matchQuery, userId, conversationId, conversationId, limit).map((row) => ({
    id: row.entity_id,
    type: 'memory',
    conversationId: row.conversation_id,
    title: row.subject || 'memory',
    excerpt: excerpt(row.content),
    score: combinedScore(row.text_rank, row.updated_at, Number(row.importance || 0)),
    importance: Number(row.importance || 0),
    createdAt: row.updated_at,
    evidence: { source: 'conversation_memories', id: row.entity_id }
  }));
}

function searchWorldBooks(database, userId, matchQuery, limit) {
  return database.prepare(
    `SELECT source.entity_id, source.world_book_id, source.name, source.content,
            entries.created_at, bm25(fts_world_book_entries, 0, 0, 0, 2.0, 1.5, 1.0) AS text_rank
     FROM fts_world_book_entries source
     JOIN world_book_entries entries ON entries.id = source.entity_id
     WHERE fts_world_book_entries MATCH ? AND source.user_id = ? AND entries.enabled = 1
     ORDER BY text_rank ASC LIMIT ?`
  ).all(matchQuery, userId, limit).map((row) => ({
    id: row.entity_id,
    type: 'world-book',
    worldBookId: row.world_book_id,
    title: row.name || 'world book entry',
    excerpt: excerpt(row.content),
    score: combinedScore(row.text_rank, row.created_at, 0),
    createdAt: row.created_at,
    evidence: { source: 'world_book_entries', id: row.entity_id }
  }));
}

function combinedScore(textRank, timestamp, importance) {
  const relevance = Math.max(0, -Number(textRank || 0)) * 100;
  const ageDays = Math.max(0, (Date.now() - Date.parse(timestamp || 0)) / 86_400_000);
  const recency = 1 / (1 + ageDays / 30);
  return round(relevance + recency + Math.max(0, importance) * 0.05);
}

function normalizeTypes(value) {
  if (!Array.isArray(value) || !value.length) return new Set(SEARCH_TYPES);
  const output = new Set();
  for (const item of value) {
    if (SEARCH_TYPES.has(item)) output.add(item);
  }
  return output.size ? output : new Set(SEARCH_TYPES);
}

function buildSourceSummaries(types, candidatesByType, returnedResults, budget) {
  const summaries = [];
  for (const type of types) {
    const candidates = candidatesByType.get(type) || [];
    const returned = returnedResults.filter((result) => result.type === type);
    const sourceLimitReached = candidates.length > budget;
    const globalLimitReached = returned.length < Math.min(candidates.length, budget);
    summaries.push({
      type,
      budget,
      candidates: candidates.length,
      returned: returned.length,
      truncated: sourceLimitReached || globalLimitReached,
      truncationReason: sourceLimitReached
        ? 'source-limit'
        : globalLimitReached ? 'global-result-limit' : '',
      evidence: returned.map((result) => result.evidence)
    });
  }
  return summaries;
}

function excerpt(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > 320 ? `${text.slice(0, 317)}...` : text;
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.floor(number))) : fallback;
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
