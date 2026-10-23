import assert from 'node:assert/strict';
import test from 'node:test';
import { completeCharacterDraft } from '../services/characterAssistant.js';
import { CHARACTER_ASSISTANT_ENVIRONMENT_GUIDE } from '../services/characterAssistantEnvironmentGuide.js';

const providerSettings = {
  providerType: 'deepseek',
  gatewayName: 'DeepSeek',
  baseUrl: 'https://provider.test',
  model: 'deepseek-flash',
  apiKey: 'sk-test',
  extraBody: {}
};

test('character assistant injects its internal FLAI environment guide in both request modes', async () => {
  const originalFetch = globalThis.fetch;
  const capturedPrompts = [];
  try {
    globalThis.fetch = async (_url, request = {}) => {
      const body = JSON.parse(request.body);
      capturedPrompts.push(body.messages.find((message) => message.role === 'system')?.content || '');
      return new Response(JSON.stringify({
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: `finish-${capturedPrompts.length}`,
              type: 'function',
              function: {
                name: 'finish_character_draft',
                arguments: JSON.stringify({ summary: '已完成本轮检查。', reviewedSections: [] })
              }
            }]
          }
        }]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    for (const conversationMode of [false, true]) {
      const result = await completeCharacterDraft(providerSettings, {
        requirement: '检查 FLAI 环境边界',
        current: {},
        conversationMode
      });
      assert.equal(result.summary, '已完成本轮检查。');
    }

    assert.doesNotMatch(CHARACTER_ASSISTANT_ENVIRONMENT_GUIDE, /[^\x00-\x7F]/);
    assert.equal(capturedPrompts.length, 2);
    for (const prompt of capturedPrompts) {
      assert.ok(prompt.includes(CHARACTER_ASSISTANT_ENVIRONMENT_GUIDE));
      assert.match(prompt, /FLAI Runtime Map/);
      assert.match(prompt, /The character card defines durable identity/);
      assert.match(prompt, /World books store reusable/);
      assert.match(prompt, /post-reply state updater/);
      assert.match(prompt, /enabledSections and the tools supplied for this request define your actual permissions/);
    }
    assert.equal(capturedPrompts[0].includes('已完成本轮检查。'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
