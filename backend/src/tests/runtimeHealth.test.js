import assert from 'node:assert/strict';
import test from 'node:test';

const { appConfig } = await import('../config.js');
const { createAppDatabase } = await import('../db.js');
const { buildRuntimeHealth, parseRuntimeMarkerText } = await import('../services/runtimeHealth.js');

test('runtime health reports package-safe backend readiness', () => {
  const database = createAppDatabase(':memory:');
  try {
    const health = buildRuntimeHealth(database, {
      now: () => '2026-07-02T00:00:00.000Z'
    });

    assert.equal(health.ok, true);
    assert.equal(health.service, appConfig.serviceName);
    assert.equal(health.version, appConfig.version);
    assert.equal(health.timestamp, '2026-07-02T00:00:00.000Z');
    assert.equal(health.runtime.packaged, false);
    assert.equal(health.checks.database.ok, true);
    assert.equal(health.checks.database.quickCheck, 'ok');
    assert.equal(health.checks.database.schemaReady, true);
    assert.equal(health.checks.storage.ok, true);
    assert.equal(health.checks.storage.data.writable, true);
    assert.equal(health.checks.storage.avatars.writable, true);
    assert.equal(health.checks.config.ok, true);
    assert.equal(health.checks.config.providerDefaultType, appConfig.providerDefaultType);

    const serialized = JSON.stringify(health);
    assert.equal(serialized.includes('APP_SECRET'), false);
    assert.equal(serialized.includes('appSecret'), false);
    assert.equal(serialized.includes('flai.sqlite'), false);
    assert.equal(serialized.includes('backendRoot'), false);
  } finally {
    database.close();
  }
});

test('runtime health fails closed when the database handle is unavailable', () => {
  const database = createAppDatabase(':memory:');
  database.close();

  const health = buildRuntimeHealth(database);
  assert.equal(health.ok, false);
  assert.equal(health.checks.database.ok, false);
  assert.equal(health.checks.database.status, 'unavailable');
  assert.equal(health.checks.database.error, 'Error');
});

test('runtime health parses Windows PowerShell UTF-8 BOM runtime markers', () => {
  const marker = parseRuntimeMarkerText('\uFEFF{"builtAt":"2026-07-02T00:00:00.000Z","gitHead":"abc123","source":"scripts/package-windows.ps1"}');
  assert.equal(marker.builtAt, '2026-07-02T00:00:00.000Z');
  assert.equal(marker.gitHead, 'abc123');
  assert.equal(marker.source, 'scripts/package-windows.ps1');
});
