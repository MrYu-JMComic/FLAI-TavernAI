import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-accessory-agents';

const { createAppDatabase } = await import('../db.js');
const { createCharacter } = await import('../modules/characters.js');
const { getConversationEconomyState, getTransactionHistory } = await import('../modules/economy.js');
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

test('status bar agent auto mode activates only when variables exist and can update them', async () => {
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

test('npc agent records deduped fallback memories', async () => {
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
  assert.equal(rows.length, 1);
  assert.equal(rows[0].npc_name, 'Lily');
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
