import assert from 'node:assert/strict';
import test from 'node:test';

const { appendAiToolList, cloneAiToolList } = await import('../../../frontend/src/utils/aiToolLists.js');

test('AI tool-list helper clones arrays without mutating the source list', () => {
  const sourceTools = [{ name: 'lookup' }, { name: 'write' }];
  const clonedTools = cloneAiToolList(sourceTools);

  assert.deepEqual(clonedTools, sourceTools);
  assert.notEqual(clonedTools, sourceTools);

  clonedTools.push({ name: 'extra' });
  assert.equal(sourceTools.length, 2);
});

test('AI tool-list helper treats non-array sources as empty lists before appending', () => {
  const log = { name: 'search' };

  assert.deepEqual(cloneAiToolList(null), []);
  assert.deepEqual(appendAiToolList(null, log), [log]);
});

test('AI tool-list helper appends logs without replacing existing entries', () => {
  const first = { name: 'first' };
  const second = { name: 'second' };
  const sourceTools = [first];
  const nextTools = appendAiToolList(sourceTools, second);

  assert.deepEqual(nextTools, [first, second]);
  assert.notEqual(nextTools, sourceTools);
  assert.deepEqual(sourceTools, [first]);
});
