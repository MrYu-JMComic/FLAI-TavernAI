import { Router } from 'express';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  hashPassword,
  newId,
  nowIso,
  setSessionCookie,
  verifyPassword
} from '../security.js';
import { registerSchema, loginSchema, updateProfileSchema, validate } from '../validations/schemas.js';

export function createAuthRouter(ctx) {
  const { db, requireAuth, asyncRoute, publicUser, saveDefaultProvider, getUserProfile } = ctx;
  const router = Router();

  router.post('/register', validate(registerSchema), asyncRoute(async (request, response) => {
    const { username, password } = request.body;
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      response.status(409).json({ error: '用户名已存在' });
      return;
    }

    const userId = newId();
    db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
      userId,
      username,
      await hashPassword(password),
      nowIso()
    );
    saveDefaultProvider(userId);

    const sessionId = createSession(db, userId);
    setSessionCookie(response, sessionId);
    response.status(201).json({ user: publicUser({ id: userId, username, created_at: nowIso() }) });
  }));

  router.post('/login', validate(loginSchema), asyncRoute(async (request, response) => {
    const { username, password } = request.body;
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      response.status(401).json({ error: '用户名或密码错误' });
      return;
    }

    const sessionId = createSession(db, row.id);
    setSessionCookie(response, sessionId);
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

function validateCredentials(body = {}) {
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!/^[\w\u4e00-\u9fa5.-]{3,32}$/.test(username)) {
    throw new Error('用户名需为 3-32 位，可包含中文、字母、数字、下划线、点和横线');
  }
  if (password.length < 6 || password.length > 128) {
    throw new Error('密码长度需为 6-128 位');
  }
  return { username, password };
}

function normalizeDisplayName(value) {
  const displayName = String(value || '').trim();
  if (!displayName) {
    return '';
  }
  if (!/^[\p{L}\p{N}_-]{1,8}$/u.test(displayName)) {
    throw new Error('对话用户名仅支持中文、字母、数字、下划线和短横线，最多 8 位');
  }
  return displayName;
}
