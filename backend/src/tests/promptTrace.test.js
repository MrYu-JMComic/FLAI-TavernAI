import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  createPromptTrace,
  getPromptTrace,
  listPromptTraces,
  recoverInterruptedPromptTraces,
  redactPromptTraceValue
} from '../services/promptTrace.js';
import { fetchProviderRequest } from '../services/providerHttp.js';

test('prompt trace redaction keeps numeric token metrics but removes token secrets and binary payloads', () => {
  const result = redactPromptTraceValue({
    max_tokens: 2048,
    estimatedTokens: 321,
    overTokenBudget: false,
    contextWindowTokens: null,
    tokens: 'credential-that-must-not-survive',
    input_tokens: ['credential-that-must-not-survive'],
    input_audio: { data: 'QQ==', format: 'wav' },
    file: { source: { data: 'Qg==', media_type: 'application/pdf' } },
    file_data: 'QQ==',
    audio_data: 'Qg==',
    base64: 'Qw==',
    blob: 'RA==',
    opaquePayload: 'C'.repeat(256),
    inline: 'data:application/pdf;base64,QUJDRA=='
  });

  assert.equal(result.value.max_tokens, 2048);
  assert.equal(result.value.estimatedTokens, 321);
  assert.equal(result.value.overTokenBudget, false);
  assert.equal(result.value.contextWindowTokens, null);
  assert.equal(result.value.tokens, '[redacted]');
  assert.equal(result.value.input_tokens, '[redacted]');
  assert.equal(result.value.input_audio.data, '[redacted binary data]');
  assert.equal(result.value.file.source.data, '[redacted binary data]');
  assert.equal(result.value.file_data, '[redacted binary data]');
  assert.equal(result.value.audio_data, '[redacted binary data]');
  assert.equal(result.value.base64, '[redacted binary data]');
  assert.equal(result.value.blob, '[redacted binary data]');
  assert.equal(result.value.opaquePayload, '[redacted binary data]');
  assert.equal(result.value.inline, '[redacted binary data]');
  assert.ok(result.redactions.some((entry) => entry.reason === 'large_base64'));
  assert.ok(result.redactions.some((entry) => entry.reason === 'binary_data_url'));
});

test('prompt trace redaction preserves ordinary URLs and sanitizes embedded URL credentials and data', () => {
  const ordinary = 'See https://example.com/path?view=full#section exactly.';
  const result = redactPromptTraceValue({
    ordinary,
    sensitive: 'Open https://user:pass@example.com/path?token=secret&view=full now.',
    embeddedData: 'Attachment data:application/pdf;base64,QUJDRA== follows.'
  });

  assert.equal(result.value.ordinary, ordinary);
  assert.equal(result.value.sensitive.includes('user:pass'), false);
  assert.equal(result.value.sensitive.includes('token=secret'), false);
  assert.match(result.value.sensitive, /view=full/);
  assert.equal(result.value.embeddedData, 'Attachment data:application/pdf;base64,[redacted] follows.');
});

test('prompt trace redaction removes signed URL credentials while preserving benign query fields', () => {
  const result = redactPromptTraceValue({
    sig: 'body-sas-signature',
    signature: 'body-signature',
    auth: 'body-auth',
    access_key: 'body-access-key',
    'X-Amz-Credential': 'body-amz-credential',
    'X-Amz-Signature': 'body-amz-signature',
    'X-Goog-Credential': 'body-goog-credential',
    'X-Goog-Signature': 'body-goog-signature',
    aws: 'https://assets.example.test/file?view=full&X-Amz-Credential=AKIA%2Fscope&X-Amz-Signature=aws-secret',
    google: 'Download https://storage.example.test/object?view=preview&X-Goog-Credential=service%40example.test&X-Goog-Signature=goog-secret now.',
    sas: 'https://blob.example.test/item?view=compact&sig=sas-secret&auth=auth-secret&access_key=key-secret'
  });

  for (const key of ['sig', 'signature', 'auth', 'access_key', 'X-Amz-Credential', 'X-Amz-Signature', 'X-Goog-Credential', 'X-Goog-Signature']) {
    assert.equal(result.value[key], '[redacted]');
  }
  for (const urlText of [result.value.aws, result.value.google, result.value.sas]) {
    assert.match(urlText, /view=(?:full|preview|compact)/);
    assert.doesNotMatch(urlText, /aws-secret|goog-secret|sas-secret|auth-secret|key-secret|AKIA|service%40example/i);
  }
});

test('prompt trace redaction preserves only validated internal token budget and estimate containers', () => {
  const result = redactPromptTraceValue({
    tokenBudget: {
      inputTokenLimit: 8192,
      reservedOutputTokens: 2048,
      imageTokensPerImage: 1024,
      contextWindowTokens: null,
      effectiveInputLimit: 8192,
      overflow: false,
      estimated: true,
      exact: false,
      method: 'application input allocation',
      warning: ''
    },
    tokenEstimate: {
      tokens: 320,
      estimatedTokens: 320,
      estimated: true,
      exact: false,
      method: 'heuristic',
      warning: '',
      breakdown: { textTokens: 300, toolSchemaTokens: 0, messageOverheadTokens: 20, toolOverheadTokens: 0, imageTokens: 0, imageCount: 0 },
      inheritedContext: false,
      coverage: 'constructed-request'
    },
    unsafeTokenBudget: { inputTokenLimit: 100, credential: 'secret' },
    tokenEstimateSecret: { tokens: 'credential' }
  });

  assert.equal(result.value.tokenBudget.contextWindowTokens, null);
  assert.equal(result.value.tokenBudget.overflow, false);
  assert.equal(result.value.tokenEstimate.estimatedTokens, 320);
  assert.equal(result.value.tokenEstimate.breakdown.imageCount, 0);
  assert.equal(result.value.unsafeTokenBudget, '[redacted]');
  assert.equal(result.value.tokenEstimateSecret, '[redacted]');
});

