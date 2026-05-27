import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret';

const { createAppDatabase } = await import('../db.js');
const { createCharacter } = await import('../modules/characters.js');
const {
  addNpcBehavior,
  addNpcMemory,
  buildNpcBehaviorPrompt,
  deleteNpcBehavior,
  deleteNpcMemory,
  listConversationNpcs,
  listNpcBehaviors,
  listNpcMemories,
  scanNpcsFromMessages,
  updateNpcBehavior
} = await import('../modules/npcs.js');

function setupDatabase() {
  const database = createAppDatabase(':memory:');
  const userId = 'npc-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'npc-tester', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, userId, { name: '主角', visibility: 'private' });
  const conversationId = 'conv-npc-1';
  const timestamp = new Date().toISOString();
  database.prepare(
    'INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(conversationId, userId, character.id, 'NPC 测试', timestamp, timestamp);
  return { database, userId, character, conversationId };
}

test('NPC memories CRUD', () => {
  const { database, userId, conversationId } = setupDatabase();

  // Empty list initially
  assert.deepEqual(listNpcMemories(database, userId, conversationId, '酒馆老板'), []);

  // Add memory
  const mem1 = addNpcMemory(database, userId, conversationId, '酒馆老板', {
    memoryType: 'event',
    content: '玩家第一次来到酒馆'
  });
  assert.equal(mem1.npcName, '酒馆老板');
  assert.equal(mem1.memoryType, 'event');
  assert.equal(mem1.content, '玩家第一次来到酒馆');
  assert.ok(mem1.id);
  assert.ok(mem1.createdAt);

  // Add second memory
  const mem2 = addNpcMemory(database, userId, conversationId, '酒馆老板', {
    memoryType: 'relationship',
    content: '对玩家有好感'
  });
  assert.equal(mem2.memoryType, 'relationship');

  // List memories
  const memories = listNpcMemories(database, userId, conversationId, '酒馆老板');
  assert.equal(memories.length, 2);

  // Delete memory
  assert.equal(deleteNpcMemory(database, userId, conversationId, mem1.id), true);
  assert.equal(deleteNpcMemory(database, userId, conversationId, 'nonexistent'), false);
  assert.equal(listNpcMemories(database, userId, conversationId, '酒馆老板').length, 1);
});

test('NPC behaviors CRUD with priority and toggle', () => {
  const { database, userId, conversationId } = setupDatabase();

  // Add behavior
  const beh1 = addNpcBehavior(database, userId, conversationId, '酒馆老板', {
    behaviorType: 'dialogue',
    triggerCondition: '玩家提到酒',
    action: '热情推荐特酿',
    priority: 10,
    enabled: true
  });
  assert.equal(beh1.npcName, '酒馆老板');
  assert.equal(beh1.behaviorType, 'dialogue');
  assert.equal(beh1.triggerCondition, '玩家提到酒');
  assert.equal(beh1.action, '热情推荐特酿');
  assert.equal(beh1.priority, 10);
  assert.equal(beh1.enabled, true);

  // Add second behavior with lower priority
  const beh2 = addNpcBehavior(database, userId, conversationId, '酒馆老板', {
    behaviorType: 'reaction',
    triggerCondition: '玩家离开',
    action: '挥手告别',
    priority: 5
  });

  // List behaviors - sorted by priority DESC
  const behaviors = listNpcBehaviors(database, userId, conversationId, '酒馆老板');
  assert.equal(behaviors.length, 2);
  assert.equal(behaviors[0].id, beh1.id); // higher priority first

  // Toggle behavior
  const toggled = updateNpcBehavior(database, userId, conversationId, beh1.id, { enabled: false });
  assert.equal(toggled.enabled, false);

  // Update behavior fields
  const updated = updateNpcBehavior(database, userId, conversationId, beh2.id, {
    action: '微笑送别',
    priority: 8
  });
  assert.equal(updated.action, '微笑送别');
  assert.equal(updated.priority, 8);

  // Delete behavior
  assert.equal(deleteNpcBehavior(database, userId, conversationId, beh1.id), true);
  assert.equal(deleteNpcBehavior(database, userId, conversationId, 'nonexistent'), false);
  assert.equal(listNpcBehaviors(database, userId, conversationId, '酒馆老板').length, 1);
});

test('scanNpcsFromMessages extracts NPC names from text patterns', () => {
  const messages = [
    { role: 'assistant', content: '【酒馆老板】欢迎来到月光酒馆！' }
  ];
  const npcs = scanNpcsFromMessages(messages, '主角');
  assert.ok(npcs.includes('酒馆老板'));

  // Bold markdown names
  const messages2 = [
    { role: 'assistant', content: '**老铁匠**锤打着铁砧，火星四溅。' }
  ];
  const npcs2 = scanNpcsFromMessages(messages2, '主角');
  assert.ok(npcs2.includes('老铁匠'));

  // Excludes main character
  const messages3 = [
    { role: 'assistant', content: '**主角**走进了房间。【酒馆老板】端来一杯酒。' }
  ];
  const npcs3 = scanNpcsFromMessages(messages3, '主角');
  assert.ok(!npcs3.includes('主角'));
  assert.ok(npcs3.includes('酒馆老板'));

  // Chinese dialogue patterns
  const messages4 = [
    { role: 'assistant', content: '\u201c神秘商人\u201d说道：\u201c你想买什么？\u201d' }
  ];
  const npcs4 = scanNpcsFromMessages(messages4, '主角');
  assert.ok(npcs4.includes('神秘商人'));

  // Empty input
  assert.deepEqual(scanNpcsFromMessages([], ''), []);
  assert.deepEqual(scanNpcsFromMessages([{ role: 'user', content: '你好' }], ''), []);
});

test('listConversationNpcs merges scanned and stored NPCs', () => {
  const { database, userId, conversationId } = setupDatabase();

  // Insert a message with NPC names
  database.prepare(
    'INSERT INTO messages (id, user_id, conversation_id, role, content, reasoning, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('msg-1', userId, conversationId, 'assistant', '【铁匠】打铁中。**商人**路过。', '', null, new Date().toISOString());

  // Add a memory for an NPC not in messages
  addNpcMemory(database, userId, conversationId, '守卫', { content: '站岗' });

  const npcs = listConversationNpcs(database, userId, conversationId, '主角');
  const names = npcs.map((n) => n.name);
  assert.ok(names.includes('铁匠'));
  assert.ok(names.includes('商人'));
  assert.ok(names.includes('守卫'));
  assert.ok(!names.includes('主角'));

  // Check counts
  const guard = npcs.find((n) => n.name === '守卫');
  assert.equal(guard.memoryCount, 1);
  assert.equal(guard.behaviorCount, 0);
});

test('buildNpcBehaviorPrompt generates system prompt from behaviors', () => {
  const { database, userId, conversationId } = setupDatabase();

  // No behaviors = empty prompt
  assert.equal(buildNpcBehaviorPrompt(database, conversationId), '');

  // Add behaviors
  addNpcBehavior(database, userId, conversationId, '酒馆老板', {
    behaviorType: 'dialogue',
    triggerCondition: '玩家点酒',
    action: '推荐特酿啤酒',
    priority: 10,
    enabled: true
  });
  addNpcBehavior(database, userId, conversationId, '酒馆老板', {
    behaviorType: 'reaction',
    triggerCondition: '玩家提及战争',
    action: '变得严肃，压低声音',
    priority: 5,
    enabled: true
  });
  addNpcBehavior(database, userId, conversationId, '酒馆老板', {
    behaviorType: 'action',
    triggerCondition: '',
    action: '这条被禁用了',
    enabled: false
  });
  addNpcMemory(database, userId, conversationId, '酒馆老板', {
    memoryType: 'opinion',
    content: '觉得玩家很可疑'
  });

  const prompt = buildNpcBehaviorPrompt(database, conversationId);
  assert.ok(prompt.includes('NPC 自主行为引擎'));
  assert.ok(prompt.includes('酒馆老板'));
  assert.ok(prompt.includes('推荐特酿啤酒'));
  assert.ok(prompt.includes('变得严肃'));
  assert.ok(!prompt.includes('这条被禁用了')); // disabled rule excluded
  assert.ok(prompt.includes('觉得玩家很可疑')); // memory included
});

test('NPC memory type normalization', () => {
  const { database, userId, conversationId } = setupDatabase();

  // Valid type
  const mem1 = addNpcMemory(database, userId, conversationId, 'NPC', { memoryType: 'emotion', content: '开心' });
  assert.equal(mem1.memoryType, 'emotion');

  // Invalid type falls back to 'event'
  const mem2 = addNpcMemory(database, userId, conversationId, 'NPC', { memoryType: 'invalid', content: 'test' });
  assert.equal(mem2.memoryType, 'event');

  // Default type
  const mem3 = addNpcMemory(database, userId, conversationId, 'NPC', { content: 'test' });
  assert.equal(mem3.memoryType, 'event');
});

test('NPC content normalization truncates long content', () => {
  const { database, userId, conversationId } = setupDatabase();

  const longContent = 'x'.repeat(3000);
  const mem = addNpcMemory(database, userId, conversationId, 'NPC', { content: longContent });
  assert.equal(mem.content.length, 2000);
});

test('NPC conversation ownership isolation', () => {
  const { database, conversationId } = setupDatabase();
  const otherUserId = 'other-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    otherUserId, 'other', 'hash', new Date().toISOString()
  );

  // Other user cannot access NPC data
  assert.throws(() => {
    listNpcMemories(database, otherUserId, conversationId, 'NPC');
  }, /对话不存在/);

  assert.throws(() => {
    addNpcMemory(database, otherUserId, conversationId, 'NPC', { content: 'hack' });
  }, /对话不存在/);
});

test('NPC behavior priority clamping', () => {
  const { database, userId, conversationId } = setupDatabase();

  const beh = addNpcBehavior(database, userId, conversationId, 'NPC', {
    action: 'test',
    priority: 999
  });
  assert.equal(beh.priority, 100); // clamped to max

  const beh2 = addNpcBehavior(database, userId, conversationId, 'NPC', {
    action: 'test',
    priority: -5
  });
  assert.equal(beh2.priority, 0); // clamped to min
});
