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

    assert.equal(capturedPrompts.length, 2);
    for (const prompt of capturedPrompts) {
      assert.ok(prompt.includes(CHARACTER_ASSISTANT_ENVIRONMENT_GUIDE));
      assert.match(prompt, /FLAI 运行环境地图/);
      assert.match(prompt, /角色卡定义角色长期身份/);
      assert.match(prompt, /世界书保存可复用/);
      assert.match(prompt, /状态栏 Agent.*回复后的状态整理/);
      assert.match(prompt, /enabledSections 与当前工具列表决定本轮权限/);
    }
    assert.equal(capturedPrompts[0].includes('已完成本轮检查。'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
