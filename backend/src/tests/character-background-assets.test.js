import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppDatabase } from '../db.js';
import { createCharacter, updateCharacter } from '../modules/characters.js';
import { getAvatarAssetForViewer } from '../services/avatars.js';

function insertUser(database, id) {
  database
    .prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(id, id, 'hash', new Date().toISOString());
}

test('character advanced backgrounds are stored as base64 assets and exposed through short URLs', () => {
  const database = createAppDatabase(':memory:');
  insertUser(database, 'owner-1');
  insertUser(database, 'viewer-1');

  const character = createCharacter(database, 'owner-1', {
    name: 'Background Test',
    authorAdvancedSettings: {
      desktopBackgroundUrl: 'data:image/png;base64,AQID',
      mobileBackgroundUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw='
    }
  });

  assert.match(character.authorAdvancedSettings.desktopBackgroundUrl, /^\/api\/avatars\/[-0-9a-f]+$/);
  assert.match(character.authorAdvancedSettings.mobileBackgroundUrl, /^\/api\/avatars\/[-0-9a-f]+$/);

  const desktopAssetId = character.authorAdvancedSettings.desktopBackgroundUrl.split('/').pop();
  const desktopRow = database.prepare('SELECT * FROM avatar_assets WHERE id = ?').get(desktopAssetId);
  assert.equal(desktopRow.owner_type, 'character-background-desktop');
  assert.equal(desktopRow.owner_id, character.id);
  assert.equal(desktopRow.mime_type, 'image/png');
  assert.equal(desktopRow.base64_data, 'AQID');

  const storedSettings = JSON.parse(
    database.prepare('SELECT author_advanced_settings FROM characters WHERE id = ?').get(character.id).author_advanced_settings
  );
  assert.equal(storedSettings.desktopBackgroundUrl, character.authorAdvancedSettings.desktopBackgroundUrl);

  assert.equal(getAvatarAssetForViewer(database, 'owner-1', desktopAssetId).base64Data, 'AQID');
  assert.equal(getAvatarAssetForViewer(database, 'viewer-1', desktopAssetId), null);

  const publicCharacter = updateCharacter(database, 'owner-1', character.id, {
    visibility: 'public',
    authorAdvancedSettings: character.authorAdvancedSettings
  });
  assert.equal(getAvatarAssetForViewer(database, 'viewer-1', desktopAssetId).base64Data, 'AQID');

  const updated = updateCharacter(database, 'owner-1', character.id, {
    authorAdvancedSettings: {
      ...publicCharacter.authorAdvancedSettings,
      mobileBackgroundUrl: ''
    }
  });
  assert.equal(updated.authorAdvancedSettings.mobileBackgroundUrl, '');
  assert.equal(
    database
      .prepare("SELECT COUNT(*) AS count FROM avatar_assets WHERE owner_type = 'character-background-mobile' AND owner_id = ?")
      .get(character.id).count,
    0
  );
});
