import { embedTexts } from './dashScope.js';
import { hashEmbeddingValue, embeddingError } from './profile.js';
import { createEmbeddingIndex, reuseEmbeddingDocuments, persistEmbeddingBatch, activateEmbeddingIndex,
  failEmbeddingIndex, getActiveEmbeddingIndex, queryEmbeddingIndex, embeddingUsageSummary } from '../../repositories/embeddingRepository.js';

export { resolveEmbeddingProfile, normalizeEmbeddingProfile, DEFAULT_EMBEDDING_MODEL } from './profile.js';
export { embedTexts } from './dashScope.js';
export { getActiveEmbeddingIndex, embeddingUsageSummary } from '../../repositories/embeddingRepository.js';

const queryCaches = new WeakMap();

/** Build/resume a shadow generation, reusing unchanged vectors, then switch atomically. */
export async function indexMemoryDocuments(database, options = {}) {
  const documents = normalizeDocuments(options.documents);
  const scope = guardedScope(database, options);
  scope.sourceHash = hashEmbeddingValue(documents.map((d) => [d.kind, d.id, d.sourceHash, d.revision]));
  const index = createEmbeddingIndex(database, scope);
  if (index.status === 'active') return index;
  try {
    const pending = [];
    for (let start = 0; start < documents.length; start += 100) {
      options.signal?.throwIfAborted();
      pending.push(...reuseEmbeddingDocuments(database, scope, index, documents.slice(start, start + 100)));
    }
    for (let start = 0; start < pending.length; start += 20) {
      const batch = pending.slice(start, start + 20);
      const result = await embedTexts(database, { ...scope, texts: batch.map((doc) => doc.text),
        textType: 'document', operation: options.operation === 'rebuild' ? 'rebuild' : 'ingest' });
      persistEmbeddingBatch(database, scope, index, batch, result.vectors);
      options.onProgress?.({ indexed: documents.length - pending.length + start + batch.length, total: documents.length });
    }
    return activateEmbeddingIndex(database, scope, index, documents.length);
  } catch (error) {
    failEmbeddingIndex(database, scope, index, error);
    throw error;
  }
}

/** Read-only by default: previews can reuse a query vector but cannot create a paid call. */
export async function searchMemoryVectors(database, options = {}) {
  const eligible = [...new Set((Array.isArray(options.eligibleSourceIds) ? options.eligibleSourceIds : []).map(String))].sort();
  if (!eligible.length || !options.profile || !String(options.query || '').trim()) return { results: [], reason: 'no_eligible_sources' };
  const index = getActiveEmbeddingIndex(database, options.userId, options.conversationId);
  if (!index) return { results: [], reason: 'index_pending' };
  if (index.fingerprint !== options.profile.fingerprint) return { results: [], reason: 'profile_changed' };
  if (options.sourceRevision !== undefined && Number(index.source_revision) !== Number(options.sourceRevision)) return { results: [], reason: 'source_changed' };
  const scope = guardedScope(database, options);
  scope.assertCurrent();
  let cache = queryCaches.get(database);
  if (!cache) { cache = new Map(); queryCaches.set(database, cache); }
  const key = hashEmbeddingValue([options.userId, options.conversationId, index.id, index.fingerprint, options.query, eligible]);
  let entry = cache.get(key);
  if (entry && entry.expires < Date.now()) { cache.delete(key); entry = null; }
  if (!entry && options.allowProviderCall !== true) return { results: [], reason: 'query_not_cached' };
  if (!entry) {
    const promise = embedTexts(database, { ...scope, texts: [String(options.query).slice(0, 16000)], textType: 'query', operation: 'query' })
      .then((result) => result.vectors[0]);
    entry = { promise, expires: Date.now() + 60_000 };
    cache.set(key, entry);
    if (cache.size > 64) cache.delete(cache.keys().next().value);
    promise.catch(() => { if (cache.get(key) === entry) cache.delete(key); });
  }
  try {
    const vector = await entry.promise;
    scope.assertCurrent();
    const current = getActiveEmbeddingIndex(database, options.userId, options.conversationId);
    if (current?.id !== index.id) return { results: [], reason: 'index_changed' };
    return { results: queryEmbeddingIndex(database, scope, index, vector, eligible, options.limit), reason: 'vector', indexId: index.id, fingerprint: index.fingerprint };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return { results: [], reason: String(error?.code || 'embedding_unavailable') };
  }
}

export function invalidateEmbeddingQueryCache(database) {
  queryCaches.delete(database);
}

function guardedScope(database, options) {
  const sourceRevision = Math.max(0, Number(options.sourceRevision ?? options.timelineRevision ?? 0));
  const assertCurrent = () => {
    options.signal?.throwIfAborted();
    const row = database.prepare('SELECT timeline_revision FROM conversations WHERE id=? AND user_id=?').get(options.conversationId, options.userId);
    if (!row || (options.timelineRevision !== undefined && Number(row.timeline_revision) !== Number(options.timelineRevision))) {
      throw embeddingError('EMBEDDING_SOURCE_STALE', '向量来源已改变或会话已删除，本次结果已丢弃。');
    }
    const state = database.prepare('SELECT revision FROM conversation_memory_state WHERE conversation_id=? AND user_id=?').get(options.conversationId, options.userId);
    if (state && options.sourceRevision !== undefined && Number(state.revision) !== sourceRevision) {
      throw embeddingError('EMBEDDING_SOURCE_STALE', '核心记忆已更新，本次向量结果已丢弃。');
    }
    options.assertCurrent?.();
  };
  return { ...options, sourceRevision, assertCurrent };
}

function normalizeDocuments(value) {
  if (!Array.isArray(value) || value.length > 100000) throw embeddingError('EMBEDDING_DOCUMENTS_INVALID', '向量文档列表无效。');
  const keys = new Set();
  return value.map((doc) => {
    const id = String(doc.id || '');
    const kind = String(doc.kind || 'event');
    const text = String(doc.text || '').normalize('NFC').trim();
    const key = `${kind}:${id}`;
    if (!id || !text || text.length > 16000 || keys.has(key)) throw embeddingError('EMBEDDING_DOCUMENTS_INVALID', '向量文档缺少来源、文本或包含重复来源。');
    keys.add(key);
    return { id, kind, text, revision: Math.max(0, Number(doc.revision || 0)),
      sourceHash: hashEmbeddingValue([doc.sourceHash || '', text]) };
  }).sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
}
