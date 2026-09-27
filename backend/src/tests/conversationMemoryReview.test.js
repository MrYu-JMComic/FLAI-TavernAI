import assert from 'node:assert/strict';
import test from 'node:test';

import { createAppDatabase } from '../db.js';
import { migrateConversationMemoryReview } from '../db/migrations/0015ConversationMemoryReview.js';
import { createCharacter } from '../modules/characters.js';
import {
  batchReviewConversationMemories,
  ConversationMemoryConflictError,
  createConversationMemory,
  listConversationMemories,
  listConversationMemoryConflictCandidates,
  mergeConversationMemories,
  pinConversationMemory,
  selectConversationMemoryContext,
  undoConversationMemoryMerge,
  updateConversationMemory
} from '../modules/conversationMemories.js';
import { insertUser } from './routeTestUtils.js';

function fixture() {
  const database = createAppDatabase(':memory:');
  migrateConversationMemoryReview(database);
  insertUser(database, 'owner');
  insertUser(database, 'other');
  const character = createCharacter(database, 'owner', { name: 'Mira' });
  const timestamp = new Date().toISOString();
  database.prepare(`INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at)
    VALUES ('conversation', 'owner', ?, 'Story', ?, ?)`).run(character.id, timestamp, timestamp);
  return database;
}

test('conversation memory review pins records and prioritizes pinned context', () => {
  const database = fixture();
  const ordinary = createConversationMemory(database, 'owner', 'conversation', { subject: '普通', content: '普通记忆', confidence: 1 });
  const pinned = createConversationMemory(database, 'owner', 'conversation', { subject: '置顶', content: '置顶记忆', confidence: 0 });
  const updated = pinConversationMemory(database, 'owner', 'conversation', pinned.id, { pinned: true, revision: pinned.revision });
  assert.equal(updated.pinned, true);
  assert.equal(updated.revision, pinned.revision + 1);
  assert.equal(listConversationMemories(database, 'owner', 'conversation')[0].id, pinned.id);
  const selection = selectConversationMemoryContext(database, 'owner', 'conversation', { budgetCharacters: 500 });
  assert.equal(selection.entries[0].id, pinned.id);
  assert.equal(selection.entries[0].pinned, true);
  assert.equal(selection.entries[0].revision, updated.revision);
  assert.equal(selection.entries[0].context, '- event:置顶: 置顶记忆');
  assert.match(selection.pinnedContext, /置顶记忆/);
  assert.doesNotMatch(selection.pinnedContext, /普通记忆/);
  assert.match(selection.unpinnedContext, /普通记忆/);
  assert.throws(() => pinConversationMemory(database, 'owner', 'conversation', ordinary.id, { pinned: true, revision: 99 }), ConversationMemoryConflictError);
  assert.throws(() => pinConversationMemory(database, 'other', 'conversation', pinned.id, { pinned: false, revision: updated.revision }), /不属于/);
});

test('conversation memory selection explains pinned entries omitted by its local budget', () => {
  const database = fixture();
  const pinned = createConversationMemory(database, 'owner', 'conversation', { subject: '重要', content: 'x'.repeat(900) });
  pinConversationMemory(database, 'owner', 'conversation', pinned.id, { pinned: true, revision: pinned.revision });
  const selection = selectConversationMemoryContext(database, 'owner', 'conversation', { budgetCharacters: 300 });
  assert.equal(selection.context, '');
  assert.equal(selection.pinnedContext, '');
  assert.equal(selection.unpinnedContext, '');
  assert.deepEqual(selection.pinnedOmitted.map(({ id, reason }) => ({ id, reason })), [
    { id: pinned.id, reason: 'budget_exceeded' }
  ]);
});

test('conversation memory batch review validates every revision before changing any record', () => {
  const database = fixture();
  const first = createConversationMemory(database, 'owner', 'conversation', { content: 'first', enabled: false, sourceKind: 'auto' });
  const second = createConversationMemory(database, 'owner', 'conversation', { content: 'second', enabled: false, sourceKind: 'auto' });
  assert.throws(() => batchReviewConversationMemories(database, 'owner', 'conversation', {
    action: 'confirm', items: [{ id: first.id, revision: first.revision }, { id: second.id, revision: 999 }]
  }), ConversationMemoryConflictError);
  assert.equal(listConversationMemories(database, 'owner', 'conversation').every((memory) => !memory.enabled), true);
  const confirmed = batchReviewConversationMemories(database, 'owner', 'conversation', {
    action: 'confirm', items: [{ id: first.id, revision: first.revision }, { id: second.id, revision: second.revision }]
  });
  assert.equal(confirmed.every((memory) => memory.enabled), true);
  const invalidated = batchReviewConversationMemories(database, 'owner', 'conversation', {
    action: 'invalidate', items: confirmed.map(({ id, revision }) => ({ id, revision }))
  });
  assert.equal(invalidated.every((memory) => memory.archived && memory.invalidatedAt), true);
});

