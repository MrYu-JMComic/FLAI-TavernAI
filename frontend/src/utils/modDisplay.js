export function normalizeModCharacterIds(ids = []) {
  const seen = new Set();
  const normalized = [];
  for (const rawId of Array.isArray(ids) ? ids : []) {
    const id = String(rawId || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
}

export function normalizeModScope(scope, characterIds = []) {
  const value = String(scope || '').trim();
  if (['global', 'all_characters', 'characters'].includes(value)) {
    return value;
  }
  return normalizeModCharacterIds(characterIds).length ? 'characters' : 'global';
}

export function modScopeLabel(mod) {
  const scope = normalizeModScope(mod?.scope, mod?.characterIds);
  if (scope === 'all_characters') {
    return '全角色加载';
  }
  if (scope === 'characters') {
    const count = normalizeModCharacterIds(mod?.characterIds).length;
    return count ? `绑定 ${count} 个角色` : '未绑定角色';
  }
  return '全局加载';
}

export function modTypeLabel(type) {
  return {
    prompt_inject: '提示词注入',
    style_enhance: '文风增强',
    custom: '自定义'
  }[type] || type;
}

export function modTypeColor(type) {
  return {
    prompt_inject: '#4f8cff',
    style_enhance: '#a855f7',
    custom: '#10b981'
  }[type] || '#888';
}

export function characterVisibilityText(value) {
  return value === 'public' ? '公开' : '私有';
}
