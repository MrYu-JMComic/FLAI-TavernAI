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
