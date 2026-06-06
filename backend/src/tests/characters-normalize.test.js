import assert from 'node:assert/strict';
import test from 'node:test';

const { createAppDatabase } = await import('../db.js');
const { createCharacter } = await import('../modules/characters.js');

test('character regex rules skip null items during normalization', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'regex-null-user',
    'regexnull',
    'hash',
    new Date().toISOString()
  );

  const character = createCharacter(database, 'regex-null-user', {
    name: 'Regex Guard',
    regexRules: [
      null,
      {
        label: 'Valid rule',
        pattern: 'cat',
        replacement: 'dog'
      }
    ]
  });

  assert.equal(character.regexRules.length, 1);
  assert.equal(character.regexRules[0].label, 'Valid rule');
  assert.equal(character.regexRules[0].pattern, 'cat');
});

test('character render plugins skip null items during normalization', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'plugin-null-user',
    'pluginnull',
    'hash',
    new Date().toISOString()
  );

  const character = createCharacter(database, 'plugin-null-user', {
    name: 'Plugin Guard',
    renderPlugins: [
      null,
      {
        label: 'Valid plugin',
        pattern: 'cat',
        titleTemplate: 'Animal'
      }
    ]
  });

  assert.equal(character.renderPlugins.length, 1);
  assert.equal(character.renderPlugins[0].label, 'Valid plugin');
  assert.equal(character.renderPlugins[0].pattern, 'cat');
});
