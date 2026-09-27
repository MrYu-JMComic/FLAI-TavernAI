import { createHash } from 'node:crypto';
import { newId, nowIso } from '../security.js';
import { parseJson } from '../utils/json.js';
import { isDiagnosticSecretKey, sanitizeDiagnosticText } from './diagnosticRedaction.js';
import { estimatePromptTokens } from './promptTokenBudget.js';

const MAX_TRACE_JSON_CHARACTERS = 250_000;
const LARGE_BASE64_MIN_CHARACTERS = 256;
const SAFE_TOKEN_KEYS = new Set([
  'max_tokens', 'max_output_tokens', 'max_completion_tokens', 'input_tokens', 'output_tokens', 'total_tokens',
  'prompt_tokens', 'completion_tokens', 'reasoning_tokens', 'cached_tokens', 'budget_tokens', 'thinking_budget',
  'tokens', 'estimatedTokens', 'inputTokenLimit', 'reservedOutputTokens', 'imageTokensPerImage', 'contextWindowTokens',
  'effectiveInputLimit', 'textTokens', 'toolSchemaTokens', 'messageOverheadTokens', 'toolOverheadTokens', 'imageTokens',
  'limitTokens', 'overflowTokens', 'originalTokens', 'keptTokens', 'estimatedTotalTokens',
  'conversationTokens', 'systemTokens', 'totalReservedTokens',
  'inputTokens', 'outputTokens', 'totalTokens', 'reasoningTokens', 'cachedTokens', 'promptTokens', 'completionTokens'
]);
const TOKEN_BUDGET_FIELDS = Object.freeze({
  inputTokenLimit: 'nullable-number', reservedOutputTokens: 'nullable-number', imageTokensPerImage: 'number',
  contextWindowTokens: 'nullable-number', effectiveInputLimit: 'number', overflow: 'boolean', unlimited: 'boolean',
  estimated: 'boolean', exact: 'boolean', method: 'string', warning: 'string'
});
const TOKEN_ESTIMATE_FIELDS = Object.freeze({
  tokens: 'number', estimatedTokens: 'number', estimated: 'boolean', exact: 'boolean', method: 'string',
  warning: 'string', breakdown: 'breakdown', inheritedContext: 'boolean', coverage: 'string'
});
const TOKEN_BREAKDOWN_FIELDS = new Set([
  'textTokens', 'toolSchemaTokens', 'messageOverheadTokens', 'toolOverheadTokens', 'imageTokens', 'imageCount'
]);
const EMBEDDED_DATA_URL_PATTERN = /data:([^;,\s]+)(?:;[^,\s]*)?;base64,[A-Za-z0-9+/=]+/gi;
const EMBEDDED_HTTP_URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const TRACE_URL_SECRET_KEY_PATTERN = /^(?:sig|signature|auth|access[_-]?key|x-amz-(?:credential|signature|security-token)|x-goog-(?:credential|signature))$/i;

export function tryCreatePromptTrace(database, options) {
  try {
    return createPromptTrace(database, options);
  } catch {
    // Trace persistence is optional observability; its failure must not block generation.
    return null;
  }
}

export function finishPromptTrace(trace, result) {
  try {
    trace?.complete(result);
    return true;
  } catch {
    // Report observer availability without changing the generation outcome.
    return false;
  }
}

