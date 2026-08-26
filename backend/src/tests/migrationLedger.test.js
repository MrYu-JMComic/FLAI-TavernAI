import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppDatabase } from '../db/runtime.js';
import { initializeDatabase } from '../db/schema.js';
import { listAppliedMigrations } from '../db/migrations.js';
import { insertUser } from './routeTestUtils.js';

test('migration ledger records deterministic checksums and replays idempotently', () => {
  const database = createAppDatabase(':memory:');
  try {
    const first = listAppliedMigrations(database);
    assert.deepEqual(first.map((row) => row.version), ['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009']);
    for (const row of first) {
      assert.match(row.checksum, /^[a-f0-9]{64}$/);
    }
    initializeDatabase(database);
    assert.deepEqual(listAppliedMigrations(database), first);
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    database.close();
  }
});

test('existing schemas without a ledger are adopted on the next initialization', () => {
  const database = createAppDatabase(':memory:');
  try {
    database.exec('DROP TABLE schema_migrations');
    initializeDatabase(database);
    assert.equal(listAppliedMigrations(database).length, 9);
  } finally {
    database.close();
  }
});

test('provider profile migration adopts legacy settings as the selected provider', () => {
  const database = createAppDatabase(':memory:');
  try {
    const userId = 'migration-provider-profile-user';
    insertUser(database, userId);
    database.prepare(
      `INSERT INTO provider_settings (
        user_id, provider_type, gateway_name, base_url, model, encrypted_api_key,
        api_key_hint, supports_reasoning, allow_private_network, extra_body, updated_at
      ) VALUES (?, 'openai', 'Legacy OpenAI', 'https://api.openai.com/v1', 'gpt-4.1-mini',
                NULL, NULL, 0, 0, '{}', '2026-08-25T00:00:00.000Z')`
    ).run(userId);
    database.prepare("DELETE FROM schema_migrations WHERE version = '0009'").run();

    initializeDatabase(database);

    const selected = database.prepare(
      `SELECT presets.*
       FROM provider_selections selection
       JOIN provider_presets presets ON presets.id = selection.provider_id
       WHERE selection.user_id = ?`
    ).get(userId);
    assert.equal(selected.gateway_name, 'Legacy OpenAI');
    assert.equal(selected.model, 'gpt-4.1-mini');
    assert.equal(database.prepare(
      'SELECT COUNT(*) AS count FROM provider_presets WHERE user_id = ?'
    ).get(userId).count, 1);
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    database.close();
  }
});

test('migration checksum drift stops startup with the exact version', () => {
  const database = createAppDatabase(':memory:');
  try {
    database.prepare("UPDATE schema_migrations SET checksum = 'changed' WHERE version = '0003'").run();
    assert.throws(() => initializeDatabase(database), /Migration 0003 checksum mismatch/);
  } finally {
    database.close();
  }
});
