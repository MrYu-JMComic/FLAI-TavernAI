/**
 * 数据版本追踪器
 * Cache Version Tracker
 *
 * 为每个 (conversationId, domain) 维护一个单调递增的版本号。
 * prompt 片段缓存键 = cacheKey('scene', conversationId, version)，
 * 数据变更时 bumpVersion 使旧缓存自然过期，无需精确删除。
 *
 * 单进程服务器：版本号仅保存在内存中。
 */

const versions = new Map(); // `${conversationId}:${domain}` -> number

const DOMAINS = ['scene', 'npc', 'memory', 'appearance', 'turn'];

export function getVersion(conversationId, domain) {
  const key = `${conversationId}:${domain}`;
  return versions.get(key) || 0;
}

export function bumpVersion(conversationId, domain) {
  if (!DOMAINS.includes(domain)) {
    return 0;
  }
  const key = `${conversationId}:${domain}`;
  const next = (versions.get(key) || 0) + 1;
  versions.set(key, next);
  return next;
}

export function versionKey(conversationId, domain) {
  return `${conversationId}:${domain}:v${getVersion(conversationId, domain)}`;
}

export function resetAllVersions() {
  versions.clear();
}
