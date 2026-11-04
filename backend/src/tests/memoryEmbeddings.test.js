import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppDatabase } from '../db/runtime.js';
import { openVectorDatabase } from '../db/vectorRuntime.js';
import { normalizeEmbeddingProfile, resolveEmbeddingProfile } from '../services/embeddings/profile.js';
import { embedTexts, indexMemoryDocuments, searchMemoryVectors, getActiveEmbeddingIndex } from '../services/embeddings/index.js';
import { createEmbeddingIndex, persistEmbeddingBatch, failEmbeddingIndex } from '../repositories/embeddingRepository.js';
import { getDailyUsage, updateUserQuota } from '../services/quotas.js';
import { createBackup, verifyBackupFile, preflightBackupRestore } from '../services/backup.js';
import { runBackupRestoreDrill } from '../services/backupRestoreDrill.js';

const settings = { providerType: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'chat-model', apiKey: 'test-only-key', retryBudget: 0 };
const profile = normalizeEmbeddingProfile({ providerProfileId: 'embed-provider', dimensions: 256, quotaUsdPerCny: 0.14 }, settings);

function fixture(filename = ':memory:') {
  const database = createAppDatabase(filename);
  database.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES('owner','owner','hash','now'),('other','other','hash','now')").run();
  database.prepare("INSERT INTO characters(id,user_id,name,created_at,updated_at) VALUES('character','owner','角色','now','now')").run();
  database.prepare("INSERT INTO conversations(id,user_id,character_id,title,created_at,updated_at) VALUES('story','owner','character','剧情','now','now'),('other-story','other','character','其他剧情','now','now')").run();
  return database;
}

function options(extra = {}) {
  return { userId: 'owner', conversationId: 'story', profile, settings, timelineRevision: 1, sourceRevision: 1, ...extra };
}

function vector(position = 0) {
  const result = new Array(256).fill(0);
  result[position % 256] = 1;
  return result;
}

function respond(body, id = 'request') {
  return new Response(JSON.stringify({ request_id: id, usage: { total_tokens: 1000 }, output: {
    embeddings: body.input.texts.map((text, index) => ({ text_index: index, embedding: vector(text.includes('钥匙') ? 0 : 1) })).reverse()
  } }), { headers: { 'Content-Type': 'application/json' } });
}

