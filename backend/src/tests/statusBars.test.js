import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createAppDatabase } from '../db.js';
import { upsertStatusBar } from '../modules/statusBars.js';

const statusBarsSource = readFileSync(new URL('../modules/statusBars.js', import.meta.url), 'utf8');

function setupConversation(database) {
  const now = new Date().toISOString();
  database
    .prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('status-user-1', 'status-user', 'hash', now);
  database
    .prepare(
      `INSERT INTO characters (
        id, user_id, name, gender, age, background, worldview, persona, opening_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run('status-character-1', 'status-user-1', 'Status Character', '', '', '', '', '', '', now, now);
  database
    .prepare('INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('status-conversation-1', 'status-user-1', 'status-character-1', 'Status Conversation', now, now);
}

test('status bar template placeholders parse property suffixes without split arrays', () => {
  const database = createAppDatabase(':memory:');
  setupConversation(database);

  const statusBar = upsertStatusBar(database, 'status-user-1', 'status-conversation-1', {
    name: 'Vitals',
    template: '{{ HP.max }} {{ Mood.text.value }} {Focus.color}',
    variables: []
  });

  assert.deepEqual(
    statusBar.variables.map((variable) => ({
      name: variable.name,
      value: variable.value,
      max: variable.max
    })),
    [
      { name: 'HP', value: 0, max: 100 },
      { name: 'Mood', value: '', max: undefined },
      { name: 'Focus', value: 0, max: 100 }
    ]
  );
  assert.match(statusBarsSource, /from '..\/..\/..\/shared\/statusTemplateTokens\.js'/);
  assert.match(
    statusBarsSource,
    /function inferTemplateVariables\(template, variables = \[\]\) \{[\s\S]*const inferred = \[\.\.\.variables\];[\s\S]*const seen = collectVariableKeys\(inferred\);/
  );
  assert.match(
    statusBarsSource,
    /function collectVariableKeys\(variables = \[\]\) \{\s*const keys = new Set\(\);\s*for \(const item of Array\.isArray\(variables\) \? variables : \[\]\) \{\s*keys\.add\(normalizeVariableKey\(item\?\.name\)\);\s*\}\s*return keys;\s*\}/
  );
  assert.doesNotMatch(statusBarsSource, /function parseTemplateVariableToken\(token\) \{/);
  assert.doesNotMatch(statusBarsSource, /token\.split\('\.'\)/);
  assert.doesNotMatch(statusBarsSource, /new Set\(inferred\.map/);
});

test('status bar text value label patterns build without array pipelines', () => {
  const textPatternHelper = statusBarsSource.match(/function textValuePatternsSafe[\s\S]*?\n}\n\nfunction normalizeName/);
  assert.ok(textPatternHelper);
  assert.match(textPatternHelper[0], /for \(let index = 0; index < sourceVariables\.length; index \+= 1\)/);
  assert.doesNotMatch(textPatternHelper[0], /\.map\(|\.filter\(/);

  const variablePatternHelper = statusBarsSource.match(/function variableNamePattern[\s\S]*?\n}\n\nfunction hasExplicitMax/);
  assert.ok(variablePatternHelper);
  assert.match(variablePatternHelper[0], /for \(const char of name\)/);
  assert.doesNotMatch(variablePatternHelper[0], /Array\.from\(name\)|\.map\(/);
});

test('status bar variables normalize with a capped direct loop', () => {
  const database = createAppDatabase(':memory:');
  setupConversation(database);

  const variables = [{ name: '', value: 'ignored' }];
  for (let index = 0; index < 65; index += 1) {
    variables.push({ name: `Var ${index}`, value: String(index), color: index === 0 ? '#abc' : 'bad' });
  }

  const statusBar = upsertStatusBar(database, 'status-user-1', 'status-conversation-1', {
    name: 'Many Variables',
    variables,
    template: '{{ LateTemplateVar }}'
  });

  assert.equal(statusBar.variables.length, 60);
  assert.equal(statusBar.variables[0].name, 'Var 0');
  assert.equal(statusBar.variables[0].value, 0);
  assert.equal(statusBar.variables[0].max, 100);
  assert.equal(statusBar.variables[0].color, '#abc');
  assert.equal(statusBar.variables.at(-1).name, 'Var 59');
  assert.equal(statusBar.variables.some((variable) => variable.name === 'LateTemplateVar'), false);

  const normalizeHelper = statusBarsSource.match(/function normalizeVariables[\s\S]*?\n}\n\nfunction normalizeVariableValue/);
  assert.ok(normalizeHelper);
  assert.match(normalizeHelper[0], /for \(let index = 0; index < sourceVariables\.length; index \+= 1\)/);
  assert.match(normalizeHelper[0], /normalized\.length >= STATUS_BAR_VARIABLE_LIMIT/);
  assert.doesNotMatch(normalizeHelper[0], /\.map\(|\.filter\(/);
});
