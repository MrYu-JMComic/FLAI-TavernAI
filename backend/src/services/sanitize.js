/**
 * XSS 防护服务
 * 使用 DOMPurify + jsdom 对用户输入进行 sanitize
 */

import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

// 严格模式：仅保留纯文本，去除所有 HTML 标签
const STRICT_CONFIG = {
  ALLOWED_TAGS: [],
  ALLOWED_ATTR: [],
  KEEP_CONTENT: true
};

// 宽松模式：保留基本格式标签（用于 Markdown 渲染前的预处理）
const RELAXED_CONFIG = {
  ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li', 'code', 'pre', 'blockquote'],
  ALLOWED_ATTR: ['href', 'title'],
  ALLOWED_URI_REGEXP: /^https?:\/\//i
};

/**
 * 严格 sanitize：去除所有 HTML，仅保留文本内容
 * 用于角色名、标签名等短文本字段
 */
export function sanitizeText(value) {
  if (typeof value !== 'string') return '';
  return DOMPurify.sanitize(value, STRICT_CONFIG).trim();
}

/**
 * 宽松 sanitize：保留基本格式标签
 * 用于人设、背景、世界观等富文本字段
 */
export function sanitizeRichText(value) {
  if (typeof value !== 'string') return '';
  return DOMPurify.sanitize(value, RELAXED_CONFIG).trim();
}

/**
 * 对消息内容做 sanitize（去除危险标签但保留文本）
 * 聊天消息可能包含 Markdown，不做格式保留
 */
export function sanitizeMessage(value) {
  if (typeof value !== 'string') return '';
  return DOMPurify.sanitize(value, STRICT_CONFIG).trim();
}

/**
 * sanitize 对象中的指定文本字段
 * @param {object} obj - 原始对象
 * @param {string[]} textFields - 需要严格 sanitize 的字段
 * @param {string[]} richFields - 需要宽松 sanitize 的字段
 */
export function sanitizeFields(obj, textFields = [], richFields = []) {
  if (!obj || typeof obj !== 'object') return obj;
  const result = { ...obj };

  for (const field of textFields) {
    if (typeof result[field] === 'string') {
      result[field] = sanitizeText(result[field]);
    }
  }

  for (const field of richFields) {
    if (typeof result[field] === 'string') {
      result[field] = sanitizeRichText(result[field]);
    }
  }

  return result;
}

/**
 * 角色创建/更新的完整 sanitize
 */
export function sanitizeCharacterPayload(body) {
  return sanitizeFields(body,
    ['name', 'gender', 'age', 'visibility'],  // 严格
    ['background', 'worldview', 'persona', 'openingMessage']  // 宽松
  );
}

/**
 * 消息内容 sanitize
 */
export function sanitizeMessagePayload(body) {
  if (!body || typeof body !== 'object') return body;
  const result = { ...body };
  if (typeof result.content === 'string') {
    result.content = sanitizeMessage(result.content);
  }
  if (typeof result.message === 'string') {
    result.message = sanitizeMessage(result.message);
  }
  return result;
}
