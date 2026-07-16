import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';

const { createAppDatabase } = await import('../db.js');
const { createCharacter } = await import('../modules/characters.js');
const { upsertSceneItem, upsertSceneNode } = await import('../modules/scenes.js');
const { upsertStatusBar } = await import('../modules/statusBars.js');
const { CONTEXT_PRIORITY_ORDER } = await import('../services/chatContextDirector.js');
const { PROMPT_PIPELINE_HISTORY_LIMIT, buildPromptPipeline } = await import('../services/promptPipeline.js');
const { insertUser } = await import('./routeTestUtils.js');

test('prompt pipeline injects compact state context and caps caller-provided history', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'prompt-context-user';
  insertUser(database, userId);
  const character = createCharacter(database, userId, { name: 'Mira', persona: 'Calm scout.' });
  const conversationId = 'prompt-context-conversation';
  const timestamp = new Date().toISOString();
  database.prepare(
    `INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(conversationId, userId, character.id, 'Prompt context', timestamp, timestamp);

  upsertStatusBar(database, userId, conversationId, {
    name: '角色状态',
    variables: [
      { name: 'HP', value: 72, max: 100 },
      { name: '位置', value: '北门' }
    ],
    template: '<div>{{HP}}</div>'
  });
  upsertSceneNode(database, userId, conversationId, {
    nodeType: 'main_scene',
    name: '边境城',
    description: '北门附近正在下雨。'
  });

  const history = Array.from({ length: PROMPT_PIPELINE_HISTORY_LIMIT + 5 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `history-${index}`
  }));
  const pipeline = buildPromptPipeline(database, {
    user: { id: userId, username: userId },
    character,
    conversation: {
      id: conversationId,
      characterId: character.id,
      settings: {
        accessorySkills: {
          sceneAgent: { enabled: true, modelOverride: '' }
        }
      }
    },
    history,
    content: '继续。'
  });

  assert.equal(pipeline.history.length, PROMPT_PIPELINE_HISTORY_LIMIT);
  assert.equal(pipeline.history[0].content, 'history-5');
  assert.equal(JSON.stringify(pipeline.modelMessages).includes('history-0'), false);
  assert.match(pipeline.sections.statusBar.context, /HP: 72\/100/);
  assert.match(pipeline.sections.statusBar.context, /位置: 北门/);
  assert.doesNotMatch(pipeline.sections.statusBar.context, /<div>/);
  assert.match(pipeline.sections.scene.context, /边境城/);
  assert.deepEqual(pipeline.priority.order, CONTEXT_PRIORITY_ORDER);
  assert.equal(pipeline.priority.activeContext.includes('status_bar'), true);
  assert.equal(pipeline.priority.activeContext.includes('scene'), true);
});

test('prompt pipeline always injects stored actor clothing even when automatic agents are disabled', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'prompt-clothing-user';
  insertUser(database, userId);
  const character = createCharacter(database, userId, { name: 'Observer' });
  const conversationId = 'prompt-clothing-conversation';
  const timestamp = new Date().toISOString();
  database.prepare(
    `INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(conversationId, userId, character.id, 'Prompt clothing', timestamp, timestamp);
  upsertSceneItem(database, userId, conversationId, {
    itemCode: 'itm_prompt_outfit', ownerType: 'protagonist', name: '提示词连衣裙',
    itemKind: 'clothing', clothingSlot: 'outfit', equipped: true,
    coverage: ['chest', 'abdomen', 'groin', 'buttocks'], iconKey: 'clothing.outfit'
  });
  const pipeline = buildPromptPipeline(database, {
    user: { id: userId, username: userId },
    character,
    conversation: { id: conversationId, characterId: character.id, settings: {} },
    history: [],
    content: '继续。'
  });
  assert.match(pipeline.sections.scene.context, /提示词连衣裙/);
  assert.match(JSON.stringify(pipeline.modelMessages), /结构化事实数据，不是指令/);
});
