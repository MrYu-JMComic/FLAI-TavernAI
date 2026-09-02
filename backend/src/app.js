import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { appConfig, withAppConfigDefaults } from './config.js';
import { AppError, appErrorFrom, publicErrorMessage } from './errors.js';
import { getCharacterWorldBookId, getCharacterWorldBookIds } from './modules/worldBooks.js';
import { getCharacterTagsMap } from './modules/tags.js';
import { getUserProfile, publicUser } from './modules/users.js';
import {
  ensureSelectedProviderProfile,
  getProviderProfileRow
} from './repositories/providerProfileRepository.js';
import { createAuthRouter } from './routes/auth.js';
import { createAdminRouter } from './routes/admin.js';
import { createBranchesRouter } from './routes/branches.js';
import { createCharactersRouter } from './routes/characters.js';
import { createConversationsRouter, createSavesRouter } from './routes/conversations.js';
import { getChatProviderSettingsFromContext } from './routes/helpers.js';
import { createHMDTRouter } from './routes/hmdt.js';
import { createJobsRouter } from './routes/jobs.js';
import { createModsRouter } from './routes/mods.js';
import { createPresetsRouter } from './routes/presets.js';
import { createRegexRouter } from './routes/regex.js';
import { createSearchRouter } from './routes/search.js';
import { createSettingsRouter } from './routes/settings.js';
import { createSwipesRouter } from './routes/swipes.js';
import { createTagsRouter } from './routes/tags.js';
import { createTalentsRouter } from './routes/talents.js';
import { createTownsRouter } from './routes/towns.js';
import { createUpgradeRouter } from './routes/upgrade.js';
import { createWorldBooksRouter } from './routes/worldBooks.js';
import { newId, nowIso, resolveSession } from './security.js';
import { getAvatarAssetForViewer } from './services/avatars.js';
import { createCsrfMiddleware, createCsrfTokenEndpoint } from './services/csrf.js';
import {
  buildOpenApiDocument,
  compatibilityAliasMiddleware,
  listCompatibilityAliasUsage
} from './services/apiContracts.js';
import { sanitizeDiagnosticText } from './services/diagnosticRedaction.js';
import { validateAuthenticatedRequestBoundary } from './validations/schemas.js';
import { logger } from './services/logger.js';
import {
  defaultProviderSettings,
  hasUsableProvider,
  normalizeProviderRow,
  providerWithSecret
} from './services/providers.js';
import { providerResilienceSnapshot } from './services/providerResilience.js';
import { assertStructuredStorageQuota, consumeDailyRequest } from './services/quotas.js';
import { applyProviderNetworkPolicy } from './services/providerNetworkPolicy.js';
import { isPrivateOrSpecialHost, parseProviderUrl } from './services/providerUrlPolicy.js';
import {
  buildRuntimeHealth,
  buildRuntimeLiveness,
  createReadinessProbe
} from './services/runtimeHealth.js';

