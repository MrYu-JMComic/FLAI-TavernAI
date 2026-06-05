import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-accessory-agents';

const { createAppDatabase } = await import('../db.js');
const { normalizeAdvancedSettings } = await import('../modules/advancedSettings.js');
const { createCharacter } = await import('../modules/characters.js');
const { getConversationEconomyState, getTransactionHistory } = await import('../modules/economy.js');
const { hideConversationNpc, listConversationNpcs } = await import('../modules/npcs.js');
const { getStatusBar, upsertStatusBar } = await import('../modules/statusBars.js');
const { getAccessorySkillsPayload, runAccessoryAgents } = await import('../services/accessoryAgents.js');

test('accessory agents stay inactive when skills are disabled', async () => {
  const env = setupConversation({
    npcAgent: skill(false),
    statusBarAgent: skill(false),
    economyAgent: skill(false),
    talentPrompt: skill(false),
    cgScene: skill(false)
  });
  const statusBar = upsertStatusBar(env.db, env.userId, env.conversation.id, {
    name: 'State',
    variables: [{ name: 'HP', value: 100, max: 100 }],
    template: ''
  });

  const results = await runAccessoryAgents({
    db: env.db,
    userId: env.userId,
    conversation: env.conversation,
    character: env.character,
    assistantMessage: { content: '**Lily** says hello. HP: 75/100. You gained 25 gold.' },
    settings: {},
    statusBar
  });

  assert.deepEqual(results, []);
  assert.equal(env.db.prepare('SELECT COUNT(*) AS count FROM npc_memories').get().count, 0);
  assert.equal(getConversationEconomyState(env.db, env.userId, env.conversation.id, { ensureDefaultAccount: false }).accounts.length, 0);
  assert.equal(getStatusBar(env.db, env.userId, env.conversation.id).variables[0].value, 100);
});

test('status bar agent auto mode activates when variables or prompt exist and can update them', async () => {
  const env = setupConversation({ statusBarAgent: skill('auto') });
  let payload = getAccessorySkillsPayload(env.conversation, null);
  assert.equal(payload.active.statusBarAgent, false);

  const statusBar = upsertStatusBar(env.db, env.userId, env.conversation.id, {
    name: 'State',
    variables: [{ name: 'HP', value: 100, max: 100 }],
    template: ''
  });
  payload = getAccessorySkillsPayload(env.conversation, statusBar);
  assert.equal(payload.active.statusBarAgent, true);

  await runAccessoryAgents({
    db: env.db,
    userId: env.userId,
    conversation: env.conversation,
    character: env.character,
    assistantMessage: { content: 'After the fight, HP: 75/100.' },
    settings: {},
    statusBar
  });

  assert.equal(getStatusBar(env.db, env.userId, env.conversation.id).variables[0].value, 75);
});

