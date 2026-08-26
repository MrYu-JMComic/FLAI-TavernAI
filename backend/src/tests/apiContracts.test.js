import assert from 'node:assert/strict';
import test from 'node:test';
import { appConfig } from '../config.js';
import { createAppDatabase } from '../db/runtime.js';
import { createApp } from '../app.js';
import { buildOpenApiDocument, listCompatibilityAliasUsage } from '../services/apiContracts.js';
import { withServer } from './routeTestUtils.js';

test('OpenAPI document fixes the shared error envelope and core security schemes', () => {
  const document = buildOpenApiDocument(appConfig);
  assert.equal(document.openapi, '3.1.0');
  assert.deepEqual(document.components.schemas.Error.required, ['error', 'code', 'requestId']);
  assert.equal(document.components.securitySchemes.sessionCookie.name, 'flai_session');
  assert.equal(document.components.securitySchemes.csrfHeader.name, 'X-CSRF-Token');
  assert.ok(document.paths['/auth/login'].post);
  assert.ok(document.paths['/jobs'].post);
  assert.ok(document.paths['/envelopes/{kind}/import'].post);
  assert.ok(document.paths['/admin/backups/{filename}/preflight'].get);
  assert.equal(document.components.schemas.CharacterList.oneOf[0].type, 'array');
});

test('compatibility aliases emit deprecation metadata and increment telemetry', async () => {
  const database = createAppDatabase(':memory:');
  const app = createApp({
    db: database,
    logger: { error() {}, warn() {}, info() {}, debug() {} }
  });
  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/health`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('deprecation'), 'true');
      assert.match(response.headers.get('link') || '', /\/api\/health\/ready/);

      const openApiResponse = await fetch(`${baseUrl}/api/openapi.json`);
      const document = await openApiResponse.json();
      assert.equal(document.openapi, '3.1.0');
    });
    const usage = listCompatibilityAliasUsage().find((row) => row.route === 'GET /api/health');
    assert.ok(usage.count >= 1);
    assert.equal(usage.replacement, '/api/health/ready');
  } finally {
    database.close();
  }
});
