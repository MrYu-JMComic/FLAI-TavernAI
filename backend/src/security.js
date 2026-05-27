import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const sessionCookieName = 'flai_session';
const scryptAsync = promisify(crypto.scrypt);
const passwordKeyLength = 64;
const sessionDays = 30;
const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(sourceDir, '..');
const secretFile = path.join(backendRoot, 'data', 'app-secret');
const legacyDevSecret = 'flai-dev-secret-change-me';

function appSecret() {
  if (process.env.APP_SECRET) {
    return process.env.APP_SECRET;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('APP_SECRET is required in production');
  }

  return localAppSecret();
}

function localAppSecret() {
  fs.mkdirSync(path.dirname(secretFile), { recursive: true });

  if (fs.existsSync(secretFile)) {
    const value = fs.readFileSync(secretFile, 'utf8').trim();
    if (value) {
      return value;
    }
  }

  const value = crypto.randomBytes(32).toString('base64url');
  fs.writeFileSync(secretFile, `${value}\n`, { mode: 0o600 });
  return value;
}

function secretCandidates() {
  const candidates = [appSecret()];
  const savedLocalSecret = readLocalAppSecret();
  if (savedLocalSecret) {
    candidates.push(savedLocalSecret);
  }
  candidates.push(legacyDevSecret);
  return [...new Set(candidates.filter(Boolean))];
}

function readLocalAppSecret() {
  if (!fs.existsSync(secretFile)) {
    return '';
  }
  return fs.readFileSync(secretFile, 'utf8').trim();
}

function secretKey(secret) {
  return crypto.createHash('sha256').update(secret).digest();
}

// v2: scrypt-derived key (32 bytes) from app secret + fixed salt
const scryptSalt = 'flai-encryption-salt-v2';
const scryptKeyLength = 32;
const scryptCost = 2 ** 14; // N parameter — strong but fast enough for encrypt/decrypt

let cachedScryptKey = null;
let cachedScryptSecret = null;

function secretKeyScrypt(secret) {
  if (cachedScryptKey && cachedScryptSecret === secret) {
    return cachedScryptKey;
  }
  // Synchronous scrypt — acceptable here since encrypt/decrypt are not on the hot path
  cachedScryptKey = crypto.scryptSync(secret, scryptSalt, scryptKeyLength, { N: scryptCost, r: 8, p: 1 });
  cachedScryptSecret = secret;
  return cachedScryptKey;
}

export function nowIso() {
  return new Date().toISOString();
}

export function newId() {
  return crypto.randomUUID();
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64');
  const derived = await scryptAsync(password, salt, passwordKeyLength);
  return `scrypt:${salt}:${Buffer.from(derived).toString('base64')}`;
}

