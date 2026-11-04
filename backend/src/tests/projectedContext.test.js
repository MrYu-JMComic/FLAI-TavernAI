import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppDatabase } from '../db/runtime.js';
import { createCharacter } from '../modules/characters.js';
import { upsertStatusBar } from '../modules/statusBars.js';
import { buildSceneContext } from '../modules/scenes.js';
import { writeConversationCheckpoint } from '../repositories/conversationSnapshotRepository.js';
import { openProjectedContext } from '../repositories/projectedContextRepository.js';
import { buildResolvedPromptPipeline } from '../services/resolvedPromptPipeline.js';
import { buildConversationContextPreview } from '../services/contextPreview.js';
import { mergeAdvancedSettings } from '../modules/advancedSettings.js';
import { createWorldBook, createEntry } from '../services/worldBooks/worldBookService.js';
import { replaceMessageWithAlternative } from '../modules/swipes.js';
import { withSavepoint } from '../modules/savepoint.js';
import { commitMemoryPacket } from '../services/conversationMemory/commit.js';
import { readMemoryWorkbench } from '../services/conversationMemory/workbench.js';

function fixture() {
  const database = createAppDatabase(':memory:');
  database.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES('owner','owner','hash','now')").run();
  const skills = { sceneAgent: { enabled: true }, economyAgent: { enabled: true } };
  const character = createCharacter(database, 'owner', { name: '岚', authorAdvancedSettings: { accessorySkills: skills } });
  database.prepare(`INSERT INTO conversations(id,user_id,character_id,title,state_status,user_advanced_settings,created_at,updated_at)
    VALUES('story','owner',?,'旧城','ready',?,'now','now')`).run(character.id, JSON.stringify({ accessorySkills: skills }));
  const conversation = { id: 'story', userId: 'owner', characterId: character.id, timelineRevision: 1,
    settings: mergeAdvancedSettings(character.authorAdvancedSettings, { accessorySkills: skills }, { allowAuthorDangerous: true }) };
  const message = (id, role, content, createdAt) => database.prepare(`INSERT INTO messages(id,user_id,conversation_id,role,content,created_at) VALUES(?,'owner','story',?,?,?)`).run(id, role, content, createdAt);
  return { database, character, conversation, user: { id: 'owner', username: 'owner' }, message };
}

