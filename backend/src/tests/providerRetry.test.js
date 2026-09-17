import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-provider-retry';

const { classifyProviderResponseError, readJsonResponse } = await import('../services/providerHttp.js');
const { isTransientProviderError, retryProviderCall } = await import('../services/providerRetry.js');
const { createAppDatabase } = await import('../db.js');
const { projectConversationCast } = await import('../services/cast/castProjector.js');
const { ensureConversationProtagonist } = await import('../services/cast/castCommandService.js');
const { getCastRoster } = await import('../services/cast/castQueryService.js');
const { clearCastSyncStatusForTests } = await import('../services/cast/castSyncStatus.js');

const GATEWAY_MESSAGE = 'auth_unavailable: no auth available (providers=antigravity, model=claude-opus-4-6-thinking)';

test('gateway credential outages and 5xx responses are classified as transient with a public message', async () => {
  const outage = await readJsonResponse(new Response(JSON.stringify({ error: { message: GATEWAY_MESSAGE } }), {
    status: 503, headers: { 'Content-Type': 'application/json' }
  })).catch((error) => error);
  assert.equal(outage.message, GATEWAY_MESSAGE, 'the upstream text stays on message for diagnostics');
  assert.equal(outage.status, 503);
  assert.equal(outage.code, 'PROVIDER_AUTH_UNAVAILABLE');
  assert.equal(outage.retryable, true);
  assert.match(outage.publicMessage, /auth_unavailable/);
  assert.match(outage.publicMessage, /自动重试/);
  assert.equal(isTransientProviderError(outage), true);

  const busy = classifyProviderResponseError(new Error('upstream busy'), { status: 429 });
  assert.equal(busy.retryable, true);
  assert.match(busy.publicMessage, /429/);

  const html = await readJsonResponse(new Response('<html>Bad Gateway</html>', { status: 502 })).catch((error) => error);
  assert.equal(html.status, 502);
  assert.equal(html.retryable, true);

  const badRequest = classifyProviderResponseError(new Error('invalid model'), { status: 400 });
  assert.equal(badRequest.retryable, undefined);
  assert.equal(badRequest.publicMessage, undefined);
  assert.equal(isTransientProviderError(badRequest), false);
  assert.equal(isTransientProviderError(new Error('plain')), false);
});

test('retryProviderCall retries only transient failures and stops on abort', async () => {
  let attempts = 0;
  const value = await retryProviderCall(() => {
    attempts += 1;
    if (attempts < 3) throw Object.assign(new Error('gateway'), { status: 503 });
    return 'ok';
  }, { retryDelaysMs: [0, 0, 0] });
  assert.equal(value, 'ok');
  assert.equal(attempts, 3);

  let permanent = 0;
  await assert.rejects(() => retryProviderCall(() => {
    permanent += 1;
    throw Object.assign(new Error('bad request'), { status: 400 });
  }, { retryDelaysMs: [0, 0] }), /bad request/);
  assert.equal(permanent, 1);

  let exhausted = 0;
  await assert.rejects(() => retryProviderCall(() => {
    exhausted += 1;
    throw Object.assign(new Error('still down'), { status: 503 });
  }, { retryDelaysMs: [0] }), /still down/);
  assert.equal(exhausted, 2);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => retryProviderCall(() => 'never', { signal: controller.signal }));
});

test('cast projector retries a transient gateway outage and reports a retryable public error when it persists', async () => {
  clearCastSyncStatusForTests();
  const database = createAppDatabase(':memory:');
  const timestamp = '2025-01-01T00:00:00.000Z';
  const userId = 'retry-user';
  const conversationId = 'retry-conversation';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(userId, userId, 'hash', timestamp);
  database.prepare('INSERT INTO characters (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('retry-character', userId, 'Hero', timestamp, timestamp);
  database.prepare(`INSERT INTO conversations (id, user_id, character_id, title, user_advanced_settings, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(conversationId, userId, 'retry-character', 'Retry', JSON.stringify({ castTracking: { enabled: true } }), timestamp, timestamp);
  ensureConversationProtagonist(database, userId, conversationId);
  database.prepare(`INSERT INTO messages (id, user_id, conversation_id, role, content, attachments_json, reasoning, usage_json, created_at)
    VALUES (?, ?, ?, 'assistant', ?, '[]', '', NULL, ?)`).run('retry-assistant', userId, conversationId, 'Alice arrived at the tower.', timestamp);
  const conversation = { id: conversationId, characterId: 'retry-character', settings: { castTracking: { enabled: true } } };
  const assistantMessage = { id: 'retry-assistant', role: 'assistant', content: 'Alice arrived at the tower.', revision: 1 };
  const settings = { providerType: 'custom', baseUrl: 'https://retry.test/v1', model: 'm', apiKey: 'k', extraBody: {} };
  const outage = () => classifyProviderResponseError(new Error(GATEWAY_MESSAGE), { status: 503 });
  try {
    let calls = 0;
    const statuses = [];
    const recovered = await projectConversationCast({
      database, userId, conversation, assistantMessage, settings,
      retryDelaysMs: [0],
      publish: (_id, state) => { statuses.push(state); return state; },
      generate: async () => {
        calls += 1;
        if (calls === 1) throw outage();
        return { content: JSON.stringify({ version: 1, summary: 'ok', operations: [{ op: 'member.create', target: { name: 'Alice' }, evidence: { messageId: 'retry-assistant', quote: 'Alice arrived' } }] }) };
      }
    });
    assert.equal(recovered.ok, true, recovered.error);
    assert.equal(calls, 2);
    assert.equal(statuses.some((state) => state.retrying === 1), true);
    assert.equal(getCastRoster(database, userId, conversationId).npcs.length, 1);

    let failing = 0;
    const failed = await projectConversationCast({
      database, userId, conversation, assistantMessage: { ...assistantMessage, id: 'retry-assistant' }, settings,
      idempotencyKey: 'second-run', retryDelaysMs: [0],
      publish: (_id, state) => state,
      generate: async () => { failing += 1; throw outage(); }
    });
    assert.equal(failing, 2);
    assert.equal(failed.ok, false);
    assert.equal(failed.retryable, true, 'the job worker may retry the whole step later');
    assert.equal(failed.code, 'PROVIDER_AUTH_UNAVAILABLE');
    assert.match(failed.error, /网关暂时没有可用于该模型的凭据/);
    assert.equal(failed.status.error, failed.error);
  } finally {
    database.close();
  }
});
