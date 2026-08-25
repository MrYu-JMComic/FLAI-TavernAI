import 'dotenv/config';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import crypto from 'crypto';
import path from 'node:path';
import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { appConfig } from './config.js';
import { db } from './db.js';
import {
  newId,
  nowIso,
  resolveSession
} from './security.js';
import { migrateLegacyAvatarUploads, getAvatarAssetForViewer } from './services/avatars.js';
import { providerWithSecret, hasUsableProvider, defaultProviderSettings, normalizeProviderRow } from './services/providers.js';
import { getCharacterWorldBookId, getCharacterWorldBookIds } from './modules/worldBooks.js';
import { getCharacterTagsMap } from './modules/tags.js';
import { publicUser, getUserProfile } from './modules/users.js';
import { startTownSimulationEngine } from './modules/townEngine.js';

// ── Route modules ──
import { createAuthRouter } from './routes/auth.js';
import { createCharactersRouter } from './routes/characters.js';
import { createConversationsRouter, createSavesRouter } from './routes/conversations.js';
import { createWorldBooksRouter } from './routes/worldBooks.js';
import { createPresetsRouter } from './routes/presets.js';
import { createModsRouter } from './routes/mods.js';
import { createTagsRouter } from './routes/tags.js';
import { createTalentsRouter } from './routes/talents.js';
import { createHMDTRouter } from './routes/hmdt.js';
import { createSettingsRouter } from './routes/settings.js';
import { createRegexRouter } from './routes/regex.js';
import { createSwipesRouter } from './routes/swipes.js';
import { createBranchesRouter } from './routes/branches.js';
import { createUpgradeRouter } from './routes/upgrade.js';
import { createTownsRouter } from './routes/towns.js';
import { getChatProviderSettingsFromContext } from './routes/helpers.js';
import { createBackup, listBackups, scheduleDailyBackup } from './services/backup.js';
import { csrfProtection, csrfTokenEndpoint } from './services/csrf.js';
import { sanitizeDiagnosticText } from './services/diagnosticRedaction.js';
import { buildRuntimeHealth } from './services/runtimeHealth.js';

const app = express();
const port = appConfig.port;
const clientOrigins = appConfig.clientOrigins;
const allowPrivateNetworkOrigins = appConfig.allowPrivateNetworkOrigins;
const apiRateLimitWindowMs = appConfig.apiRateLimitWindowMs;
const apiRateLimitMax = appConfig.apiRateLimitMax;
const authenticatedApiRateLimitMax = appConfig.authenticatedApiRateLimitMax;
const authRateLimitWindowMs = appConfig.authRateLimitWindowMs;
const authRateLimitMax = appConfig.authRateLimitMax;

function isAuthAttemptPath(request) {
  const pathName = String(request.path || '');
  const originalUrl = String(request.originalUrl || '');
  return pathName === '/auth/login'
    || pathName === '/auth/register'
    || originalUrl.startsWith('/api/auth/login')
    || originalUrl.startsWith('/api/auth/register');
}

function shouldSkipApiRateLimit(request) {
  return request.method === 'OPTIONS' || isAuthAttemptPath(request);
}

function getApiRateLimitForRequest(request) {
  return request.auth?.user ? authenticatedApiRateLimitMax : apiRateLimitMax;
}

function getApiRateLimitKey(request) {
  return request.auth?.user?.id || ipKeyGenerator(request.ip);
}

function shouldCompressResponse(request, response) {
  const accept = String(request.headers?.accept || '').toLowerCase();
  const contentType = String(response.getHeader('Content-Type') || '').toLowerCase();
  if (accept.includes('text/event-stream') || contentType.includes('text/event-stream')) {
    return false;
  }
  return compression.filter(request, response);
}

