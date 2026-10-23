import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import test from 'node:test';
import { insertUser, withServer } from './routeTestUtils.js';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret';

const { createAppDatabase } = await import('../db/runtime.js');
const { applyRegexRules, createCharacter, getCharacter, testRegexRule } = await import('../modules/characters.js');
const { createRegexRouter } = await import('../routes/regex.js');
const charactersSource = fs.readFileSync(new URL('../modules/characters.js', import.meta.url), 'utf8');
const userRegexSources = [
  '../modules/characters.js',
  '../domain/worldBooks/entryRules.js',
  '../services/characterAssistant.js',
  '../services/exportEnvelopes.js',
  '../services/worldBooks/worldBookMatcher.js',
  '../services/worldBooks/worldBookMatchPreview.js'
].map((path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8'));

test('regex deletion persists for enabled and disabled rules without changing remaining rules', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'regex-delete-owner';
  insertUser(database, userId);
  const character = createCharacter(database, userId, {
    name: 'Regex deletion fixture',
    regexRules: [
      { label: 'Keep first', pattern: 'first', groupName: 'Keep', priority: 1 },
      { label: 'Delete enabled', pattern: 'enabled', groupName: 'Delete', enabled: true, priority: 2 },
      { label: 'Delete disabled', pattern: 'disabled', groupName: 'Delete', enabled: false, priority: 3 },
      { label: 'Keep last', pattern: 'last', groupName: 'Keep', priority: 4 }
    ]
  });
  const remainingRules = [character.regexRules[0], character.regexRules[3]];
  const remainingListRules = remainingRules.map((rule) => ({ ...rule, characterId: character.id }));
  const app = createRegexRoutesApp(database, userId);

  try {
    await withServer(app, async (baseUrl) => {
      for (const rule of [character.regexRules[1], character.regexRules[2]]) {
        const response = await fetch(`${baseUrl}/api/regex-rules/${rule.id}`, { method: 'DELETE' });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { ok: true });
      }

      const listResponse = await fetch(`${baseUrl}/api/regex-rules`);
      assert.equal(listResponse.status, 200);
      assert.deepEqual(await listResponse.json(), remainingListRules);
      const groupResponse = await fetch(`${baseUrl}/api/regex-rules?group=Delete`);
      assert.deepEqual(await groupResponse.json(), []);
    });

    assert.deepEqual(getCharacter(database, userId, character.id).regexRules, remainingRules);
    await withServer(createRegexRoutesApp(database, userId), async (baseUrl) => {
      const reloaded = await fetch(`${baseUrl}/api/regex-rules`).then((response) => response.json());
      assert.deepEqual(reloaded, remainingListRules);
    });
  } finally {
    database.close();
  }
});

