import { apiRequest } from './core.js';

export function getMe() {
  return apiRequest('/api/auth/me');
}

export function register(payload) {
  return apiRequest('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function login(payload) {
  return apiRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function logout() {
  return apiRequest('/api/auth/logout', { method: 'POST' });
}

export function saveUserAvatar(payload) {
  return apiRequest('/api/users/me/avatar', {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function getUserProfile() {
  return apiRequest('/api/users/me/profile');
}

export function saveUserProfile(payload) {
  return apiRequest('/api/users/me/profile', {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}