test('DashScope document/query batches preserve order, pin protocol, and settle CNY once', async () => {
  const database = fixture();
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, request) => {
    const body = JSON.parse(request.body);
    requests.push({ url, body });
    return respond(body, `request-${requests.length}`);
  };
  try {
    const result = await embedTexts(database, options({ texts: ['钥匙', ...new Array(20).fill('城门')] }));
    assert.equal(result.vectors.length, 21);
    assert.equal(result.vectors[0][0], 1);
    assert.equal(result.vectors[1][1], 1);
    assert.deepEqual(requests.map((r) => r.body.input.texts.length), [20, 1]);
    assert.equal(requests[0].url, 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding');
    assert.equal(requests[0].body.model, profile.model);
    assert.equal(requests[0].body.parameters.text_type, 'document');
    assert.equal(requests[0].body.parameters.dimension, 256);
    const usage = getDailyUsage(database, 'owner');
    assert.equal(usage.inputTokens, 2000);
    assert.equal(usage.costMicros, 36);
    const rows = database.prepare('SELECT * FROM memory_embedding_usage').all();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].currency, 'CNY');
    assert.equal(rows[0].cost_cny, 0.000125);
    assert.equal(rows[0].quota_usd_per_cny, 0.14);
    await embedTexts(database, options({ texts: ['钥匙在哪'], textType: 'query', operation: 'query' }));
    assert.equal(requests[2].body.parameters.text_type, 'query');
    assert.equal(requests[2].body.parameters.instruct, profile.queryInstruction);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test('same profile ID changes vector fingerprint; invalid models and missing exchange rate never call chat fallback', async () => {
  const database = fixture();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('unexpected'); };
  try {
    const updated = normalizeEmbeddingProfile({ ...profile, queryTemplateVersion: '2' }, settings);
    assert.notEqual(updated.fingerprint, profile.fingerprint);
    assert.notEqual(normalizeEmbeddingProfile(profile, { ...settings, baseUrl: 'https://another.example/v1' }).fingerprint, profile.fingerprint);
    assert.throws(() => normalizeEmbeddingProfile({ ...profile, model: 'any-chat-model' }, settings), { code: 'EMBEDDING_MODEL_UNSUPPORTED' });
    assert.throws(() => normalizeEmbeddingProfile({ ...profile, region: 'ap-southeast-1' }, settings), { code: 'EMBEDDING_REGION_UNPRICED' });
    assert.throws(() => normalizeEmbeddingProfile(profile, { ...settings, baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' }), { code: 'EMBEDDING_REGION_UNPRICED' });
    await assert.rejects(embedTexts(database, options({ profile: { ...profile, region: 'arbitrary-region' }, texts: ['秘密'] })), { code: 'EMBEDDING_REGION_UNPRICED' });
    await assert.rejects(embedTexts(null, options({ profile: { ...profile, region: 'ap-southeast-1' }, texts: ['秘密'] })), { code: 'EMBEDDING_REGION_UNPRICED' });
    await assert.rejects(embedTexts(database, options({ profile: { ...profile, quotaUsdPerCny: null }, texts: ['秘密'] })), { code: 'EMBEDDING_QUOTA_CONVERSION_REQUIRED' });
    assert.throws(() => resolveEmbeddingProfile(database, 'other', { enabled: true, providerProfileId: 'owners-provider' }), { code: 'EMBEDDING_PROFILE_MISSING' });
    assert.equal(calls, 0);
    assert.equal(getDailyUsage(database, 'owner').inputTokens, 0);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test('malformed vectors are rejected after accounting a successful provider invocation', async () => {
  const database = fixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ request_id: 'invalid', usage: { total_tokens: 1000 }, output: {
    embeddings: [{ text_index: 0, embedding: [1, 2] }]
  } }));
  try {
    await assert.rejects(embedTexts(database, options({ texts: ['证据'] })), { code: 'EMBEDDING_RESPONSE_INVALID' });
    assert.equal(getDailyUsage(database, 'owner').inputTokens, 1000);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM memory_embedding_usage').get().count, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM memory_embedding_documents').get().count, 0);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test('shadow indexing reuses unchanged vectors, filters actor eligibility before KNN, and caches read-only preview queries', async () => {
  const database = fixture();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, request) => respond(JSON.parse(request.body), `index-${++calls}`);
  try {
    const docs = [{ id: 'secret', kind: 'event', text: '钥匙藏在地窖', revision: 1 }, { id: 'public', kind: 'event', text: '城门关闭', revision: 1 }];
    const first = await indexMemoryDocuments(database, options({ documents: docs }));
    assert.equal(first.status, 'active');
    assert.equal(calls, 1);
    const readonly = await searchMemoryVectors(database, options({ query: '钥匙在哪', eligibleSourceIds: ['public'] }));
    assert.equal(readonly.reason, 'query_not_cached');
    assert.equal(calls, 1);
    const recalled = await searchMemoryVectors(database, options({ query: '钥匙在哪', eligibleSourceIds: ['public'], allowProviderCall: true }));
    assert.equal(recalled.reason, 'vector');
    assert.deepEqual(recalled.results.map((r) => r.sourceId), ['public']);
    const repeat = await searchMemoryVectors(database, options({ query: '钥匙在哪', eligibleSourceIds: ['public'] }));
    assert.deepEqual(repeat.results, recalled.results);
    assert.equal(calls, 2);
    const second = await indexMemoryDocuments(database, options({ sourceRevision: 2, documents: [...docs, { id: 'new', kind: 'event', text: '钥匙交给阿岚', revision: 1 }] }));
    assert.notEqual(second.id, first.id);
    assert.equal(calls, 3);
    assert.equal(second.document_count, 3);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM memory_vectors_256').get().count, 5);
    const stale = await searchMemoryVectors(database, options({ query: '钥匙', eligibleSourceIds: ['public'], sourceRevision: 1 }));
    assert.equal(stale.reason, 'source_changed');
    const other = await searchMemoryVectors(database, options({ userId: 'other', conversationId: 'other-story', query: '钥匙', eligibleSourceIds: ['secret'], allowProviderCall: true }));
    assert.equal(other.reason, 'index_pending');
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test('successful generations prune obsolete vectors by scope while retaining rollback, building and resumable failed work', async () => {
  const database = fixture();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, request) => respond(JSON.parse(request.body), `prune-${++calls}`);
  try {
    database.prepare("INSERT INTO conversations(id,user_id,character_id,title,created_at,updated_at) VALUES('sibling','owner','character','同用户其他剧情','now','now')").run();
    const foreign = await indexMemoryDocuments(database, options({ userId: 'other', conversationId: 'other-story', documents: [{ id: 'foreign', text: '其他用户剧情' }] }));
    const sibling = await indexMemoryDocuments(database, options({ conversationId: 'sibling', documents: [{ id: 'sibling', text: '同用户其他剧情' }] }));
    const first = await indexMemoryDocuments(database, options({ documents: [{ id: 'first', text: '钥匙遗失' }] }));
    const partialDocs = Array.from({ length: 21 }, (_, i) => ({ id: `partial-${i}`, text: `角色线索${i}` }));
    let batches = 0;
    globalThis.fetch = async (url, request) => ++batches === 1 ? respond(JSON.parse(request.body), `prune-${++calls}`) : new Response('{}');
    await assert.rejects(indexMemoryDocuments(database, options({ sourceRevision: 3, documents: partialDocs })), { code: 'EMBEDDING_RESPONSE_INVALID' });
    const failed = database.prepare("SELECT * FROM memory_embedding_indexes WHERE conversation_id='story' AND status='failed'").get();
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM memory_embedding_documents WHERE index_id=?').get(failed.id).count, 20);

    const scope = { ...options({ sourceRevision: 3 }), sourceHash: 'inflight', assertCurrent() {} };
    const building = createEmbeddingIndex(database, scope);
    persistEmbeddingBatch(database, scope, building, [{ id: 'building', kind: 'event', sourceHash: 'building', revision: 0, text: '构建中的线索' }], [vector()]);
    const oldScope = { ...scope, sourceRevision: 2, sourceHash: 'obsolete' };
    const obsolete = createEmbeddingIndex(database, oldScope);
    persistEmbeddingBatch(database, oldScope, obsolete, [{ id: 'obsolete', kind: 'event', sourceHash: 'obsolete', revision: 0, text: '过时的线索' }], [vector()]);
    failEmbeddingIndex(database, oldScope, obsolete, new Error('interrupted'));

    globalThis.fetch = async (url, request) => respond(JSON.parse(request.body), `prune-${++calls}`);
    const second = await indexMemoryDocuments(database, options({ sourceRevision: 3, documents: [{ id: 'second', text: '钥匙找到' }, { id: 'extra', text: '城门打开' }] }));
    const indexById = database.prepare('SELECT * FROM memory_embedding_indexes WHERE id=?');
    assert.equal(indexById.get(first.id).status, 'superseded');
    assert.equal(indexById.get(failed.id).status, 'failed');
    assert.equal(indexById.get(building.id).status, 'building');
    assert.equal(indexById.get(obsolete.id), undefined);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM memory_embedding_documents WHERE index_id=?').get(obsolete.id).count, 0);

    const callsBeforeResume = calls;
    const resumed = await indexMemoryDocuments(database, options({ sourceRevision: 3, documents: partialDocs }));
    assert.equal(resumed.id, failed.id);
    assert.equal(calls - callsBeforeResume, 1);
    assert.equal(indexById.get(first.id), undefined);
    assert.equal(indexById.get(second.id).status, 'superseded');
    assert.equal(indexById.get(building.id).status, 'building');
    assert.equal(indexById.get(foreign.id).status, 'active');
    assert.equal(indexById.get(sibling.id).status, 'active');
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM memory_embedding_indexes WHERE conversation_id='story' AND status IN ('active','superseded')").get().count, 2);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM memory_vectors_256').get().count, 26);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM memory_vectors_256 v LEFT JOIN memory_embedding_documents d ON d.id=v.document_id WHERE d.id IS NULL').get().count, 0);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test('concurrent identical queries share one billed invocation and failed queries fall back without poisoning a retry', async () => {
  const database = fixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, request) => respond(JSON.parse(request.body), 'shared-initial');
  try {
    const index = await indexMemoryDocuments(database, options({ documents: [{ id: 'public', text: '钥匙位于城门' }] }));
    let release;
    let calls = 0;
    globalThis.fetch = async (url, request) => {
      calls += 1;
      return new Promise(resolve => { release = () => resolve(respond(JSON.parse(request.body), 'shared-query')); });
    };
    const query = options({ query: '钥匙在哪里', eligibleSourceIds: ['public'], allowProviderCall: true });
    const first = searchMemoryVectors(database, query);
    const second = searchMemoryVectors(database, query);
    while (!release) await new Promise(resolve => setImmediate(resolve));
    release();
    const results = await Promise.all([first, second]);
    assert.equal(calls, 1);
    assert.equal(results[0].reason, 'vector');
    assert.deepEqual(results[0], results[1]);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM memory_embedding_usage WHERE operation='query'").get().count, 1);
    assert.equal(getDailyUsage(database, 'owner').inputTokens, 2000);
    assert.equal(getDailyUsage(database, 'owner').costMicros, 36);

    const retryQuery = { ...query, query: '城门何时打开' };
    globalThis.fetch = async () => new Response('{}');
    const failed = await searchMemoryVectors(database, retryQuery);
    assert.deepEqual(failed.results, []);
    assert.equal(failed.reason, 'EMBEDDING_RESPONSE_INVALID');
    assert.equal(getActiveEmbeddingIndex(database, 'owner', 'story').id, index.id);
    globalThis.fetch = async (url, request) => respond(JSON.parse(request.body), 'retried-query');
    const retried = await searchMemoryVectors(database, retryQuery);
    assert.equal(retried.reason, 'vector');
    assert.deepEqual(retried.results.map(row => row.sourceId), ['public']);
    assert.equal(getDailyUsage(database, 'owner').inputTokens, 3000);
    assert.equal(getDailyUsage(database, 'owner').costMicros, 55);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test('failed rebuild preserves the active generation; deleted conversation rejects late embeddings and cascades vectors', async () => {
  const database = fixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, request) => respond(JSON.parse(request.body), 'initial');
  try {
    const first = await indexMemoryDocuments(database, options({ documents: [{ id: 'first', text: '钥匙遗失' }] }));
    globalThis.fetch = async () => new Response('{}');
    await assert.rejects(indexMemoryDocuments(database, options({ sourceRevision: 2, documents: [{ id: 'second', text: '钥匙找到' }] })), { code: 'EMBEDDING_RESPONSE_INVALID' });
    assert.equal(getActiveEmbeddingIndex(database, 'owner', 'story').id, first.id);
    let release;
    globalThis.fetch = async (url, request) => new Promise((resolve) => { release = () => resolve(respond(JSON.parse(request.body), 'late')); });
    const pending = indexMemoryDocuments(database, options({ sourceRevision: 3, documents: [{ id: 'late', text: '钥匙出现' }] }));
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    database.prepare("DELETE FROM conversations WHERE id='story'").run();
    release();
    await assert.rejects(pending, { code: 'EMBEDDING_SOURCE_STALE' });
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM memory_embedding_documents').get().count, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM memory_vectors_256').get().count, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM memory_embedding_indexes').get().count, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM memory_embedding_usage').get().count, 0);
    // The successful late invocation is billed once even though the owning story no longer exists.
    assert.equal(getDailyUsage(database, 'owner').inputTokens, 2000);
    assert.equal(getDailyUsage(database, 'owner').costMicros, 37);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test('retired in-flight generation cannot write late vectors or displace a replacement with the same source counters', async () => {
  const database = fixture();
  const originalFetch = globalThis.fetch;
  let release;
  globalThis.fetch = async (url, request) => new Promise((resolve) => { release = () => resolve(respond(JSON.parse(request.body), 'retired-late')); });
  try {
    const pending = indexMemoryDocuments(database, options({ documents: [{ id: 'late', text: '恢复前的钥匙' }] }));
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    database.prepare("UPDATE memory_embedding_indexes SET status='stale' WHERE conversation_id='story'").run();
    globalThis.fetch = async (url, request) => respond(JSON.parse(request.body), 'replacement');
    const replacement = await indexMemoryDocuments(database, options({ documents: [{ id: 'current', text: '恢复后的城门' }] }));
    release();
    await assert.rejects(pending, { code: 'EMBEDDING_INDEX_STALE' });
    assert.equal(getActiveEmbeddingIndex(database, 'owner', 'story').id, replacement.id);
    assert.deepEqual(database.prepare('SELECT source_id FROM memory_embedding_documents').all().map(row=>row.source_id), ['current']);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM memory_vectors_256').get().count, 1);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test('quota is reserved before the embedding provider and cannot be bypassed by a low budget', async () => {
  const database = fixture();
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('unexpected'); };
  try {
    updateUserQuota(database, 'owner', { maxDailyCostMicros: 1 });
    await assert.rejects(embedTexts(database, options({ texts: ['剧情'] })), { code: 'DAILY_COST_QUOTA_EXCEEDED' });
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test('native vectors survive independent backup integrity, preflight and migration drill connections with loading disabled', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'flai-memory-vector-'));
  const filename = path.join(root, 'story.sqlite');
  const database = fixture(filename);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, request) => respond(JSON.parse(request.body), 'backup');
  try {
    await indexMemoryDocuments(database, options({ documents: [{ id: 'proof', text: '钥匙位于城门' }] }));
    assert.throws(() => database.loadExtension('arbitrary-path'), { code: 'ERR_INVALID_STATE' });
    const backup = createBackup({ database, databasePath: filename, label: 'vectors', withMetadata: true });
    assert.equal(verifyBackupFile(backup.path), 'ok');
    assert.equal(preflightBackupRestore({ databasePath: filename, filename: backup.filename }).canRestore, true);
    assert.equal(runBackupRestoreDrill({ databasePath: filename }).ok, true);
    const copy = openVectorDatabase(backup.path, { readOnly: true });
    try {
      assert.equal(copy.prepare('SELECT COUNT(*) AS count FROM memory_vectors_256').get().count, 1);
      assert.throws(() => copy.loadExtension('arbitrary-path'), { code: 'ERR_INVALID_STATE' });
    } finally { copy.close(); }
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});
