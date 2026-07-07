import { apiRequest } from './core.js';

export function exportDiagnostics() {
  return apiRequest('/api/diagnostics/export');
}
