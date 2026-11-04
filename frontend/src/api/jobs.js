import { apiRequest } from './core.js';

export function fetchJob(jobId) {
  return apiRequest(`/api/jobs/${encodeURIComponent(String(jobId || '').trim())}`);
}

export function cancelJob(jobId) { return apiRequest(`/api/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' }); }
export function retryJob(jobId) { return apiRequest(`/api/jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST' }); }
