import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const dbModule = await import('../db.js');
const { createAppDatabase, initializeDatabase } = dbModule;
const runtimeModule = await import('../db/runtime.js');
const { isDatabaseLockedError } = runtimeModule;
const dbRuntimeSource = readFileSync(new URL('../db/runtime.js', import.meta.url), 'utf8');

function indexColumns(database, indexName) {
  return database
    .prepare(`PRAGMA index_info(${indexName})`)
    .all()
    .map((row) => row.name);
}

function indexSql(database, indexName) {
  return database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(indexName)?.sql || '';
}

function explainDetails(database, sql, ...params) {
  return database
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...params)
    .map((row) => row.detail)
    .join('\n');
}

function assertPlanUsesIndex(database, indexName, sql, ...params) {
  assert.match(explainDetails(database, sql, ...params), new RegExp(`USING (?:COVERING )?INDEX ${indexName}`));
}

test('database module preserves public exports after structure split', () => {
  assert.equal(typeof dbModule.backendRoot, 'string');
  assert.equal(typeof dbModule.dataDir, 'string');
  assert.equal(typeof dbModule.avatarUploadDir, 'string');
  assert.equal(typeof dbModule.ensureStorageDirs, 'function');
  assert.equal(typeof createAppDatabase, 'function');
  assert.equal(typeof initializeDatabase, 'function');
  assert.ok(dbModule.db);
});