export function createPromptTrace(database, options) {
  const { userId, conversationId, ticket, pipeline, settings, sourceMessageId = '', operation = 'send' } = options;
  assertOwner(database, userId, conversationId);
  const id = newId();
  const secrets = [settings?.apiKey].filter((value) => typeof value === 'string' && value.length > 0);
  const source = database.prepare('SELECT revision FROM messages WHERE id = ? AND user_id = ? AND conversation_id = ?')
    .get(sourceMessageId, userId, conversationId);
  const selection = {
    priority: pipeline.priority, diagnostics: pipeline.diagnostics,
    manifest: (pipeline.selectionManifest || []).map((item) => ({ ...item })),
    sources: Object.fromEntries(Object.entries(pipeline.sections || {}).map(([key, section]) => [key, {
      budget: section.budget,
      entries: section.entries || [],
      omitted: section.omitted || 0,
      pinnedOmitted: section.pinnedOmitted || []
    }])),
    history: (pipeline.history || []).map((message) => ({ id: message.id || '', revision: message.revision || 0, role: message.role }))
  };
  if (operation === 'send') {
    const input = selection.manifest.findLast((item) => item.section === 'conversation' && item.role === 'user' && !item.sourceId);
    if (input) { input.sourceId = sourceMessageId; input.sourceRevision = source?.revision || 0; }
  }
  database.prepare(`INSERT INTO prompt_traces
    (id, user_id, conversation_id, generation_id, timeline_revision, operation, source_message_id, source_message_revision,
     provider_type, model, logical_messages_json, selection_json, budget_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, userId, conversationId, ticket?.id || '', ticket?.revision || 0, operation, sourceMessageId, source?.revision || 0,
      sanitizeMetadata(settings?.providerType || 'unknown', secrets, 80), sanitizeMetadata(settings?.model || '', secrets, 240),
      serializedRedacted(pipeline.modelMessages, secrets), serializedRedacted(selection, secrets), serializedRedacted(pipeline.budget, secrets), nowIso());
  let ordinal = 0;
  return {
    id,
    requestStarted(request) {
      const rawBody = typeof request.body === 'string' ? request.body : '';
      const body = rawBody ? parseJson(rawBody, { unparsed: true }) : null;
      const redacted = redactPromptTraceValue(body, secrets);
      const requestUrl = new URL(request.url);
      const endpoint = classifyEndpoint(requestUrl.pathname);
      const tokenEstimate = estimateRequestTokens(body, settings, pipeline.budget?.tokenBudget);
      const requestId = newId();
      ordinal += 1;
      database.prepare(`INSERT INTO prompt_requests
        (id, trace_id, ordinal, attempt, redirect_hop, auth_mode, method, endpoint, host, body_json, body_hash,
         redactions_json, token_estimate_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'started', ?)`)
        .run(requestId, id, ordinal, request.attempt || 1, request.redirectHop || 0, request.authMode || 'configured',
          sanitizeMetadata(request.method || 'POST', secrets, 16), endpoint, sanitizeMetadata(requestUrl.host, secrets, 255),
          boundedJson(redacted.value), digest(rawBody), JSON.stringify(redacted.redactions), serializedRedacted(tokenEstimate, secrets), nowIso());
      return requestId;
    },
    requestFinished(requestId, result) {
      if (!requestId) return;
      database.prepare('UPDATE prompt_requests SET status = ?, http_status = ?, error_code = ?, finished_at = ? WHERE id = ? AND trace_id = ?')
        .run(sanitizeMetadata(result.status || 'failed', secrets, 40), result.httpStatus ?? null,
          sanitizeMetadata(result.errorCode || '', secrets, 100), nowIso(), requestId, id);
    },
    complete(result = {}) {
      const status = result.status || (result.assistantMessageId ? 'completed' : 'failed');
      database.prepare(`UPDATE prompt_traces SET status = ?, assistant_message_id = ?, usage_json = ?, error_code = ?, finished_at = ?
        WHERE id = ? AND status = 'pending'`)
        .run(sanitizeMetadata(status, secrets, 40), sanitizeMetadata(result.assistantMessageId || '', secrets, 160),
          serializedRedacted(result.usage || null, secrets), sanitizeMetadata(result.errorCode || '', secrets, 100), nowIso(), id);
    }
  };
}

export function listPromptTraces(database, userId, conversationId, options = {}) {
  if (!hasOwner(database, userId, conversationId)) return null;
  const limit = Number.isInteger(options.limit) ? Math.max(1, Math.min(100, options.limit)) : 30;
  return database.prepare(`SELECT t.id, t.operation, t.provider_type, t.model, t.status, t.source_message_id,
    t.assistant_message_id, t.timeline_revision, t.created_at, t.finished_at, t.error_code,
    (SELECT COUNT(*) FROM prompt_requests r WHERE r.trace_id = t.id) AS request_count
    FROM prompt_traces t WHERE t.user_id = ? AND t.conversation_id = ? ORDER BY t.created_at DESC, t.rowid DESC LIMIT ?`)
    .all(userId, conversationId, limit).map(toTraceSummary);
}

export function getPromptTrace(database, userId, conversationId, traceId) {
  if (!hasOwner(database, userId, conversationId)) return null;
  const row = database.prepare('SELECT * FROM prompt_traces WHERE id = ? AND user_id = ? AND conversation_id = ?').get(traceId, userId, conversationId);
  if (!row) return null;
  const requests = database.prepare(`SELECT r.* FROM prompt_requests r
    JOIN prompt_traces t ON t.id = r.trace_id
    WHERE r.trace_id = ? AND t.user_id = ? AND t.conversation_id = ? ORDER BY r.ordinal`)
    .all(row.id, userId, conversationId).map((request) => ({
    id: request.id, ordinal: request.ordinal, attempt: request.attempt, redirectHop: request.redirect_hop,
    authMode: request.auth_mode, method: request.method, endpoint: request.endpoint, host: request.host,
    body: parseJson(request.body_json, null), bodyHash: request.body_hash, redactions: parseJson(request.redactions_json, []),
    tokenEstimate: parseJson(request.token_estimate_json, {}), status: request.status, httpStatus: request.http_status,
    errorCode: request.error_code, createdAt: request.created_at, finishedAt: request.finished_at
  }));
  return {
    ...toTraceSummary(row), requestCount: requests.length, generationId: row.generation_id,
    sourceMessageRevision: row.source_message_revision,
    logicalMessages: parseJson(row.logical_messages_json, []), selection: parseJson(row.selection_json, {}),
    budget: parseJson(row.budget_json, {}), usage: parseJson(row.usage_json, null), requests,
    redacted: true,
    outdated: database.prepare('SELECT timeline_revision FROM conversations WHERE id = ? AND user_id = ?')
      .get(conversationId, userId)?.timeline_revision !== row.timeline_revision
  };
}

export function recoverInterruptedPromptTraces(database) {
  const timestamp = nowIso();
  const requests = database.prepare(`UPDATE prompt_requests SET status = 'interrupted', error_code = 'PROCESS_RESTART', finished_at = ?
    WHERE status = 'started'`).run(timestamp).changes;
  const traces = database.prepare(`UPDATE prompt_traces SET status = 'interrupted', error_code = 'PROCESS_RESTART', finished_at = ?
    WHERE status = 'pending'`).run(timestamp).changes;
  return { traces, requests };
}

export function redactPromptTraceValue(value, secrets = []) {
  const redactions = [];
  const walk = (item, path, key = '', parent = null, trustedTokenField = false) => {
    const typedTokenContainer = isTypedTokenContainer(key, item);
    if (isPromptTraceSecretKey(key) && !trustedTokenField && !isSafeTokenMetric(key, item) && !typedTokenContainer) {
      redactions.push({ path, reason: 'secret_field' });
      return '[redacted]';
    }
    if (typeof item === 'string') {
      const binaryReason = binaryRedactionReason(item, key, parent, path);
      if (binaryReason) {
        redactions.push({ path, reason: binaryReason, characters: item.length, sha256: digest(item) });
        return '[redacted binary data]';
      }
      const sanitized = sanitizeText(item, secrets);
      if (sanitized !== item) redactions.push({ path, reason: 'sensitive_text' });
      return sanitized;
    }
    if (Array.isArray(item)) return item.map((entry, index) => walk(entry, `${path}[${index}]`, '', item));
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(Object.entries(item).map(([childKey, entry]) => [
      childKey,
      walk(entry, path ? `${path}.${childKey}` : childKey, childKey, item, typedTokenContainer)
    ]));
  };
  return { value: walk(value, ''), redactions };
}

function estimateRequestTokens(body, settings, budget = {}) {
  const messages = Array.isArray(body?.messages) ? [...body.messages]
    : Array.isArray(body?.input) ? body.input.map((entry) => entry.role ? entry : { role: 'tool', content: entry.output || JSON.stringify(entry) })
      : typeof body?.input === 'string' ? [{ role: 'user', content: body.input }] : [];
  if (body?.system) messages.unshift({ role: 'system', content: body.system });
  if (body?.instructions) messages.unshift({ role: 'system', content: body.instructions });
  return { ...estimatePromptTokens(messages, { ...settings, ...budget, tools: body?.tools }),
    inheritedContext: Boolean(body?.previous_response_id || body?.conversation),
    coverage: body?.previous_response_id || body?.conversation ? 'current-request-only' : 'constructed-request' };
}

function serializedRedacted(value, secrets) { return boundedJson(redactPromptTraceValue(value, secrets).value); }
function boundedJson(value) {
  const json = JSON.stringify(value) || 'null';
  return json.length <= MAX_TRACE_JSON_CHARACTERS ? json : JSON.stringify({ truncated: true, originalCharacters: json.length, preview: json.slice(0, MAX_TRACE_JSON_CHARACTERS - 100) });
}
function sanitizeText(value, secrets) {
  const text = String(value);
  let output = '';
  let offset = 0;
  for (const match of text.matchAll(EMBEDDED_HTTP_URL_PATTERN)) {
    output += sanitizeNonUrlText(text.slice(offset, match.index), secrets);
    output += sanitizeUrlToken(match[0], secrets);
    offset = match.index + match[0].length;
  }
  return output + sanitizeNonUrlText(text.slice(offset), secrets);
}
function sanitizeMetadata(value, secrets, limit) { return sanitizeText(value, secrets).slice(0, limit); }
function classifyEndpoint(pathname) {
  const normalized = String(pathname || '').replace(/\/+$/, '');
  const match = /\/(chat\/completions|responses|messages)$/.exec(normalized);
  return match?.[0] || '[other provider endpoint]';
}
function isSafeTokenMetric(key, value) {
  if (SAFE_TOKEN_KEYS.has(key) && typeof value === 'number' && Number.isFinite(value)) return true;
  if (key === 'overTokenBudget' && typeof value === 'boolean') return true;
  return key === 'contextWindowTokens' && value === null;
}
function isTypedTokenContainer(key, value) {
  if (key === 'tokenBudget') return matchesTypedObject(value, TOKEN_BUDGET_FIELDS);
  if (key === 'tokenEstimate') return matchesTypedObject(value, TOKEN_ESTIMATE_FIELDS);
  return false;
}
function matchesTypedObject(value, schema) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (!entries.length) return false;
  return entries.every(([key, item]) => Object.hasOwn(schema, key) && matchesTypedField(item, schema[key]));
}
function matchesTypedField(value, type) {
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'nullable-number') return value === null || (typeof value === 'number' && Number.isFinite(value));
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'string') return typeof value === 'string';
  if (type === 'breakdown') {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
      && Object.entries(value).every(([key, item]) => TOKEN_BREAKDOWN_FIELDS.has(key)
        && typeof item === 'number' && Number.isFinite(item));
  }
  return false;
}
function binaryRedactionReason(value, key, parent, path) {
  if (/^data:[^;,]+(?:;[^,]*)?;base64,/i.test(value)) return 'binary_data_url';
  if (/^(?:base64|blob|file_data|image_data|audio_data|video_data)$/i.test(key)) return 'binary_data';
  if (key === 'data' && /(?:^|\.)(?:input_audio|source)\.data$/i.test(path)) return 'binary_data';
  if (/^(?:file|image|audio|video)?_?data$/i.test(key)) {
    if (parent?.type === 'base64' || /(?:image|audio|video|file|document|pdf|input_audio)/i.test(String(parent?.type || ''))
      || looksLikeBase64(value)) return 'binary_data';
  }
  return looksLikeBase64(value) ? 'large_base64' : '';
}
function looksLikeBase64(value) {
  if (value.length < LARGE_BASE64_MIN_CHARACTERS || value.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}
function sanitizeNonUrlText(value, secrets) {
  let text = maskConfiguredSecrets(value, secrets);
  text = sanitizeDiagnosticText(text).replace(/\bsk-[A-Za-z0-9._-]{6,}/g, '[redacted]');
  return text.replace(EMBEDDED_DATA_URL_PATTERN, 'data:$1;base64,[redacted]');
}
function sanitizeUrlToken(value, secrets) {
  const masked = maskConfiguredSecrets(value, secrets).replace(/\bsk-[A-Za-z0-9._-]{6,}/g, '[redacted]');
  try {
    const url = new URL(masked);
    let changed = false;
    if (url.username || url.password) {
      url.username = '';
      url.password = '';
      changed = true;
    }
    for (const key of [...url.searchParams.keys()]) {
      if (!isPromptTraceSecretKey(key)) continue;
      url.searchParams.set(key, '[redacted]');
      changed = true;
    }
    return changed ? url.toString() : masked;
  } catch {
    return masked;
  }
}
function maskConfiguredSecrets(value, secrets) {
  let text = String(value);
  for (const secret of secrets) text = text.split(secret).join('[redacted]');
  return text;
}
function isPromptTraceSecretKey(key) {
  const value = String(key || '');
  return isDiagnosticSecretKey(value) || TRACE_URL_SECRET_KEY_PATTERN.test(value);
}
function digest(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function toTraceSummary(row) {
  return { id: row.id, operation: row.operation, providerType: row.provider_type, model: row.model, status: row.status,
    sourceMessageId: row.source_message_id, assistantMessageId: row.assistant_message_id, timelineRevision: row.timeline_revision,
    createdAt: row.created_at, finishedAt: row.finished_at, errorCode: row.error_code, requestCount: row.request_count || 0 };
}
function hasOwner(database, userId, conversationId) { return Boolean(database.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').get(conversationId, userId)); }
function assertOwner(database, userId, conversationId) {
  if (!hasOwner(database, userId, conversationId)) throw Object.assign(new Error('Conversation not found'), { code: 'CONVERSATION_NOT_FOUND', status: 404 });
}
