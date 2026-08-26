import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const serverSource = readFileSync(new URL('../server.js', import.meta.url), 'utf8');

test('server attaches request ids and envelopes JSON error responses', () => {
  assert.match(appSource, /function attachRequestId\(request, response, next\)/);
  assert.match(appSource, /request\.requestId = crypto\.randomUUID\(\)/);
  assert.match(appSource, /response\.setHeader\('X-Request-Id', request\.requestId\)/);
  assert.match(appSource, /function attachApiErrorEnvelope\(request, response, next\)/);
  assert.match(appSource, /const originalJson = response\.json\.bind\(response\)/);
  assert.match(appSource, /body && typeof body === 'object' && body\.error && !body\.requestId/);
  assert.match(appSource, /requestId: request\.requestId/);
  assert.match(appSource, /code: normalizeApiErrorCode\(response\.statusCode, body\.code\)/);
});

test('app global error handler logs request context and returns code plus request id', () => {
  assert.match(appSource, /app\.use\(\(error, request, response, _next\) => \{/);
  assert.match(appSource, /applicationLogger\.error\('http_error', \{/);
  assert.match(appSource, /import \{ sanitizeDiagnosticText \} from '\.\/services\/diagnosticRedaction\.js';/);
  assert.match(appSource, /requestId: request\.requestId/);
  assert.match(appSource, /method: request\.method/);
  assert.match(appSource, /path: request\.originalUrl \|\| request\.url/);
  assert.match(appSource, /message: sanitizeDiagnosticText\(rawMessage\)/);
  assert.match(appSource, /stack: sanitizeDiagnosticText\(error\?\.stack\)/);
  assert.match(appSource, /response\.status\(status\)\.json\(\{ error: message, code, requestId: request\.requestId/);
});

test('server owns process lifecycle without constructing routes', () => {
  assert.match(serverSource, /const app = createApp\(\{/);
  assert.match(serverSource, /const server = await listen\(app, config\.port\)/);
  assert.match(serverSource, /stopTownEngine\?\.\(\)/);
  assert.match(serverSource, /database\.exec\('PRAGMA wal_checkpoint\(TRUNCATE\)'\)/);
  assert.doesNotMatch(appSource, /\.listen\(/);
  assert.doesNotMatch(appSource, /setInterval\(/);
});
