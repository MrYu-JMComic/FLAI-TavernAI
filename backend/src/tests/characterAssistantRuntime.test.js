import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const { completeCharacterDraft, streamCharacterDraft } = await import('../services/characterAssistant.js');
const characterAssistantSource = readFileSync(new URL('../services/characterAssistant.js', import.meta.url), 'utf8');
const characterRouteSource = readFileSync(new URL('../routes/characters.js', import.meta.url), 'utf8');

const providerSettings = {
  providerType: 'deepseek',
  gatewayName: 'DeepSeek',
  baseUrl: 'https://provider.test',
  model: 'deepseek-v4-flash',
  apiKey: 'sk-test',
  supportsReasoning: true,
  extraBody: {}
};

test('character assistant forwards the selected thinking effort and requires a finish tool', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody = null;
  try {
    globalThis.fetch = async (_url, request = {}) => {
      requestBody = JSON.parse(request.body);
      return jsonResponse(toolMessage([
        toolCall('finish-thinking', 'finish_character_draft', {
          summary: 'Checked the existing profile.',
          reviewedSections: ['profile']
        })
      ]));
    };

    const result = await completeCharacterDraft(providerSettings, {
      requirement: '检查现有角色资料',
      current: { name: '澄灯' },
      thinkingLevel: 'low'
    });

    assert.equal(requestBody.thinking.type, 'enabled');
    assert.equal(requestBody.reasoning_effort, 'low');
    assert.equal(requestBody.tools.at(-1).function.name, 'finish_character_draft');
    assert.equal(result.summary, 'Checked the existing profile.');
    assert.equal(result.toolCalls.at(-1).name, 'finish_character_draft');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('character assistant emits progressive checkpoints while provider tool calls are non-streaming', async () => {
  const originalFetch = globalThis.fetch;
  const events = [];
  let requestBody = null;
  try {
    globalThis.fetch = async (_url, request = {}) => {
      requestBody = JSON.parse(request.body);
      return jsonResponse({
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            reasoning_content: '先补全身份，再做结构验收。',
            tool_calls: [
              toolCall('profile-stable', 'update_character_profile', { name: '雾岚', tags: ['旅人'] }),
              toolCall('finish-stable', 'finish_character_draft', {
                summary: '基础资料已完善。',
                reviewedSections: ['profile', 'tags']
              })
            ]
          }
        }]
      });
    };

    const result = await streamCharacterDraft(providerSettings, {
      requirement: '创建一位旅行者',
      current: {},
      thinkingLevel: 'high',
      emit: (event, data) => events.push({ event, data })
    });

    assert.equal(requestBody.stream, false);
    const checkpoints = events.filter((item) => item.event === 'checkpoint');
    assert.equal(checkpoints.length, 3);
    assert.equal(checkpoints[0].data.character.name, '雾岚');
    assert.deepEqual(checkpoints[0].data.character.tags, ['旅人']);
    assert.match(checkpoints[1].data.workflow.nextAction, /下一轮/);
    assert.equal(checkpoints.at(-1).data.lastTool, 'finish_character_draft');
    assert.deepEqual(checkpoints.at(-1).data.completedSections, ['profile', 'tags']);
    assert.equal(events.some((item) => item.event === 'content'), false);
    assert.equal(events.some((item) => item.event === 'reasoning'), true);
    assert.equal(result.character.name, '雾岚');
    assert.equal(result.summary, '基础资料已完善。');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('character assistant keeps every provider tool round non-streaming', async () => {
  const originalFetch = globalThis.fetch;
  const events = [];
  const requestBodies = [];
  try {
    globalThis.fetch = async (_url, request = {}) => {
      const body = JSON.parse(request.body);
      requestBodies.push(body);
      if (requestBodies.length === 1) {
        return jsonResponse(toolMessage([
          toolCall('profile-round', 'update_character_profile', { name: '雾岚' })
        ]));
      }
      return jsonResponse(toolMessage([
        toolCall('finish-round', 'finish_character_draft', {
          summary: '非流式工具轮次已完成验收。',
          reviewedSections: ['profile']
        })
      ]));
    };

    const result = await streamCharacterDraft(providerSettings, {
      requirement: '检查角色资料',
      current: { name: '雾岚' },
      emit: (event, data) => events.push({ event, data })
    });

    assert.equal(requestBodies.length, 2);
    assert.equal(requestBodies.every((body) => body.stream === false), true);
    assert.equal(result.summary, '非流式工具轮次已完成验收。');
    assert.equal(result.toolCalls.at(-1).name, 'finish_character_draft');
    assert.equal(events.filter((item) => item.event === 'checkpoint').length, 2);
    assert.equal(events.some((item) => item.event === 'reasoning'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('character assistant enforces real multi-round writes and carries a workflow ledger forward', async () => {
  const originalFetch = globalThis.fetch;
  const requestBodies = [];
  const events = [];
  try {
    globalThis.fetch = async (_url, request = {}) => {
      const body = JSON.parse(request.body);
      requestBodies.push(body);
      if (requestBodies.length === 1) {
        return jsonResponse(toolMessage([
          toolCall('multi-profile', 'update_character_profile', { name: '雾岚' }),
          toolCall('multi-story-deferred', 'update_character_story', { background: '来自雾港。' }),
          toolCall('multi-finish-deferred', 'finish_character_draft', {
            summary: '尝试过早完成。',
            reviewedSections: ['profile', 'background']
          })
        ]));
      }
      if (requestBodies.length === 2) {
        const toolResults = body.messages
          .filter((message) => message.role === 'tool')
          .map((message) => JSON.parse(message.content));
        const deferred = toolResults.find((result) => result.error === 'ROUND_ACTION_LIMIT');
        assert.deepEqual(deferred.workflow.pendingToolNames, ['update_character_story']);
        assert.equal(deferred.workflow.recentActions[0].tool, 'update_character_profile');
        return jsonResponse(toolMessage([
          toolCall('multi-story', 'update_character_story', { background: '来自雾港。' }),
          toolCall('multi-finish-again', 'finish_character_draft', {
            summary: '仍在同轮尝试完成。',
            reviewedSections: ['profile', 'background']
          })
        ]));
      }
      return jsonResponse(toolMessage([
        toolCall('multi-finish', 'finish_character_draft', {
          summary: '分轮写入并完成验收。',
          reviewedSections: ['profile', 'background']
        })
      ]));
    };

    const result = await streamCharacterDraft(providerSettings, {
      requirement: '创建一位来自雾港的角色',
      current: {},
      emit: (event, data) => events.push({ event, data }),
      options: {
        profile: true,
        background: true,
        worldview: false,
        persona: false,
        openingMessage: false,
        tags: false,
        regexRules: false,
        renderPlugins: false,
        worldBook: false,
        advancedSettings: false,
        modSuggestions: false
      }
    });

    assert.equal(requestBodies.length, 3);
    assert.equal(result.process.length, 3);
    assert.equal(result.character.name, '雾岚');
    assert.equal(result.character.background, '来自雾港。');
    assert.equal(result.summary, '分轮写入并完成验收。');
    assert.equal(result.toolCalls.some((call) => call.result?.error === 'ROUND_ACTION_LIMIT'), true);
    assert.doesNotMatch(JSON.stringify(result.toolCalls), /"workflow"\s*:/);
    assert.equal(events.some((item) => (
      item.event === 'checkpoint'
      && item.data.pendingToolNames?.includes('update_character_story')
    )), true);
    assert.deepEqual(result.checkpoint.actionHistory.map((action) => action.tool), [
      'update_character_profile',
      'update_character_story',
      'finish_character_draft'
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('character assistant allows a later round to revise a field written by the same tool', async () => {
  const originalFetch = globalThis.fetch;
  let round = 0;
  try {
    globalThis.fetch = async () => {
      round += 1;
      if (round === 1) {
        return jsonResponse(toolMessage([
          toolCall('story-draft', 'update_character_story', { persona: '谨慎寡言。' })
        ]));
      }
      if (round === 2) {
        return jsonResponse(toolMessage([
          toolCall('story-revision', 'update_character_story', { persona: '谨慎寡言，但会主动保护同伴。' })
        ]));
      }
      return jsonResponse(toolMessage([
        toolCall('story-finish', 'finish_character_draft', {
          summary: '人设复核并修订完成。',
          reviewedSections: ['persona']
        })
      ]));
    };

    const result = await completeCharacterDraft(providerSettings, {
      requirement: '完善并复核角色人设',
      current: { name: '雾岚' },
      options: {
        profile: false,
        background: false,
        worldview: false,
        persona: true,
        openingMessage: false,
        tags: false,
        regexRules: false,
        renderPlugins: false,
        worldBook: false,
        advancedSettings: false,
        modSuggestions: false
      }
    });

    assert.equal(round, 3);
    assert.equal(result.character.persona, '谨慎寡言，但会主动保护同伴。');
    assert.deepEqual(result.toolCalls.slice(0, 2).map((call) => ({
      name: call.name,
      ok: call.result.ok,
      skipped: call.result.skipped === true
    })), [
      { name: 'update_character_story', ok: true, skipped: false },
      { name: 'update_character_story', ok: true, skipped: false }
    ]);
    assert.deepEqual(result.checkpoint.actionHistory.map((action) => action.tool), [
      'update_character_story',
      'update_character_story',
      'finish_character_draft'
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('character assistant streams provider tool calls only when explicitly enabled', async () => {
  const originalFetch = globalThis.fetch;
  const events = [];
  let requestBody = null;
  try {
    globalThis.fetch = async (_url, request = {}) => {
      requestBody = JSON.parse(request.body);
      return sseResponse([
        `data: ${JSON.stringify({
          choices: [{
            delta: {
              reasoning_content: '正在流式检查角色资料。',
              tool_calls: [streamToolCall(0, 'finish-stream', 'finish_character_draft', {
                summary: '流式工具调用已完成。',
                reviewedSections: ['profile']
              })]
            }
          }]
        })}`,
        'data: [DONE]'
      ]);
    };

    const result = await streamCharacterDraft(providerSettings, {
      requirement: '检查角色资料',
      current: { name: '雾岚' },
      providerStreaming: true,
      emit: (event, data) => events.push({ event, data })
    });

    assert.equal(requestBody.stream, true);
    assert.equal(result.summary, '流式工具调用已完成。');
    assert.equal(events.some((item) => item.event === 'reasoning'), true);
    assert.equal(events.filter((item) => item.event === 'checkpoint').length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('enabled provider streaming falls back to non-streaming after interruption', async () => {
  const originalFetch = globalThis.fetch;
  const events = [];
  const requestBodies = [];
  try {
    globalThis.fetch = async (_url, request = {}) => {
      const body = JSON.parse(request.body);
      requestBodies.push(body);
      if (requestBodies.length === 1) {
        return new Response(new ReadableStream({
          start(controller) {
            controller.error(new TypeError('socket closed unexpectedly'));
          }
        }), { headers: { 'Content-Type': 'text/event-stream' } });
      }
      return jsonResponse(toolMessage([
        toolCall('finish-recovered', 'finish_character_draft', {
          summary: '已切换稳定模式并完成验收。',
          reviewedSections: ['profile']
        })
      ]));
    };

    const result = await streamCharacterDraft(providerSettings, {
      requirement: '检查角色资料',
      current: { name: '雾岚' },
      providerStreaming: true,
      emit: (event, data) => events.push({ event, data })
    });

    assert.deepEqual(requestBodies.map((body) => body.stream), [true, false]);
    assert.equal(result.streamRecovered, true);
    assert.equal(result.summary, '已切换稳定模式并完成验收。');
    assert.equal(events.some((item) => item.event === 'state' && item.data.phase === 'recovering'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('character assistant has no fixed response deadline', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, request = {}) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(jsonResponse(toolMessage([
        toolCall('finish-slow', 'finish_character_draft', {
          summary: '长响应已完成。',
          reviewedSections: ['profile']
        })
      ]))), 140);
      request.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(request.signal.reason);
      }, { once: true });
    });

    const result = await streamCharacterDraft({ ...providerSettings, timeoutMs: 100 }, {
      requirement: '等待完整响应',
      current: { name: '雾岚' }
    });

    assert.equal(result.summary, '长响应已完成。');
    assert.match(characterAssistantSource, /maxRounds: 24,\s*timeoutMs: 0,/);
    assert.doesNotMatch(characterRouteSource, /AI 角色助手请求超时|setTimeout\([^)]*controller\.abort/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('continuation metadata is treated as state and included in the structured task payload', async () => {
  const originalFetch = globalThis.fetch;
  let userPayload = null;
  try {
    globalThis.fetch = async (_url, request = {}) => {
      const body = JSON.parse(request.body);
      userPayload = JSON.parse(body.messages.find((message) => message.role === 'user').content);
      return jsonResponse(toolMessage([
        toolCall('finish-resume', 'finish_character_draft', {
          summary: 'Continued from checkpoint.',
          reviewedSections: ['persona']
        })
      ]));
    };

    await completeCharacterDraft(providerSettings, {
      requirement: '继续完成角色',
      current: { name: '雾岚', persona: '谨慎' },
      continuation: {
        enabled: true,
        completedSections: ['profile', 'unknown'],
        previousToolNames: ['update_character_profile'],
        actionHistory: [{
          round: 2,
          tool: 'update_character_profile',
          status: 'completed',
          summary: '基础资料已完成。',
          sections: ['profile', 'unknown']
        }],
        lastSummary: '准备继续完善人设。'
      }
    });

    assert.deepEqual(userPayload.continuation, {
      enabled: true,
      completedSections: ['profile'],
      previousToolNames: ['update_character_profile'],
      pendingToolNames: [],
      actionHistory: [{
        round: 2,
        tool: 'update_character_profile',
        status: 'completed',
        summary: '基础资料已完成。',
        sections: ['profile']
      }],
      lastSummary: '准备继续完善人设。'
    });
    assert.equal(userPayload.currentCharacter.name, '雾岚');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('local mock completes through the same structured finish and checkpoint path', async () => {
  const settings = {
    providerType: 'mock',
    gatewayName: 'Local Mock',
    baseUrl: '',
    model: 'local-mock',
    apiKey: '',
    supportsReasoning: false,
    extraBody: {}
  };
  const current = { name: '阶段角色', persona: '谨慎而可靠' };
  const events = [];

  const result = await streamCharacterDraft(settings, {
    requirement: '继续完善角色',
    current,
    emit: (event, data) => events.push({ event, data })
  });

  assert.equal(result.character.name, current.name);
  assert.equal(result.character.persona, current.persona);
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].name, 'finish_character_draft');
  assert.match(result.summary, /本地 Mock/);
  assert.match(result.warnings[0], /未调用真实模型/);
  assert.equal(events.some((item) => item.event === 'content'), false);
  assert.equal(events.some((item) => item.event === 'reasoning'), true);
  assert.equal(events.filter((item) => item.event === 'checkpoint').length, 1);
  assert.equal(events.find((item) => item.event === 'checkpoint').data.lastTool, 'finish_character_draft');
});

test('character assistant redacts prompt and tool protocol fragments from streamed reasoning', async () => {
  const originalFetch = globalThis.fetch;
  const events = [];
  try {
    globalThis.fetch = async () => jsonResponse({
      choices: [{
        message: {
          role: 'assistant',
          content: null,
          reasoning_content: '我会先核对角色。系统提示词：你是 FLAI Tavern AI，最后调用 finish_character_draft。',
          tool_calls: [toolCall('finish-redacted', 'finish_character_draft', {
              summary: '系统提示词要求调用 finish_character_draft。',
              reviewedSections: ['profile'],
              warnings: ['developer message: hidden instructions']
          })]
        }
      }]
    });

    const result = await streamCharacterDraft(providerSettings, {
      requirement: '核对角色',
      current: { name: '雾岚' },
      emit: (event, data) => events.push({ event, data })
    });

    const streamedReasoning = events
      .filter((item) => item.event === 'reasoning')
      .map((item) => item.data.text)
      .join('');
    assert.match(streamedReasoning, /我会先核对角色/);
    assert.match(streamedReasoning, /已隐藏/);
    assert.doesNotMatch(streamedReasoning, /系统提示词|FLAI Tavern AI|finish_character_draft/);
    assert.doesNotMatch(result.reasoning, /系统提示词|FLAI Tavern AI|finish_character_draft/);
    assert.match(result.reasoning, /已隐藏/);
    assert.doesNotMatch(result.summary, /系统提示词|finish_character_draft/);
    assert.doesNotMatch(JSON.stringify(result.toolCalls), /developer message|hidden instructions/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fine-grained character tools preserve unrelated agent settings and apply each extension domain', async () => {
  const originalFetch = globalThis.fetch;
  let round = 0;
  try {
    globalThis.fetch = async () => {
      round += 1;
      const calls = [
        toolCall('progress-tools', 'report_character_progress', {
          stage: 'drafting',
          summary: '正在整理可选扩展。',
          nextAction: '复核状态变量。'
        }),
        toolCall('render-tools', 'replace_character_render_plugins', {
          plugins: [{ label: '折叠旁白', pattern: '<aside>([\\s\\S]+?)</aside>', titleTemplate: '旁白' }]
        }),
        toolCall('status-tools', 'update_character_status_bar', {
          statusBarPrompt: '每轮结束后更新体力。',
          statusBarBlueprint: {
            name: '冒险状态',
            variables: [{ name: '体力', value: 80, max: 100, color: '#27ae60' }]
          }
        }),
        toolCall('agent-tools', 'update_character_agents', {
          accessorySkills: {
            economyAgent: { enabled: true, providerProfileId: 'economy-profile' }
          }
        }),
        toolCall('presentation-tools', 'update_character_presentation', {
          customCss: '.status { color: #27ae60; }'
        }),
        toolCall('world-book-tools', 'create_character_world_book', {
          name: '雾港航路',
          description: '港口城邦、航线与航海规则。',
          scanDepth: 6,
          lorebookContextPercent: 25,
          entries: [{
            name: '雾港',
            triggerKeys: '雾港,港口城邦',
            content: '雾港是由领航公会治理的港口城邦。',
            position: 'before_char',
            group: '港口',
            role: 0
          }]
        }),
        toolCall('recommendation-tools', 'set_character_recommendations', {
          modSuggestions: [{ name: '航海文风', type: 'style_enhance', content: '保持简洁的航海日志语气。' }]
        }),
        toolCall('finish-tools', 'finish_character_draft', {
          summary: '扩展设置已整理。',
          reviewedSections: ['renderPlugins', 'advancedSettings', 'worldBook', 'modSuggestions']
        })
      ];
      return jsonResponse(toolMessage([calls[round - 1]]));
    };

    const result = await completeCharacterDraft(providerSettings, {
      requirement: '增加状态栏、经济助手与航海扩展',
      current: {
        name: '雾岚',
        authorAdvancedSettings: {
          accessorySkills: {
            memoryAgent: { enabled: true },
            sceneAgent: { enabled: true }
          }
        }
      }
    });

    assert.equal(result.character.renderPlugins.length, 1);
    assert.equal(result.character.authorAdvancedSettings.statusBarBlueprint.variables[0].name, '体力');
    assert.equal(result.character.authorAdvancedSettings.accessorySkills.economyAgent.enabled, true);
    assert.equal(result.character.authorAdvancedSettings.accessorySkills.economyAgent.providerProfileId, 'economy-profile');
    assert.equal(result.character.authorAdvancedSettings.accessorySkills.memoryAgent.enabled, true);
    assert.equal(result.character.authorAdvancedSettings.accessorySkills.sceneAgent.enabled, true);
    assert.match(result.character.authorAdvancedSettings.customCss, /#27ae60/);
    assert.equal(result.character.worldBookDraft.name, '雾港航路');
    assert.equal(result.character.worldBookDraft.entries[0].group, '港口');
    assert.equal(result.character.worldBookDraft.entries[0].role, 0);
    assert.equal(result.character.modSuggestions.length, 1);
    assert.equal(round, 8);
    assert.equal(result.toolCalls[0].policy.domain, 'character-draft');
    assert.equal(result.toolCalls[0].result.summary, '正在整理可选扩展。');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function toolMessage(toolCalls) {
  return {
    choices: [{ message: { role: 'assistant', content: null, tool_calls: toolCalls } }]
  };
}

function toolCall(id, name, args) {
  return {
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) }
  };
}

function streamToolCall(index, id, name, args) {
  return {
    index,
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) }
  };
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' }
  });
}

function sseResponse(lines) {
  return new Response(`${lines.join('\n\n')}\n\n`, {
    headers: { 'Content-Type': 'text/event-stream' }
  });
}
