export const TOWN_WORLD_GENERATION_TIMEOUT_DEFAULT_MS = 8 * 60 * 1000;
export const TOWN_WORLD_GENERATION_TIMEOUT_MIN_MS = 60 * 1000;
export const TOWN_WORLD_GENERATION_TIMEOUT_MAX_MS = 30 * 60 * 1000;

export const appConfig = Object.freeze({
  serviceName: 'flai-tavern-backend',
  version: '0.1.0',
  nodeEnv: readString(process.env.NODE_ENV, 'development'),
  isProduction: process.env.NODE_ENV === 'production',
  port: readPositiveInteger(process.env.PORT, 3001),
  databasePath: readString(process.env.FLAI_DB_PATH, ''),
  clientOrigins: readClientOrigins(process.env.CLIENT_ORIGIN),
  allowPrivateNetworkOrigins: readBoolean(
    process.env.ALLOW_PRIVATE_NETWORK_ORIGINS,
    false
  ),
  allowPrivateProviderNetwork: readBoolean(
    process.env.ALLOW_PRIVATE_PROVIDER_NETWORK,
    false
  ),
  // Local gateways remain available for the single-user development server,
  // while the explicit production setting above controls deployed instances.
  allowPrivateProviderNetworkInDevelopment: readBoolean(
    process.env.ALLOW_PRIVATE_PROVIDER_NETWORK_DEV,
    process.env.NODE_ENV !== 'production'
  ),
  providerResolveDns: readBoolean(
    process.env.PROVIDER_RESOLVE_DNS,
    true
  ),
  registrationEnabled: readBoolean(process.env.REGISTRATION_ENABLED, true),
  rootAdminUsername: readString(process.env.ROOT_ADMIN_USERNAME, ''),
  rootAdminPassword: readString(process.env.ROOT_ADMIN_PASSWORD, ''),
  apiRateLimitWindowMs: readPositiveInteger(process.env.API_RATE_LIMIT_WINDOW_MS, 60 * 1000),
  apiRateLimitMax: readPositiveInteger(process.env.API_RATE_LIMIT_MAX, 240),
  authenticatedApiRateLimitMax: readPositiveInteger(
    process.env.AUTHENTICATED_API_RATE_LIMIT_MAX ?? process.env.API_AUTHENTICATED_RATE_LIMIT_MAX,
    Math.max(readPositiveInteger(process.env.API_RATE_LIMIT_MAX, 240), 900)
  ),
  authRateLimitWindowMs: readPositiveInteger(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 60 * 1000),
  authRateLimitMax: readPositiveInteger(process.env.AUTH_RATE_LIMIT_MAX, 20),
  townWorldGenerationTimeoutMs: readBoundedPositiveInteger(
    process.env.TOWN_WORLD_GENERATION_TIMEOUT_MS,
    TOWN_WORLD_GENERATION_TIMEOUT_DEFAULT_MS,
    TOWN_WORLD_GENERATION_TIMEOUT_MIN_MS,
    TOWN_WORLD_GENERATION_TIMEOUT_MAX_MS
  ),
  jsonBodyLimit: process.env.JSON_BODY_LIMIT || '8mb',
  logLevel: readLogLevel(process.env.LOG_LEVEL, 'info'),
  quotaDefaults: Object.freeze({
    maxConcurrentAiJobs: readPositiveInteger(process.env.DEFAULT_MAX_CONCURRENT_AI_JOBS, 2),
    maxUploadBytes: readPositiveInteger(process.env.DEFAULT_MAX_UPLOAD_BYTES, 100 * 1024 * 1024),
    maxDailyRequests: readPositiveInteger(process.env.DEFAULT_MAX_DAILY_REQUESTS, 10_000),
    maxDailyCostMicros: readPositiveInteger(process.env.DEFAULT_MAX_DAILY_COST_MICROS, 5_000_000)
  }),
  upload: Object.freeze({
    avatarMaxBytes: readPositiveInteger(process.env.AVATAR_UPLOAD_MAX_BYTES, 2 * 1024 * 1024),
    backgroundMaxBytes: readPositiveInteger(process.env.BACKGROUND_UPLOAD_MAX_BYTES, 4 * 1024 * 1024),
    chatImageMaxBytes: readPositiveInteger(process.env.CHAT_IMAGE_UPLOAD_MAX_BYTES, 4 * 1024 * 1024),
    assetMaxBytes: readPositiveInteger(process.env.ASSET_UPLOAD_MAX_BYTES, 6 * 1024 * 1024),
    imageMaxPixels: readPositiveInteger(process.env.IMAGE_UPLOAD_MAX_PIXELS, 25_000_000)
  }),
  providerDefaultType: readProviderType(process.env.DEFAULT_PROVIDER_TYPE, 'deepseek'),
  mockProviderEnabled: readBoolean(process.env.FLAI_ENABLE_MOCK_PROVIDER, false),
  appSecret: readString(process.env.APP_SECRET, '')
});

export function readPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function readBoundedPositiveInteger(value, fallback, min, max) {
  const boundedFallback = Math.min(max, Math.max(min, readPositiveInteger(fallback, min)));
  const parsed = readPositiveInteger(value, boundedFallback);
  return Math.min(max, Math.max(min, parsed));
}

function readClientOrigins(value) {
  return String(value || 'http://127.0.0.1:5173,http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function readString(value, fallback) {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function readBoolean(value, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function readLogLevel(value, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['silent', 'error', 'warn', 'info', 'debug'].includes(normalized) ? normalized : fallback;
}

function readProviderType(value, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || fallback;
}
