import assert from 'node:assert/strict';
import test from 'node:test';
import { runToolCompletion, streamToolCompletion } from '../services/providerToolCompletions.js';
import { resetProviderResilienceState } from '../services/providerResilience.js';

const tools = [{ type: 'function', function: { name: 'finish_memory_review', parameters: { type: 'object', properties: {} } } }];

for (const streaming of [false, true]) {
  for (const failure of ['network', 'http']) {
    test(`${streaming ? 'streaming' : 'completion'} diagnostics retain ${failure} failure reasons and redact configured credentials`, async () => {
      const originalFetch = globalThis.fetch;
      const originalError = console.error;
      const logs = [];
      const credential = 'diagnostic-test-credential';
      const settings = { providerType: 'deepseek', gatewayName: 'Test', baseUrl: 'https://diagnostics.test/v1',
        model: 'deepseek-test', apiKey: credential, extraBody: {}, retryBudget: 0 };
      try {
        resetProviderResilienceState();
        console.error = (...args) => logs.push(args);
        globalThis.fetch = async () => {
          if (failure === 'network') {
            throw new TypeError(`fetch failed ${credential}`, { cause: Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }) });
          }
          return Response.json({ error: { message: `tool parameters rejected ${credential}` } }, { status: 400 });
        };
        const operation = streaming
          ? () => streamToolCompletion(settings, [{ role: 'user', content: 'Private story text.' }], tools, () => {}, () => {}, undefined, { maxRounds: 1 })
          : () => runToolCompletion(settings, [{ role: 'user', content: 'Private story text.' }], tools, () => {}, { maxRounds: 1 });
        await assert.rejects(operation, error => failure === 'network' ? error.code === 'PROVIDER_NETWORK_ERROR' : error.status === 400);
        assert.equal(logs.length, 1);
        const diagnostic = JSON.parse(logs[0][1]);
        assert.equal(diagnostic.round, 1);
        assert.equal(diagnostic.provider, 'deepseek');
        assert.deepEqual(diagnostic.toolNames, ['finish_memory_review']);
        assert.equal(diagnostic.messageCount, 1);
        if (failure === 'network') {
          assert.equal(diagnostic.error.code, 'PROVIDER_NETWORK_ERROR');
          assert.match(diagnostic.error.causes[0].message, /fetch failed/);
          assert.equal(diagnostic.error.causes[1].code, 'ECONNRESET');
        } else {
          assert.equal(diagnostic.error.status, 400);
          assert.match(diagnostic.error.message, /tool parameters rejected/);
        }
        assert.equal(JSON.stringify(logs).includes(credential), false);
        assert.equal(JSON.stringify(logs).includes('Private story text.'), false);
      } finally {
        globalThis.fetch = originalFetch;
        console.error = originalError;
        resetProviderResilienceState();
      }
    });
  }
}

test('streaming diagnostics stay quiet for an explicit client cancellation', async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const logs = [];
  const controller = new AbortController();
  const settings = {
    providerType: 'custom', gatewayName: 'Test', baseUrl: 'https://diagnostics.test/v1',
    model: 'claude-sonnet-5-5', apiKey: 'diagnostic-test-credential', extraBody: {}, retryBudget: 0
  };
  try {
    resetProviderResilienceState();
    console.error = (...args) => logs.push(args);
    globalThis.fetch = async () => {
      controller.abort(new Error('客户端已取消角色助手请求。'));
      throw controller.signal.reason;
    };

    await assert.rejects(
      () => streamToolCompletion(
        settings,
        [{ role: 'user', content: 'Private story text.' }],
        tools,
        () => {},
        () => {},
        controller.signal,
        { maxRounds: 1 }
      ),
      /客户端已取消角色助手请求/
    );
    assert.equal(logs.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    resetProviderResilienceState();
  }
});
