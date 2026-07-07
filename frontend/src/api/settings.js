import { apiRequest } from './core.js';

export function fetchRegexRules(group = '') {
  const params = new URLSearchParams();
  if (group) params.set('group', group);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return apiRequest(`/api/regex-rules${suffix}`);
}

export function toggleRegexRule(ruleId) {
  return apiRequest(`/api/regex-rules/${ruleId}/toggle`, { method: 'PUT' });
}

export function reorderRegexRules(orderedIds, group = '') {
  const body = { orderedIds };
  if (group) body.group = group;
  return apiRequest('/api/regex-rules/order', {
    method: 'PUT',
    body: JSON.stringify(body)
  });
}

export function importRegexRuleSet(payload) {
  return apiRequest('/api/regex-rules/import', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}
