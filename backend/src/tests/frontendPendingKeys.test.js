import assert from 'node:assert/strict';
import test from 'node:test';

const { usePendingKeys } = await import('../../../frontend/src/composables/usePendingKeys.js');

test('usePendingKeys guards duplicate work per key', () => {
  const pending = usePendingKeys();

  assert.equal(pending.start('char-a'), true);
  assert.equal(pending.start('char-a'), false);
  assert.equal(pending.isPending('char-a'), true);

  assert.equal(pending.start('char-b'), true);
  pending.finish('char-a');

  assert.equal(pending.isPending('char-a'), false);
  assert.equal(pending.isPending('char-b'), true);
  assert.equal(pending.start('char-a'), true);

  pending.reset();
  assert.equal(pending.isPending('char-a'), false);
  assert.equal(pending.isPending('char-b'), false);
});

test('usePendingKeys ignores empty keys but accepts numeric zero ids', () => {
  const pending = usePendingKeys();

  assert.equal(pending.start(''), false);
  assert.equal(pending.start(null), false);
  assert.equal(pending.start(undefined), false);

  assert.equal(pending.start(0), true);
  assert.equal(pending.start('0'), false);
  assert.equal(pending.isPending('0'), true);

  pending.finish(0);
  assert.equal(pending.isPending('0'), false);
});
