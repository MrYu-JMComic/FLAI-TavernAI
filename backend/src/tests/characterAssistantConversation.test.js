import assert from 'node:assert/strict';
import test from 'node:test';
import { completeCharacterDraft, streamCharacterDraft } from '../services/characterAssistant.js';

const settings = {
  providerType: 'custom', gatewayName: 'Assistant test', baseUrl: 'https://assistant-conversation.test',
  apiKey: 'test-key', model: 'test-model', extraBody: {}
};

function reply(content, toolCalls = [], usage = null) {
  return Response.json({ choices: [{ message: { role: 'assistant', content, tool_calls: toolCalls } }], usage });
}

function tool(name, args) {
  return { id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

test('conversation answers discussion directly with an unchanged card and stable instructions across turns', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  try {
    globalThis.fetch = async (_url, request) => {
      requests.push(JSON.parse(request.body));
      return reply('可以先讨论她的动机，再决定是否修改角色卡。', [], { prompt_tokens: 200, prompt_tokens_details: { cached_tokens: 120 } });
    };
    const first = await completeCharacterDraft(settings, {
      conversationMode: true, current: { name: '雾岚', persona: '谨慎' }, requirement: '她适合怎样的动机？'
    });
    await completeCharacterDraft(settings, {
      conversationMode: true, current: { name: '澄灯', persona: '开朗' }, requirement: '继续讨论',
      user: { displayName: 'Another user' }, options: { optimizeExisting: true },
      history: [{ role: 'user', content: '她适合怎样的动机？' }, { role: 'assistant', content: first.assistantMessage }]
    });
    assert.equal(requests.length, 2);
    assert.equal(requests[0].messages[0].content, requests[1].messages[0].content);
    assert.deepEqual(requests[0].tools, requests[1].tools);
    assert.equal(requests[1].messages[1].content, '她适合怎样的动机？');
    assert.equal(JSON.parse(requests[1].messages.at(-1).content).currentCharacter.name, '澄灯');
    assert.equal(first.character.name, '雾岚');
    assert.equal(first.character.persona, '谨慎');
    assert.equal(first.changed, false);
    assert.equal(first.toolCalls.length, 0);
    assert.equal(first.assistantMessage, '可以先讨论她的动机，再决定是否修改角色卡。');
    assert.equal(first.summary, first.assistantMessage);
    assert.equal(first.context.cache.cachedTokens, 120);
    assert.equal(first.context.cache.hitRate, 0.6);
    assert.equal(first.checkpoint.lastTool, '');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('conversation can finish with normal assistant text after applying tool changes', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  try {
    globalThis.fetch = async (_url, request) => {
      requests.push(JSON.parse(request.body));
      if (requests.length === 1) return reply('我会完善她的动机。', [tool('update_character_story', { persona: '谨慎，但渴望找到失踪的同伴。' })]);
      return reply('我补充了她寻找同伴的动机，也保留了谨慎的性格。');
    };
    const result = await completeCharacterDraft(settings, {
      conversationMode: true, current: { name: '雾岚' }, requirement: '请完善她的动机'
    });
    assert.equal(requests.length, 2);
    const toolResult = requests[1].messages.find((message) => message.role === 'tool');
    assert.ok(toolResult);
    assert.doesNotMatch(JSON.parse(toolResult.content).workflow.nextAction, /finish_character_draft/);
    assert.equal(result.changed, true);
    assert.equal(result.character.persona, '谨慎，但渴望找到失踪的同伴。');
    assert.deepEqual(result.toolCalls.map((call) => call.name), ['update_character_story']);
    assert.equal(result.assistantMessage, '我补充了她寻找同伴的动机，也保留了谨慎的性格。');
    assert.equal(result.summary, result.assistantMessage);
    assert.equal(result.context.cache.reported, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const streaming of [false, true]) {
  test(`excluding the character from model context preserves the canonical card with streaming ${streaming}`, async () => {
    const originalFetch = globalThis.fetch;
    const requests = [];
    const current = {
      name: '手动角色', persona: '手动人设', background: '手动背景', visibility: 'public',
      tags: ['保留标签'], authorAdvancedSettings: { customCss: '.card { color: red; }', customCssEnabled: true }
    };
    try {
      globalThis.fetch = async (_url, request) => {
        requests.push(JSON.parse(request.body));
        return reply('我们可以先自由讨论角色方向。');
      };
      const request = {
        current, conversationMode: true, requirement: '暂时不要参考当前角色卡，先聊聊方向',
        options: { excludeCharacterContext: true, worldBook: false }
      };
      const result = streaming
        ? await streamCharacterDraft(settings, { ...request, providerStreaming: true })
        : await completeCharacterDraft(settings, request);
      assert.deepEqual(JSON.parse(requests[0].messages.at(-1).content).currentCharacter, {});
      assert.equal(result.changed, false);
      assert.equal(result.character.name, current.name);
      assert.equal(result.character.persona, current.persona);
      assert.equal(result.character.background, current.background);
      assert.equal(result.character.visibility, current.visibility);
      assert.deepEqual(result.character.tags, current.tags);
      assert.equal(result.character.authorAdvancedSettings.customCss, current.authorAdvancedSettings.customCss);
      assert.equal(result.character.authorAdvancedSettings.customCssEnabled, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

for (const providerStreaming of [false, true]) {
  test(`conversation emits response text and context with provider streaming ${providerStreaming}`, async () => {
    const originalFetch = globalThis.fetch;
    const events = [];
    try {
      globalThis.fetch = async () => reply('我们可以先确定时代与关系。');
      const result = await streamCharacterDraft(settings, {
        conversationMode: true, providerStreaming, current: { name: '雾岚' }, requirement: '先聊一聊',
        emit: (event, data) => events.push({ event, data })
      });
      assert.equal(events.filter(({ event }) => event === 'content').map(({ data }) => data.text).join(''), result.assistantMessage);
      assert.equal(events.filter(({ event }) => event === 'context').length, 2);
      assert.equal(result.context.strategy, 'stable-prefix-v1');
      assert.equal(result.changed, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}
