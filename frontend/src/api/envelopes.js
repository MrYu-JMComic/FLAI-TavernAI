import { apiRequest } from './core.js';

export function exportEnvelope(kind, options = {}) {
  const params = new URLSearchParams();
  const ids = normalizeEnvelopeExportIds(options.ids ?? options.id);
  if (ids.length) {
    params.set('ids', ids.join(','));
  }
  const query = params.toString();
  return apiRequest(`/api/envelopes/${encodeURIComponent(kind)}${query ? `?${query}` : ''}`);
}

export function importEnvelope(kind, payload) {
  return apiRequest(`/api/envelopes/${encodeURIComponent(kind)}/import`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

function normalizeEnvelopeExportIds(value) {
  const ids = [];
  const seen = new Set();
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  for (const raw of source) {
    const id = String(raw || '').trim();
    if (!id || seen.has(id)) {
      continue;
    }
    ids.push(id);
    seen.add(id);
  }
  return ids;
}
