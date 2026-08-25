/**
 * 缓存工具层
 * Cache Utilities
 *
 * 提供进程内 LRU 缓存（按用途分桶）：
 * - queryCache   : 高频只读数据库查询结果（短 TTL）
 * - promptCache  : prompt 片段（NPC 上下文卡、场景上下文等），数据变更时主动失效
 * - sceneCache   : 场景/物品工作区（较长 TTL，场景变更时失效）
 *
 * 所有缓存都是纯进程内内存缓存，单进程部署下一致性由「变更即失效」保证。
 */

import { LRUCache } from 'lru-cache';
import crypto from 'node:crypto';

const DEFAULT_QUERY_TTL_MS = 15_000;
const DEFAULT_PROMPT_TTL_MS = 20_000;
const DEFAULT_SCENE_TTL_MS = 60_000;

const queryCache = new LRUCache({ max: 500, ttl: DEFAULT_QUERY_TTL_MS, updateAgeOnGet: true });
const promptCache = new LRUCache({ max: 80, ttl: DEFAULT_PROMPT_TTL_MS, updateAgeOnGet: true });
const sceneCache = new LRUCache({ max: 120, ttl: DEFAULT_SCENE_TTL_MS, updateAgeOnGet: true });

// ── Key helpers ──

/**
 * 拼接缓存键，自动对参数做 JSON 规范化，避免对象键序导致的不命中。
 */
export function cacheKey(prefix, ...args) {
  const parts = args.map((arg) => {
    if (arg === null || arg === undefined) {
      return '';
    }
    if (typeof arg === 'object') {
      return stableStringify(arg);
    }
    return String(arg);
  });
  return `${prefix}:${parts.join(':')}`;
}

/**
 * 基于内容生成确定性哈希键（用于 prompt 片段缓存）。
 */
export function hashKey(prefix, ...values) {
  const digest = crypto
    .createHash('sha1')
    .update(values.map((value) => (typeof value === 'string' ? value : JSON.stringify(value))).join('|'))
    .digest('hex')
    .slice(0, 16);
  return `${prefix}:${digest}`;
}

// ── Generic get/set/invalidate ──

export function getCached(cacheName, key) {
  const cache = resolveCache(cacheName);
  return cache.get(key);
}

export function setCached(cacheName, key, value, ttlMs = 0) {
  const cache = resolveCache(cacheName);
  if (ttlMs > 0) {
    cache.set(key, value, { ttl: ttlMs });
  } else {
    cache.set(key, value);
  }
  return value;
}

export function invalidateCache(cacheName, key) {
  resolveCache(cacheName).delete(key);
}

/**
 * 按前缀批量失效（如 invalidatePrefix('scene', 'conv:abc') 清理所有场景缓存）。
 */
export function invalidatePrefix(cacheName, prefix) {
  const cache = resolveCache(cacheName);
  const needle = String(prefix || '');
  if (!needle) {
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(needle)) {
      cache.delete(key);
    }
  }
}

// ── Convenience wrappers ──

/**
 * 缓存包裹的同步查询函数：
 * const rows = cachedQuery(db, 'npcMemories', key, 'SELECT ...', ...params);
 */
export function cachedQuery(database, cacheName, key, sql, ...params) {
  const cached = getCached(cacheName, key);
  if (cached !== undefined) {
    return cached;
  }
  const result = database.prepare(sql).all(...params);
  setCached(cacheName, key, result);
  return result;
}

/**
 * 缓存包裹的同步单行查询函数。
 */
export function cachedGetRow(database, cacheName, key, sql, ...params) {
  const cached = getCached(cacheName, key);
  if (cached !== undefined) {
    return cached;
  }
  const result = database.prepare(sql).get(...params);
  setCached(cacheName, key, result);
  return result;
}

// ── Stats ──

export function getCacheStats() {
  return {
    query: { size: queryCache.size, hits: queryCache.usedPercentage },
    prompt: { size: promptCache.size, hits: promptCache.usedPercentage },
    scene: { size: sceneCache.size, hits: sceneCache.usedPercentage }
  };
}

export function clearAllCaches() {
  queryCache.clear();
  promptCache.clear();
  sceneCache.clear();
}

// ── Internal ──

function resolveCache(cacheName) {
  if (cacheName === 'prompt') return promptCache;
  if (cacheName === 'scene') return sceneCache;
  return queryCache;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}
