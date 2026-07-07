import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText } from './frontendSfcTestUtils.js';

const serverSource = readRepoText('backend/src/server.js');
const configSource = readRepoText('backend/src/config.js');
const dbSource = readRepoText('backend/src/db.js');
const securitySource = readRepoText('backend/src/security.js');
const csrfSource = readRepoText('backend/src/services/csrf.js');
const avatarsSource = readRepoText('backend/src/services/avatars.js');
const assetsSource = readRepoText('backend/src/modules/assets.js');
const chatAttachmentsSource = readRepoText('backend/src/services/chatAttachments.js');
const providerRegistrySource = readRepoText('backend/src/services/providerRegistry.js');
const runtimeHealthSource = readRepoText('backend/src/services/runtimeHealth.js');

test('server API rate limit is tuned for normal authenticated app usage', () => {
  assert.match(configSource, /apiRateLimitWindowMs: readPositiveInteger\(process\.env\.API_RATE_LIMIT_WINDOW_MS, 60 \* 1000\)/);
  assert.match(configSource, /apiRateLimitMax: readPositiveInteger\(process\.env\.API_RATE_LIMIT_MAX, 240\)/);
  assert.match(configSource, /authenticatedApiRateLimitMax: readPositiveInteger\(/);
  assert.match(configSource, /process\.env\.AUTHENTICATED_API_RATE_LIMIT_MAX \?\? process\.env\.API_AUTHENTICATED_RATE_LIMIT_MAX/);
  assert.match(configSource, /Math\.max\(readPositiveInteger\(process\.env\.API_RATE_LIMIT_MAX, 240\), 900\)/);
  assert.match(serverSource, /const apiRateLimitWindowMs = appConfig\.apiRateLimitWindowMs;/);
  assert.match(serverSource, /const apiRateLimitMax = appConfig\.apiRateLimitMax;/);
  assert.match(serverSource, /const authenticatedApiRateLimitMax = appConfig\.authenticatedApiRateLimitMax;/);
  assert.match(serverSource, /function shouldSkipApiRateLimit\(request\)[\s\S]*request\.method === 'OPTIONS'/);
  assert.match(serverSource, /function getApiRateLimitForRequest\(request\)[\s\S]*request\.auth\?\.user \? authenticatedApiRateLimitMax : apiRateLimitMax;/);
  assert.match(serverSource, /limit: getApiRateLimitForRequest/);
  assert.match(serverSource, /skip: shouldSkipApiRateLimit/);
  assert.match(serverSource, /keyGenerator: getApiRateLimitKey/);
});

test('server keeps auth attempt rate limit separate and strict', () => {
  assert.match(configSource, /authRateLimitWindowMs: readPositiveInteger\(process\.env\.AUTH_RATE_LIMIT_WINDOW_MS, 60 \* 1000\)/);
  assert.match(configSource, /authRateLimitMax: readPositiveInteger\(process\.env\.AUTH_RATE_LIMIT_MAX, 20\)/);
  assert.match(serverSource, /const authRateLimitWindowMs = appConfig\.authRateLimitWindowMs;/);
  assert.match(serverSource, /const authRateLimitMax = appConfig\.authRateLimitMax;/);
  assert.match(serverSource, /app\.use\('\/api\/auth\/login', authLimiter\);/);
  assert.match(serverSource, /app\.use\('\/api\/auth\/register', authLimiter\);/);
});

test('app config centralizes upload provider and log defaults', () => {
  assert.match(configSource, /logLevel: readLogLevel\(process\.env\.LOG_LEVEL, 'info'\)/);
  assert.match(configSource, /avatarMaxBytes: readPositiveInteger\(process\.env\.AVATAR_UPLOAD_MAX_BYTES, 2 \* 1024 \* 1024\)/);
  assert.match(configSource, /backgroundMaxBytes: readPositiveInteger\(process\.env\.BACKGROUND_UPLOAD_MAX_BYTES, 4 \* 1024 \* 1024\)/);
  assert.match(configSource, /chatImageMaxBytes: readPositiveInteger\(process\.env\.CHAT_IMAGE_UPLOAD_MAX_BYTES, 4 \* 1024 \* 1024\)/);
  assert.match(configSource, /assetMaxBytes: readPositiveInteger\(process\.env\.ASSET_UPLOAD_MAX_BYTES, 6 \* 1024 \* 1024\)/);
  assert.match(configSource, /imageMaxPixels: readPositiveInteger\(process\.env\.IMAGE_UPLOAD_MAX_PIXELS, 25_000_000\)/);
  assert.match(configSource, /providerDefaultType: readProviderType\(process\.env\.DEFAULT_PROVIDER_TYPE, 'deepseek'\)/);
  assert.match(configSource, /mockProviderEnabled: readBoolean\(process\.env\.FLAI_ENABLE_MOCK_PROVIDER, false\)/);
  assert.match(configSource, /function readBoolean\(value, fallback\)/);
  assert.match(avatarsSource, /const avatarMaxBytes = appConfig\.upload\.avatarMaxBytes;/);
  assert.match(avatarsSource, /const backgroundMaxBytes = appConfig\.upload\.backgroundMaxBytes;/);
  assert.match(assetsSource, /const assetMaxBytes = appConfig\.upload\.assetMaxBytes;/);
  assert.match(chatAttachmentsSource, /const CHAT_IMAGE_MAX_BYTES = appConfig\.upload\.chatImageMaxBytes;/);
  assert.match(chatAttachmentsSource, /const CHAT_IMAGE_MAX_PIXELS = appConfig\.upload\.imageMaxPixels;/);
  assert.match(providerRegistrySource, /providerPresets\[appConfig\.providerDefaultType\] \|\| providerPresets\.deepseek/);
});

test('app config centralizes runtime environment defaults', () => {
  assert.match(configSource, /nodeEnv: readString\(process\.env\.NODE_ENV, 'development'\)/);
  assert.match(configSource, /isProduction: process\.env\.NODE_ENV === 'production'/);
  assert.match(configSource, /databasePath: readString\(process\.env\.FLAI_DB_PATH, ''\)/);
  assert.match(configSource, /appSecret: readString\(process\.env\.APP_SECRET, ''\)/);
  assert.match(dbSource, /appConfig\.databasePath \|\| path\.join\(dataDir, 'flai\.sqlite'\)/);
  assert.match(securitySource, /if \(appConfig\.appSecret\)/);
  assert.match(securitySource, /secure: appConfig\.isProduction/);
  assert.match(csrfSource, /secure: appConfig\.isProduction/);
  assert.match(serverSource, /function getChatProviderSettings\(userId\) \{[\s\S]*mockProviderEnabled: appConfig\.mockProviderEnabled/);
  assert.match(serverSource, /mockProviderEnabled: appConfig\.mockProviderEnabled/);
});

test('server exposes package-safe runtime health checks', () => {
  assert.match(serverSource, /import \{ buildRuntimeHealth \} from '\.\/services\/runtimeHealth\.js';/);
  assert.match(serverSource, /app\.get\('\/api\/health', \(_request, response\) => \{[\s\S]*response\.json\(buildRuntimeHealth\(db\)\);[\s\S]*\}\);/);
  assert.match(runtimeHealthSource, /export function buildRuntimeHealth\(database, options = \{\}\)/);
  assert.match(runtimeHealthSource, /database: checkDatabase\(database\)/);
  assert.match(runtimeHealthSource, /storage: checkStorage\(\)/);
  assert.match(runtimeHealthSource, /config: checkConfig\(\)/);
  assert.match(runtimeHealthSource, /bundle: checkRuntimeBundle\(\)/);
  assert.match(runtimeHealthSource, /packaged: checks\.bundle\.present === true/);
  assert.match(runtimeHealthSource, /parseRuntimeMarkerText\(fs\.readFileSync\(markerPath, 'utf8'\)\)/);
  assert.match(runtimeHealthSource, /export function parseRuntimeMarkerText\(text\) \{[\s\S]*replace\(\/\^\\uFEFF\/, ''\)/);
});