test('database startup configures lock tolerance before WAL setup', () => {
  const busyTimeoutIndex = dbRuntimeSource.indexOf("database.exec('PRAGMA busy_timeout = 5000')");
  const walSetupIndex = dbRuntimeSource.indexOf("execWithDatabaseLockRetry(database, 'PRAGMA journal_mode = WAL')");
  assert.ok(busyTimeoutIndex > -1);
  assert.ok(walSetupIndex > -1);
  assert.ok(busyTimeoutIndex < walSetupIndex);
  assert.match(dbRuntimeSource, /function execWithDatabaseLockRetry\(database, statement, options = \{\}\) \{/);
  assert.match(dbRuntimeSource, /waitForDatabaseRetry\(delayMs \* attempt\);/);
});

test('database startup recognizes sqlite lock errors for retry handling', () => {
  assert.equal(isDatabaseLockedError({
    code: 'ERR_SQLITE_ERROR',
    errcode: 261,
    errstr: 'database is locked'
  }), true);
  assert.equal(isDatabaseLockedError({
    code: 'ERR_SQLITE_ERROR',
    errcode: 6,
    message: 'database table is locked'
  }), true);
  assert.equal(isDatabaseLockedError({
    code: 'ERR_SQLITE_ERROR',
    errcode: 1,
    message: 'syntax error'
  }), false);
});

test('database initialization creates expected high-value composite indexes', () => {
  const database = createAppDatabase(':memory:');
  try {
    const expected = {
      idx_messages_user_conversation_created: ['user_id', 'conversation_id', 'created_at'],
      idx_messages_conversation_created: ['conversation_id', 'created_at'],
      idx_messages_conversation_user_role_created: ['conversation_id', 'user_id', 'role', 'created_at'],
      idx_message_swipes_message_user_created: ['message_id', 'user_id', 'created_at'],
      idx_conversations_user_updated: ['user_id', 'updated_at'],
      idx_conversations_branch_user_created: ['branched_from_id', 'user_id', 'created_at'],
      idx_conversations_character_user_updated: ['character_id', 'user_id', 'updated_at'],
      idx_characters_user_created: ['user_id', 'created_at'],
      idx_characters_user_last_used: ['user_id', 'last_used_at', 'created_at'],
      idx_characters_visibility_created: ['visibility', 'created_at'],
      idx_assets_user_created: ['user_id', 'created_at'],
      idx_assets_owner_kind_updated: ['owner_type', 'owner_id', 'kind', 'updated_at'],
      idx_regex_user_character_order: ['user_id', 'character_id', 'priority', 'order_index'],
      idx_regex_user_group_order: ['user_id', 'group_name', 'priority', 'order_index'],
      idx_conversation_memories_user_conversation_archived_enabled: ['user_id', 'conversation_id', 'archived', 'enabled', 'updated_at'],
      idx_world_books_user_updated: ['user_id', 'updated_at'],
      idx_world_book_entries_book_order: ['world_book_id', 'order_index'],
      idx_world_book_entries_book_order_created: ['world_book_id', 'order_index', 'created_at'],
      idx_cwb_character_order: ['character_id', 'order_index', 'created_at'],
      idx_saves_user_conversation_created: ['user_id', 'conversation_id', 'created_at'],
      idx_presets_user_default_updated: ['user_id', 'is_default', 'updated_at'],
      idx_mods_user_order: ['user_id', 'order_index', 'created_at'],
      idx_npc_memories_conversation_npc_created: ['conversation_id', 'npc_name', 'created_at'],
      idx_npc_memories_conversation_created: ['conversation_id', 'created_at'],
      idx_npc_behaviors_conversation_npc_priority: ['conversation_id', 'npc_name', 'priority', 'created_at'],
      idx_npc_behaviors_conversation_enabled_priority: ['conversation_id', 'enabled', 'priority', 'created_at'],
      idx_economy_transactions_account_created: ['account_id', 'created_at'],
      idx_character_images_character_order: ['character_id', 'order_index', 'created_at'],
      idx_character_talents_character_rolled: ['character_id', 'rolled_at']
    };

    for (const [indexName, columns] of Object.entries(expected)) {
      assert.deepEqual(indexColumns(database, indexName), columns, indexName);
    }
  } finally {
    database.close();
  }
});

test('database high-value indexes are idempotent when initializeDatabase runs twice', () => {
  const database = createAppDatabase(':memory:');
  try {
    initializeDatabase(database);
    assert.match(indexSql(database, 'idx_messages_user_conversation_created'), /CREATE INDEX/);
    assert.deepEqual(
      indexColumns(database, 'idx_regex_user_character_order'),
      ['user_id', 'character_id', 'priority', 'order_index']
    );
  } finally {
    database.close();
  }
});

test('database query planner uses high-value indexes for representative reads', () => {
  const database = createAppDatabase(':memory:');
  try {
    assertPlanUsesIndex(
      database,
      'idx_messages_user_conversation_created',
      `SELECT id FROM messages
       WHERE user_id = ? AND conversation_id = ?
       ORDER BY created_at ASC, rowid ASC`,
      'user-plan',
      'conversation-plan'
    );
    assertPlanUsesIndex(
      database,
      'idx_regex_user_character_order',
      `SELECT id FROM regex_rules
       WHERE user_id = ? AND character_id = ?
       ORDER BY priority ASC, order_index ASC, rowid ASC`,
      'user-plan',
      'character-plan'
    );
    assertPlanUsesIndex(
      database,
      'idx_world_book_entries_book_order',
      `SELECT id FROM world_book_entries
       WHERE world_book_id = ?
       ORDER BY order_index ASC, rowid ASC`,
      'book-plan'
    );
    assertPlanUsesIndex(
      database,
      'idx_assets_user_created',
      `SELECT id FROM assets
       WHERE user_id = ?
       ORDER BY created_at DESC, rowid DESC`,
      'user-plan'
    );
    assertPlanUsesIndex(
      database,
      'idx_assets_owner_kind_updated',
      `SELECT id FROM assets
       WHERE owner_type = 'user' AND owner_id = ? AND kind = ?
       ORDER BY updated_at DESC, rowid DESC`,
      'owner-plan',
      'avatar'
    );
    assertPlanUsesIndex(
      database,
      'idx_conversation_memories_user_conversation_archived_enabled',
      `SELECT id FROM conversation_memories
       WHERE user_id = ? AND conversation_id = ? AND archived = 0
       ORDER BY enabled DESC, updated_at DESC, rowid DESC`,
      'user-plan',
      'conversation-plan'
    );
    assertPlanUsesIndex(
      database,
      'idx_world_book_entries_book_order_created',
      `SELECT id FROM world_book_entries
       WHERE world_book_id = ?
       ORDER BY order_index ASC, created_at ASC, rowid ASC`,
      'book-plan'
    );
    assertPlanUsesIndex(
      database,
      'idx_npc_memories_conversation_npc_created',
      `SELECT id FROM npc_memories
       WHERE conversation_id = ? AND npc_name = ?
       ORDER BY created_at DESC, rowid DESC`,
      'conversation-plan',
      'npc-plan'
    );
    assertPlanUsesIndex(
      database,
      'idx_npc_memories_conversation_created',
      `SELECT id FROM npc_memories
       WHERE conversation_id = ?
       ORDER BY created_at DESC, rowid DESC`,
      'conversation-plan'
    );
    assertPlanUsesIndex(
      database,
      'idx_npc_behaviors_conversation_enabled_priority',
      `SELECT id FROM npc_behaviors
       WHERE conversation_id = ? AND enabled = 1
       ORDER BY priority DESC, created_at ASC, rowid ASC`,
      'conversation-plan'
    );
    assertPlanUsesIndex(
      database,
      'idx_conversations_user_updated',
      `SELECT id FROM conversations
       WHERE user_id = ?
      ORDER BY updated_at DESC, rowid DESC`,
      'user-plan'
    );
    assertPlanUsesIndex(
      database,
      'idx_conversations_character_user_updated',
      `SELECT id FROM conversations
       WHERE character_id = ? AND user_id = ?
       ORDER BY updated_at DESC, rowid DESC`,
      'character-plan',
      'user-plan'
    );
    assertPlanUsesIndex(
      database,
      'idx_messages_conversation_user_role_created',
      `SELECT COUNT(*) FROM messages
       WHERE conversation_id = ? AND user_id = ? AND role = 'assistant'`,
      'conversation-plan',
      'user-plan'
    );
  } finally {
    database.close();
  }
});
