import assert from 'node:assert/strict';
import test from 'node:test';
import {
  executeProviderRequest,
  providerResilienceSnapshot,
  resetProviderResilienceState
} from '../services/providerResilience.js';

test('provider resilience retries only idempotent transient responses', async () => {
  resetProviderResilienceState();
  let getCalls = 0;
  const response = await executeProviderRequest('provider:model:get', async () => {
    getCalls += 1;
    return new Response('{}', { status: getCalls < 3 ? 503 : 200 });
  }, { idempotent: true, retryBudget: 2 });
  assert.equal(response.status, 200);
  assert.equal(getCalls, 3);

  let postCalls = 0;
  const postResponse = await executeProviderRequest('provider:model:post', async () => {
    postCalls += 1;
    return new Response('{}', { status: 503 });
  }, { idempotent: false, retryBudget: 4 });
  assert.equal(postResponse.status, 503);
  assert.equal(postCalls, 1);
  assert.equal(providerResilienceSnapshot().find((row) => row.key === 'provider:model:get').retries, 2);
});

test('provider resilience enforces concurrency per route key', async () => {
  resetProviderResilienceState();
  let active = 0;
  let maxActive = 0;
  const operation = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
    return new Response('{}', { status: 200 });
  };
  await Promise.all([
    executeProviderRequest('limited-provider', operation, { concurrency: 1 }),
    executeProviderRequest('limited-provider', operation, { concurrency: 1 }),
    executeProviderRequest('limited-provider', operation, { concurrency: 1 })
  ]);
  assert.equal(maxActive, 1);
});

test('provider resilience opens a circuit after consecutive failures', async () => {
  resetProviderResilienceState();
  for (let index = 0; index < 5; index += 1) {
    const response = await executeProviderRequest('broken-provider', async () => (
      new Response('{}', { status: 503 })
    ));
    assert.equal(response.status, 503);
  }
  await assert.rejects(
    executeProviderRequest('broken-provider', async () => new Response('{}', { status: 200 })),
    { code: 'PROVIDER_CIRCUIT_OPEN' }
  );
  assert.equal(providerResilienceSnapshot()[0].circuit, 'open');
});

test('provider resilience aborts a call at its configured deadline', async () => {
  resetProviderResilienceState();
  await assert.rejects(
    executeProviderRequest('slow-provider', ({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }), { timeoutMs: 100 }),
    { name: 'TimeoutError' }
  );
});
