import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppDatabase } from '../db/runtime.js';
import { createPreset } from '../modules/presets.js';
import {
  buildExportEnvelope,
  exportEnvelopeCompatibility,
  importExportEnvelope
} from '../services/exportEnvelopes.js';
import { insertUser } from './routeTestUtils.js';

test('envelopes publish schema compatibility and migrate legacy v1 imports', () => {
  const database = createEnvelopeDatabase();
  try {
    const imported = importExportEnvelope(database, 'envelope-user', 'presets', {
      version: 1,
      kind: 'presets',
      items: [{ name: 'Legacy Preset', systemPrompt: 'Legacy instructions.' }]
    });
    assert.equal(imported.schemaVersion, 2);
    assert.deepEqual(imported.migrationsApplied, ['1-to-2']);
    const exported = buildExportEnvelope(database, 'envelope-user', 'presets');
    assert.equal(exported.schemaVersion, 2);
    assert.deepEqual(exported.compatibility, exportEnvelopeCompatibility);
  } finally {
    database.close();
  }
});

test('dry-run imports roll back domain writes but retain an audit report', () => {
  const database = createEnvelopeDatabase();
  try {
    const result = importExportEnvelope(database, 'envelope-user', 'presets', {
      schemaVersion: 2,
      kind: 'presets',
      dryRun: true,
      conflictStrategy: 'duplicate',
      items: [{ name: 'Dry Run Preset', systemPrompt: 'Do not commit.' }]
    });
    assert.equal(result.dryRun, true);
    assert.equal(result.imported, 1);
    assert.equal(result.wouldImport, 1);
    assert.ok(result.auditReportId);
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM presets WHERE name = 'Dry Run Preset'").get().count,
      0
    );
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM import_audit_reports').get().count, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM automation_audit_events').get().count, 1);
  } finally {
    database.close();
  }
});

test('conflict strategies skip or reject duplicates without extra writes', () => {
  const database = createEnvelopeDatabase();
  try {
    createPreset(database, 'envelope-user', { name: 'Existing Preset' });
    const skip = importExportEnvelope(database, 'envelope-user', 'presets', {
      schemaVersion: 2,
      conflictStrategy: 'skip',
      items: [{ name: 'Existing Preset' }]
    });
    assert.equal(skip.imported, 0);
    assert.equal(skip.conflicts.length, 1);
    assert.equal(skip.skipped[0].reason, 'conflict');

    const error = importExportEnvelope(database, 'envelope-user', 'presets', {
      schemaVersion: 2,
      conflictStrategy: 'error',
      items: [{ name: 'Existing Preset' }, { name: 'Should Not Commit' }]
    });
    assert.equal(error.imported, 0);
    assert.equal(error.conflicts.length, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM presets WHERE name = 'Should Not Commit'").get().count, 0);
  } finally {
    database.close();
  }
});

test('import item quota rejects oversized envelopes before writes', () => {
  const database = createEnvelopeDatabase();
  try {
    assert.throws(
      () => importExportEnvelope(database, 'envelope-user', 'presets', {
        schemaVersion: 2,
        items: Array.from({ length: 1001 }, (_, index) => ({ name: `Preset ${index}` }))
      }),
      /import item quota exceeded/
    );
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM presets').get().count, 0);
  } finally {
    database.close();
  }
});

function createEnvelopeDatabase() {
  const database = createAppDatabase(':memory:');
  insertUser(database, 'envelope-user');
  return database;
}