test('conversation memory conflicts are review candidates based on explicit matching fields', () => {
  const database = fixture();
  createConversationMemory(database, 'owner', 'conversation', { memoryType: 'relationship', subject: 'Mira', content: 'Mira trusts Rowan.' });
  createConversationMemory(database, 'owner', 'conversation', { memoryType: 'relationship', subject: 'Mira', content: 'Mira distrusts Rowan.' });
  createConversationMemory(database, 'owner', 'conversation', { memoryType: 'fact', subject: 'Mira', content: 'Mira is a scout.' });
  const candidates = listConversationMemoryConflictCandidates(database, 'owner', 'conversation');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].reason, 'same_subject_different_content');
  assert.equal(candidates[0].memories.length, 2);
});

test('conversation memory merge preserves source records and can be safely undone', () => {
  const database = fixture();
  const target = createConversationMemory(database, 'owner', 'conversation', { subject: 'Mira', content: 'Mira was cautious.', sourceExcerpt: 'turn 1' });
  const source = createConversationMemory(database, 'owner', 'conversation', { subject: 'Mira', content: 'Mira now trusts Rowan.', sourceExcerpt: 'turn 8' });
  const merged = mergeConversationMemories(database, 'owner', 'conversation', {
    targetId: target.id, targetRevision: target.revision,
    sourceItems: [{ id: source.id, revision: source.revision }], content: 'Mira was cautious and now trusts Rowan.'
  });
  const afterMerge = listConversationMemories(database, 'owner', 'conversation', { includeArchived: true });
  assert.equal(afterMerge.length, 2);
  assert.equal(afterMerge.find((memory) => memory.id === source.id).mergedIntoId, target.id);
  assert.equal(afterMerge.find((memory) => memory.id === source.id).archived, true);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM conversation_memory_review_members WHERE operation_id = ?').get(merged.operationId).count, 2);

  const undone = undoConversationMemoryMerge(database, 'owner', 'conversation', merged.operationId);
  assert.equal(undone.memories.length, 2);
  const restored = listConversationMemories(database, 'owner', 'conversation', { includeArchived: true });
  assert.equal(restored.find((memory) => memory.id === target.id).content, target.content);
  assert.equal(restored.find((memory) => memory.id === source.id).archived, false);
  assert.equal(undone.memories.find((memory) => memory.id === target.id).content, target.content);
  assert.equal(undone.memories.find((memory) => memory.id === source.id).mergedIntoId, null);
});

test('conversation memory merge rolls back its audit rows when validation fails', () => {
  const database = fixture();
  const target = createConversationMemory(database, 'owner', 'conversation', { subject: 'Mira', content: 'target' });
  const source = createConversationMemory(database, 'owner', 'conversation', { subject: 'Mira', content: 'source' });
  assert.throws(() => mergeConversationMemories(database, 'owner', 'conversation', {
    targetId: target.id,
    targetRevision: target.revision,
    sourceItems: [{ id: source.id, revision: source.revision }],
    content: '   '
  }), /合并后的记忆内容不能为空/);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM conversation_memory_review_operations').get().count, 0);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM conversation_memory_review_members').get().count, 0);
  const unchanged = listConversationMemories(database, 'owner', 'conversation', { includeArchived: true });
  assert.equal(unchanged.find((memory) => memory.id === target.id).content, 'target');
  assert.equal(unchanged.find((memory) => memory.id === source.id).archived, false);
});

test('conversation memory merge undo refuses to overwrite a later manual edit', () => {
  const database = fixture();
  const target = createConversationMemory(database, 'owner', 'conversation', { subject: 'Mira', content: 'old target' });
  const source = createConversationMemory(database, 'owner', 'conversation', { subject: 'Mira', content: 'source' });
  const merged = mergeConversationMemories(database, 'owner', 'conversation', {
    targetId: target.id, targetRevision: target.revision,
    sourceItems: [{ id: source.id, revision: source.revision }], content: 'merged'
  });
  updateConversationMemory(database, 'owner', 'conversation', target.id, { content: 'manual correction' });
  assert.throws(() => undoConversationMemoryMerge(database, 'owner', 'conversation', merged.operationId), ConversationMemoryConflictError);
  assert.equal(listConversationMemories(database, 'owner', 'conversation', { includeArchived: true }).find((memory) => memory.id === target.id).content, 'manual correction');
});