// ── Middleware ──

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || isAllowedClientOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS origin is not allowed: ${origin}`));
    },
    credentials: true
  })
);

// ── Compression (gzip/deflate) ──
app.use(compression({
  threshold: 256,
  level: 6,
  filter: shouldCompressResponse
}));

// ── Cookie Parser (用于 CSRF 校验) ──
app.use(cookieParser());

// ── 基础安全响应头 ──
app.use((_request, response, next) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'SAMEORIGIN');
  response.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.use(express.json({ limit: appConfig.jsonBodyLimit }));
app.use(attachRequestId);
app.use(attachApiErrorEnvelope);
migrateLegacyAvatarUploads(db);
app.use(attachAuth);

// ── API 速率限制 ──
const apiLimiter = rateLimit({
  windowMs: apiRateLimitWindowMs,
  limit: getApiRateLimitForRequest,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '请求过于频繁，请稍后再试' },
  skip: shouldSkipApiRateLimit,
  keyGenerator: getApiRateLimitKey
});

const authLimiter = rateLimit({
  windowMs: authRateLimitWindowMs,
  limit: authRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '登录尝试过于频繁，请 1 分钟后再试' }
});

// ── CSRF token 端点（在 CSRF 中间件之前注册） ──
app.get('/api/csrf-token', csrfTokenEndpoint);

app.get('/api/avatars/:id', requireAuth, (request, response) => {
  const asset = getAvatarAssetForViewer(db, request.auth.user.id, request.params.id);
  if (!asset) {
    response.status(404).json({ error: '头像资源不存在' });
    return;
  }

  response.setHeader('Content-Type', asset.mimeType);
  response.setHeader('Cache-Control', 'private, max-age=3600');
  response.send(Buffer.from(asset.base64Data, 'base64'));
});

// ── CSRF 防护（应用于状态变更路由） ──
app.use('/api', csrfProtection);

// ── 统一 UTF-8 编码 ──
app.use((_request, response, next) => {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

// ── 速率限制应用于所有 API 路由 ──
app.use('/api', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// ── ETag / Cache helpers ──

function withEtag(request, response, data) {
  const body = JSON.stringify(data);
  const etag = '"' + crypto.createHash('md5').update(body).digest('hex').slice(0, 16) + '"';
  response.setHeader('ETag', etag);
  response.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
  if (request.headers['if-none-match'] === etag) {
    response.status(304).end();
    return;
  }
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.send(body);
}

function withListCache(request, response, data) {
  const body = JSON.stringify(data);
  const etag = '"' + crypto.createHash('md5').update(body).digest('hex').slice(0, 16) + '"';
  response.setHeader('ETag', etag);
  response.setHeader('Cache-Control', 'private, max-age=10, stale-while-revalidate=30');
  if (request.headers['if-none-match'] === etag) {
    response.status(304).end();
    return;
  }
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.send(body);
}

// ── Shared middleware & helpers ──

function attachRequestId(request, response, next) {
  request.requestId = crypto.randomUUID();
  response.setHeader('X-Request-Id', request.requestId);
  next();
}

function attachApiErrorEnvelope(request, response, next) {
  const originalJson = response.json.bind(response);
  response.json = (body) => {
    if (body && typeof body === 'object' && body.error && !body.requestId) {
      return originalJson({
        ...body,
        code: normalizeApiErrorCode(response.statusCode, body.code),
        requestId: request.requestId
      });
    }
    return originalJson(body);
  };
  next();
}

function attachAuth(request, _response, next) {
  request.auth = resolveSession(db, request);
  next();
}

function requireAuth(request, response, next) {
  if (!request.auth?.user) {
    response.status(401).json({ error: '请先登录' });
    return;
  }
  next();
}

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function normalizeApiErrorCode(status, explicitCode = '') {
  if (explicitCode) {
    return String(explicitCode);
  }
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 413) return 'PAYLOAD_TOO_LARGE';
  if (status === 419) return 'CSRF_TOKEN_INVALID';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'INTERNAL_ERROR';
  return 'BAD_REQUEST';
}

// ── Character helpers (shared between routes) ──

function withWorldBookId(character) {
  if (!character) return character;
  return { ...character, worldBookId: getCharacterWorldBookId(db, character.id) };
}

function withCharacterTags(character) {
  if (!character) return character;
  const characterTags = db
    .prepare(
      `SELECT tags.id, tags.name, tags.color FROM character_tags
       JOIN tags ON tags.id = character_tags.tag_id
       WHERE character_tags.character_id = ? AND tags.user_id = ?
       ORDER BY tags.name COLLATE NOCASE ASC, tags.name ASC, tags.rowid ASC`
    )
    .all(character.id, character.ownerId);
  return { ...character, characterTags };
}

function withCharacterListExtras(characters) {
  if (!Array.isArray(characters) || !characters.length) {
    return [];
  }
  const ids = characters.map((character) => character.id);
  const worldBookIds = getCharacterWorldBookIds(db, ids);
  const tagsByCharacter = getCharacterTagsMap(db, ids);

  return characters.map((character) => ({
    ...character,
    worldBookId: worldBookIds.get(character.id) || null,
    characterTags: (tagsByCharacter.get(character.id) || [])
      .filter((row) => row.user_id === character.ownerId)
      .map(({ id, name, color }) => ({ id, name, color }))
  }));
}

function getProviderRow(userId) {
  return db.prepare('SELECT * FROM provider_settings WHERE user_id = ?').get(userId);
}

function getChatProviderSettings(userId) {
  return getChatProviderSettingsFromContext({
    providerWithSecret,
    hasUsableProvider,
    getProviderRow,
    mockProviderEnabled: appConfig.mockProviderEnabled
  }, userId);
}

// ── User helpers ──

// ── Dependency context for route modules ──

const ctx = {
  db,
  requireAuth,
  asyncRoute,
  newId,
  nowIso,
  publicUser: (row) => publicUser(db, row),
  getUserProfile: (userId) => getUserProfile(db, userId),
  saveDefaultProvider: (userId) => {
    const preset = defaultProviderSettings();
    const timestamp = nowIso();
    db.prepare(
      `INSERT OR IGNORE INTO provider_settings (
        user_id, provider_type, gateway_name, base_url, model, encrypted_api_key,
        api_key_hint, supports_reasoning, extra_body, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      userId,
      preset.providerType,
      preset.gatewayName,
      preset.baseUrl,
      preset.model,
      null,
      null,
      preset.supportsReasoning ? 1 : 0,
      JSON.stringify(preset.extraBody),
      timestamp
    );
    const row = db.prepare('SELECT * FROM provider_settings WHERE user_id = ?').get(userId);
    return row ? normalizeProviderRow(row) : preset;
  },
  withWorldBookId,
  withCharacterTags,
  withCharacterListExtras,
  withEtag,
  withListCache,
  getProviderRow,
  getChatProviderSettings,
  providerWithSecret,
  hasUsableProvider,
  mockProviderEnabled: appConfig.mockProviderEnabled,
  townWorldGenerationTimeoutMs: appConfig.townWorldGenerationTimeoutMs
};

