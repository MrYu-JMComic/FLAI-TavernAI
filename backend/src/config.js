export const appConfig = Object.freeze({
  serviceName: 'flai-tavern-backend',
  version: '0.1.0',
  nodeEnv: readString(process.env.NODE_ENV, 'development'),
  isProduction: process.env.NODE_ENV === 'production',
  port: readPositiveInteger(process.env.PORT, 3001),
  databasePath: readString(process.env.FLAI_DB_PATH, ''),
  clientOrigins: readClientOrigins(process.env.CLIENT_ORIGIN),
  allowPrivateNetworkOrigins: process.env.ALLOW_PRIVATE_NETWORK_ORIGINS !== 'false',
  apiRateLimitWindowMs: readPositiveInteger(process.env.API_RATE_LIMIT_WINDOW_MS, 60 * 1000),
  apiRateLimitMax: readPositiveInteger(process.env.API_RATE_LIMIT_MAX, 240),
  authenticatedApiRateLimitMax: readPositiveInteger(
    process.env.AUTHENTICATED_API_RATE_LIMIT_MAX ?? process.env.API_AUTHENTICATED_RATE_LIMIT_MAX,
    Math.max(readPositiveInteger(process.env.API_RATE_LIMIT_MAX, 240), 900)
  ),
  authRateLimitWindowMs: readPositiveInteger(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 60 * 1000),
  authRateLimitMax: readPositiveInteger(process.env.AUTH_RATE_LIMIT_MAX, 20),
  jsonBodyLimit: process.env.JSON_BODY_LIMIT || '8mb',
  logLevel: readLogLevel(process.env.LOG_LEVEL, 'info'),
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
