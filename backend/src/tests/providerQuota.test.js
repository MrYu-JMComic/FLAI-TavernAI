import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppDatabase } from '../db/runtime.js';
import { updateUserQuota, getDailyUsage } from '../services/quotas.js';
import { generateCompletion } from '../services/providers.js';

test('provider facade pre-reserves the daily cost before calling a provider', async () => {
  const database = createAppDatabase(':memory:');
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    database.prepare(
      `INSERT INTO users (id, username, password_hash, created_at)
       VALUES ('quota-user', 'quota-user', 'hash', ?)`
    ).run(new Date().toISOString());
    updateUserQuota(database, 'quota-user', { maxDailyCostMicros: 1 });
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'should not run' } }] }), {
        headers: { 'Content-Type': 'application/json' }
      });
    };

    await assert.rejects(
      generateCompletion(
        {
          providerType: 'custom',
          gatewayName: 'Quota test',
          baseUrl: 'https://quota.example/v1',
          model: 'quota-model',
          apiKey: 'sk-test'
        },
        [{ role: 'user', content: 'hello' }],
        { database, userId: 'quota-user' }
      ),
      { code: 'DAILY_COST_QUOTA_EXCEEDED' }
    );
    assert.equal(calls, 0);
    assert.equal(getDailyUsage(database, 'quota-user').costMicros, 0);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});