test('regex deletion cannot remove a rule owned by another user', async () => {
  const database = createAppDatabase(':memory:');
  const ownerId = 'regex-delete-foreign-owner';
  const viewerId = 'regex-delete-viewer';
  insertUser(database, ownerId);
  insertUser(database, viewerId);
  const character = createCharacter(database, ownerId, {
    name: 'Public regex deletion fixture',
    visibility: 'public',
    regexRules: [{ label: 'Foreign rule', pattern: 'foreign' }]
  });

  try {
    await withServer(createRegexRoutesApp(database, viewerId), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/regex-rules/${character.regexRules[0].id}`, { method: 'DELETE' });
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: '规则不存在' });
    });
    assert.deepEqual(getCharacter(database, ownerId, character.id).regexRules, character.regexRules);
  } finally {
    database.close();
  }
});

test('regex deletion returns 404 for missing and already deleted rules', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'regex-delete-missing-owner';
  insertUser(database, userId);
  const character = createCharacter(database, userId, {
    name: 'Missing regex deletion fixture',
    regexRules: [{ label: 'Delete once', pattern: 'once' }]
  });

  try {
    await withServer(createRegexRoutesApp(database, userId), async (baseUrl) => {
      const ruleUrl = `${baseUrl}/api/regex-rules/${character.regexRules[0].id}`;
      assert.equal((await fetch(ruleUrl, { method: 'DELETE' })).status, 200);
      for (const url of [ruleUrl, `${baseUrl}/api/regex-rules/missing-rule`]) {
        const response = await fetch(url, { method: 'DELETE' });
        assert.equal(response.status, 404);
        assert.deepEqual(await response.json(), { error: '规则不存在' });
      }
    });
    assert.deepEqual(getCharacter(database, userId, character.id).regexRules, []);
  } finally {
    database.close();
  }
});

function createRegexRoutesApp(database, userId) {
  const app = express();
  app.use('/api/regex-rules', createRegexRouter({
    db: database,
    requireAuth(request, response, next) {
      request.auth = { user: { id: userId } };
      next();
    }
  }));
  return app;
}

// ── testRegexRule: contain mode ──

test('testRegexRule contain mode passes when text contains pattern', () => {
  const result = testRegexRule({ pattern: 'hello', mode: 'contain' }, 'say hello world');
  assert.equal(result.pass, true);
  assert.deepEqual(result.matches, ['hello']);
});

test('testRegexRule contain mode fails when text does not contain pattern', () => {
  const result = testRegexRule({ pattern: 'goodbye', mode: 'contain' }, 'say hello world');
  assert.equal(result.pass, false);
  assert.deepEqual(result.matches, []);
});

// ── testRegexRule: exact mode ──

test('testRegexRule exact mode passes when text matches exactly', () => {
  const result = testRegexRule({ pattern: 'hello', mode: 'exact' }, 'hello');
  assert.equal(result.pass, true);
  assert.deepEqual(result.matches, ['hello']);
});

test('testRegexRule exact mode fails when text does not match exactly', () => {
  const result = testRegexRule({ pattern: 'hello', mode: 'exact' }, 'hello world');
  assert.equal(result.pass, false);
  assert.deepEqual(result.matches, []);
});

// ── testRegexRule: regex mode ──

test('testRegexRule regex mode passes when pattern matches', () => {
  const result = testRegexRule({ pattern: '\\d+', mode: 'regex', flags: 'g' }, 'abc 123 def 456');
  assert.equal(result.pass, true);
  assert.deepEqual(result.matches, ['123', '456']);
});

test('testRegexRule regex mode fails when pattern does not match', () => {
  const result = testRegexRule({ pattern: '\\d+', mode: 'regex', flags: 'g' }, 'no numbers here');
  assert.equal(result.pass, false);
  assert.deepEqual(result.matches, []);
});

test('testRegexRule regex mode returns empty matches on invalid regex', () => {
  const result = testRegexRule({ pattern: '[invalid', mode: 'regex' }, 'test');
  assert.equal(result.pass, false);
  assert.deepEqual(result.matches, []);
});

test('testRegexRule rejects potentially catastrophic regex patterns', () => {
  const result = testRegexRule({ pattern: '(a+)+$', mode: 'regex' }, 'aaaa!');
  assert.equal(result.pass, false);
  assert.deepEqual(result.matches, []);
});

// ── testRegexRule: preset mode ──

test('testRegexRule preset mode always passes', () => {
  const result = testRegexRule({ pattern: 'anything', mode: 'preset' }, 'any text');
  assert.equal(result.pass, true);
  assert.deepEqual(result.matches, []);
});

// ── testRegexRule: default mode ──

test('testRegexRule defaults to regex mode when mode is not specified', () => {
  const result = testRegexRule({ pattern: 'cat' }, 'the cat sat');
  assert.equal(result.pass, true);
  assert.deepEqual(result.matches, ['cat']);
});

// ── applyRegexRules: scriptMode ──

test('applyRegexRules ignores stored scripts without executing them', () => {
  delete globalThis.__flaiRegexScriptExecuted;
  const rules = [
    {
      label: 'uppercase script',
      pattern: 'hello',
      replacement: '',
      flags: 'g',
      scope: 'input',
      enabled: true,
      scriptMode: 1,
      jsScript: 'globalThis.__flaiRegexScriptExecuted = true; return text.toUpperCase();'
    }
  ];
  const result = applyRegexRules('hello world', rules, 'input');
  assert.equal(result, 'hello world');
  assert.equal(globalThis.__flaiRegexScriptExecuted, undefined);
});

test('applyRegexRules falls back to replacement when scriptMode is disabled', () => {
  const rules = [
    {
      label: 'simple replace',
      pattern: 'hello',
      replacement: 'hi',
      flags: 'g',
      scope: 'input',
      enabled: true
    }
  ];
  const result = applyRegexRules('hello world', rules, 'input');
  assert.equal(result, 'hi world');
});

test('applyRegexRules falls back to replacement when jsScript is empty', () => {
  const rules = [
    {
      label: 'empty script',
      pattern: 'hello',
      replacement: 'hi',
      flags: 'g',
      scope: 'input',
      enabled: true,
      scriptMode: 1,
      jsScript: ''
    }
  ];
  const result = applyRegexRules('hello world', rules, 'input');
  assert.equal(result, 'hi world');
});

test('applyRegexRules skips potentially catastrophic regex patterns', () => {
  const rules = [
    {
      label: 'unsafe pattern',
      pattern: '(a+)+$',
      replacement: 'blocked',
      flags: 'g',
      scope: 'input',
      enabled: true
    }
  ];
  const result = applyRegexRules('aaaa!', rules, 'input');
  assert.equal(result, 'aaaa!');
});

test('backend regex rules contain no dynamic JavaScript execution primitive', () => {
  assert.doesNotMatch(charactersSource, /\bnew\s+Function\b|\beval\s*\(/);
});

test('user-authored regex paths use the shared safe compiler', () => {
  for (const source of userRegexSources) {
    assert.doesNotMatch(source, /new\s+RegExp\s*\(/);
  }
});
