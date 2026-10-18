import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-provider-retry';

const { classifyProviderResponseError, readJsonResponse } = await import('../services/providerHttp.js');
const { isTransientProviderError, retryProviderCall } = await import('../services/providerRetry.js');

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
