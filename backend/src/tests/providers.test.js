import assert from 'node:assert/strict';
import test from 'node:test';

const { generateCompletion, streamCompletion, summarizeUsageSnapshots } = await import('../services/providers.js');

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function withMockFetch(fetchHandler, callback) {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = fetchHandler;
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('summarizeUsageSnapshots treats null usages as empty', () => {
  assert.deepEqual(summarizeUsageSnapshots(null), {
    totalTokens: 0,
    totalCostCny: null,
    currency: 'CNY'
  });
});

test('Anthropic completion treats null messages as empty', async () => {
  const requests = [];
  await withMockFetch(
    async (_url, request = {}) => {
      requests.push(JSON.parse(request.body));
      return jsonResponse({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 }
      });
    },
    async () => {
      const result = await generateCompletion(
        {
          providerType: 'anthropic',
          gatewayName: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          model: 'claude-test',
          apiKey: 'sk-ant-test',
          extraBody: {}
        },
        null
      );

      assert.equal(result.content, 'ok');
      assert.deepEqual(requests[0].messages, [{ role: 'user', content: '' }]);
    }
  );
});

test('Anthropic streaming reports a friendly error when the response body is missing', async () => {
  await withMockFetch(
    async () => new Response(null, { status: 200 }),
    async () => {
      await assert.rejects(
        () => streamCompletion(
          {
            providerType: 'anthropic',
            gatewayName: 'Anthropic',
            baseUrl: 'https://api.anthropic.com/v1',
            model: 'claude-test',
            apiKey: 'sk-ant-test',
            extraBody: {}
          },
          [{ role: 'user', content: 'hello' }],
          () => {}
        ),
        /AI \u6d41\u5f0f\u54cd\u5e94\u4e0d\u53ef\u7528/
      );
    }
  );
});
