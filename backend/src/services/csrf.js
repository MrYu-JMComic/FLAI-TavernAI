/**
 * CSRF 防护服务
 * 基于 Double Submit Cookie 模式实现
 *
 * 流程：
 * 1. 服务端生成 CSRF token，通过 cookie 发送给客户端
 * 2. 客户端在 POST/PUT/DELETE 请求的 header 中携带 X-CSRF-Token
 * 3. 服务端校验 header 中的 token 与 cookie 中的 token 是否一致
 *
 * 为什么不用 csurf 包：
 * - csurf 依赖 session，且已被标记为 deprecated
 * - Double Submit Cookie 模式更简单，适合 SPA + API 架构
 */

import crypto from 'node:crypto';
import { appConfig } from '../config.js';
import { appSecretForSigning } from '../security.js';

const CSRF_COOKIE_NAME = 'flai_csrf';
const CSRF_BIND_COOKIE_NAME = 'flai_csrf_bind';
const CSRF_HEADER_NAME = 'x-csrf-token';
const TOKEN_LENGTH = 32;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const MUTATION_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

/**
 * 生成随机 CSRF token
 */
function generateCsrfToken() {
  return crypto.randomBytes(TOKEN_LENGTH).toString('base64url');
}

function csrfBinding(request) {
  return request.auth?.sessionId || request.cookies?.[CSRF_BIND_COOKIE_NAME] || '';
}

function tokenSignature(payload) {
  return crypto.createHmac('sha256', appSecretForSigning()).update(payload).digest('base64url');
}

function createSignedToken(binding) {
  const payload = Buffer.from(JSON.stringify({
    binding,
    nonce: generateCsrfToken(),
    expiresAt: Date.now() + TOKEN_TTL_MS
  })).toString('base64url');
  return `v1.${payload}.${tokenSignature(payload)}`;
}

export function issueCsrfToken(response, binding) {
  const normalizedBinding = String(binding || '').trim() || generateCsrfToken();
  setCsrfBindingCookie(response, normalizedBinding);
  const token = createSignedToken(normalizedBinding);
  setCsrfCookie(response, token);
  return token;
}

function verifySignedToken(token, binding) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts[0] !== 'v1' || !binding) {
    return false;
  }
  const [version, payload, signature] = parts;
  const expected = tokenSignature(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    return false;
  }
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return decoded?.binding === binding && Number(decoded?.expiresAt) > Date.now();
  } catch {
    return false;
  }
}

/**
 * 设置 CSRF cookie（不可被 JS 读取，但会自动随请求发送）
 */
function setCsrfCookie(response, token) {
  response.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false, // 前端需要读取此 cookie 来设置 header
    sameSite: 'lax',
    secure: appConfig.isProduction,
    maxAge: 24 * 60 * 60 * 1000, // 24 小时
    path: '/'
  });
}

function setCsrfBindingCookie(response, value) {
  response.cookie(CSRF_BIND_COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: appConfig.isProduction,
    maxAge: TOKEN_TTL_MS,
    path: '/'
  });
}

function allowedMutationOrigin(request) {
  const fetchSite = String(request.headers?.['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite === 'cross-site') {
    return false;
  }
  const origin = String(request.headers?.origin || '').trim();
  if (!origin) {
    return true;
  }
  if (appConfig.clientOrigins.includes(origin)) {
    return true;
  }
  if (!appConfig.allowPrivateNetworkOrigins) {
    return false;
  }
  try {
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol)
      && ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

/**
 * CSRF 校验中间件
 * GET/HEAD/OPTIONS 请求不需要校验
 * POST/PUT/DELETE/PATCH 请求需要校验
 */
export function csrfProtection(request, response, next) {
  // 仅对状态变更请求做校验
  const method = request.method.toUpperCase();
  if (!MUTATION_METHODS.has(method)) {
    return next();
  }

  if (!allowedMutationOrigin(request)) {
    response.status(419).json({ error: '请求来源未被信任', code: 'CSRF_ORIGIN_INVALID' });
    return;
  }

  // 从 cookie 中获取 token
  const cookieToken = request.cookies?.[CSRF_COOKIE_NAME];
  // 从 header 中获取 token
  const headerToken = request.headers[CSRF_HEADER_NAME];

  if (!cookieToken || !headerToken || !verifySignedToken(cookieToken, csrfBinding(request)) || cookieToken !== headerToken) {
    response.status(419).json({ error: 'CSRF token 无效，请刷新页面重试', code: 'CSRF_TOKEN_INVALID' });
    return;
  }

  next();
}

/**
 * 获取 CSRF token 的端点
 * 前端在首次加载时调用，获取 token 并存入 cookie
 */
export function csrfTokenEndpoint(request, response) {
  const binding = csrfBinding(request) || generateCsrfToken();
  const token = issueCsrfToken(response, binding);
  response.json({ csrfToken: token });
}
