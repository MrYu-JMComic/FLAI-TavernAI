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
  hideConversationNpc,
  hideEmptyConversationNpcs,
  listConversationNpcs,
  listNpcBehaviors,
  listNpcMemories,
  scanNpcsFromMessages,
  upsertConversationNpc,
  updateConversationNpc,
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

test('NPC memories preserve newest insertion order when timestamps tie', () => {
  const { database, userId, conversationId } = setupDatabase();
  const tiedTimestamp = '2026-01-01T00:00:00.000Z';

  database.prepare(
    'INSERT INTO npc_memories (id, conversation_id, npc_name, memory_type, content, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('npc-memory-first', conversationId, 'NPC', 'event', 'first memory', tiedTimestamp);
  database.prepare(
    'INSERT INTO npc_memories (id, conversation_id, npc_name, memory_type, content, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('npc-memory-second', conversationId, 'NPC', 'event', 'second memory', tiedTimestamp);

  const memories = listNpcMemories(database, userId, conversationId, 'NPC');

  assert.deepEqual(memories.map((memory) => memory.id), ['npc-memory-second', 'npc-memory-first']);
});

test('NPC behaviors preserve insertion order when priority and timestamps tie', () => {
  const { database, userId, conversationId } = setupDatabase();
  const tiedTimestamp = '2026-01-01T00:00:00.000Z';

  database.prepare(
    'INSERT INTO npc_behaviors (id, conversation_id, npc_name, behavior_type, trigger_condition, action, priority, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('npc-behavior-first', conversationId, 'NPC', 'reaction', 'same trigger', 'first action', 10, 1, tiedTimestamp);
  database.prepare(
    'INSERT INTO npc_behaviors (id, conversation_id, npc_name, behavior_type, trigger_condition, action, priority, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('npc-behavior-second', conversationId, 'NPC', 'reaction', 'same trigger', 'second action', 10, 1, tiedTimestamp);

  const behaviors = listNpcBehaviors(database, userId, conversationId, 'NPC');

  assert.deepEqual(behaviors.map((behavior) => behavior.id), ['npc-behavior-first', 'npc-behavior-second']);

  const prompt = buildNpcBehaviorPrompt(database, conversationId);
  assert.ok(prompt.indexOf('first action') < prompt.indexOf('second action'));
});

test('NPC behavior prompt uses newest tied memories first', () => {
  const { database, conversationId } = setupDatabase();
  const tiedTimestamp = '2026-01-01T00:00:00.000Z';

  database.prepare(
    'INSERT INTO npc_behaviors (id, conversation_id, npc_name, behavior_type, trigger_condition, action, priority, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('npc-prompt-memory-behavior', conversationId, 'NPC', 'reaction', '', 'act from memory', 1, 1, tiedTimestamp);

  for (let index = 1; index <= 6; index += 1) {
    database.prepare(
      'INSERT INTO npc_memories (id, conversation_id, npc_name, memory_type, content, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(`npc-prompt-memory-${index}`, conversationId, 'NPC', 'event', `memory-${index}`, tiedTimestamp);
  }

  const prompt = buildNpcBehaviorPrompt(database, conversationId);

  assert.ok(!prompt.includes('memory-1'));
  assert.ok(prompt.indexOf('memory-6') < prompt.indexOf('memory-5'));
  assert.ok(prompt.indexOf('memory-5') < prompt.indexOf('memory-4'));
  assert.ok(prompt.indexOf('memory-4') < prompt.indexOf('memory-3'));
  assert.ok(prompt.indexOf('memory-3') < prompt.indexOf('memory-2'));
});

test('NPC behavior prompt includes memory-only NPCs', () => {
  const { database, userId, conversationId } = setupDatabase();

  addNpcMemory(database, userId, conversationId, 'MemoryOnlyNpc', {
    memoryType: 'knowledge',
    content: 'MEMORY_ONLY_SENTINEL'
  });

  const prompt = buildNpcBehaviorPrompt(database, conversationId);

  assert.ok(prompt.includes('MemoryOnlyNpc'));
  assert.ok(prompt.includes('MEMORY_ONLY_SENTINEL'));
});

test('NPC mutators treat null payloads as empty input', () => {
  const { database, userId, conversationId } = setupDatabase();

  const memory = addNpcMemory(database, userId, conversationId, 'NPC', null);
  assert.equal(memory.memoryType, 'event');
  assert.equal(memory.content, '');

  const behavior = addNpcBehavior(database, userId, conversationId, 'NPC', null);
  assert.equal(behavior.behaviorType, 'reaction');
  assert.equal(behavior.triggerCondition, '');
  assert.equal(behavior.action, '');
  assert.equal(behavior.priority, 0);
  assert.equal(behavior.enabled, true);

  const updated = updateNpcBehavior(database, userId, conversationId, behavior.id, null);
  assert.equal(updated.behaviorType, behavior.behaviorType);
  assert.equal(updated.triggerCondition, behavior.triggerCondition);
  assert.equal(updated.action, behavior.action);
  assert.equal(updated.priority, behavior.priority);
  assert.equal(updated.enabled, behavior.enabled);

  assert.equal(upsertConversationNpc(database, userId, conversationId, null), null);
});

test('NPC mutators normalize string boolean flags', () => {
  const { database, userId, conversationId } = setupDatabase();

  const disabledBehavior = addNpcBehavior(database, userId, conversationId, 'NPC', {
    enabled: 'false'
  });
  assert.equal(disabledBehavior.enabled, false);

  const enabledBehavior = updateNpcBehavior(database, userId, conversationId, disabledBehavior.id, {
    enabled: 'true'
  });
  assert.equal(enabledBehavior.enabled, true);

  const hiddenNpc = upsertConversationNpc(database, userId, conversationId, {
    npcName: 'String Flag NPC',
    hidden: 'true'
  });
  assert.equal(hiddenNpc.hidden, true);

  const stillHidden = upsertConversationNpc(database, userId, conversationId, {
    npcName: 'String Flag NPC',
    hidden: 'false'
  });
  assert.equal(stillHidden.hidden, true);

  const unhidden = upsertConversationNpc(database, userId, conversationId, {
    npcName: 'String Flag NPC',
    hidden: 'false',
    unhide: 'true'
  });
  assert.equal(unhidden.hidden, false);
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

test('scanNpcsFromMessages is disabled to avoid keyword false positives', () => {
  const messages = [
    { role: 'assistant', content: '【酒馆老板】欢迎来到月光酒馆！' },
    { role: 'assistant', content: '**老铁匠**锤打着铁砧，火星四溅。' },
    { role: 'assistant', content: '老板娘：欢迎回来，今天想听哪段传闻？' },
    {
      role: 'assistant',
      content: [
        '**主角信息**',
        '**其他角色**',
        '**特殊要素**',
        '角色状态面板：6 项状态'
      ].join('\n')
    }
  ];

  assert.deepEqual(scanNpcsFromMessages(messages, '主角'), []);
  assert.deepEqual(scanNpcsFromMessages([], ''), []);
  assert.deepEqual(scanNpcsFromMessages([{ role: 'user', content: '你好' }], ''), []);
});

test('listConversationNpcs merges stored and agent-registered NPCs only', () => {
  const { database, userId, conversationId } = setupDatabase();

  // Insert a message with NPC names
  database.prepare(
    'INSERT INTO messages (id, user_id, conversation_id, role, content, reasoning, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('msg-1', userId, conversationId, 'assistant', '【铁匠】打铁中。**商人**路过。', '', null, new Date().toISOString());

  // Add a memory for an NPC not in messages
  addNpcMemory(database, userId, conversationId, '守卫', { content: '站岗' });

  const npcs = listConversationNpcs(database, userId, conversationId, '主角');
  const names = npcs.map((n) => n.name);
  assert.deepEqual(names, ['守卫']);

  // Check counts
  const guard = npcs.find((n) => n.name === '守卫');
  assert.equal(guard.memoryCount, 1);
  assert.equal(guard.behaviorCount, 0);
});

test('listConversationNpcs includes registry NPCs and hides removed NPCs', () => {
  const { database, userId, conversationId } = setupDatabase();
  database.prepare(
    'INSERT INTO messages (id, user_id, conversation_id, role, content, reasoning, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('msg-registry-1', userId, conversationId, 'assistant', '【误判标题】不是角色。\n老板娘：欢迎回来。', '', null, new Date().toISOString());

  const agentNpc = upsertConversationNpc(database, userId, conversationId, {
    npcName: '巡逻队长',
    source: 'agent',
    evidence: '巡逻队长出现在走廊口',
    confidence: 88
  });
  assert.equal(agentNpc.name, '巡逻队长');
  assert.equal(agentNpc.source, 'agent');

  addNpcMemory(database, userId, conversationId, '误判标题', { content: '旧误判记忆' });
  assert.ok(listConversationNpcs(database, userId, conversationId, '主角').some((npc) => npc.name === '误判标题'));

  const hidden = hideConversationNpc(database, userId, conversationId, '误判标题');
  assert.equal(hidden.hidden, true);

  const npcs = listConversationNpcs(database, userId, conversationId, '主角');
  const names = npcs.map((npc) => npc.name);
  assert.ok(names.includes('巡逻队长'));
  assert.ok(!names.includes('老板娘'));
  assert.ok(!names.includes('误判标题'));
  assert.equal(npcs.find((npc) => npc.name === '巡逻队长').confidence, 88);
});

test('NPC status aliases and memory seal affect prompt memory injection', () => {
  const { database, userId, conversationId } = setupDatabase();

  addNpcMemory(database, userId, conversationId, 'Captain Aria', {
    memoryType: 'knowledge',
    content: 'SEALED_MEMORY_SENTINEL'
  });
  updateConversationNpc(database, userId, conversationId, 'Captain Aria', {
    status: 'dead',
    aliases: ['Aria Valen', 'Captain Aria', 'Aria Valen'],
    memorySealed: true
  });

  const sealedList = listConversationNpcs(database, userId, conversationId, '');
  const sealedNpc = sealedList.find((npc) => npc.name === 'Captain Aria');
  assert.equal(sealedNpc.status, 'dead');
  assert.deepEqual(sealedNpc.aliases, ['Aria Valen', 'Captain Aria']);
  assert.equal(sealedNpc.memorySealed, true);
  assert.equal(sealedNpc.memorySealActive, true);

  const sealedPrompt = buildNpcBehaviorPrompt(database, conversationId);
  assert.ok(sealedPrompt.includes('Status: dead'));
  assert.ok(sealedPrompt.includes('Exact aliases: Aria Valen, Captain Aria'));
  assert.ok(sealedPrompt.includes('Memories: sealed'));
  assert.ok(!sealedPrompt.includes('SEALED_MEMORY_SENTINEL'));

  updateConversationNpc(database, userId, conversationId, 'Captain Aria', {
    status: 'following'
  });

  const unsealedNpc = listConversationNpcs(database, userId, conversationId, '')
    .find((npc) => npc.name === 'Captain Aria');
  assert.equal(unsealedNpc.memorySealed, true);
  assert.equal(unsealedNpc.memorySealActive, false);

  const unsealedPrompt = buildNpcBehaviorPrompt(database, conversationId);
  assert.ok(unsealedPrompt.includes('Status: following'));
  assert.ok(unsealedPrompt.includes('SEALED_MEMORY_SENTINEL'));
});

test('hideEmptyConversationNpcs hides NPCs without memories or behaviors only', () => {
  const { database, userId, conversationId } = setupDatabase();
  database.prepare(
    'INSERT INTO messages (id, user_id, conversation_id, role, content, reasoning, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    'msg-empty-npcs-1',
    userId,
    conversationId,
    'assistant',
    '空甲：只是路过。\n空乙：点了点头。\n记忆者：留下线索。\n行为者：继续巡逻。',
    '',
    null,
    new Date().toISOString()
  );
  upsertConversationNpc(database, userId, conversationId, { npcName: '空甲', source: 'agent', evidence: '助手识别', confidence: 80 });
  upsertConversationNpc(database, userId, conversationId, { npcName: '空乙', source: 'agent', evidence: '助手识别', confidence: 80 });
  addNpcMemory(database, userId, conversationId, '记忆者', { content: '留下线索' });
  addNpcBehavior(database, userId, conversationId, '行为者', {
    behaviorType: 'movement',
    triggerCondition: '夜晚',
    action: '继续巡逻'
  });

  const result = hideEmptyConversationNpcs(database, userId, conversationId, '主角');
  assert.equal(result.count, 2);
  assert.deepEqual(result.hidden.map((npc) => npc.name).sort(), ['空乙', '空甲']);

  const names = listConversationNpcs(database, userId, conversationId, '主角').map((npc) => npc.name);
  assert.ok(!names.includes('空甲'));
  assert.ok(!names.includes('空乙'));
  assert.ok(names.includes('记忆者'));
  assert.ok(names.includes('行为者'));
});

test('hidden NPC state is scoped to a single conversation', () => {
  const { database, userId, character, conversationId } = setupDatabase();
  const secondConversationId = 'conv-npc-2';
  const timestamp = new Date().toISOString();
  database.prepare(
    'INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(secondConversationId, userId, character.id, 'NPC isolation test', timestamp, timestamp);
  database.prepare(
    'INSERT INTO messages (id, user_id, conversation_id, role, content, reasoning, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('msg-isolation-1', userId, conversationId, 'assistant', 'SharedNpc: appears here.', '', null, timestamp);
  database.prepare(
    'INSERT INTO messages (id, user_id, conversation_id, role, content, reasoning, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('msg-isolation-2', userId, secondConversationId, 'assistant', 'SharedNpc: appears there.\nSecondOnly: stays there.', '', null, timestamp);
  upsertConversationNpc(database, userId, conversationId, { npcName: 'SharedNpc', source: 'agent', evidence: 'appears here', confidence: 80 });
  upsertConversationNpc(database, userId, secondConversationId, { npcName: 'SharedNpc', source: 'agent', evidence: 'appears there', confidence: 80 });
  upsertConversationNpc(database, userId, secondConversationId, { npcName: 'SecondOnly', source: 'agent', evidence: 'stays there', confidence: 80 });

  const hidden = hideConversationNpc(database, userId, conversationId, 'SharedNpc');
  assert.equal(hidden.hidden, true);
  assert.ok(!listConversationNpcs(database, userId, conversationId, 'Main').some((npc) => npc.name === 'SharedNpc'));

  const secondNames = listConversationNpcs(database, userId, secondConversationId, 'Main').map((npc) => npc.name);
  assert.ok(secondNames.includes('SharedNpc'));
  assert.ok(secondNames.includes('SecondOnly'));
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
