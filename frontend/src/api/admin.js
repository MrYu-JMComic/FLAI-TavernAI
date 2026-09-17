import { apiRequest } from './core.js';

export function fetchAdminUsers(options = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(options.limit || 50));
  if (options.cursor) {
    params.set('cursor', options.cursor);
  }
  if (options.search) {
    params.set('search', String(options.search).trim());
  }
  return apiRequest(`/api/admin/users?${params.toString()}`);
}

export function updateAdminUserQuota(userId, payload) {
  return apiRequest(`/api/admin/users/${encodeURIComponent(userId)}/quota`, {
    method: 'PUT',
    body: JSON.stringify(payload || {})
  });
}

export function resetAdminDailyRequestUsage(userId) {
  return apiRequest(`/api/admin/users/${encodeURIComponent(userId)}/usage/requests/reset`, {
    method: 'POST'
  });
}

export function deleteAdminUser(userId) {
  return apiRequest(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE'
  });
}
