import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppDatabase } from '../db/runtime.js';
import { buildDiagnosticsExport } from '../services/diagnosticsExport.js';
import { buildProjectSnapshot } from '../services/projectSnapshot.js';
import { buildExportEnvelope, importExportEnvelope } from '../services/exportEnvelopes.js';
import { getStructuredStorageUsage } from '../services/quotas.js';
import { sumMemoryStorageBytes } from '../repositories/memoryStorageRepository.js';
import { createCharacter } from '../modules/characters.js';

function fixture() {
  const database = createAppDatabase(':memory:');
  database.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES('owner','owner','hash','now'),('other','other','hash','now')").run();
  const character = createCharacter(database, 'owner', { name: '角色', authorAdvancedSettings: {
    accessorySkills: { memoryAgent: { enabled: 'on', providerProfileId: 'private-extractor',
      memoryPolicy: { actorId: 'private-actor', isolation: 'actor' },
      embedding: { enabled: true, providerProfileId: 'private-embedding', quotaUsdPerCny: 0.14 } } }
  } });
  for (const user of ['owner', 'other']) database.prepare('INSERT INTO conversations(id,user_id,character_id,title,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .run(`${user}-story`, user, character.id, user, 'now', 'now');
  return { database, character };
}

function addRecords(database, user, content) {
  database.prepare(`INSERT INTO memory_events(id,user_id,conversation_id,memory_id,kind,content,narrative_order,source_hash,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(`${user}-event`, user, `${user}-story`, `${user}-memory`, 'event', content, 1, 'hash', 'now');
  database.prepare(`INSERT INTO memory_summaries(id,user_id,conversation_id,level,content,start_order,end_order,source_hash,profile_fingerprint,created_at)
    VALUES(?,?,?,'scene',?,1,1,'hash','profile','now')`).run(`${user}-summary`, user, `${user}-story`, content);
  database.prepare('INSERT INTO memory_summary_dependencies(summary_id,event_id,source_hash) VALUES(?,?,?)').run(`${user}-summary`, `${user}-event`, 'hash');
}

test('canonical UTF-8 memory and float32 vector payloads contribute to the correct user quota', () => {
  const { database } = fixture();
  try {
    const baseline = getStructuredStorageUsage(database, 'owner');
    addRecords(database, 'other', '另一位用户的秘密'.repeat(100));
    assert.equal(getStructuredStorageUsage(database, 'owner'), baseline);
    addRecords(database, 'owner', '钥匙');
    const memoryBytes = sumMemoryStorageBytes(database, 'owner');
    assert.ok(memoryBytes > Buffer.byteLength('钥匙') * 2);
    assert.equal(getStructuredStorageUsage(database, 'owner') - baseline, memoryBytes);
    const profile = '{}';
    database.prepare(`INSERT INTO memory_embedding_indexes
      (id,user_id,conversation_id,fingerprint,profile_json,dimensions,source_revision,source_hash,status,created_at,updated_at)
      VALUES('index','owner','owner-story','hash',?,256,1,'hash','building','now','now')`).run(profile);
    const beforeVector = sumMemoryStorageBytes(database, 'owner');
    database.prepare(`INSERT INTO memory_embedding_documents
      (id,index_id,user_id,conversation_id,source_id,source_kind,source_hash,source_revision,dimensions,text_bytes,created_at)
      VALUES('document','index','owner','owner-story','event','event','hash',1,256,6,'now')`).run();
    assert.ok(sumMemoryStorageBytes(database, 'owner') - beforeVector >= 256 * 4);
  } finally { database.close(); }
});

test('memory diagnostics and project inventories join summary dependencies to their owner and omit vector payloads', () => {
  const { database } = fixture();
  try {
    addRecords(database, 'owner', '公开记忆');
    addRecords(database, 'other', '另一个人的私有剧情');
    const diagnostics = buildDiagnosticsExport(database, 'owner');
    assert.equal(diagnostics.counts.memory_events, 1);
    assert.equal(diagnostics.counts.memory_summary_dependencies, 1);
    assert.equal(JSON.stringify(diagnostics).includes('另一个人的私有剧情'), false);
    const snapshot = buildProjectSnapshot(database, 'owner');
    assert.equal(snapshot.purpose, 'diagnostic_inventory');
    assert.equal(snapshot.restorable, false);
    assert.equal(snapshot.items.conversationMemoryInventory.recordCounts.memory_summary_dependencies, 1);
    assert.equal(snapshot.items.conversationMemoryInventory.restorable, false);
    assert.equal(JSON.stringify(snapshot).includes('另一个人的私有剧情'), false);
    assert.equal(Object.hasOwn(snapshot.items.conversationMemoryInventory, 'vectors'), false);
  } finally { database.close(); }
});

test('portable character export/import removes memory execution bindings and actors without including private story memory', () => {
  const { database, character } = fixture();
  try {
    addRecords(database, 'owner', '私密剧情不随角色分享');
    const envelope = buildExportEnvelope(database, 'owner', 'characters', { ids: [character.id] });
    const memory = envelope.items[0].authorAdvancedSettings.accessorySkills.memoryAgent;
    assert.equal(memory.providerProfileId, '');
    assert.equal(memory.memoryPolicy.actorId, '');
    assert.equal(memory.embedding.enabled, false);
    assert.equal(memory.embedding.providerProfileId, '');
    assert.equal(memory.embedding.quotaUsdPerCny, 0);
    assert.equal(JSON.stringify(envelope).includes('私密剧情不随角色分享'), false);
    assert.equal(JSON.stringify(envelope).includes('private-embedding'), false);
    const imported = importExportEnvelope(database, 'other', 'characters', {
      version: 1, kind: 'characters', items: [{ name: '导入角色', authorAdvancedSettings: {
        accessorySkills: { memoryAgent: { providerProfileId: 'owners-binding', embedding: { enabled: true, providerProfileId: 'owners-embedding' }, memoryPolicy: { actorId: 'owners-actor' } } }
      } }]
    });
    assert.equal(imported.imported, 1);
    const row = database.prepare('SELECT author_advanced_settings FROM characters WHERE id=?').get(imported.items[0].id);
    const saved = JSON.parse(row.author_advanced_settings).accessorySkills.memoryAgent;
    assert.equal(saved.providerProfileId, '');
    assert.equal(saved.embedding.enabled, false);
    assert.equal(saved.embedding.providerProfileId, '');
    assert.equal(saved.memoryPolicy.actorId, '');
    assert.equal(buildExportEnvelope(database, 'owner', 'conversation'), null);
  } finally { database.close(); }
});