test('prompt traces enforce owner reads, sanitize metadata, and recover unfinished rows', () => {
  const database = createTraceDatabase();
  const secret = 'sk-super-secret-value';
  const trace = createPromptTrace(database, {
    userId: 'owner',
    conversationId: 'conversation',
    ticket: { id: 'generation', revision: 3 },
    pipeline: {
      priority: [], diagnostics: {}, sections: {}, history: [],
      modelMessages: [{ role: 'user', content: `hello ${secret}` }],
      budget: { tokenBudget: { inputTokenLimit: 10 } }
    },
    settings: { providerType: `custom-${secret}`, model: `model-${secret}`, apiKey: secret },
    sourceMessageId: 'source-message'
  });
  const requestId = trace.requestStarted({
    url: 'https://provider.test/v1/chat/completions/',
    method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', content: secret }] })
  });

  assert.equal(listPromptTraces(database, 'other', 'conversation'), null);
  assert.equal(getPromptTrace(database, 'other', 'conversation', trace.id), null);
  const detail = getPromptTrace(database, 'owner', 'conversation', trace.id);
  assert.equal(detail.providerType.includes(secret), false);
  assert.equal(detail.model.includes(secret), false);
  assert.equal(detail.logicalMessages[0].content.includes(secret), false);
  assert.equal(detail.requests[0].endpoint, '/chat/completions');
  assert.equal(detail.requests[0].status, 'started');

  const recovered = recoverInterruptedPromptTraces(database);
  assert.deepEqual(recovered, { traces: 1, requests: 1 });
  const recoveredDetail = getPromptTrace(database, 'owner', 'conversation', trace.id);
  assert.equal(recoveredDetail.status, 'interrupted');
  assert.equal(recoveredDetail.errorCode, 'PROCESS_RESTART');
  assert.equal(recoveredDetail.requests[0].status, 'interrupted');
  assert.equal(recoveredDetail.requests[0].errorCode, 'PROCESS_RESTART');
  assert.deepEqual(recoverInterruptedPromptTraces(database), { traces: 0, requests: 0 });

  database.close();
  assert.ok(requestId);
});

test('provider request tracing failures never alter successful or failed transport', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response('{}', { status: 200 });
  };
  try {
    const response = await fetchProviderRequest('https://provider.test/v1/responses', {}, {
      isProduction: false,
      requestTrace: {
        requestStarted() { throw new Error('trace storage unavailable'); },
        requestFinished() { throw new Error('trace storage unavailable'); }
      }
    });
    assert.equal(response.status, 200);
    assert.equal(calls, 1);

    globalThis.fetch = async () => { throw new TypeError('network down'); };
    await assert.rejects(
      fetchProviderRequest('https://provider.test/v1/responses', {}, {
        isProduction: false,
        requestTrace: {
          requestStarted() { return 'request-id'; },
          requestFinished() { throw new Error('trace storage unavailable'); }
        }
      }),
      { code: 'PROVIDER_NETWORK_ERROR' }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('provider request tracing distinguishes redirects from received responses', async () => {
  const originalFetch = globalThis.fetch;
  const statuses = [];
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response(null, { status: 302, headers: { Location: '/v1/messages' } });
    return new Response('{}', { status: 200 });
  };
  try {
    const response = await fetchProviderRequest('https://provider.test/v1/start', {}, {
      isProduction: false,
      requestTrace: {
        requestStarted(request) { return `request-${request.redirectHop}`; },
        requestFinished(_requestId, result) { statuses.push(result); }
      }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(statuses, [
      { status: 'redirected', httpStatus: 302 },
      { status: 'response_received', httpStatus: 200 }
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function createTraceDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE conversations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, timeline_revision INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE messages (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, conversation_id TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE prompt_traces (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, conversation_id TEXT NOT NULL, generation_id TEXT NOT NULL,
      timeline_revision INTEGER NOT NULL, operation TEXT NOT NULL, source_message_id TEXT NOT NULL DEFAULT '',
      source_message_revision INTEGER NOT NULL DEFAULT 0, assistant_message_id TEXT NOT NULL DEFAULT '',
      provider_type TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      logical_messages_json TEXT NOT NULL, selection_json TEXT NOT NULL, budget_json TEXT NOT NULL,
      usage_json TEXT, error_code TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, finished_at TEXT
    );
    CREATE TABLE prompt_requests (
      id TEXT PRIMARY KEY, trace_id TEXT NOT NULL, ordinal INTEGER NOT NULL, attempt INTEGER NOT NULL,
      redirect_hop INTEGER NOT NULL, auth_mode TEXT NOT NULL, method TEXT NOT NULL, endpoint TEXT NOT NULL,
      host TEXT NOT NULL, body_json TEXT NOT NULL, body_hash TEXT NOT NULL, redactions_json TEXT NOT NULL,
      token_estimate_json TEXT NOT NULL, status TEXT NOT NULL, http_status INTEGER,
      error_code TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, finished_at TEXT,
      UNIQUE(trace_id, ordinal)
    );
    INSERT INTO users (id) VALUES ('owner'), ('other');
    INSERT INTO conversations (id, user_id, timeline_revision) VALUES ('conversation', 'owner', 3);
    INSERT INTO messages (id, user_id, conversation_id, revision) VALUES ('source-message', 'owner', 'conversation', 2);
  `);
  return database;
}