test('as-of compilation reads checkpoint status, scene and economy without live restoration or cache contamination', async () => {
  const f = fixture();
  const { database, message, user, conversation, character } = f;
  try {
    message('u1', 'user', '进入旧城', '2026-01-01T00:00:01Z');
    message('a1', 'assistant', '岚走进旧城', '2026-01-01T00:00:02Z');
    upsertStatusBar(database, 'owner', 'story', { name: '体力', variables: [{ name: 'HP', value: 80 }] });
    database.prepare("INSERT INTO scene_nodes(id,conversation_id,node_type,name,created_at,updated_at) VALUES('place','story','main_scene','旧城','now','now')").run();
    database.prepare("INSERT INTO economy_accounts(id,user_id,conversation_id,currency_type,balance,created_at,updated_at) VALUES('coins','owner','story','gold',40,'now','now')").run();
    const checkpoint = writeConversationCheckpoint(database, 'owner', 'story', { throughMessageId: 'a1' });
    message('u2', 'user', '继续', '2026-01-01T00:00:03Z');
    message('a2', 'assistant', '未来回复不能出现', '2026-01-01T00:00:04Z');
    upsertStatusBar(database, 'owner', 'story', { name: '体力', variables: [{ name: 'HP', value: 1 }] });
    database.prepare("UPDATE scene_nodes SET name='未来遗迹' WHERE id='place'").run();
    database.prepare("UPDATE economy_accounts SET balance=0 WHERE id='coins'").run();
    const cachedFuture = buildSceneContext(database, 'owner', 'story');
    assert.match(cachedFuture, /未来遗迹/);
    const currentBefore = JSON.stringify(database.prepare('SELECT * FROM conversations').all());
    const result = await buildResolvedPromptPipeline(database, { user, character, conversation, history: [
      { id: 'u1', role: 'user', content: '进入旧城' }, { id: 'a1', role: 'assistant', content: '岚走进旧城' },
      { id: 'u2', role: 'user', content: '继续' }, { id: 'a2', role: 'assistant', content: '未来回复不能出现' }
    ], content: '', appendUserMessage: false, asOfMessageId: 'a2', beforeCutoff: true, persistWorldBookState: false });
    assert.equal(result.diagnostics.stateProjection.checkpointId, checkpoint);
    assert.match(result.sections.statusBar.context, /HP: 80/);
    assert.match(result.sections.scene.context, /旧城/);
    assert.doesNotMatch(result.sections.scene.context, /未来遗迹/);
    assert.match(result.sections.economy.context, /gold: 40/);
    assert.equal(result.messages.some((row) => String(row.content).includes('未来回复不能出现')), false);
    assert.equal(database.prepare("SELECT balance FROM economy_accounts WHERE id='coins'").get().balance, 0);
    assert.equal(buildSceneContext(database, 'owner', 'story'), cachedFuture);
    assert.equal(JSON.stringify(database.prepare('SELECT * FROM conversations').all()), currentBefore);
    const preview = await buildConversationContextPreview(database, user, 'story', { asOfMessageId: 'a2', beforeCutoff: true, content: '继续' });
    assert.equal(preview.diagnostics.stateProjection.checkpointId, checkpoint);
    assert.match(preview.sections.economy.context, /gold: 40/);
    assert.deepEqual(preview.retrieval.evidence, preview.sections.memory.entries);
  } finally { database.close(); }
});

test('historical views fail closed without a checkpoint and exposed projections cannot be written', async () => {
  const f = fixture();
  try {
    f.message('u1', 'user', '过去', '2026-01-01T00:00:01Z');
    await assert.rejects(buildResolvedPromptPipeline(f.database, { ...f, asOfMessageId: 'u1' }), { code: 'CONTEXT_CHECKPOINT_REQUIRED', accepted: false });
    writeConversationCheckpoint(f.database, 'owner', 'story', { throughMessageId: 'u1' });
    const projection = openProjectedContext(f.database, 'owner', 'story', { asOfMessageId: 'u1' });
    try {
      assert.throws(() => projection.database.prepare("DELETE FROM conversations").run(), /readonly/i);
      assert.equal(f.database.prepare('SELECT COUNT(*) AS count FROM conversations').get().count, 1);
    } finally { projection.dispose(); }
  } finally { f.database.close(); }
});

test('historical compilation pins the checkpoint commit before a later correction at the same message order', async () => {
  const { database, message, user, conversation, character } = fixture();
  try {
    message('a1', 'assistant', '钥匙原本放在阁楼。', '2026-01-01T00:00:01Z');
    const first = commitMemoryPacket(database, 'owner', 'story', { messageId: 'a1', sources: [{ messageId: 'a1', revision: 1 }],
      events: [{ key: 'key', content: '钥匙在阁楼', kind: 'event', truthStatus: 'established', evidence: [{ messageId: 'a1', quote: '钥匙原本放在阁楼' }] }] });
    writeConversationCheckpoint(database, 'owner', 'story', { throughMessageId: 'a1' });
    const correction = commitMemoryPacket(database, 'owner', 'story', {
      events: [{ key: 'corrected-key', content: '钥匙在地窖', kind: 'event', truthStatus: 'established', supersedesId: first.eventIds[0] }]
    }, { kind: 'author_correction' });
    assert.equal(first.coreOrder, correction.coreOrder);
    const options = { user, conversation, character, history: [], content: '钥匙在哪', persistWorldBookState: false };
    const historical = await buildResolvedPromptPipeline(database, { ...options, asOfMessageId: 'a1' });
    assert.equal(historical.contextBundle.source.commitId, first.commitId);
    assert.equal(historical.contextBundle.memory.state.revision,first.revision);
    assert.equal(historical.contextBundle.memory.state.core_commit_id,first.commitId);
    assert.match(historical.sections.memory.context, /阁楼/);
    assert.doesNotMatch(historical.sections.memory.context, /地窖/);
    const workbench=readMemoryWorkbench(database,'owner','story',{asOfMessageId:'a1'});
    assert.equal(workbench.events[0].id,first.eventIds[0]);
    assert.match(workbench.events[0].content,/阁楼/);
    const current = await buildResolvedPromptPipeline(database, options);
    assert.equal(current.contextBundle.source.commitId, correction.commitId);
    assert.match(current.sections.memory.context, /地窖/);
    assert.doesNotMatch(current.sections.memory.context, /阁楼/);
  } finally { database.close(); }
});