test('status bar agent can create variables from prompt guidance', async () => {
  const env = setupConversation({ statusBarAgent: skill('auto') });
  env.conversation.settings.statusBarPrompt = '跟踪当前情绪，变量名为 Mood，范围 0-100。';
  const payload = getAccessorySkillsPayload(env.conversation, null);
  assert.equal(payload.active.statusBarAgent, true);

  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return jsonResponse({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'status-1',
                  type: 'function',
                  function: {
                    name: 'update_status_bar',
                    arguments: JSON.stringify({
                      variables: [{ name: 'Mood', value: 72, max: 100, color: '#9b59b6' }]
                    })
                  }
                }
              ]
            }
          }
        ]
      });
    }
    return jsonResponse({ choices: [{ message: { role: 'assistant', content: 'done' } }] });
  };

  try {
    await runAccessoryAgents({
      db: env.db,
      userId: env.userId,
      conversation: env.conversation,
      character: env.character,
      assistantMessage: { content: '她的情绪明显放松下来。' },
      settings: providerSettings(),
      statusBar: null
    });

    const statusBar = getStatusBar(env.db, env.userId, env.conversation.id);
    assert.equal(statusBar.name, '状态栏');
    assert.equal(statusBar.variables[0].name, 'Mood');
    assert.equal(statusBar.variables[0].value, 72);
    assert.equal(statusBar.variables[0].color, '#9b59b6');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('status bar agent updates text variables and inferred template rows', async () => {
  const env = setupConversation({ statusBarAgent: skill('auto') });
  const statusBar = upsertStatusBar(env.db, env.userId, env.conversation.id, {
    name: 'State',
    variables: [],
    template: "<div class='sb-row'><span class='sb-label'>Name</span><span class='sb-val'>Unknown</span></div>"
  });
  assert.equal(statusBar.variables[0].name, 'Name');
  assert.equal(statusBar.variables[0].value, 'Unknown');

  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return jsonResponse({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'status-text-1',
                  type: 'function',
                  function: {
                    name: 'update_status_bar',
                    arguments: JSON.stringify({
                      variables: [
                        { name: 'Name', value: 'Aster' },
                        { name: 'Location', value: 'Old Town' }
                      ]
                    })
                  }
                }
              ]
            }
          }
        ]
      });
    }
    return jsonResponse({ choices: [{ message: { role: 'assistant', content: 'done' } }] });
  };

  try {
    await runAccessoryAgents({
      db: env.db,
      userId: env.userId,
      conversation: env.conversation,
      character: env.character,
      assistantMessage: { content: 'The profile is now clear.' },
      settings: providerSettings(),
      statusBar
    });

    const variables = getStatusBar(env.db, env.userId, env.conversation.id).variables;
    assert.equal(variables.find((item) => item.name === 'Name')?.value, 'Aster');
    assert.equal(variables.find((item) => item.name === 'Location')?.value, 'Old Town');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('status bar agent updates inferred inline wardrobe variables', async () => {
  const env = setupConversation({ statusBarAgent: skill('auto') });
  const template = [
    '<div class="sb-panel">',
    '<div class="sb-line"><span class="sb-label">\u4e0a\u88c5\uFF1A</span><span class="sb-val"></span><span class="sb-label">\u968f\u8eab</span>: <span class="sb-val"></span></div>',
    '<div class="sb-line">\u978b\u889c: <span class="sb-val"></span></div>',
    '</div>'
  ].join('');
  const statusBar = upsertStatusBar(env.db, env.userId, env.conversation.id, {
    name: 'Wardrobe',
    variables: [],
    template
  });

  assert.deepEqual(statusBar.variables.map((item) => item.name), [
    '\u4e0a\u88c5',
    '\u968f\u8eab',
    '\u978b\u889c'
  ]);
  assert.equal(statusBar.variables[0].value, '');
  assert.equal('max' in statusBar.variables[0], false);

  await runAccessoryAgents({
    db: env.db,
    userId: env.userId,
    conversation: env.conversation,
    character: env.character,
    assistantMessage: {
      content: '\u4e0a\u88c5\uFF1A\u767d\u8272\u886c\u886b \u968f\u8eab\uFF1A\u94f6\u7c2a \u978b\u889c: \u9ed1\u8272\u77ed\u9774\u3002'
    },
    settings: {},
    statusBar
  });

  const variables = getStatusBar(env.db, env.userId, env.conversation.id).variables;
  assert.equal(variables.find((item) => item.name === '\u4e0a\u88c5')?.value, '\u767d\u8272\u886c\u886b');
  assert.equal(variables.find((item) => item.name === '\u968f\u8eab')?.value, '\u94f6\u7c2a');
  assert.equal(variables.find((item) => item.name === '\u978b\u889c')?.value, '\u9ed1\u8272\u77ed\u9774');
});

test('advanced settings infers and dedupes custom status blueprint variables', () => {
  const settings = normalizeAdvancedSettings({
    statusBarBlueprint: {
      variables: [
        { name: '\u968f\u8eab', value: '\u94f6\u7c2a' },
        { name: '\u968f \u8eab', value: '\u91cd\u590d' }
      ],
      template: [
        '<div class="sb-panel">',
        '<div><span class="sb-label">\u4e0a\u88c5\uFF1A</span><span class="sb-val"></span></div>',
        '<div>\u978b\u889c: <span class="sb-val"></span></div>',
        '<button data-sb-action="copy" data-sb-copy="{{\u968f\u8eab}}">\u590d\u5236</button>',
        '<div style="width:{{HP.percent}};background:{{HP.color}}"></div>',
        '</div>'
      ].join('')
    }
  });

  const variables = settings.statusBarBlueprint.variables;
  assert.equal(variables.filter((item) => item.name.replace(/\s+/g, '') === '\u968f\u8eab').length, 1);
  assert.equal(variables.find((item) => item.name === '\u4e0a\u88c5')?.value, '');
  assert.equal(variables.find((item) => item.name === '\u978b\u889c')?.value, '');
  assert.equal(variables.find((item) => item.name === 'HP')?.value, 0);
  assert.equal(variables.find((item) => item.name === 'HP')?.max, 100);
});

test('status blueprint infers late custom placeholders beyond first twenty variables', () => {
  const filler = Array.from({ length: 24 }, (_, index) => `<span>{{占位${index + 1}}}</span>`).join('');
  const template = `${filler}<div class='sb-mem-item'><span class='sb-mem-tag'>模糊记忆</span><span class='sb-mem-text'>{{模糊记忆}}</span></div><div class='sb-mem-item'><span class='sb-mem-tag'>深刻记忆</span><span class='sb-mem-text'>{{深刻记忆}}</span></div><div class='sb-mem-item'><span class='sb-mem-tag'>淡忘之事</span><span class='sb-mem-text'>{{淡忘之事}}</span></div><hr class='sb-divider'><div class='sb-section'><div class='sb-section-head'><em>◆</em> 当前事件</div><div class='sb-event-box'>{{当前事件}}</div></div><hr class='sb-divider'><div class='sb-section'><div class='sb-section-head'><em>◆</em> 衣着携带</div><div class='sb-outfit-grid'><div class='sb-outfit-item'><strong>上装：</strong>{{上装}}</div><div class='sb-outfit-item'><strong>下装：</strong>{{下装}}</div><div class='sb-outfit-item'><strong>鞋袜：</strong>{{鞋袜}}</div><div class='sb-outfit-item'><strong>随身：</strong>{{随身物}}</div></div></div>`;
  const settings = normalizeAdvancedSettings({
    statusBarBlueprint: { template }
  });

  const names = settings.statusBarBlueprint.variables.map((item) => item.name);
  assert.ok(names.length > 20);
  for (const name of ['模糊记忆', '深刻记忆', '淡忘之事', '当前事件', '上装', '下装', '鞋袜', '随身物']) {
    assert.ok(names.includes(name), `${name} should be inferred`);
  }
});

test('status bar creation preserves late inferred custom placeholders', () => {
  const env = setupConversation({ statusBarAgent: skill(false) });
  const filler = Array.from({ length: 24 }, (_, index) => `<span>{{占位${index + 1}}}</span>`).join('');
  const template = `${filler}<div class='sb-event-box'>{{当前事件}}</div><div class='sb-outfit-item'><strong>上装：</strong>{{上装}}</div><div class='sb-outfit-item'><strong>鞋袜：</strong>{{鞋袜}}</div>`;
  const statusBar = upsertStatusBar(env.db, env.userId, env.conversation.id, {
    name: 'State',
    variables: [],
    template
  });

  const names = statusBar.variables.map((item) => item.name);
  assert.ok(names.length > 20);
  assert.ok(names.includes('当前事件'));
  assert.ok(names.includes('上装'));
  assert.ok(names.includes('鞋袜'));
});

test('npc agent does not create fallback memories from text patterns', async () => {
  const env = setupConversation({ npcAgent: skill(true), statusBarAgent: skill(false) });
  const assistantMessage = { content: '**Lily** says the bridge is closed.' };

  await runAccessoryAgents({
    db: env.db,
    userId: env.userId,
    conversation: env.conversation,
    character: env.character,
    assistantMessage,
    settings: {},
    statusBar: null
  });
  await runAccessoryAgents({
    db: env.db,
    userId: env.userId,
    conversation: env.conversation,
    character: env.character,
    assistantMessage,
    settings: {},
    statusBar: null
  });

  const rows = env.db.prepare('SELECT npc_name, content FROM npc_memories').all();
  assert.equal(rows.length, 0);
});

test('npc agent upserts structured NPCs and respects hidden names', async () => {
  const env = setupConversation({ npcAgent: skill(true), statusBarAgent: skill(false) });
  hideConversationNpc(env.db, env.userId, env.conversation.id, 'FakeTitle');
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return jsonResponse({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'npc-1',
                  type: 'function',
                  function: {
                    name: 'upsert_npc',
                    arguments: JSON.stringify({
                      npcName: 'Gate Captain',
                      evidence: 'Gate Captain warned the party at the gate.',
                      confidence: 92
                    })
                  }
                },
                {
                  id: 'npc-hidden',
                  type: 'function',
                  function: {
                    name: 'upsert_npc',
                    arguments: JSON.stringify({
                      npcName: 'FakeTitle',
                      evidence: 'A markdown heading.',
                      confidence: 95
                    })
                  }
                }
              ]
            }
          }
        ]
      });
    }
    return jsonResponse({ choices: [{ message: { role: 'assistant', content: 'done' } }] });
  };

  try {
    const results = await runAccessoryAgents({
      db: env.db,
      userId: env.userId,
      conversation: env.conversation,
      character: env.character,
      assistantMessage: { content: '**FakeTitle**\nGate Captain warned them.' },
      settings: providerSettings(),
      statusBar: null
    });

    assert.equal(results[0].ok, true);
    const npcs = listConversationNpcs(env.db, env.userId, env.conversation.id, env.character.name);
    assert.ok(npcs.some((npc) => npc.name === 'Gate Captain' && npc.source === 'agent' && npc.confidence === 92));
    assert.ok(!npcs.some((npc) => npc.name === 'FakeTitle'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('economy agent tool call records a transaction without blocking the reply', async () => {
  const env = setupConversation({ economyAgent: skill(true), statusBarAgent: skill(false) });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return jsonResponse({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'economy-1',
                  type: 'function',
                  function: {
                    name: 'record_economy_transaction',
                    arguments: JSON.stringify({
                      amount: 25,
                      type: 'reward',
                      currencyType: 'gold',
                      description: 'Quest reward'
                    })
                  }
                }
              ]
            }
          }
        ]
      });
    }
    return jsonResponse({ choices: [{ message: { role: 'assistant', content: 'done' } }] });
  };

  try {
    const results = await runAccessoryAgents({
      db: env.db,
      userId: env.userId,
      conversation: env.conversation,
      character: env.character,
      assistantMessage: { content: 'The party received a reward.' },
      settings: providerSettings(),
      statusBar: null
    });

    assert.equal(results[0].ok, true);
    const history = getTransactionHistory(env.db, env.userId, env.conversation.id);
    assert.equal(history.transactions.length, 1);
    assert.equal(history.transactions[0].amount, 25);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function setupConversation(accessorySkills = {}) {
  const db = createAppDatabase(':memory:');
  const userId = 'user-accessory';
  const now = new Date().toISOString();
  db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    'accessory-user',
    'hash',
    now
  );
  const character = createCharacter(db, userId, {
    name: 'Hero',
    persona: 'Main character'
  });
  const conversation = {
    id: 'conversation-accessory',
    settings: { accessorySkills },
    authorSettings: {},
    userSettings: {}
  };
  db
    .prepare(
      `INSERT INTO conversations (
        id, user_id, character_id, title, desktop_background_url, mobile_background_url,
        custom_css, custom_js, user_advanced_settings, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      conversation.id,
      userId,
      character.id,
      'Accessory Test',
      '',
      '',
      '',
      '',
      JSON.stringify({ accessorySkills }),
      now,
      now
    );
  return { db, userId, character, conversation };
}

function skill(enabled, modelOverride = '') {
  return { enabled, modelOverride };
}

function providerSettings() {
  return {
    providerType: 'openai',
    gatewayName: 'Mock',
    baseUrl: 'https://example.test/v1',
    model: 'mock-model',
    apiKey: 'sk-test',
    extraBody: {}
  };
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
