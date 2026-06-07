import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText } from './frontendSfcTestUtils.js';

const serverSource = readRepoText('backend/src/server.js');

test('server API rate limit is tuned for normal authenticated app usage', () => {
  assert.match(serverSource, /const apiRateLimitWindowMs = readPositiveInteger\(process\.env\.API_RATE_LIMIT_WINDOW_MS, 60 \* 1000\);/);
  assert.match(serverSource, /const apiRateLimitMax = readPositiveInteger\(process\.env\.API_RATE_LIMIT_MAX, 240\);/);
  assert.match(serverSource, /const authenticatedApiRateLimitMax = readPositiveInteger\(/);
  assert.match(serverSource, /process\.env\.AUTHENTICATED_API_RATE_LIMIT_MAX \?\? process\.env\.API_AUTHENTICATED_RATE_LIMIT_MAX/);
  assert.match(serverSource, /Math\.max\(apiRateLimitMax, 900\)/);
  assert.match(serverSource, /function shouldSkipApiRateLimit\(request\)[\s\S]*request\.method === 'OPTIONS'/);
  assert.match(serverSource, /function getApiRateLimitForRequest\(request\)[\s\S]*request\.auth\?\.user \? authenticatedApiRateLimitMax : apiRateLimitMax;/);
  assert.match(serverSource, /limit: getApiRateLimitForRequest/);
  assert.match(serverSource, /skip: shouldSkipApiRateLimit/);
  assert.match(serverSource, /keyGenerator: getApiRateLimitKey/);
});

test('server keeps auth attempt rate limit separate and strict', () => {
  assert.match(serverSource, /const authRateLimitWindowMs = readPositiveInteger\(process\.env\.AUTH_RATE_LIMIT_WINDOW_MS, 60 \* 1000\);/);
  assert.match(serverSource, /const authRateLimitMax = readPositiveInteger\(process\.env\.AUTH_RATE_LIMIT_MAX, 20\);/);
  assert.match(serverSource, /app\.use\('\/api\/auth\/login', authLimiter\);/);
  assert.match(serverSource, /app\.use\('\/api\/auth\/register', authLimiter\);/);
});