test('regeneration stages budget-selected lore against its checkpoint and applies it only with the accepted replacement', async () => {
  const f = fixture();
  const { database, message, user, conversation, character } = f;
  try {
    const book = createWorldBook(database, 'owner', { name: '旧城规则', characterId: character.id });
    const lore = createEntry(database, 'owner', book.id, { name: '门卫', content: '门卫只知公开规则。', alwaysActive: true, sticky: 3 });
    message('u1', 'user', '进入旧城', '2026-01-01T00:00:01Z');
    message('a1', 'assistant', '岚进入旧城', '2026-01-01T00:00:02Z');
    const checkpoint = writeConversationCheckpoint(database, 'owner', 'story', { throughMessageId: 'a1' });
    message('u2', 'user', '询问门卫', '2026-01-01T00:00:03Z');
    message('a2', 'assistant', '原来的候选', '2026-01-01T00:00:04Z');
    database.prepare("INSERT INTO conversation_world_book_clock(conversation_id,message_count) VALUES('story',7)").run();
    const pipeline = await buildResolvedPromptPipeline(database, { user, character, conversation,
      asOfMessageId: 'a2', beforeCutoff: true, history: [{ id: 'u2', role: 'user', content: '询问门卫' }],
      appendUserMessage: false
    });
    assert.equal(pipeline.loreTransition.checkpointId, checkpoint);
    assert.equal(pipeline.loreTransition.state.messageCount, 1);
    assert.equal(pipeline.loreTransition.state.entries.find((entry) => entry.entry_id === lore.id).sticky_remaining, 2);
    assert.equal(database.prepare("SELECT message_count FROM conversation_world_book_clock WHERE conversation_id='story'").get().message_count, 7);
    const original = database.prepare("SELECT * FROM messages WHERE id='a2'").get();
    const bad = { ...pipeline.loreTransition, checkpointId: 'another-checkpoint' };
    assert.throws(() => withSavepoint(database, 'invalid_lore_candidate', () => replaceMessageWithAlternative(database, 'owner', original,
      { content: '无效候选' }, { loreTransition: bad })), { code: 'LORE_TRANSITION_STALE' });
    assert.equal(database.prepare("SELECT content FROM messages WHERE id='a2'").get().content, '原来的候选');
    withSavepoint(database, 'accept_lore_candidate', () => replaceMessageWithAlternative(database, 'owner', original,
      { content: '门卫讲述公开规则。' }, { loreTransition: pipeline.loreTransition }));
    assert.equal(database.prepare("SELECT message_count FROM conversation_world_book_clock WHERE conversation_id='story'").get().message_count, 1);
    const job = database.prepare("SELECT payload_json FROM jobs WHERE conversation_id='story' ORDER BY created_at DESC LIMIT 1").get();
    assert.equal(JSON.parse(job.payload_json).replayLore, false);
    const state = database.prepare("SELECT sticky_remaining FROM conversation_world_book_state WHERE conversation_id='story' AND entry_id=?").get(lore.id);
    assert.equal(state.sticky_remaining, 2);
  } finally { database.close(); }
});
