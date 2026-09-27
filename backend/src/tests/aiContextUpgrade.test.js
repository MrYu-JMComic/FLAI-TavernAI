import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppDatabase } from '../db.js';
import { createCharacter } from '../modules/characters.js';
import { createConversationMemory, selectConversationMemoryContext } from '../modules/conversationMemories.js';
import { buildModPromptSections, createMod } from '../modules/mods.js';
import { createEntry, createWorldBook, injectAtDepthEntries, matchWorldBookEntries } from '../modules/worldBooks.js';
import { applyPromptBudget, buildPromptPipeline } from '../services/promptPipeline.js';
import { buildConversationContextPreview } from '../services/contextPreview.js';
import { insertUser } from './routeTestUtils.js';

function fixture(t) {
  const database = createAppDatabase(':memory:');
  t.after(() => database.close());
  const user = { id: 'context-user', username: 'context-user' };
  insertUser(database, user.id);
  const character = createCharacter(database, user.id, { name: 'Context Character', persona: 'CHARACTER_SENTINEL' });
  const conversation = { id: 'context-conversation', userId: user.id, characterId: character.id };
  const timestamp = new Date().toISOString();
  database.prepare('INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(conversation.id, user.id, character.id, 'Context test', timestamp, timestamp);
  return { database, user, character, conversation };
}

test('budget preserves full current multimodal input and reports an impossible budget', () => {
  const content = [{ type: 'text', text: 'X'.repeat(2000) + ' KEEP_THIS_END' }, { type: 'image_url', image_url: { url: 'https://image.test/picture.png' } }];
  const result = applyPromptBudget([
    { role: 'system', content: 'CONTRACT' },
    { role: 'user', content: 'old'.repeat(500) },
    { role: 'assistant', content: 'old reply' },
    { role: 'user', content }
  ], 1000);
  assert.deepEqual(result.messages.at(-1).content, content);
  assert.equal(result.budget.overBudget, true);
  assert.equal(result.budget.overflowCharacters, result.budget.characters - 1000);
  assert.equal(result.budget.imageParts, 1);
  assert.equal(result.messages.length, 2);
});

test('budget removes optional mods before history and keeps lore from splitting an exchange', () => {
  const mod = { role: 'system', content: 'MOD'.repeat(400), _promptContext: { section: 'mods', priority: 10, sourceId: 'mod-1' } };
  const lore = { role: 'user', content: 'LORE', _promptContext: { section: 'worldBook', priority: 50 } };
  const messages = [
    { role: 'system', content: 'CONTRACT' }, mod,
    { role: 'user', content: 'old question' }, lore,
    { role: 'assistant', content: 'old answer' },
    { role: 'user', content: 'latest' }
  ];
  const result = applyPromptBudget(messages, 1000);
  assert.ok(result.messages.some((message) => message.content === 'old answer'));
  assert.equal(result.budget.sections.mods.keptCharacters, 0);
  assert.equal(result.budget.truncation[0].sourceId, 'mod-1');
  assert.ok(result.messages.every((message) => !Object.hasOwn(message, '_promptContext')));
  messages[2].content = 'old question'.repeat(200);
  const trimmed = applyPromptBudget(messages, 1000);
  assert.ok(!trimmed.messages.some((message) => message.content === 'old answer'));
  assert.ok(trimmed.messages.some((message) => message.content === 'LORE'));
});

test('world book depth insertions share the original tail and preserve same-depth order', () => {
  const messages = ['system', 'u1', 'a1', 'u2'].map((content) => ({ role: 'system', content }));
  const entries = [
    { position: 'at_depth', depth: 1, content: 'd1a', role: 1 },
    { position: 'at_depth', depth: 1, content: 'd1b', role: 2 },
    { position: 'at_depth', depth: 2, content: 'd2' },
    { position: 'at_depth', depth: 0, content: 'd0' }
  ];
  injectAtDepthEntries(messages, entries);
  assert.deepEqual(messages.map((message) => message.content), ['system', 'u1', 'd2', 'a1', 'd1a', 'd1b', 'u2', 'd0']);
  assert.equal(messages[4].role, 'user');
  assert.equal(messages[5].role, 'assistant');
});

test('each world book keeps its own scan depth and oversized entries do not starve later lore', (t) => {
  const { database, user, character } = fixture(t);
  const shallow = createWorldBook(database, user.id, { name: 'Shallow', characterId: character.id, scanDepth: 1 });
  const deep = createWorldBook(database, user.id, { name: 'Deep', characterId: character.id, scanDepth: 2 });
  createEntry(database, user.id, shallow.id, { name: 'Old shallow', triggerKeys: 'ancient', content: 'Shallow content' });
  const expected = createEntry(database, user.id, deep.id, { name: 'Old deep', triggerKeys: 'ancient', content: 'Deep content' });
  const matches = matchWorldBookEntries(database, character.id, ['ancient', 'current'], { persistState: false });
  assert.deepEqual(matches.map((entry) => entry.id), [expected.id]);
  const large = createEntry(database, user.id, shallow.id, { name: 'Large', content: 'X'.repeat(2000), alwaysActive: true, sticky: 3 });
  const small = createEntry(database, user.id, shallow.id, { name: 'Small', content: 'Useful lore.', alwaysActive: true });
  const budgeted = matchWorldBookEntries(database, character.id, ['current'], { contextSize: 1000, lorebookContextPercent: 10 });
  assert.deepEqual(budgeted.map((entry) => entry.id), [small.id]);
  assert.equal(database.prepare('SELECT was_active FROM world_book_entry_state WHERE entry_id = ?').get(large.id).was_active, 0);
});

test('memory selection recalls older relevant evidence within a bounded whole-entry budget', (t) => {
  const { database, user, conversation } = fixture(t);
  const relevant = createConversationMemory(database, user.id, conversation.id, { content: 'Mira found the silver key.', sourceMessageId: 'source-turn' });
  for (let index = 0; index < 30; index += 1) {
    createConversationMemory(database, user.id, conversation.id, { content: `Unrelated event ${index}.` });
  }
  createConversationMemory(database, user.id, conversation.id, { content: 'silver key '.repeat(400) });
  createConversationMemory(database, user.id, conversation.id, { content: 'Pending silver key candidate.', sourceKind: 'auto', enabled: false });
  const selected = selectConversationMemoryContext(database, user.id, conversation.id, { query: 'silver key', budgetCharacters: 600 });
  assert.equal(selected.entries[0].id, relevant.id);
  assert.equal(selected.entries[0].sourceMessageId, 'source-turn');
  assert.ok(selected.context.length <= 600);
  assert.ok(selected.omitted > 0);
  assert.doesNotMatch(selected.context, /Pending/);
  assert.equal(selectConversationMemoryContext(database, 'other-user', conversation.id).context, '');
});

test('prompt pipeline respects lore positions and budgets each source without sending internal metadata', (t) => {
  const { database, user, character, conversation } = fixture(t);
  const book = createWorldBook(database, user.id, { name: 'Positions', characterId: character.id });
  for (const position of ['at_start', 'before_char', 'after_char', 'at_depth']) {
    createEntry(database, user.id, book.id, { name: position, content: `LORE_${position}`, position, depth: 0, role: 1, alwaysActive: true });
  }
  createMod(database, user.id, { name: 'Tone', type: 'style_enhance', content: 'MOD_SENTINEL' });
  const pipeline = buildPromptPipeline(database, { user, character, conversation, content: 'CURRENT_SENTINEL', persistWorldBookState: false });
  const texts = pipeline.messages.map((message) => String(message.content));
  const characterIndex = texts.findIndex((text) => text.includes('CHARACTER_SENTINEL'));
  assert.ok(texts.findIndex((text) => text.includes('LORE_before_char')) < characterIndex);
  assert.ok(texts.findIndex((text) => text.includes('LORE_after_char')) > characterIndex);
  for (const position of ['at_start', 'before_char', 'after_char', 'at_depth']) {
    assert.equal(texts.filter((text) => text.includes(`LORE_${position}`)).length, 1);
  }
  assert.ok(pipeline.sections.mods.budget.keptCharacters > 0);
  assert.ok(pipeline.messages.every((message) => !Object.hasOwn(message, '_promptContext')));
  const minimal = buildPromptPipeline(database, { user, character, conversation, content: 'CURRENT_SENTINEL'.repeat(200), contextBudgetCharacters: 1000, persistWorldBookState: false });
  assert.ok(minimal.messages.some((message) => message.content === 'CURRENT_SENTINEL'.repeat(200)));
  assert.equal(minimal.sections.mods.budget.keptCharacters, 0);
  assert.equal(minimal.budget.overBudget, true);
  const preview = buildConversationContextPreview(database, user, conversation.id, { content: 'silver key' });
  assert.equal(preview.retrieval.query, 'silver key');
});

test('mod prompt sections ignore disabled, blank, and repeated IDs while retaining order', () => {
  const sections = buildModPromptSections([
    { id: 'a', name: 'A', type: 'prompt_inject', content: 'A' },
    { id: 'a', name: 'Duplicate', content: 'duplicate' },
    { id: 'b', enabled: false, content: 'disabled' },
    { id: 'c', content: ' ' },
    { id: 'd', name: 'D', type: 'style_enhance', content: 'D' }
  ]);
  assert.deepEqual(sections.map((entry) => entry.id), ['a', 'd']);
  assert.equal(buildModPromptSections(null).length, 0);
});

test('world book state is committed only for entries retained by the final prompt budget', (t) => {
  const { database, user, character, conversation } = fixture(t);
  const book = createWorldBook(database, user.id, { name: 'Budget state', characterId: character.id });
  const entry = createEntry(database, user.id, book.id, { name: 'Sticky', content: 'Small lore.', alwaysActive: true, sticky: 3 });
  const pipeline = buildPromptPipeline(database, { user, character, conversation, content: 'Current request.', contextBudgetCharacters: 1000 });
  assert.equal(pipeline.worldBookEntries.length, 0);
  assert.equal(pipeline.worldBookMatches.length, 0);
  assert.equal(pipeline.priority.activeContext.includes('world_book'), false);
  const state = database.prepare('SELECT was_active, sticky_remaining FROM conversation_world_book_state WHERE conversation_id = ? AND entry_id = ?').get(conversation.id, entry.id);
  assert.equal(state.was_active, 0);
  assert.equal(state.sticky_remaining, 0);
});

test('memory retrieval finds confirmed evidence older than the recent candidate window', (t) => {
  const { database, user, conversation } = fixture(t);
  const old = createConversationMemory(database, user.id, conversation.id, { content: 'The obsidian compass points to Silver Harbor.' });
  for (let index = 0; index < 220; index += 1) {
    createConversationMemory(database, user.id, conversation.id, { content: `Unrelated recent event ${index}.` });
  }
  createConversationMemory(database, user.id, conversation.id, { content: 'Pending obsidian compass.', enabled: false });
  const selected = selectConversationMemoryContext(database, user.id, conversation.id, { query: 'obsidian compass', budgetCharacters: 700 });
  assert.equal(selected.entries[0].id, old.id);
  assert.ok(selected.retrieved > 0);
  assert.doesNotMatch(selected.context, /Pending/);
});