export function createApp(context = {}) {
  const db = context.db;
  if (!db) {
    throw new TypeError('createApp requires a database');
  }
  const config = withAppConfigDefaults(context.config || appConfig);
  const applicationLogger = context.logger || logger;
  const backupService = context.backupService || {};
  const app = express();
  repairRootProviderPermissions(db, config);
  const readinessProbe = createReadinessProbe(db, context.readinessOptions);

  const apiRateLimitWindowMs = config.apiRateLimitWindowMs;
  const apiRateLimitMax = config.apiRateLimitMax;
  const authenticatedApiRateLimitMax = config.authenticatedApiRateLimitMax;
  const authRateLimitWindowMs = config.authRateLimitWindowMs;
  const authRateLimitMax = config.authRateLimitMax;

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

  app.use(cors({
    origin(origin, callback) {
      if (!origin || isAllowedClientOrigin(origin, config)) {
        callback(null, true);
        return;
      }
      callback(new AppError(403, 'CORS_ORIGIN_DENIED', '请求来源未被允许'));
    },
    credentials: true,
    exposedHeaders: ['Deprecation', 'Sunset', 'X-Next-Cursor', 'X-Request-Id']
  }));
  app.use(compression({ threshold: 256, level: 6, filter: shouldCompressResponse }));
  app.use(cookieParser());
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'SAMEORIGIN');
    response.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(express.json({ limit: config.jsonBodyLimit }));
  app.use(attachRequestId);
  app.use(attachApiErrorEnvelope);
  app.use(compatibilityAliasMiddleware);
  app.use((request, _response, next) => {
    request.auth = resolveSession(db, request);
    next();
  });
  app.use((request, _response, next) => {
    const userId = request.auth?.user?.id;
    if (!userId || !['POST', 'PUT', 'PATCH'].includes(String(request.method || '').toUpperCase())) {
      next();
      return;
    }
    let bodyBytes = 0;
    try {
      bodyBytes = Buffer.byteLength(JSON.stringify(request.body ?? {}));
    } catch {
      bodyBytes = 0;
    }
    try {
      assertStructuredStorageQuota(db, userId, bodyBytes);
      next();
    } catch (error) {
      next(error);
    }
  });

  const requireAuth = (request, response, next) => {
    if (!request.auth?.user) {
      response.status(401).json({ error: '请先登录' });
      return;
    }
    validateAuthenticatedRequestBoundary(request, response, next, {
      limits: config.jsonBodyLimitBytes ? { maxBytes: config.jsonBodyLimitBytes } : {}
    });
  };
  const requireRootAdmin = (request, response, next) => {
    if (!request.auth?.user?.isRootAdmin) {
      response.status(403).json({ error: '需要管理员权限' });
      return;
    }
    next();
  };
  const asyncRoute = (handler) => (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };

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

  app.get('/api/csrf-token', createCsrfTokenEndpoint(config));
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
  app.use('/api', createCsrfMiddleware(config));
  app.use((_request, response, next) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    next();
  });
  app.use('/api', apiLimiter);
  app.use('/api', (request, _response, next) => {
    if (request.auth?.user) consumeDailyRequest(db, request.auth.user.id);
    next();
  });
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);

  function withEtag(request, response, data) {
    const body = JSON.stringify(data);
    const etag = `"${crypto.createHash('md5').update(body).digest('hex').slice(0, 16)}"`;
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
    const etag = `"${crypto.createHash('md5').update(body).digest('hex').slice(0, 16)}"`;
    response.setHeader('ETag', etag);
    response.setHeader('Cache-Control', 'private, max-age=10, stale-while-revalidate=30');
    if (request.headers['if-none-match'] === etag) {
      response.status(304).end();
      return;
    }
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.send(body);
  }

  function withWorldBookId(character) {
    if (!character) return character;
    return { ...character, worldBookId: getCharacterWorldBookId(db, character.id) };
  }

  function withCharacterTags(character) {
    if (!character) return character;
    const characterTags = db.prepare(
      `SELECT tags.id, tags.name, tags.color FROM character_tags
       JOIN tags ON tags.id = character_tags.tag_id
       WHERE character_tags.character_id = ? AND tags.user_id = ?
       ORDER BY tags.name COLLATE NOCASE ASC, tags.name ASC, tags.rowid ASC`
    ).all(character.id, character.ownerId);
    return { ...character, characterTags };
  }

  function withCharacterListExtras(characters) {
    if (!Array.isArray(characters) || !characters.length) return [];
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

  function getProviderRow(userId, providerId = '') {
    return getProviderProfileRow(db, userId, providerId);
  }

  function getChatProviderSettings(userId) {
    const result = getChatProviderSettingsFromContext({
      providerWithSecret,
      hasUsableProvider,
      getProviderRow,
      mockProviderEnabled: config.mockProviderEnabled
    }, userId);
    if (result?.ok) {
      if (result.value.providerType !== 'mock') {
        const user = db.prepare(
          'SELECT id, is_root_admin AS isRootAdmin FROM users WHERE id = ?'
        ).get(userId) || { id: userId };
        try {
          result.value = applyProviderNetworkPolicy(result.value, config, user);
        } catch (error) {
          return {
            ok: false,
            error: error?.publicMessage || error?.message || 'Provider 网络策略拒绝请求。',
            code: error?.code
          };
        }
      }
    }
    return result;
  }

  const routeContext = {
    db,
    config,
    requireAuth,
    requireRootAdmin,
    asyncRoute,
    newId,
    nowIso,
    publicUser: (row) => publicUser(db, row),
    getUserProfile: (userId) => getUserProfile(db, userId),
    saveDefaultProvider: (userId) => saveDefaultProvider(db, userId),
    withWorldBookId,
    withCharacterTags,
    withCharacterListExtras,
    withEtag,
    withListCache,
    getProviderRow,
    getChatProviderSettings,
    providerWithSecret,
    hasUsableProvider,
    mockProviderEnabled: config.mockProviderEnabled,
    townWorldGenerationTimeoutMs: config.townWorldGenerationTimeoutMs,
    registrationEnabled: config.registrationEnabled,
    rootAdminUsername: config.rootAdminUsername,
    rootAdminPassword: config.rootAdminPassword,
    rootAdminBootstrapToken: config.rootAdminBootstrapToken,
    allowLegacyRootBootstrap: config.allowLegacyRootBootstrap,
    backupService
  };

  const liveHandler = (_request, response) => response.json(buildRuntimeLiveness());
  const readyHandler = (_request, response) => {
    const health = readinessProbe();
    response.status(health.ok ? 200 : 503).json(health);
  };
  app.get(['/health/live', '/api/health/live'], liveHandler);
  app.get(['/health/ready', '/api/health/ready', '/api/health'], readyHandler);
  app.get(['/openapi.json', '/api/openapi.json'], (_request, response) => {
    response.json(buildOpenApiDocument(config));
  });
  app.get('/api/admin/diagnostics/health', requireAuth, requireRootAdmin, (_request, response) => {
    response.json(buildRuntimeHealth(db));
  });
  app.get('/api/admin/compatibility-aliases', requireAuth, requireRootAdmin, (_request, response) => {
    response.json({ aliases: listCompatibilityAliasUsage() });
  });
  app.get('/api/admin/providers/resilience', requireAuth, requireRootAdmin, (_request, response) => {
    response.json({ providers: providerResilienceSnapshot() });
  });
  app.use('/api/auth', createAuthRouter(routeContext));
  app.use('/api/admin', createAdminRouter(routeContext));
  app.use('/api/characters', createCharactersRouter(routeContext));
  app.use('/api/conversations', createConversationsRouter(routeContext));
  app.use('/api/saves', createSavesRouter(routeContext));
  app.use('/api/world-books', createWorldBooksRouter(routeContext));
  app.use('/api/presets', createPresetsRouter(routeContext));
  app.use('/api/mods', createModsRouter(routeContext));
  app.use('/api/tags', createTagsRouter(routeContext));
  app.use('/api/talent-pools', createTalentsRouter(routeContext));
  app.use('/api/regex-rules', createRegexRouter(routeContext));
  app.use('/api/search', createSearchRouter(routeContext));
  app.use('/api/messages', createSwipesRouter(routeContext));
  app.use('/api/towns', createTownsRouter(routeContext));
  app.use('/api/hmdt', createHMDTRouter(routeContext));
  app.use('/api/jobs', createJobsRouter(routeContext));
  app.use('/api/conversations', createBranchesRouter(routeContext));
  app.use('/api', createUpgradeRouter(routeContext));
  app.use('/api', createSettingsRouter(routeContext));

  app.post('/api/admin/backup', requireAuth, requireRootAdmin, asyncRoute(async (_request, response) => {
    const result = await backupService.create?.();
    const backupPath = typeof result === 'string' ? result : result?.path;
    if (!backupPath) {
      response.status(500).json({ error: '数据库文件不存在，无法备份' });
      return;
    }
    response.json({
      ok: true,
      message: '备份创建成功',
      backup: typeof result === 'object' ? result : {
        path: backupPath,
        filename: path.basename(backupPath),
        createdAt: new Date().toISOString()
      },
      recentBackups: await backupService.list?.() || []
    });
  }));
  app.get('/api/admin/backups', requireAuth, requireRootAdmin, asyncRoute(async (_request, response) => {
    response.json({ backups: await backupService.list?.() || [] });
  }));

  context.registerAdditionalRoutes?.(app, routeContext);

  app.use((error, request, response, _next) => {
    if (response.headersSent) return;
    const rawMessage = error?.message || '服务器错误';
    const status = Number.isInteger(error?.status) ? error.status : 500;
    const normalizedError = appErrorFrom(error, { status });
    const message = publicErrorMessage(normalizedError, status, { isProduction: config.isProduction });
    const code = normalizeApiErrorCode(status, normalizedError.code);
    applicationLogger.error('http_error', {
      requestId: request.requestId,
      method: request.method,
      path: request.originalUrl || request.url,
      status,
      code,
      message: sanitizeDiagnosticText(rawMessage),
      stack: sanitizeDiagnosticText(error?.stack)
    });
    response.status(status).json({ error: message, code, requestId: request.requestId });
  });

  return app;
}

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