export async function verifyPassword(password, storedHash) {
  const [scheme, salt, hash] = String(storedHash || '').split(':');
  if (scheme !== 'scrypt' || !salt || !hash) {
    return false;
  }

  const derived = await scryptAsync(password, salt, passwordKeyLength);
  const expected = Buffer.from(hash, 'base64');
  const actual = Buffer.from(derived);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function encryptSecret(value) {
  if (!value) {
    return null;
  }

  const key = secretKeyScrypt(appSecret());
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v2:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptSecret(value) {
  if (!value) {
    return '';
  }

  const parts = String(value).split(':');
  const version = parts[0];

  if (version === 'v2') {
    // v2: AES-256-GCM with scrypt-derived key
    const [, ivText, tagText, encryptedText] = parts;
    let lastError;
    for (const secret of secretCandidates()) {
      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', secretKeyScrypt(secret), Buffer.from(ivText, 'base64'));
        decipher.setAuthTag(Buffer.from(tagText, 'base64'));
        return Buffer.concat([
          decipher.update(Buffer.from(encryptedText, 'base64')),
          decipher.final()
        ]).toString('utf8');
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  if (version === 'v1') {
    // v1 (legacy): AES-256-GCM with SHA-256 key — backward compatible
    const [, ivText, tagText, encryptedText] = parts;
    let lastError;
    for (const secret of secretCandidates()) {
      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey(secret), Buffer.from(ivText, 'base64'));
        decipher.setAuthTag(Buffer.from(tagText, 'base64'));
        return Buffer.concat([
          decipher.update(Buffer.from(encryptedText, 'base64')),
          decipher.final()
        ]).toString('utf8');
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  throw new Error('Unsupported encrypted secret format');
}

export function apiKeyHint(apiKey) {
  if (!apiKey) {
    return null;
  }

  const value = String(apiKey);
  if (value.length <= 8) {
    return '已保存';
  }

  return `${value.slice(0, 3)}...${value.slice(-4)}`;
}

export function parseCookies(cookieHeader = '') {
  return String(cookieHeader)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const index = part.indexOf('=');
      if (index === -1) {
        return cookies;
      }
      const key = decodeURIComponent(part.slice(0, index));
      cookies[key] = decodeURIComponent(part.slice(index + 1));
      return cookies;
    }, {});
}

export function setSessionCookie(response, sessionId) {
  response.cookie(sessionCookieName, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: sessionDays * 24 * 60 * 60 * 1000,
    path: '/'
  });
}

export function clearSessionCookie(response) {
  response.clearCookie(sessionCookieName, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/'
  });
}

// ── CSRF Protection (Double-Submit Cookie) ──

export const csrfCookieName = 'flai_csrf';
const csrfHeaderName = 'x-csrf-token';
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

export function generateCsrfToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function setCsrfCookie(response, token) {
  response.cookie(csrfCookieName, token, {
    httpOnly: false,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: sessionDays * 24 * 60 * 60 * 1000,
    path: '/'
  });
}

export function csrfProtection(request, response, next) {
  if (safeMethods.has(request.method)) {
    // Ensure CSRF cookie exists for safe methods
    const existingToken = parseCookies(request.headers.cookie)[csrfCookieName];
    if (!existingToken) {
      setCsrfCookie(response, generateCsrfToken());
    }
    next();
    return;
  }

  // Validate CSRF token on state-changing requests
  const cookieToken = parseCookies(request.headers.cookie)[csrfCookieName];
  const headerToken = request.headers[csrfHeaderName];

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    response.status(403).json({ error: 'CSRF 验证失败，请刷新页面后重试' });
    return;
  }

  next();
}

export function createSession(database, userId) {
  const sessionId = newId();
  const expiresAt = Date.now() + sessionDays * 24 * 60 * 60 * 1000;
  database
    .prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(sessionId, userId, expiresAt, nowIso());
  return sessionId;
}

export function destroySession(database, sessionId) {
  if (sessionId) {
    database.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  }
}

export function resolveSession(database, request) {
  const sessionId = parseCookies(request.headers.cookie)[sessionCookieName];
  if (!sessionId) {
    return null;
  }

  const row = database
    .prepare(
      `SELECT sessions.id AS session_id, users.id, users.username, users.display_name,
              users.permission_group, users.is_root_admin, users.created_at,
              avatar_assets.id AS avatar_asset_id
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       LEFT JOIN avatar_assets
         ON avatar_assets.owner_type = 'user' AND avatar_assets.owner_id = users.id
       WHERE sessions.id = ? AND sessions.expires_at > ?`
    )
    .get(sessionId, Date.now());

  if (!row) {
    database.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    return null;
  }

  return {
    sessionId: row.session_id,
    user: {
      id: row.id,
      username: row.username,
      accountName: row.username,
      displayName: row.display_name || '',
      permissionGroup: row.permission_group || 'user',
      isRootAdmin: Boolean(row.is_root_admin),
      permissionLabel: permissionLabel(row.permission_group, Boolean(row.is_root_admin)),
      avatarUrl: row.avatar_asset_id ? `/api/avatars/${row.avatar_asset_id}` : '',
      createdAt: row.created_at
    }
  };
}

function permissionLabel(permissionGroup, isRootAdmin) {
  if (isRootAdmin) {
    return '真管理员';
  }
  return {
    admin: '管理员组',
    user: '用户组',
    guest: '游客组'
  }[permissionGroup] || '用户组';
}
