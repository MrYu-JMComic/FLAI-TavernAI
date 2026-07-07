import { apiRequest } from './core.js';

export function fetchAppBootstrap() {
  return apiRequest('/api/app/bootstrap');
}

export function exportProjectSnapshot() {
  return apiRequest('/api/project/snapshot');
}