// ── Health check ──

app.get('/api/health', (_request, response) => {
  response.json(buildRuntimeHealth(db));
});

// ── Mount route modules ──

app.use('/api/auth', createAuthRouter(ctx));
app.use('/api/characters', createCharactersRouter(ctx));
app.use('/api/conversations', createConversationsRouter(ctx));
app.use('/api/saves', createSavesRouter(ctx));
app.use('/api/world-books', createWorldBooksRouter(ctx));
app.use('/api/presets', createPresetsRouter(ctx));
app.use('/api/mods', createModsRouter(ctx));
app.use('/api/tags', createTagsRouter(ctx));
app.use('/api/talent-pools', createTalentsRouter(ctx));
app.use('/api/regex-rules', createRegexRouter(ctx));
app.use('/api/messages', createSwipesRouter(ctx));
app.use('/api/towns', createTownsRouter(ctx));
app.use('/api/hmdt', createHMDTRouter(ctx));
app.use('/api/conversations', createBranchesRouter(ctx));
app.use('/api', createUpgradeRouter(ctx));
app.use('/api', createSettingsRouter(ctx));

startTownSimulationEngine(db, {
  onError: (error) => {
    console.error('[town-engine]', sanitizeDiagnosticText(error?.message || error));
  }
});

// ── Admin backup endpoint ──

app.post('/api/admin/backup', requireAuth, asyncRoute(async (request, response) => {
  if (!request.auth.user.isRootAdmin) {
    response.status(403).json({ error: '需要管理员权限' });
    return;
  }
  const backupPath = createBackup();
  if (!backupPath) {
    response.status(500).json({ error: '数据库文件不存在，无法备份' });
    return;
  }
  response.json({
    ok: true,
    message: '备份创建成功',
    backup: {
      path: backupPath,
      filename: path.basename(backupPath),
      createdAt: new Date().toISOString()
    },
    recentBackups: listBackups()
  });
}));

app.get('/api/admin/backups', requireAuth, asyncRoute(async (request, response) => {
  if (!request.auth.user.isRootAdmin) {
    response.status(403).json({ error: '需要管理员权限' });
    return;
  }
  response.json({ backups: listBackups() });
}));

// ── Error handler ──

app.use((error, request, response, _next) => {
  const message = error?.message || '服务器错误';
  if (response.headersSent) {
    return;
  }
  const status = error?.status
    || (/SQLITE|database|disk/i.test(message) ? 500 : 400);
  const code = normalizeApiErrorCode(status, error?.code);
  console.error('[error]', {
    requestId: request.requestId,
    method: request.method,
    path: request.originalUrl || request.url,
    status,
    code,
    message: sanitizeDiagnosticText(message),
    stack: sanitizeDiagnosticText(error?.stack)
  });
  response.status(status).json({ error: message, code, requestId: request.requestId });
});

// ── Start ──

app.listen(port, () => {
  scheduleDailyBackup();
  console.log(`FLAI Tavern backend listening on http://localhost:${port}`);
});

// ── Graceful shutdown ──

function gracefulShutdown(signal) {
  console.log(`[server] Received ${signal}, shutting down gracefully...`);
  try {
    // WAL checkpoint to flush pending writes
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.close();
    console.log('[server] Database closed successfully');
  } catch (error) {
    console.error('[server] Error during database shutdown:', error?.message || error);
  }
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// ── CORS helpers ──

function isAllowedClientOrigin(origin) {
  if (clientOrigins.includes(origin)) {
    return true;
  }

  if (!allowPrivateNetworkOrigins) {
    return false;
  }

  try {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return false;
    }
    return isLocalHost(url.hostname) || isPrivateNetworkHost(url.hostname);
  } catch {
    return false;
  }
}

function isLocalHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function isPrivateNetworkHost(hostname) {
  return (
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)
  );
}
