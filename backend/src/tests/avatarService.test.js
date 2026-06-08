import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createAppDatabase } from '../db.js';
import { avatarShortUrl, saveAvatarInput } from '../services/avatars.js';

const avatarServiceSource = readFileSync(new URL('../services/avatars.js', import.meta.url), 'utf8');

function insertUser(database, id) {
  database
    .prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(id, id, 'hash', new Date().toISOString());
}

function insertAvatarAsset(database, { id, userId, ownerType, ownerId }) {
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO avatar_assets (
        id, user_id, owner_type, owner_id, mime_type, base64_data, byte_size, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, userId, ownerType, ownerId, 'image/png', 'AQID', 3, now, now);
}

test('avatar short URL reuse parses a single asset-id segment without path splitting', () => {
  const database = createAppDatabase(':memory:');
  insertUser(database, 'owner-1');
  insertAvatarAsset(database, {
    id: 'avatar-asset-1',
    userId: 'owner-1',
    ownerType: 'user',
    ownerId: 'owner-1'
  });
  insertAvatarAsset(database, {
    id: 'nested',
    userId: 'owner-1',
    ownerType: 'character',
    ownerId: 'character-1'
  });

  assert.equal(
    saveAvatarInput(database, {
      userId: 'owner-1',
      ownerType: 'user',
      ownerId: 'owner-1',
      value: avatarShortUrl('avatar-asset-1')
    }),
    avatarShortUrl('avatar-asset-1')
  );
  assert.equal(
    saveAvatarInput(database, {
      userId: 'owner-1',
      ownerType: 'user',
      ownerId: 'owner-1',
      value: '/api/avatars/prefix/nested'
    }),
    '/api/avatars/prefix/nested'
  );
  assert.match(avatarServiceSource, /function getAvatarShortUrlAssetId\(input\) \{/);
  assert.doesNotMatch(avatarServiceSource, /input\.split\('\/'\)\.pop\(\)/);
});
