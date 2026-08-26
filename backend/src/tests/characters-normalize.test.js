import assert from 'node:assert/strict';
import test from 'node:test';

const { createAppDatabase } = await import('../db.js');
const { createCharacter, getCharacter } = await import('../modules/characters.js');

test('character persistence preserves content within API field limits', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'long-character-content-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    'longcharacter',
    'hash',
    new Date().toISOString()
  );
  const content = {
    background: '背'.repeat(9_000),
    worldview: '界'.repeat(9_100),
    persona: '人'.repeat(9_200),
    openingMessage: '开'.repeat(4_500)
  };

  const character = createCharacter(database, userId, {
    name: 'Long Content',
    ...content
  });
  const reloaded = getCharacter(database, userId, character.id);

  assert.equal(reloaded.background, content.background);
  assert.equal(reloaded.worldview, content.worldview);
  assert.equal(reloaded.persona, content.persona);
  assert.equal(reloaded.openingMessage, content.openingMessage);
});

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

test('character reads drop unsafe legacy render plugin patterns', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'plugin-legacy-user',
    'pluginlegacy',
    'hash',
    new Date().toISOString()
  );
  const character = createCharacter(database, 'plugin-legacy-user', {
    name: 'Legacy Plugin Guard'
  });
  database.prepare('UPDATE characters SET render_plugins = ? WHERE id = ?').run(
    JSON.stringify([{ label: 'Unsafe legacy plugin', pattern: '(a+)+$', enabled: true }]),
    character.id
  );

  const reloaded = getCharacter(database, 'plugin-legacy-user', character.id);
  assert.deepEqual(reloaded.renderPlugins, []);
});
