import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret';

const { createAppDatabase } = await import('../db.js');
const { createTag, listTags } = await import('../modules/tags.js');

test('listTags limits loaded tags after deterministic ordering', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'tag-limit-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    'taglimit',
    'hash',
    new Date().toISOString()
  );

  createTag(database, userId, { name: 'Gamma' });
  createTag(database, userId, { name: 'Alpha' });
  createTag(database, userId, { name: 'Bravo' });

  const limited = listTags(database, userId, { limit: '2' });

  assert.deepEqual(limited.map((tag) => tag.name), ['Alpha', 'Bravo']);
  assert.equal(listTags(database, userId, { limit: 'not-a-number' }).length, 3);
});
