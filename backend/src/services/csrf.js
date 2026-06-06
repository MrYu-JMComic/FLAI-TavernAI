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

const CSRF_COOKIE_NAME = 'flai_csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';
const TOKEN_LENGTH = 32;

/**
 * 生成随机 CSRF token
 */
function generateCsrfToken() {
  return crypto.randomBytes(TOKEN_LENGTH).toString('base64url');
}

/**
 * 设置 CSRF cookie（不可被 JS 读取，但会自动随请求发送）
 */
function setCsrfCookie(response, token) {
  response.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false, // 前端需要读取此 cookie 来设置 header
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000, // 24 小时
    path: '/'
  });
}

/**
 * CSRF 校验中间件
 * GET/HEAD/OPTIONS 请求不需要校验
 * POST/PUT/DELETE/PATCH 请求需要校验
 */
export function csrfProtection(request, response, next) {
  // 仅对状态变更请求做校验
  const method = request.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return next();
  }

  // 从 cookie 中获取 token
  const cookieToken = request.cookies?.[CSRF_COOKIE_NAME];
  // 从 header 中获取 token
  const headerToken = request.headers[CSRF_HEADER_NAME];

  if (!cookieToken || !headerToken) {
    response.status(403).json({ error: 'CSRF token 缺失，请刷新页面重试' });
    return;
  }

  // 使用 timingSafeEqual 防止时序攻击
  try {
    const a = Buffer.from(cookieToken);
    const b = Buffer.from(headerToken);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      response.status(403).json({ error: 'CSRF token 无效，请刷新页面重试' });
      return;
    }
  } catch {
    response.status(403).json({ error: 'CSRF token 校验失败' });
    return;
  }

  next();
}

/**
 * 获取 CSRF token 的端点
 * 前端在首次加载时调用，获取 token 并存入 cookie
 */
export function csrfTokenEndpoint(request, response) {
  const token = generateCsrfToken();
  setCsrfCookie(response, token);
  response.json({ csrfToken: token });
}
