import assert from 'node:assert/strict';
import test from 'node:test';

const { createAppDatabase } = await import('../db.js');
const {
  DIAGNOSTIC_REDACTED_VALUE,
  sanitizeDiagnosticText,
  sanitizeDiagnosticValue
} = await import('../services/diagnosticRedaction.js');
const { buildDiagnosticsExport } = await import('../services/diagnosticsExport.js');
const { insertUser } = await import('./routeTestUtils.js');

test('diagnostic redaction removes secret fields and inline credential text', () => {
  const input = {
    apiKey: 'sk-direct-secret-123456',
    apiKeySet: true,
    apiKeyHint: 'sk-...3456',
    encrypted_api_key: 'ciphertext-secret',
    headers: {
      Authorization: 'Bearer sk-bearer-secret-123456',
      Cookie: 'flai_session=session-secret; csrf_token=csrf-secret',
      Accept: 'application/json'
    },
    nested: {
      csrfToken: 'csrf-secret-value',
      password: 'password-secret-value',
      safe: 'visible'
    },
    text: [
      'Bearer sk-inline-secret-123456',
      'flai_session=session-secret; csrf_token=csrf-secret',
      'data:image/png;base64,AAAA'
    ]
  };
  input.self = input;

  const safe = sanitizeDiagnosticValue(input);
  assert.equal(safe.apiKey, DIAGNOSTIC_REDACTED_VALUE);
  assert.equal(safe.apiKeySet, true);
  assert.equal(safe.apiKeyHint, 'sk-...3456');
  assert.equal(safe.encrypted_api_key, DIAGNOSTIC_REDACTED_VALUE);
  assert.equal(safe.headers.Authorization, DIAGNOSTIC_REDACTED_VALUE);
  assert.equal(safe.headers.Cookie, DIAGNOSTIC_REDACTED_VALUE);
  assert.equal(safe.headers.Accept, 'application/json');
  assert.equal(safe.nested.csrfToken, DIAGNOSTIC_REDACTED_VALUE);
  assert.equal(safe.nested.password, DIAGNOSTIC_REDACTED_VALUE);
  assert.equal(safe.nested.safe, 'visible');
  assert.equal(safe.self, '[circular]');

  const serialized = JSON.stringify(safe);
  assert.equal(serialized.includes('sk-direct-secret'), false);
  assert.equal(serialized.includes('sk-bearer-secret'), false);
  assert.equal(serialized.includes('session-secret'), false);
  assert.equal(serialized.includes('csrf-secret'), false);
  assert.match(serialized, /data:image\/png;base64,\[redacted\]/);
});

test('diagnostic text redaction removes bearer headers cookies tokens and image data urls', () => {
  const text = [
    'Authorization: Bearer sk-header-secret-123456',
    'x-csrf-token=csrf-secret-value',
    'cookie: flai_session=session-secret; other=ok',
    'preview=data:image/jpeg;base64,BBBB'
  ].join('\n');

  const safe = sanitizeDiagnosticText(text);
  assert.equal(safe.includes('sk-header-secret'), false);
  assert.equal(safe.includes('csrf-secret-value'), false);
  assert.equal(safe.includes('session-secret'), false);
  assert.match(safe, /Authorization: \[redacted\]/);
  assert.match(safe, /data:image\/jpeg;base64,\[redacted\]/);
});

test('diagnostics export sanitizes provider extra body without dropping public state', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'diagnostics-redaction-user';
  insertUser(database, userId);
  database
    .prepare(
      `INSERT INTO provider_settings (
        user_id, provider_type, gateway_name, base_url, model, encrypted_api_key,
        api_key_hint, supports_reasoning, extra_body, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      'openai_compatible',
      'Secret Gateway',
      'https://provider.example/v1',
      'roleplay-model',
      'not-a-valid-encrypted-key',
      'sk-...3456',
      1,
      JSON.stringify({
        headers: {
          Authorization: 'Bearer sk-extra-secret-123456',
          Cookie: 'flai_session=session-secret'
        },
        nested: {
          apiKey: 'sk-extra-body-secret-123456',
          image: 'data:image/png;base64,AAAA'
        }
      }),
      new Date().toISOString()
    );

  const exported = buildDiagnosticsExport(database, userId);
  assert.equal(exported.provider.providerType, 'openai_compatible');
  assert.equal(exported.provider.apiKeyHint, 'sk-...3456');
  assert.equal(exported.provider.apiKeyNeedsReset, true);
  assert.equal(exported.provider.extraBody.headers.Authorization, DIAGNOSTIC_REDACTED_VALUE);
  assert.equal(exported.provider.extraBody.headers.Cookie, DIAGNOSTIC_REDACTED_VALUE);
  assert.equal(exported.provider.extraBody.nested.apiKey, DIAGNOSTIC_REDACTED_VALUE);
  assert.equal(exported.provider.extraBody.nested.image, 'data:image/png;base64,[redacted]');

  const serialized = JSON.stringify(exported);
  assert.equal(serialized.includes('sk-extra-secret'), false);
  assert.equal(serialized.includes('sk-extra-body-secret'), false);
  assert.equal(serialized.includes('session-secret'), false);
  assert.equal(serialized.includes('not-a-valid-encrypted-key'), false);
});
