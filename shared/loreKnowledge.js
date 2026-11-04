export const LORE_VISIBILITIES = ['author', 'public', 'restricted'];

export function normalizeLoreKnowledge(value = {}, fallback = {}) {
  const visibility = value.knowledgeVisibility ?? value.knowledge_visibility ?? fallback.knowledgeVisibility ?? fallback.knowledge_visibility;
  let keys = value.audienceCastKeys ?? value.audience_cast_keys ?? fallback.audienceCastKeys ?? fallback.audience_cast_keys ?? [];
  if (typeof keys === 'string') {
    try { keys = JSON.parse(keys); } catch { keys = keys.split(','); }
  }
  return {
    knowledgeVisibility: LORE_VISIBILITIES.includes(visibility) ? visibility : 'author',
    audienceCastKeys: [...new Set((Array.isArray(keys) ? keys : []).map((key) => String(key).trim().slice(0, 80)).filter(Boolean))].slice(0, 64)
  };
}

/** Filter before matching, recursion, or trigger-state updates; author/cast views retain author lore. */
export function isLoreVisibleToScope(entry, scope = {}) {
  if (scope.isolation !== 'actor') return true;
  const policy = normalizeLoreKnowledge(entry);
  if (policy.knowledgeVisibility === 'public') return true;
  if (policy.knowledgeVisibility !== 'restricted') return false;
  const keys = new Set(scope.actorCastKeys || []);
  return policy.audienceCastKeys.some((key) => keys.has(key));
}
