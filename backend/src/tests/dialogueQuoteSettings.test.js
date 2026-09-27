import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppDatabase } from '../db/runtime.js';
import { createCharacter } from '../modules/characters.js';
import { normalizeAdvancedSettings, mergeAdvancedSettings } from '../modules/advancedSettings.js';
import { getConversationAppearance, normalizeConversationAppearance, saveConversationAppearance } from '../modules/conversationAppearance.js';
import { saveConversationSettingsSchema } from '../validations/schemas.js';
import { createDefaultChatAppearance, normalizeChatAppearance, mergeChatAppearance } from '../../../frontend/src/utils/chatAppearance.js';

test('dialogue coloring defaults on and normalizes explicit false in all appearance layers', () => {
  assert.equal(createDefaultChatAppearance().highlightDialogue, true);
  for (const normalize of [normalizeChatAppearance, normalizeAdvancedSettings, normalizeConversationAppearance]) {
    assert.equal(normalize({}).highlightDialogue, true);
    assert.equal(normalize({ highlightDialogue: false }).highlightDialogue, false);
    assert.equal(normalize({ highlightDialogue: 'false' }).highlightDialogue, false);
    assert.equal(normalize({ highlight_dialogue: 'false' }).highlightDialogue, false);
    assert.equal(normalize({ highlightDialogue: true }).highlightDialogue, true);
  }
  for (const merge of [mergeChatAppearance, mergeAdvancedSettings]) {
    assert.equal(merge({}, {}).highlightDialogue, true);
    assert.equal(merge({ highlightDialogue: false }, {}).highlightDialogue, false);
    assert.equal(merge({ highlightDialogue: true }, { highlightDialogue: false }).highlightDialogue, false);
    assert.equal(merge({ highlightDialogue: false }, { highlightDialogue: true }).highlightDialogue, true);
  }
  assert.equal(saveConversationSettingsSchema.parse({ highlightDialogue: 'false' }).highlightDialogue, false);
  assert.equal(saveConversationSettingsSchema.parse({}).highlightDialogue, undefined);
});

test('dialogue coloring round-trips and older clients do not reset the preference', () => {
  const db = createAppDatabase(':memory:');
  try {
    const now = new Date().toISOString();
    db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .run('quote-user', 'quote-user', 'hash', now);
    const character = createCharacter(db, 'quote-user', { name: 'Quote settings' });
    db.prepare('INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('quote-chat', 'quote-user', character.id, 'Quote settings', now, now);
    assert.equal(getConversationAppearance(db, 'quote-user', 'quote-chat').highlightDialogue, true);
    saveConversationAppearance(db, 'quote-user', 'quote-chat', { highlightDialogue: false });
    assert.equal(getConversationAppearance(db, 'quote-user', 'quote-chat').highlightDialogue, false);
    saveConversationAppearance(db, 'quote-user', 'quote-chat', saveConversationSettingsSchema.parse({ customCss: '.test {}' }));
    assert.equal(getConversationAppearance(db, 'quote-user', 'quote-chat').highlightDialogue, false);
    saveConversationAppearance(db, 'quote-user', 'quote-chat', null);
    assert.equal(getConversationAppearance(db, 'quote-user', 'quote-chat').highlightDialogue, false);
    assert.equal(getConversationAppearance(db, 'other-user', 'quote-chat'), null);
    assert.equal(saveConversationAppearance(db, 'other-user', 'quote-chat', { highlightDialogue: true }), null);
    saveConversationAppearance(db, 'quote-user', 'quote-chat', { highlightDialogue: true });
    assert.equal(getConversationAppearance(db, 'quote-user', 'quote-chat').highlightDialogue, true);
  } finally {
    db.close();
  }
});
