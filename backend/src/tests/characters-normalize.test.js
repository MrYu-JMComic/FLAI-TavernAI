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
        replacement: 'dog',
        enabled: 'false',
        scriptMode: 'false',
        priority: 'Infinity'
      }
    ]
  });

  assert.equal(character.regexRules.length, 1);
  assert.equal(character.regexRules[0].label, 'Valid rule');
  assert.equal(character.regexRules[0].pattern, 'cat');
  assert.equal(character.regexRules[0].enabled, false);
  assert.equal(character.regexRules[0].scriptMode, false);
  assert.equal(character.regexRules[0].priority, 0);
});

test('character regex rule cap counts normalized rule objects only', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'regex-cap-user',
    'regexcap',
    'hash',
    new Date().toISOString()
  );

  const regexRules = [null, 'ignored'];
  for (let index = 0; index < 42; index += 1) {
    regexRules.push({
      label: `Rule ${index}`,
      pattern: `rule-${index}`,
      replacement: `replacement-${index}`
    });
  }

  const character = createCharacter(database, 'regex-cap-user', {
    name: 'Regex Cap',
    regexRules
  });

  assert.equal(character.regexRules.length, 40);
  assert.equal(character.regexRules[0].pattern, 'rule-0');
  assert.equal(character.regexRules[39].pattern, 'rule-39');
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
        titleTemplate: 'Animal',
        enabled: 'false'
      }
    ]
  });

  assert.equal(character.renderPlugins.length, 1);
  assert.equal(character.renderPlugins[0].label, 'Valid plugin');
  assert.equal(character.renderPlugins[0].pattern, 'cat');
  assert.equal(character.renderPlugins[0].enabled, false);
});

test('character render plugin cap counts patterned plugins only', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'plugin-cap-user',
    'plugincap',
    'hash',
    new Date().toISOString()
  );

  const renderPlugins = [null, {}, { label: 'Empty plugin', pattern: '' }];
  for (let index = 0; index < 22; index += 1) {
    renderPlugins.push({
      label: `Plugin ${index}`,
      pattern: `plugin-${index}`,
      titleTemplate: `Plugin ${index}`
    });
  }

  const character = createCharacter(database, 'plugin-cap-user', {
    name: 'Plugin Cap',
    renderPlugins
  });

  assert.equal(character.renderPlugins.length, 20);
  assert.equal(character.renderPlugins[0].pattern, 'plugin-0');
  assert.equal(character.renderPlugins[19].pattern, 'plugin-19');
});