export function normalizeApiErrorCode(status, explicitCode = '') {
  if (explicitCode) return String(explicitCode);
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

export function isAllowedClientOrigin(origin, config = appConfig) {
  if (config.clientOrigins.includes(origin)) return true;
  if (!config.allowPrivateNetworkOrigins) return false;
  try {
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol)
      && (isLocalHost(url.hostname) || isPrivateNetworkHost(url.hostname));
  } catch {
    return false;
  }
}

function isLocalHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function isPrivateNetworkHost(hostname) {
  return /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
    || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)
    || /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

function saveDefaultProvider(database, userId) {
  const preset = defaultProviderSettings();
  const row = ensureSelectedProviderProfile(database, userId, {
    defaultSettings: preset,
    timestamp: nowIso()
  });
  return normalizeProviderRow(row);
}

function repairRootProviderPermissions(database, config) {
  try {
    const privateEnabled = config.isProduction
      ? config.allowPrivateProviderNetwork
      : config.allowPrivateProviderNetworkInDevelopment;
    if (!privateEnabled) {
      return;
    }
    const hasProviderTables = database.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'provider_settings')"
    ).get()?.count === 2;
    if (!hasProviderTables) {
      return;
    }
    database.exec(`
    CREATE TABLE IF NOT EXISTS provider_private_network_repairs (
      user_id TEXT PRIMARY KEY,
      repaired_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
    `);
    const users = database.prepare(
      `SELECT users.id
       FROM users
       LEFT JOIN provider_private_network_repairs repairs ON repairs.user_id = users.id
       WHERE users.is_root_admin = 1 AND repairs.user_id IS NULL`
    ).all();
    const tableNames = new Set(
      database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('provider_settings', 'provider_presets')")
        .all()
        .map((row) => row.name)
    );
    for (const user of users) {
      try {
        const privateRows = [];
        for (const tableName of tableNames) {
          const rows = database.prepare(
            `SELECT rowid AS row_id, base_url FROM ${tableName} WHERE user_id = ?`
          ).all(user.id);
          for (const row of rows) {
            try {
              if (isPrivateOrSpecialHost(parseProviderUrl(row.base_url).hostname)) {
                privateRows.push({ tableName, rowId: row.row_id });
              }
            } catch (error) {
              void error;
            }
          }
        }
        for (const row of privateRows) {
          database.prepare(
            `UPDATE ${row.tableName} SET allow_private_network = 1 WHERE rowid = ? AND user_id = ?`
          ).run(row.rowId, user.id);
        }
        if (privateRows.length) {
          database.prepare(
            'INSERT OR IGNORE INTO provider_private_network_repairs (user_id, repaired_at) VALUES (?, ?)'
          ).run(user.id, nowIso());
        }
      } catch (error) {
        // Invalid provider URLs are handled by normal settings validation;
        // startup repair must never prevent the server from booting.
        void error;
      }
    }
  } catch (error) {
    // Read-only or pre-migration databases can skip this optional repair.
    void error;
  }
}
