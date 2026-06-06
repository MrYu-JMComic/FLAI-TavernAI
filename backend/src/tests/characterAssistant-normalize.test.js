import assert from 'node:assert/strict';
import test from 'node:test';

const { completeCharacterDraft } = await import('../services/characterAssistant.js');

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

test('character assistant treats null current tags as empty', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => jsonResponse({
      choices: [{ message: { role: 'assistant', content: 'Done.' } }]
    });

    const result = await completeCharacterDraft(
      {
        providerType: 'deepseek',
        gatewayName: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        apiKey: 'sk-test',
        extraBody: {}
      },
      {
        requirement: 'keep existing character',
        current: {
          name: 'Tag Guard',
          tags: null
        }
      }
    );

    assert.equal(result.character.name, 'Tag Guard');
    assert.deepEqual(result.character.tags, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
