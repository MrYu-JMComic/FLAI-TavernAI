import { apiRequest } from './core.js';

export function fetchJob(jobId) {
  return apiRequest(`/api/jobs/${encodeURIComponent(String(jobId || '').trim())}`);
}
