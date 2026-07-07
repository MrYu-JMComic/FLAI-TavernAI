import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const serverSource = readFileSync(new URL('../server.js', import.meta.url), 'utf8');

test('server attaches request ids and envelopes JSON error responses', () => {
  assert.match(serverSource, /function attachRequestId\(request, response, next\)/);
  assert.match(serverSource, /request\.requestId = crypto\.randomUUID\(\)/);
  assert.match(serverSource, /response\.setHeader\('X-Request-Id', request\.requestId\)/);
  assert.match(serverSource, /function attachApiErrorEnvelope\(request, response, next\)/);
  assert.match(serverSource, /const originalJson = response\.json\.bind\(response\)/);
  assert.match(serverSource, /body && typeof body === 'object' && body\.error && !body\.requestId/);
  assert.match(serverSource, /requestId: request\.requestId/);
  assert.match(serverSource, /code: normalizeApiErrorCode\(response\.statusCode, body\.code\)/);
});

test('server global error handler logs request context and returns code plus request id', () => {
  assert.match(serverSource, /app\.use\(\(error, request, response, _next\) => \{/);
  assert.match(serverSource, /console\.error\('\[error\]', \{/);
  assert.match(serverSource, /import \{ sanitizeDiagnosticText \} from '\.\/services\/diagnosticRedaction\.js';/);
  assert.match(serverSource, /requestId: request\.requestId/);
  assert.match(serverSource, /method: request\.method/);
  assert.match(serverSource, /path: request\.originalUrl \|\| request\.url/);
  assert.match(serverSource, /message: sanitizeDiagnosticText\(message\)/);
  assert.match(serverSource, /stack: sanitizeDiagnosticText\(error\?\.stack\)/);
  assert.match(serverSource, /response\.status\(status\)\.json\(\{ error: message, code, requestId: request\.requestId/);
});
