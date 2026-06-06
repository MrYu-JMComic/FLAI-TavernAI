import assert from 'node:assert/strict';
import test from 'node:test';

const { generateCompletion, summarizeUsageSnapshots } = await import('../services/providers.js');

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

test('summarizeUsageSnapshots treats null usages as empty', () => {
  assert.deepEqual(summarizeUsageSnapshots(null), {
    totalTokens: 0,
    totalCostCny: null,
    currency: 'CNY'
  });
});

test('Anthropic completion treats null messages as empty', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  try {
    globalThis.fetch = async (_url, request = {}) => {
      requests.push(JSON.parse(request.body));
      return jsonResponse({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 }
      });
    };

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
  } finally {
    globalThis.fetch = originalFetch;
  }
});
