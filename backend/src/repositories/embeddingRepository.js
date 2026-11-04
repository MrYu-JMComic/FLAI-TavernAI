import { randomUUID } from 'node:crypto';
import { ensureVectorTable, vectorTableName } from '../db/vectorRuntime.js';
import { withSavepoint } from '../modules/savepoint.js';
import { assertStructuredStorageQuota } from '../services/quotas.js';

/** The source guards run in the same synchronous boundary as every derived write. */
export function createEmbeddingIndex(database, scope) {
  return withSavepoint(database, 'memory_embedding_create', () => {
    scope.assertCurrent();
    const existing = database.prepare(`SELECT * FROM memory_embedding_indexes WHERE user_id=? AND conversation_id=?
      AND fingerprint=? AND source_revision=? AND source_hash=? AND status IN ('building','active','failed') ORDER BY created_at DESC LIMIT 1`)
      .get(scope.userId, scope.conversationId, scope.profile.fingerprint, scope.sourceRevision, scope.sourceHash);
    if (existing) {
      if (existing.status === 'failed') database.prepare("UPDATE memory_embedding_indexes SET status='building',error_code='',updated_at=? WHERE id=?").run(new Date().toISOString(), existing.id);
      return { ...existing, status: existing.status === 'failed' ? 'building' : existing.status };
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    assertStructuredStorageQuota(database, scope.userId, Buffer.byteLength(JSON.stringify(scope.profile)) + 512);
    database.prepare(`INSERT INTO memory_embedding_indexes
      (id,user_id,conversation_id,fingerprint,profile_json,dimensions,source_revision,source_hash,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,'building',?,?)`).run(id, scope.userId, scope.conversationId, scope.profile.fingerprint,
      JSON.stringify(scope.profile), scope.profile.dimensions, scope.sourceRevision, scope.sourceHash, now, now);
    return database.prepare('SELECT * FROM memory_embedding_indexes WHERE id=?').get(id);
  });
}

/** Copy matching vectors inside SQLite; unchanged documents never incur a second provider call. */
export function reuseEmbeddingDocuments(database, scope, index, documents) {
  return withSavepoint(database, 'memory_embedding_reuse', () => {
    scope.assertCurrent();
    assertWritableEmbeddingIndex(database, scope, index);
    const presentQuery = database.prepare('SELECT id FROM memory_embedding_documents WHERE index_id=? AND source_kind=? AND source_id=? AND source_hash=?');
    const previousQuery = database.prepare(`SELECT d.id FROM memory_embedding_documents d JOIN memory_embedding_indexes i ON i.id=d.index_id
      WHERE d.user_id=? AND d.conversation_id=? AND i.fingerprint=? AND d.source_kind=? AND d.source_id=? AND d.source_hash=?
      ORDER BY i.updated_at DESC LIMIT 1`);
    const pending = [];
    const copies = [];
    for (const document of documents) {
      if (presentQuery.get(index.id, document.kind, document.id, document.sourceHash)) continue;
      const previous = previousQuery.get(scope.userId, scope.conversationId, scope.profile.fingerprint, document.kind, document.id, document.sourceHash);
      if (previous) copies.push({ document, previous });
      else pending.push(document);
    }
    if (!copies.length) return pending;
    assertStructuredStorageQuota(database, scope.userId, copies.reduce((total, copy) => total + documentStorageBytes(scope, copy.document), 0));
    const table = ensureVectorTable(database, scope.profile.dimensions);
    const copyQuery = database.prepare(`INSERT INTO ${table}(document_id,scope_key,embedding) SELECT ?,?,embedding FROM ${table} WHERE document_id=?`);
    for (const { document, previous } of copies) {
      const id = insertDocument(database, scope, index, document);
      copyQuery.run(id, scopeKey(scope.userId, scope.conversationId, index.id), previous.id);
    }
    return pending;
  });
}

export function persistEmbeddingBatch(database, scope, index, documents, vectors) {
  return withSavepoint(database, 'memory_embedding_batch', () => {
    scope.assertCurrent();
    assertWritableEmbeddingIndex(database, scope, index);
    assertStructuredStorageQuota(database, scope.userId, documents.reduce((total, doc) => total + documentStorageBytes(scope, doc), 0));
    const table = ensureVectorTable(database, scope.profile.dimensions);
    documents.forEach((document, position) => {
      const id = insertDocument(database, scope, index, document);
      database.prepare(`INSERT INTO ${table}(document_id,scope_key,embedding) VALUES(?,?,?)`)
        .run(id, scopeKey(scope.userId, scope.conversationId, index.id), vectorBytes(vectors[position], scope.profile.dimensions));
    });
  });
}

/** Replacement is visible only after the complete expected source set is present. */
export function activateEmbeddingIndex(database, scope, index, expectedCount) {
  return withSavepoint(database, 'memory_embedding_activate', () => {
    scope.assertCurrent();
    assertWritableEmbeddingIndex(database, scope, index);
    const count = Number(database.prepare('SELECT COUNT(*) AS count FROM memory_embedding_documents WHERE index_id=?').get(index.id).count);
    if (count !== expectedCount) throw Object.assign(new Error('Embedding generation is incomplete.'), { code: 'EMBEDDING_INDEX_INCOMPLETE' });
    const previous = getActiveEmbeddingIndex(database, scope.userId, scope.conversationId);
    const now = new Date().toISOString();
    database.prepare("UPDATE memory_embedding_indexes SET status='superseded',updated_at=? WHERE user_id=? AND conversation_id=? AND status='active' AND id<>?")
      .run(now, scope.userId, scope.conversationId, index.id);
    database.prepare("UPDATE memory_embedding_indexes SET status='active',document_count=?,error_code='',updated_at=? WHERE id=? AND status IN ('building','active')")
      .run(count, now, index.id);
    pruneEmbeddingGenerations(database, scope, previous?.id === index.id ? null : previous?.id);
    return getActiveEmbeddingIndex(database, scope.userId, scope.conversationId);
  });
}

/** Retain the active/previous complete generations and resumable work only within this conversation. */
export function pruneEmbeddingGenerations(database, scope, previousIndexId = null) {
  return withSavepoint(database, 'memory_embedding_prune', () => {
    scope.assertCurrent();
    const active = getActiveEmbeddingIndex(database, scope.userId, scope.conversationId);
    if (!active) return 0;
    const previous = previousIndexId
      ? database.prepare("SELECT id FROM memory_embedding_indexes WHERE id=? AND user_id=? AND conversation_id=? AND status='superseded'")
        .get(previousIndexId, scope.userId, scope.conversationId)
      : database.prepare("SELECT id FROM memory_embedding_indexes WHERE user_id=? AND conversation_id=? AND status='superseded' ORDER BY updated_at DESC,rowid DESC LIMIT 1")
        .get(scope.userId, scope.conversationId);
    // Cascades remove metadata and vec0 cleanup triggers release the corresponding vector copies.
    const result = database.prepare(`DELETE FROM memory_embedding_indexes WHERE user_id=? AND conversation_id=? AND id<>?
      AND (status IN ('superseded','stale') OR (status='failed' AND (source_revision<>? OR fingerprint<>?)))`)
      .run(scope.userId, scope.conversationId, previous?.id || '', active.source_revision, active.fingerprint);
    return Number(result.changes);
  });
}

export function failEmbeddingIndex(database, scope, index, error) {
  database.prepare("UPDATE memory_embedding_indexes SET status='failed',error_code=?,updated_at=? WHERE id=? AND user_id=? AND conversation_id=? AND status='building'")
    .run(String(error?.code || 'EMBEDDING_INDEX_FAILED').slice(0, 120), new Date().toISOString(), index.id, scope.userId, scope.conversationId);
}

export function getActiveEmbeddingIndex(database, userId, conversationId) {
  return database.prepare("SELECT * FROM memory_embedding_indexes WHERE user_id=? AND conversation_id=? AND status='active'").get(userId, conversationId) || null;
}

/** Eligibility is an input to native KNN, so forbidden documents cannot occupy top-k slots. */
export function queryEmbeddingIndex(database, scope, index, vector, eligibleSourceIds, limit = 24) {
  const table = vectorTableName(index.dimensions);
  return database.prepare(`SELECT d.source_id AS sourceId,d.source_kind AS kind,d.source_hash AS sourceHash,
      d.source_revision AS revision,v.distance FROM ${table} v JOIN memory_embedding_documents d ON d.id=v.document_id
    WHERE v.embedding MATCH ? AND v.k=? AND v.scope_key=? AND v.document_id IN
      (SELECT id FROM memory_embedding_documents WHERE index_id=? AND source_id IN (SELECT value FROM json_each(?)))
    ORDER BY v.distance`).all(vectorBytes(vector, index.dimensions), Math.min(64, Math.max(1, Number(limit) || 24)),
      scopeKey(scope.userId, scope.conversationId, index.id), index.id, JSON.stringify(eligibleSourceIds));
}

export function embeddingUsageSummary(database, userId, conversationId) {
  return database.prepare(`SELECT operation,SUM(input_tokens) AS inputTokens,SUM(cost_cny) AS costCny,
    currency,price_version AS priceVersion,COUNT(*) AS requests FROM memory_embedding_usage
    WHERE user_id=? AND conversation_id=? GROUP BY operation,currency,price_version`).all(userId, conversationId);
}

function insertDocument(database, scope, index, document) {
  const id = randomUUID();
  database.prepare(`INSERT INTO memory_embedding_documents
    (id,index_id,user_id,conversation_id,source_id,source_kind,source_hash,source_revision,dimensions,text_bytes,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id, index.id, scope.userId, scope.conversationId, document.id, document.kind,
      document.sourceHash, document.revision, scope.profile.dimensions, Buffer.byteLength(document.text), new Date().toISOString());
  return id;
}

/** A restore can retire one generation without changing its source counters; late work must still stop. */
function assertWritableEmbeddingIndex(database, scope, index) {
  const current = database.prepare(`SELECT id FROM memory_embedding_indexes WHERE id=? AND user_id=? AND conversation_id=?
    AND fingerprint=? AND source_revision=? AND source_hash=? AND status='building'`)
    .get(index.id, scope.userId, scope.conversationId, scope.profile.fingerprint, scope.sourceRevision, scope.sourceHash);
  if (!current) throw Object.assign(new Error('Embedding generation was retired or replaced.'), { code: 'EMBEDDING_INDEX_STALE' });
}

function scopeKey(userId, conversationId, indexId) {
  return JSON.stringify([userId, conversationId, indexId]);
}

function vectorBytes(vector, dimensions) {
  if (!Array.isArray(vector) || vector.length !== Number(dimensions)) throw new Error('Vector dimensions do not match index.');
  const values = new Float32Array(vector);
  if (values.some((value) => !Number.isFinite(value)) || !values.some((value) => value !== 0)) throw new Error('Invalid float32 vector.');
  return new Uint8Array(values.buffer);
}

function documentStorageBytes(scope, document) {
  return scope.profile.dimensions * 4 + Buffer.byteLength(document.id + document.kind + document.sourceHash) + 512;
}
