import { Router } from 'express';
import crypto from 'node:crypto';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  hashPassword,
  newId,
  nowIso,
  setSessionCookie,
  rotateSession,
  verifyPassword
} from '../security.js';
import { appConfig } from '../config.js';
import { issueCsrfToken } from '../services/csrf.js';
import { isUniqueConstraintError, withSavepoint } from '../modules/savepoint.js';
import { registerSchema, loginSchema, updateProfileSchema, validate } from '../validations/schemas.js';

export function createAuthRouter(ctx) {
  const {
    db,
    requireAuth,
    asyncRoute,
    publicUser,
    saveDefaultProvider,
    getUserProfile,
    registrationEnabled = appConfig.registrationEnabled,
    rootAdminUsername = appConfig.rootAdminUsername,
    rootAdminPassword = appConfig.rootAdminPassword,
    rootAdminBootstrapToken = appConfig.rootAdminBootstrapToken,
    allowLegacyRootBootstrap = appConfig.allowLegacyRootBootstrap,
    config = appConfig
  } = ctx;
  const router = Router();

  router.post('/register', validate(registerSchema), asyncRoute(async (request, response) => {
    if (!registrationEnabled) {
      response.status(403).json({ error: '当前已关闭公开注册', code: 'REGISTRATION_DISABLED' });
      return;
    }
    const userCount = Number(db.prepare('SELECT COUNT(*) AS count FROM users').get()?.count || 0);
    const rootExists = Boolean(db.prepare('SELECT 1 FROM users WHERE is_root_admin = 1 LIMIT 1').get());
    const bootstrapConfigured = Boolean(rootAdminBootstrapToken)
      || Boolean(allowLegacyRootBootstrap && rootAdminUsername && rootAdminPassword);
    if (bootstrapConfigured && rootExists) {
      response.status(403).json({ error: '管理员初始化已完成，公开注册已关闭', code: 'REGISTRATION_BOOTSTRAP_COMPLETE' });
      return;
    }
    if (rootAdminBootstrapToken && userCount > 0 && !rootExists) {
      response.status(403).json({ error: '管理员初始化必须在空数据库中完成', code: 'ROOT_BOOTSTRAP_REQUIRED' });
      return;
    }
    const { username, password, bootstrapToken } = request.body;
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      response.status(409).json({ error: '用户名已存在' });
      return;
    }

    const rootCredentialMatch = rootAdminBootstrapToken
      ? Boolean(rootAdminUsername && constantTimeEqual(username, rootAdminUsername)
        && constantTimeEqual(bootstrapToken, rootAdminBootstrapToken))
      : Boolean(
        allowLegacyRootBootstrap
          && rootAdminUsername
          && rootAdminPassword
          && constantTimeEqual(username, rootAdminUsername)
          && password === rootAdminPassword
      );
    if (rootAdminBootstrapToken && !rootCredentialMatch) {
      response.status(403).json({ error: '需要有效的管理员初始化令牌', code: 'ROOT_BOOTSTRAP_REQUIRED' });
      return;
    }
    const userId = newId();
    const passwordHash = await hashPassword(password);
    const createdAt = nowIso();
    let isRootAdmin = false;
    let sessionId = '';
    try {
      withSavepoint(db, 'sp_register_user', () => {
        db.prepare(
          `INSERT INTO users (id, username, password_hash, permission_group, is_root_admin, created_at)
           SELECT ?, ?, ?,
             CASE WHEN ? = 1 AND NOT EXISTS (SELECT 1 FROM users) THEN 'admin' ELSE 'user' END,
             CASE WHEN ? = 1 AND NOT EXISTS (SELECT 1 FROM users) THEN 1 ELSE 0 END,
             ?`
        ).run(userId, username, passwordHash, rootCredentialMatch ? 1 : 0, rootCredentialMatch ? 1 : 0, createdAt);
        isRootAdmin = Boolean(db.prepare('SELECT is_root_admin FROM users WHERE id = ?').get(userId)?.is_root_admin);
        saveDefaultProvider(userId);
        sessionId = createSession(db, userId);
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        response.status(409).json({ error: '用户名已存在', code: 'USERNAME_TAKEN' });
        return;
      }
      throw error;
    }

    setSessionCookie(response, sessionId);
    issueCsrfToken(response, sessionId, config);
    response.status(201).json({ user: publicUser({ id: userId, username, is_root_admin: isRootAdmin ? 1 : 0, created_at: createdAt }) });
  }));

  router.post('/login', validate(loginSchema), asyncRoute(async (request, response) => {
    const { username, password } = request.body;
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      response.status(401).json({ error: '用户名或密码错误' });
      return;
    }

    const sessionId = rotateSession(db, row.id, request.auth?.sessionId || '');
    setSessionCookie(response, sessionId);
    issueCsrfToken(response, sessionId, config);
    response.json({ user: publicUser(row) });
  }));

  router.post('/logout', requireAuth, (request, response) => {
    destroySession(db, request.auth.sessionId);
    clearSessionCookie(response);
    response.json({ ok: true });
  });

  router.get('/me', (request, response) => {
    response.json({ user: request.auth?.user || null });
  });

  // ── User Profile ──

  router.get('/users/me/profile', requireAuth, (request, response) => {
    response.json(getUserProfile(request.auth.user.id));
  });

  router.put('/users/me/profile', requireAuth, validate(updateProfileSchema), (request, response) => {
    const displayName = request.body.displayName || '';
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, request.auth.user.id);
    response.json(getUserProfile(request.auth.user.id));
  });

  return router;
}

function constantTimeEqual(left, right) {
  const leftHash = crypto.createHash('sha256').update(String(left || '')).digest();
  const rightHash = crypto.createHash('sha256').update(String(right || '')).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}
