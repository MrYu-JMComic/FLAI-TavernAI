import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret';

const { createAppDatabase } = await import('../db.js');
const {
  applyRegexRules,
  createCharacter,
  deleteCharacter,
  getCharacter,
  getRegexRules,
  getRegexRulesByGroup,
  listCharacters,
  replaceRegexRules,
  reorderRegexRules,
  setCharacterFavorite,
  setCharacterLike,
  updateCharacter
} = await import('../modules/characters.js');
const { getOwnedCharacterStats, publicUser } = await import('../modules/users.js');
const {
  apiKeyHint,
  decryptSecret,
  encryptSecret,
  hashPassword,
  newId,
  nowIso,
  parseCookies,
  resolveSession,
  verifyPassword
} = await import('../security.js');
const {
  buildProviderBody,
  buildUsageSnapshot,
  generateCompletion,
  hasUsableProvider,
  listProviderModels,
  normalizeProviderRow,
  providerWithSecret,
  runToolCompletion,
  streamCompletion,
  streamToolCompletion,
  summarizeUsageSnapshots
} = await import('../services/providers.js');
const {
  conversationBackgroundOwnerTypes,
  getAvatarAssetForViewer,
  getUserAvatarUrl,
  saveAvatarInput
} = await import('../services/avatars.js');
const {
  getConversationAppearance,
  normalizeConversationAppearance,
  saveConversationAppearance
} = await import('../modules/conversationAppearance.js');
const { branchConversation, getConversationBranches } = await import('../modules/branches.js');
const { completeCharacterDraft } = await import('../services/characterAssistant.js');
const { completeWorldBookDraft } = await import('../services/worldBookAssistant.js');
const { createCharactersRouter } = await import('../routes/characters.js');
const { createConversationsRouter } = await import('../routes/conversations.js');
const { createRegexRouter } = await import('../routes/regex.js');
const { createSwipesRouter } = await import('../routes/swipes.js');
const { createSettingsRouter } = await import('../routes/settings.js');
const { isAccessorySkillActive, mergeAdvancedSettings, normalizeAdvancedSettings } = await import('../modules/advancedSettings.js');
const { renderPromptVariables, resolvePromptUserName } = await import('../services/promptVariables.js');
const { expandMacros } = await import('../services/macros.js');
const {
  createCharacterSchema,
  createModSchema,
  updateModSchema,
  updateCharacterSchema,
  createWorldBookSchema,
  updateWorldBookSchema,
  saveConversationSettingsSchema,
  saveProviderSchema
} = await import('../validations/schemas.js');
const {
  createWorldBook,
  getWorldBook,
  listCharacterWorldBooks,
  listWorldBooks,
  updateWorldBook,
  deleteWorldBook,
  createEntry,
  updateEntry,
  deleteEntry,
  matchWorldBookEntries,
  buildWorldBookContext,
  linkWorldBookToCharacter,
  injectAtDepthEntries,
  resetMessageCounter
} = await import('../modules/worldBooks.js');
const {
  createTag,
  listTags,
  deleteTag,
  setCharacterTags,
  getCharacterTagNames
} = await import('../modules/tags.js');
const {
  createPreset,
  getPreset,
  listPresets,
  updatePreset,
  deletePreset,
  setDefaultPreset,
  getDefaultPreset
} = await import('../modules/presets.js');
const {
  buildModSystemPrompt,
  createMod,
  getMod,
  listMods,
  updateMod,
  deleteMod,
  reorderMods,
  getEnabledModsForUser
} = await import('../modules/mods.js');
const {
  applyVariableUpdates,
  deleteStatusBar,
  extractVariablesFromText,
  getStatusBar,
  upsertStatusBar
} = await import('../modules/statusBars.js');
const {
  createSave,
  deleteSave,
  getSave,
  listSaves,
  loadSave,
  updateSave
} = await import('../modules/saves.js');
const {
  buildTalentSystemPrompt,
  createTalentPool,
  deleteAllCharacterTalents,
  deleteCharacterTalent,
  deleteTalentPool,
  getCharacterTalents,
  getTalentPool,
  listTalentPools,
  rollTalent,
  updateTalentPool,
  RARITY_CONFIG,
  RARITY_LABEL_MAP,
  weightedRandomPick
} = await import('../modules/talents.js');
const {
  createSwipe,
  getSwipeIndex,
  getActiveSwipe,
  listSwipes,
  setActiveSwipe
} = await import('../modules/swipes.js');

test('password hashes verify and reject wrong passwords', async () => {
  const hash = await hashPassword('correct horse battery');
  assert.equal(await verifyPassword('correct horse battery', hash), true);
  assert.equal(await verifyPassword('wrong horse battery', hash), false);
});

test('parseCookies skips malformed percent-encoded pairs', () => {
  assert.deepEqual(
    parseCookies('flai_session=session%201; broken=%E0%A4%A; bad%ZZ=value; empty=; theme=dark'),
    {
      flai_session: 'session 1',
      empty: '',
      theme: 'dark'
    }
  );
});

test('user root admin flags normalize string false values', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'string-false-root-user';
  const sessionId = 'string-false-root-session';
  database
    .prepare(
      `INSERT INTO users (id, username, password_hash, permission_group, is_root_admin, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(userId, 'stringfalseroot', 'hash', 'admin', 'false', nowIso());
  database
    .prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(sessionId, userId, Date.now() + 60_000, nowIso());

  const row = database.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const profileUser = publicUser(database, row);
  const session = resolveSession(database, { headers: { cookie: `flai_session=${sessionId}` } });

  assert.equal(profileUser.isRootAdmin, false);
  assert.equal(session.user.isRootAdmin, false);
  assert.equal(profileUser.permissionGroup, 'admin');
  assert.equal(session.user.permissionGroup, 'admin');
});

test('provider API keys are encrypted and decryptable', () => {
  const encrypted = encryptSecret('sk-test-secret');
  assert.notEqual(encrypted, 'sk-test-secret');
  assert.equal(decryptSecret(encrypted), 'sk-test-secret');
});

test('provider API keys encrypted with the old dev secret still decrypt', () => {
  const encrypted = encryptWithSecret('sk-legacy-secret', 'flai-dev-secret-change-me');
  assert.equal(decryptSecret(encrypted), 'sk-legacy-secret');
});

test('provider rows report undecryptable API keys without throwing', () => {
  const brokenEncryptedKey = encryptSecret('sk-test-secret').replace(/.$/, (char) => (char === 'A' ? 'B' : 'A'));
  const row = {
    provider_type: 'deepseek',
    gateway_name: 'DeepSeek',
    base_url: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    encrypted_api_key: brokenEncryptedKey,
    api_key_hint: 'sk-...test',
    supports_reasoning: 1,
    extra_body: '{}',
    updated_at: new Date().toISOString()
  };

  const publicSettings = normalizeProviderRow(row);
  const privateSettings = providerWithSecret(row);
  assert.equal(publicSettings.model, 'deepseek-v4-flash');
  assert.equal(publicSettings.apiKeySet, false);
  assert.equal(publicSettings.apiKeyNeedsReset, true);
  assert.equal(privateSettings.apiKey, '');
  assert.match(privateSettings.apiKeyError, /重新输入/);
});

test('characters persist with regex rules in order', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'user-1';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    'tester',
    'hash',
    new Date().toISOString()
  );

  const character = createCharacter(database, userId, {
    name: '测试角色',
    persona: '安静、认真',
    tags: ['测试'],
    regexRules: [
      {
        label: '输入替换',
        pattern: '猫',
        replacement: '伙伴',
        flags: 'g',
        scope: 'input',
        enabled: true
      },
      {
        label: '输出替换',
        pattern: '雨',
        replacement: '灯光',
        flags: 'g',
        scope: 'output',
        enabled: true
      }
    ]
  });

  const saved = getCharacter(database, userId, character.id);
  assert.equal(saved.name, '测试角色');
  assert.equal(saved.regexRules.length, 2);
  assert.equal(applyRegexRules('猫在门口', saved.regexRules, 'input'), '伙伴在门口');
  assert.equal(applyRegexRules('窗外有雨', saved.regexRules, 'output'), '窗外有灯光');
});

test('replaceRegexRules keeps existing rules when replacement insert fails', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'regex-replace-rollback-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    'regexreplace',
    'hash',
    new Date().toISOString()
  );

  const character = createCharacter(database, userId, {
    name: 'Regex Replace Rollback',
    regexRules: [
      { id: 'regex-keep-rule', label: 'Keep', pattern: 'old', replacement: 'kept' }
    ]
  });
  const other = createCharacter(database, userId, {
    name: 'Regex Existing Id',
    regexRules: [
      { id: 'regex-taken-rule', label: 'Taken', pattern: 'taken', replacement: 'taken' }
    ]
  });

  assert.throws(
    () => replaceRegexRules(database, userId, character.id, [
      { id: other.regexRules[0].id, label: 'Colliding', pattern: 'new', replacement: 'new' }
    ]),
    /constraint|UNIQUE/i
  );

  assert.deepEqual(
    getRegexRules(database, userId, character.id).map((rule) => [rule.id, rule.pattern, rule.replacement]),
    [['regex-keep-rule', 'old', 'kept']]
  );
  assert.deepEqual(
    getRegexRules(database, userId, other.id).map((rule) => rule.id),
    ['regex-taken-rule']
  );
});

test('applyRegexRules treats null rules as no rules', () => {
  assert.equal(applyRegexRules('unchanged text', null, 'input'), 'unchanged text');
});

test('applyRegexRules skips null rule items', () => {
  assert.equal(
    applyRegexRules(
      'alpha beta',
      [
        null,
        {
          enabled: true,
          pattern: 'alpha',
          replacement: 'omega',
          scope: 'input'
        },
        undefined
      ],
      'input'
    ),
    'omega beta'
  );
});

test('regex partial reorder keeps priorities unique', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'regex-partial-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    'regex-partial',
    'hash',
    new Date().toISOString()
  );

  const character = createCharacter(database, userId, {
    name: 'Regex Partial',
    regexRules: [
      { label: 'First rule', pattern: 'first', replacement: '1' },
      { label: 'Second rule', pattern: 'second', replacement: '2' },
      { label: 'Third rule', pattern: 'third', replacement: '3' }
    ]
  });
  const [rule1, rule2, rule3] = character.regexRules;

  reorderRegexRules(database, userId, ['missing-rule', rule3.id, rule3.id]);

  const ordered = getRegexRules(database, userId, character.id);
  assert.deepEqual(ordered.map((rule) => rule.id), [rule3.id, rule1.id, rule2.id]);
  assert.deepEqual(ordered.map((rule) => rule.priority), [0, 1, 2]);

  reorderRegexRules(database, userId, [rule2.id], null);
  const nullOptionsOrdered = getRegexRules(database, userId, character.id);
  assert.deepEqual(nullOptionsOrdered.map((rule) => rule.id), [rule2.id, rule3.id, rule1.id]);
  assert.deepEqual(nullOptionsOrdered.map((rule) => rule.priority), [0, 1, 2]);
});

test('regex group reorder only updates that group', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'regex-group-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    'regex-group',
    'hash',
    new Date().toISOString()
  );

  const character = createCharacter(database, userId, {
    name: 'Regex Groups',
    regexRules: [
      { label: 'Alpha one', pattern: 'a1', groupName: 'Alpha', priority: 0 },
      { label: 'Beta one', pattern: 'b1', groupName: 'Beta', priority: 0 },
      { label: 'Alpha two', pattern: 'a2', groupName: 'Alpha', priority: 1 }
    ]
  });
  const [alphaOne, betaOne, alphaTwo] = character.regexRules;

  reorderRegexRules(database, userId, [alphaTwo.id], { group: 'Alpha' });

  const alphaRules = getRegexRulesByGroup(database, userId, 'Alpha');
  const betaRules = getRegexRulesByGroup(database, userId, 'Beta');
  assert.deepEqual(alphaRules.map((rule) => rule.id), [alphaTwo.id, alphaOne.id]);
  assert.deepEqual(alphaRules.map((rule) => rule.priority), [0, 1]);
  assert.deepEqual(betaRules.map((rule) => [rule.id, rule.priority]), [[betaOne.id, 0]]);
});

test('reorderRegexRules rolls back priority changes when an update fails', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'regex-reorder-rollback-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    'regexreorder',
    'hash',
    new Date().toISOString()
  );

  const character = createCharacter(database, userId, {
    name: 'Regex Reorder Rollback',
    regexRules: [
      { id: 'regex-first-rule', label: 'First', pattern: 'first', priority: 0 },
      { id: 'regex-second-rule', label: 'Second', pattern: 'second', priority: 1 },
      { id: 'regex-third-rule', label: 'Third', pattern: 'third', priority: 2 }
    ]
  });
  const [rule1, rule2, rule3] = character.regexRules;

  database.exec(`
    CREATE TRIGGER fail_regex_priority_update
    BEFORE UPDATE OF priority ON regex_rules
    WHEN NEW.id = '${rule2.id}'
    BEGIN
      SELECT RAISE(ABORT, 'forced regex reorder failure');
    END
  `);

  assert.throws(
    () => reorderRegexRules(database, userId, [rule3.id, rule2.id, rule1.id]),
    /forced regex reorder failure/
  );

  const ordered = getRegexRules(database, userId, character.id);
  assert.deepEqual(ordered.map((rule) => rule.id), [rule1.id, rule2.id, rule3.id]);
  assert.deepEqual(ordered.map((rule) => rule.priority), [0, 1, 2]);
});

test('regex rule reads keep insertion order when priority and order index tie', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'regex-tie-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    'regex-tie',
    'hash',
    new Date().toISOString()
  );

  const character = createCharacter(database, userId, {
    name: 'Regex Tie',
    regexRules: [
      { label: 'First cascade', pattern: 'alpha', replacement: 'beta', groupName: 'Tie' },
      { label: 'Second cascade', pattern: 'beta', replacement: 'gamma', groupName: 'Tie' }
    ]
  });
  const [firstRule, secondRule] = character.regexRules;
  database
    .prepare('UPDATE regex_rules SET priority = 0, order_index = 0 WHERE id IN (?, ?)')
    .run(firstRule.id, secondRule.id);

  database.exec('PRAGMA reverse_unordered_selects = ON');
  try {
    const characterRules = getRegexRules(database, userId, character.id);
    const groupRules = getRegexRulesByGroup(database, userId, 'Tie');

    assert.deepEqual(characterRules.map((rule) => rule.id), [firstRule.id, secondRule.id]);
    assert.deepEqual(groupRules.map((rule) => rule.id), [firstRule.id, secondRule.id]);
    assert.equal(applyRegexRules('alpha', characterRules, 'input'), 'gamma');
  } finally {
    database.exec('PRAGMA reverse_unordered_selects = OFF');
  }
});

test('regex import route rolls back earlier inserts when a later insert fails', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'regex-import-rollback-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    'regeximport',
    'hash',
    new Date().toISOString()
  );
  const character = createCharacter(database, userId, { name: 'Regex Import Rollback' });

  database.exec(`
    CREATE TRIGGER fail_regex_import_insert
    BEFORE INSERT ON regex_rules
    WHEN NEW.pattern = 'fail-import'
    BEGIN
      SELECT RAISE(ABORT, 'forced regex import failure');
    END
  `);

  const app = express();
  app.use(express.json());
  app.use('/api/regex', createRegexRouter({
    db: database,
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: userId, username: 'regeximport' } };
      next();
    },
    newId
  }));
  app.use((error, _request, response, _next) => {
    response.status(500).json({ error: error.message });
  });

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const importResponse = await fetch(`${baseUrl}/api/regex/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rules: [
          { characterId: character.id, label: 'First import', pattern: 'ok-import' },
          { characterId: character.id, label: 'Failing import', pattern: 'fail-import' }
        ]
      })
    });
    const body = await importResponse.json();

    assert.equal(importResponse.status, 500);
    assert.equal(body.imported, 0);
    assert.equal(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM regex_rules WHERE character_id = ? AND pattern IN ('ok-import', 'fail-import')"
        )
        .get(character.id).count,
      0
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('regex import route normalizes string booleans and numeric indexes', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'regex-import-boolean-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    'regeximportboolean',
    'hash',
    new Date().toISOString()
  );
  const character = createCharacter(database, userId, { name: 'Regex Import Boolean' });

  const app = express();
  app.use(express.json());
  app.use('/api/regex', createRegexRouter({
    db: database,
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: userId, username: 'regeximportboolean' } };
      next();
    },
    newId
  }));
  app.use((error, _request, response, _next) => {
    response.status(500).json({ error: error.message });
  });

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const importResponse = await fetch(`${baseUrl}/api/regex/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rules: [
          {
            characterId: character.id,
            label: 'String false import',
            pattern: 'string-false-import',
            enabled: 'false',
            script_mode: 'false',
            js_script: 'return "unused";',
            orderIndex: '-5',
            priority: '-9'
          },
          {
            characterId: character.id,
            label: 'Non-finite import',
            pattern: 'nonfinite-import',
            order: 'Infinity',
            priority: 'Infinity'
          }
        ]
      })
    });
    const body = await importResponse.json();
    const rows = database
      .prepare(
        `SELECT pattern, enabled, script_mode, js_script, order_index, priority
         FROM regex_rules
         WHERE character_id = ? AND pattern IN (?, ?)`
      )
      .all(character.id, 'string-false-import', 'nonfinite-import');
    const rowByPattern = new Map(rows.map((row) => [row.pattern, row]));
    const stringFalseRow = rowByPattern.get('string-false-import');
    const nonFiniteRow = rowByPattern.get('nonfinite-import');

    assert.equal(importResponse.status, 201);
    assert.equal(body.imported, 2);
    assert.equal(rows.length, 2);
    assert.equal(stringFalseRow.enabled, 0);
    assert.equal(stringFalseRow.script_mode, 0);
    assert.equal(stringFalseRow.js_script, 'return "unused";');
    assert.equal(stringFalseRow.order_index, 0);
    assert.equal(stringFalseRow.priority, 0);
    assert.equal(nonFiniteRow.order_index, 1);
    assert.equal(nonFiniteRow.priority, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('prompt variables render the current user name', () => {
  const user = {
    username: 'account_name',
    displayName: '赵雨乐'
  };

  assert.equal(resolvePromptUserName(user), '赵雨乐');
  assert.equal(renderPromptVariables('你好，{user}。{user} 已进入故事。', user), '你好，赵雨乐。赵雨乐 已进入故事。');
  assert.equal(renderPromptVariables('没有变量', user), '没有变量');
  const fallbackName = resolvePromptUserName({});
  assert.equal(resolvePromptUserName(null), fallbackName);
  assert.equal(renderPromptVariables('Hello {user}', null), `Hello ${fallbackName}`);
});

test('expandMacros treats null context as defaults', () => {
  assert.equal(expandMacros('plain {{unknown}}', null), 'plain {{unknown}}');
});

test('character schema accepts null worldBookId for unlinked characters', () => {
  const createResult = createCharacterSchema.safeParse({
    name: 'Unlinked Character',
    worldBookId: null
  });
  const updateResult = updateCharacterSchema.safeParse({
    worldBookId: null
  });

  assert.equal(createResult.success, true);
  assert.equal(createResult.data.worldBookId, null);
  assert.equal(updateResult.success, true);
  assert.equal(updateResult.data.worldBookId, null);
});

test('provider settings schema accepts form-encoded extra body JSON', () => {
  const result = saveProviderSchema.safeParse({
    providerType: 'custom',
    gatewayName: 'Local proxy',
    baseUrl: 'http://127.0.0.1:8317/v1',
    model: 'deepseek-v4-flash',
    apiKey: '',
    clearApiKey: false,
    supportsReasoning: false,
    extraBody: '{}'
  });

  assert.equal(result.success, true);
  assert.equal(result.data.extraBody, '{}');
});

test('character routes pass database into tag updates', async () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'route-user',
    'routeuser',
    'hash',
    new Date().toISOString()
  );
  const app = express();
  app.use(express.json());
  app.use('/api/characters', createCharactersRouter({
    db: database,
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: 'route-user', username: 'routeuser' } };
      next();
    },
    asyncRoute: (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    withCharacterTags: (character) => character,
    withWorldBookId: (character) => character,
    hasUsableProvider: () => true,
    getChatProviderSettings: () => ({ ok: false, error: 'unused' }),
    withEtag: (_request, response, data) => response.json(data),
    withListCache: (_request, response, data) => response.json(data),
    nowIso: () => new Date().toISOString()
  }));
  app.use((error, _request, response, _next) => {
    response.status(500).json({ error: error.message });
  });

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const createdResponse = await fetch(`${baseUrl}/api/characters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Tagged Route Character', tags: ['route-tag'] })
    });
    const created = await createdResponse.json();

    assert.equal(createdResponse.status, 201);
    assert.equal(getCharacterTagNames(database, created.id).includes('route-tag'), true);

    const updatedResponse = await fetch(`${baseUrl}/api/characters/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: ['route-tag-2'] })
    });

    assert.equal(updatedResponse.status, 200);
    assert.deepEqual(getCharacterTagNames(database, created.id), ['route-tag-2']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('character routes reject foreign world book links', async () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'route-user',
    'routeuser',
    'hash',
    new Date().toISOString()
  );
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'other-user',
    'otheruser',
    'hash',
    new Date().toISOString()
  );
  const otherBook = createWorldBook(database, 'other-user', { name: 'Other World Book' });
  const existing = createCharacter(database, 'route-user', { name: 'Existing Character' });

  const app = express();
  app.use(express.json());
  app.use('/api/characters', createCharactersRouter({
    db: database,
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: 'route-user', username: 'routeuser' } };
      next();
    },
    asyncRoute: (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    withCharacterTags: (character) => character,
    withWorldBookId: (character) => character,
    hasUsableProvider: () => true,
    getChatProviderSettings: () => ({ ok: false, error: 'unused' }),
    withEtag: (_request, response, data) => response.json(data),
    withListCache: (_request, response, data) => response.json(data),
    nowIso: () => new Date().toISOString()
  }));
  app.use((error, _request, response, _next) => {
    response.status(500).json({ error: error.message });
  });

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const createResponse = await fetch(`${baseUrl}/api/characters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Blocked Create', worldBookId: otherBook.id })
    });

    assert.equal(createResponse.status, 404);
    assert.equal(listCharacters(database, 'route-user', { search: 'Blocked Create' }).length, 0);

    const updateResponse = await fetch(`${baseUrl}/api/characters/${existing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Blocked Update', worldBookId: otherBook.id })
    });

    assert.equal(updateResponse.status, 404);
    assert.equal(getCharacter(database, 'route-user', existing.id).name, 'Existing Character');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('character world book route normalizes non-finite order index', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'route-order-index-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    'routeorderindex',
    'hash',
    new Date().toISOString()
  );
  const character = createCharacter(database, userId, { name: 'Order Index Character' });
  const book = createWorldBook(database, userId, { name: 'Order Index Book' });

  const app = express();
  app.use(express.json());
  app.use('/api/characters', createCharactersRouter({
    db: database,
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: userId, username: 'routeorderindex' } };
      next();
    },
    asyncRoute: (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    withCharacterTags: (value) => value,
    withWorldBookId: (value) => value,
    hasUsableProvider: () => true,
    getChatProviderSettings: () => ({ ok: false, error: 'unused' }),
    withEtag: (_request, response, data) => response.json(data),
    withListCache: (_request, response, data) => response.json(data),
    nowIso: () => new Date().toISOString()
  }));
  app.use((error, _request, response, _next) => {
    response.status(500).json({ error: error.message });
  });

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${baseUrl}/api/characters/${character.id}/world-books`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldBookId: book.id, orderIndex: 'Infinity' })
    });
    const row = database
      .prepare('SELECT order_index FROM character_world_books WHERE character_id = ? AND world_book_id = ?')
      .get(character.id, book.id);

    assert.equal(response.status, 200);
    assert.equal(row.order_index, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('character routes normalize string boolean flags', async () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'boolean-route-user',
    'booleanrouteuser',
    'hash',
    new Date().toISOString()
  );
  const character = createCharacter(database, 'boolean-route-user', { name: 'Boolean Route Character' });

  const app = express();
  app.use(express.json());
  app.use('/api/characters', createCharactersRouter({
    db: database,
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: 'boolean-route-user', username: 'booleanrouteuser' } };
      next();
    },
    asyncRoute: (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    withCharacterTags: (value) => value,
    withWorldBookId: (value) => value,
    hasUsableProvider: () => true,
    getChatProviderSettings: () => ({ ok: false, error: 'unused' }),
    withEtag: (_request, response, data) => response.json(data),
    withListCache: (_request, response, data) => response.json(data),
    nowIso: () => new Date().toISOString()
  }));
  app.use((error, _request, response, _next) => {
    response.status(500).json({ error: error.message });
  });

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const favoriteOn = await fetch(`${baseUrl}/api/characters/${character.id}/favorite`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorited: 'true' })
    });
    assert.equal((await favoriteOn.json()).favoritedByMe, true);

    const favoriteOff = await fetch(`${baseUrl}/api/characters/${character.id}/favorite`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorited: 'false' })
    });
    assert.equal((await favoriteOff.json()).favoritedByMe, false);

    const likeOn = await fetch(`${baseUrl}/api/characters/${character.id}/like`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ liked: 'true' })
    });
    assert.equal((await likeOn.json()).likedByMe, true);

    const likeOff = await fetch(`${baseUrl}/api/characters/${character.id}/like`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ liked: 'false' })
    });
    assert.equal((await likeOff.json()).likedByMe, false);

    const firstImageResponse = await fetch(`${baseUrl}/api/characters/${character.id}/images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: 'https://example.test/first.png', isDefault: 'false' })
    });
    const firstImage = await firstImageResponse.json();
    assert.equal(firstImage.isDefault, false);

    const defaultImageResponse = await fetch(`${baseUrl}/api/characters/${character.id}/images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: 'https://example.test/default.png', isDefault: 'true' })
    });
    const defaultImage = await defaultImageResponse.json();
    assert.equal(defaultImage.isDefault, true);

    const unsetDefaultResponse = await fetch(`${baseUrl}/api/characters/${character.id}/images/${defaultImage.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isDefault: 'false' })
    });
    assert.equal((await unsetDefaultResponse.json()).isDefault, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('swipe active lookup respects message ownership', async () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'swipe-owner',
    'swipeowner',
    'hash',
    new Date().toISOString()
  );
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'swipe-other',
    'swipeother',
    'hash',
    new Date().toISOString()
  );
  const character = createCharacter(database, 'swipe-owner', { name: 'Swipe Character' });
  const timestamp = new Date().toISOString();
  database.prepare(
    'INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('swipe-conv', 'swipe-owner', character.id, 'Swipe Conversation', timestamp, timestamp);
  database.prepare(
    'INSERT INTO messages (id, user_id, conversation_id, role, content, reasoning, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('swipe-message', 'swipe-owner', 'swipe-conv', 'assistant', 'owner-only message', 'private reasoning', null, timestamp);
  createSwipe(database, 'swipe-owner', 'swipe-message', {
    content: 'alternate owner-only message',
    reasoning: 'alternate reasoning'
  });

  assert.equal(getActiveSwipe(database, 'swipe-other', 'swipe-message'), null);
  assert.equal(getActiveSwipe(database, 'swipe-owner', 'swipe-message').content, 'owner-only message');

  const app = express();
  app.use(express.json());
  app.use('/api/swipes', createSwipesRouter({
    db: database,
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: request.headers['x-test-user'], username: 'test' } };
      next();
    }
  }));
  app.use((error, _request, response, _next) => {
    response.status(500).json({ error: error.message });
  });

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const foreignResponse = await fetch(`${baseUrl}/api/swipes/swipe-message/swipes/active`, {
      headers: { 'x-test-user': 'swipe-other' }
    });
    const ownerResponse = await fetch(`${baseUrl}/api/swipes/swipe-message/swipes/active`, {
      headers: { 'x-test-user': 'swipe-owner' }
    });
    const ownerBody = await ownerResponse.json();

    assert.equal(foreignResponse.status, 404);
    assert.equal(ownerResponse.status, 200);
    assert.equal(ownerBody.content, 'owner-only message');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createSwipe rejects messages owned by another user', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'swipe-owner',
    'swipeowner',
    'hash',
    new Date().toISOString()
  );
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'swipe-other',
    'swipeother',
    'hash',
    new Date().toISOString()
  );
  const character = createCharacter(database, 'swipe-owner', { name: 'Swipe Character' });
  const timestamp = new Date().toISOString();
  database.prepare(
    'INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('swipe-conv', 'swipe-owner', character.id, 'Swipe Conversation', timestamp, timestamp);
  database.prepare(
    'INSERT INTO messages (id, user_id, conversation_id, role, content, reasoning, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('swipe-message', 'swipe-owner', 'swipe-conv', 'assistant', 'owner-only message', 'private reasoning', null, timestamp);

  const swipe = createSwipe(database, 'swipe-other', 'swipe-message', {
    content: 'foreign alternative'
  });

  assert.equal(swipe, null);
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM message_swipes WHERE message_id = ?').get('swipe-message').count,
    0
  );
});

test('setActiveSwipe saves current message against foreign duplicate content', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'swipe-owner',
    'swipeowner',
    'hash',
    new Date().toISOString()
  );
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'swipe-other',
    'swipeother',
    'hash',
    new Date().toISOString()
  );
  const character = createCharacter(database, 'swipe-owner', { name: 'Swipe Character' });
  const timestamp = new Date().toISOString();
  database.prepare(
    'INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('swipe-conv', 'swipe-owner', character.id, 'Swipe Conversation', timestamp, timestamp);
  database.prepare(
    'INSERT INTO messages (id, user_id, conversation_id, role, content, reasoning, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('swipe-message', 'swipe-owner', 'swipe-conv', 'assistant', 'owner-only message', 'private reasoning', null, timestamp);
  database.prepare(
    'INSERT INTO message_swipes (id, message_id, user_id, content, reasoning, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run('foreign-duplicate', 'swipe-message', 'swipe-other', 'owner-only message', '', null, timestamp);

  const alternate = createSwipe(database, 'swipe-owner', 'swipe-message', {
    content: 'alternate owner-only message',
    reasoning: 'alternate reasoning'
  });

  const result = setActiveSwipe(database, 'swipe-owner', 'swipe-message', alternate.id);

  assert.ok(result);
  assert.equal(result.content, 'alternate owner-only message');
  assert.equal(
    database
      .prepare('SELECT COUNT(*) AS count FROM message_swipes WHERE message_id = ? AND user_id = ? AND content = ?')
      .get('swipe-message', 'swipe-owner', 'owner-only message').count,
    1
  );
});

test('setActiveSwipe rolls back saved current message when activation update fails', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'swipe-owner',
    'swipeowner',
    'hash',
    new Date().toISOString()
  );
  const character = createCharacter(database, 'swipe-owner', { name: 'Swipe Character' });
  const timestamp = new Date().toISOString();
  database.prepare(
    'INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('swipe-conv', 'swipe-owner', character.id, 'Swipe Conversation', timestamp, timestamp);
  database.prepare(
    'INSERT INTO messages (id, user_id, conversation_id, role, content, reasoning, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('swipe-message', 'swipe-owner', 'swipe-conv', 'assistant', 'current message', 'current reasoning', null, timestamp);

  const alternate = createSwipe(database, 'swipe-owner', 'swipe-message', {
    content: 'blocked alternate message',
    reasoning: 'alternate reasoning'
  });
  database.exec(`
    CREATE TRIGGER fail_active_swipe_message_update
    BEFORE UPDATE OF content ON messages
    WHEN NEW.id = 'swipe-message' AND NEW.content = 'blocked alternate message'
    BEGIN
      SELECT RAISE(ABORT, 'forced active swipe update failure');
    END
  `);

  assert.throws(
    () => setActiveSwipe(database, 'swipe-owner', 'swipe-message', alternate.id),
    /forced active swipe update failure/
  );
  assert.equal(
    database.prepare('SELECT content FROM messages WHERE id = ?').get('swipe-message').content,
    'current message'
  );
  assert.equal(
    database
      .prepare('SELECT COUNT(*) AS count FROM message_swipes WHERE message_id = ? AND user_id = ? AND content = ?')
      .get('swipe-message', 'swipe-owner', 'current message').count,
    0
  );
  assert.deepEqual(
    listSwipes(database, 'swipe-owner', 'swipe-message').map((swipe) => swipe.content),
    ['blocked alternate message']
  );
});

test('swipes preserve insertion order when timestamps tie', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'swipe-owner',
    'swipeowner',
    'hash',
    new Date().toISOString()
  );
  const character = createCharacter(database, 'swipe-owner', { name: 'Swipe Character' });
  const timestamp = new Date().toISOString();
  const tiedTimestamp = '2000-01-01T00:00:00.000Z';
  database.prepare(
    'INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('swipe-conv', 'swipe-owner', character.id, 'Swipe Conversation', timestamp, timestamp);
  database.prepare(
    'INSERT INTO messages (id, user_id, conversation_id, role, content, reasoning, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('swipe-message', 'swipe-owner', 'swipe-conv', 'assistant', 'current message', '', null, timestamp);
  database.prepare(
    'INSERT INTO message_swipes (id, message_id, user_id, content, reasoning, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run('swipe-first', 'swipe-message', 'swipe-owner', 'first alternate', '', null, tiedTimestamp);
  database.prepare(
    'INSERT INTO message_swipes (id, message_id, user_id, content, reasoning, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run('swipe-second', 'swipe-message', 'swipe-owner', 'second alternate', '', null, tiedTimestamp);

  assert.deepEqual(
    listSwipes(database, 'swipe-owner', 'swipe-message').map((swipe) => swipe.id),
    ['swipe-first', 'swipe-second']
  );
  assert.deepEqual(getSwipeIndex(database, 'swipe-message', 'swipe-second'), { index: 1, total: 2 });
  assert.equal(setActiveSwipe(database, 'swipe-owner', 'swipe-message', 'swipe-second').activeIndex, 2);
});

test('character assistant completes drafts through multiple tool rounds', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, request = {}) => {
    calls += 1;
    const body = JSON.parse(request.body);
    assert.equal(body.tools.length, 4);
    assert.ok(body.tools.some((tool) => tool.function?.name === 'set_character_extensions'));
    const extensionsTool = body.tools.find((tool) => tool.function?.name === 'set_character_extensions');
    const statusBlueprintSchema = extensionsTool.function.parameters.properties.statusBarBlueprint;
    const statusValueSchema = statusBlueprintSchema.properties.variables.items.properties.value;
    assert.deepEqual(statusValueSchema.oneOf.map((schema) => schema.type), ['number', 'string']);
    assert.match(statusBlueprintSchema.description, /\{\{姓名\}\}/);
    assert.match(statusBlueprintSchema.description, /\{\{体力\.percent\}\}/);
    assert.match(body.messages[0].content, /\{\{变量名\}\}/);
    assert.match(body.messages[0].content, /\.sb-val/);
    assert.match(body.messages[0].content, /Do not hardcode dynamic fallback text/);

    if (calls === 1) {
      return jsonResponse({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: {
                    name: 'set_character_profile',
                    arguments: JSON.stringify({
                      name: '澄灯',
                      persona: '会把 {user} 当作熟客，但不会越界。',
                      tags: ['温和', '推理']
                    })
                  }
                }
              ]
            }
          }
        ]
      });
    }

    if (calls === 2) {
      assert.equal(body.messages.at(-1).role, 'tool');
      return jsonResponse({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call-2',
                  type: 'function',
                  function: {
                    name: 'add_regex_rule',
                    arguments: JSON.stringify({
                      label: '称呼替换',
                      pattern: '老板',
                      replacement: '掌柜',
                      scope: 'input'
                    })
                  }
                }
              ]
            }
          }
        ]
      });
    }

    return jsonResponse({
      choices: [{ message: { role: 'assistant', content: '设定已完成。' } }],
      usage: { total_tokens: 88 }
    });
  };

  let result;
  try {
    result = await completeCharacterDraft(
      {
        providerType: 'deepseek',
        gatewayName: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        apiKey: 'sk-test',
        extraBody: {},
        supportsReasoning: true
      },
      {
        requirement: '做一个温和的推理角色',
        current: {},
        user: { displayName: '赵雨乐', username: 'baigei' }
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls, 3);
  assert.equal(result.character.name, '澄灯');
  assert.match(result.character.persona, /\{user\}/);
  assert.deepEqual(result.character.tags, ['温和', '推理']);
  assert.equal(result.character.regexRules[0].pattern, '老板');
  assert.equal(result.toolCalls.length, 2);
});

test('character assistant respects disabled generation sections', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, request = {}) => {
      const body = JSON.parse(request.body);
      assert.match(body.messages[0].content, /Only modify these enabled sections/);
      return jsonResponse({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call-disabled',
                  type: 'function',
                  function: {
                    name: 'set_character_profile',
                    arguments: JSON.stringify({
                      name: 'Changed Name',
                      persona: 'Changed persona',
                      background: 'Changed background',
                      tags: ['changed']
                    })
                  }
                },
                {
                  id: 'call-regex',
                  type: 'function',
                  function: {
                    name: 'add_regex_rule',
                    arguments: JSON.stringify({
                      label: 'Blocked rule',
                      pattern: 'foo',
                      replacement: 'bar'
                    })
                  }
                }
              ]
            }
          }
        ]
      });
    };

    const result = await completeCharacterDraft(
      {
        providerType: 'deepseek',
        gatewayName: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        apiKey: 'sk-test',
        extraBody: {}
      },
      {
        requirement: 'only persona',
        current: {
          name: 'Original Name',
          persona: 'Original persona',
          background: 'Original background',
          tags: ['original'],
          regexRules: []
        },
        options: {
          profile: false,
          background: false,
          persona: true,
          tags: false,
          regexRules: false,
          renderPlugins: false,
          worldBookSuggestion: false,
          advancedSettings: false,
          modSuggestions: false
        }
      }
    );

    assert.equal(result.character.name, 'Original Name');
    assert.equal(result.character.background, 'Original background');
    assert.equal(result.character.persona, 'Changed persona');
    assert.deepEqual(result.character.tags, ['original']);
    assert.equal(result.character.regexRules.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('character assistant ignores null tool arguments', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'character-null-profile',
                    type: 'function',
                    function: {
                      name: 'set_character_profile',
                      arguments: 'null'
                    }
                  }
                ]
              }
            }
          ]
        });
      }
      return jsonResponse({
        choices: [{ message: { role: 'assistant', content: 'No profile changes.' } }]
      });
    };

    const result = await completeCharacterDraft(
      {
        providerType: 'deepseek',
        gatewayName: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        apiKey: 'sk-test',
        extraBody: {}
      },
      {
        requirement: 'keep existing profile',
        current: {
          name: 'Original Name',
          persona: 'Original persona',
          regexRules: []
        }
      }
    );

    assert.equal(calls, 2);
    assert.equal(result.character.name, 'Original Name');
    assert.equal(result.character.persona, 'Original persona');
    assert.equal(result.toolCalls[0].result.ok, true);
    assert.deepEqual(result.toolCalls[0].result.applied, {});
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('character assistant ignores non-object loose JSON fallback', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => jsonResponse({
      choices: [{ message: { role: 'assistant', content: 'null' } }]
    });

    const result = await completeCharacterDraft(
      {
        providerType: 'deepseek',
        gatewayName: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        apiKey: 'sk-test',
        extraBody: {}
      },
      {
        requirement: 'keep current draft',
        current: {
          name: 'Existing Draft',
          persona: 'Existing persona'
        }
      }
    );

    assert.equal(result.character.name, 'Existing Draft');
    assert.equal(result.character.persona, 'Existing persona');
    assert.equal(result.toolCalls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('character assistant treats null request as defaults', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, request = {}) => {
      const body = JSON.parse(request.body);
      const payload = JSON.parse(body.messages[1].content);
      assert.equal(payload.requirement, '');
      assert.equal(payload.optimizeExisting, false);
      assert.equal(payload.currentCharacter.name, '');

      return jsonResponse({
        choices: [{ message: { role: 'assistant', content: 'null' } }]
      });
    };

    const result = await completeCharacterDraft(
      {
        providerType: 'deepseek',
        gatewayName: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        apiKey: 'sk-test',
        extraBody: {}
      },
      null
    );

    assert.equal(result.character.name, '');
    assert.equal(result.character.regexRules.length, 0);
    assert.equal(result.toolCalls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('character assistant skips non-object generated array entries', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'character-mixed-regex',
                    type: 'function',
                    function: {
                      name: 'replace_regex_rules',
                      arguments: JSON.stringify({
                        rules: [
                          null,
                          'not a regex rule',
                          { label: 'Valid rule', pattern: 'foo', replacement: 'bar' }
                        ]
                      })
                    }
                  },
                  {
                    id: 'character-mixed-extensions',
                    type: 'function',
                    function: {
                      name: 'set_character_extensions',
                      arguments: JSON.stringify({
                        renderPlugins: [
                          null,
                          'not a render plugin',
                          { label: 'Valid fold', pattern: '\\[note\\]([\\s\\S]+?)\\[/note\\]', titleTemplate: 'Note' }
                        ],
                        modSuggestions: [
                          null,
                          'not a mod',
                          { name: 'Valid Mod', type: 'style', content: 'Use concise prose.' }
                        ]
                      })
                    }
                  }
                ]
              }
            }
          ]
        });
      }
      return jsonResponse({
        choices: [{ message: { role: 'assistant', content: 'Done.' } }]
      });
    };

    const result = await completeCharacterDraft(
      {
        providerType: 'deepseek',
        gatewayName: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        apiKey: 'sk-test',
        extraBody: {}
      },
      { requirement: 'mixed generated arrays', current: null }
    );

    assert.equal(calls, 2);
    assert.deepEqual(result.character.regexRules.map((rule) => rule.pattern), ['foo']);
    assert.deepEqual(result.character.renderPlugins.map((plugin) => plugin.label), ['Valid fold']);
    assert.deepEqual(result.character.modSuggestions.map((mod) => mod.name), ['Valid Mod']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('world book assistant normalizes AI draft fields for real entry creation', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => jsonResponse({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'wb-profile',
                type: 'function',
                function: {
                  name: 'set_world_book_profile',
                  arguments: JSON.stringify({
                    name: 'Court Lore',
                    description: 'Faction lore',
                    scanDepth: 8,
                    lorebookContextPercent: 30
                  })
                }
              },
              {
                id: 'wb-entries',
                type: 'function',
                function: {
                  name: 'replace_world_book_entries',
                  arguments: JSON.stringify({
                    entries: [
                      {
                        name: 'Duke House',
                        triggerKeys: 'duke,house',
                        content: 'The duke house controls the old port.',
                        position: 'at_depth',
                        role: 'assistant',
                        depth: 3,
                        useProbability: true,
                        probability: 50,
                        inclusionGroup: 'noble-rumor',
                        groupWeight: 2,
                        sticky: 2,
                        cooldown: 1,
                        delay: 0
                      }
                    ]
                  })
                }
              }
            ]
          }
        }
      ]
    });

    const result = await completeWorldBookDraft(
      {
        providerType: 'deepseek',
        gatewayName: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        apiKey: 'sk-test',
        extraBody: {}
      },
      { requirement: 'noble court lore' }
    );

    const database = createAppDatabase(':memory:');
    database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
      'wb-user',
      'worldbooker',
      'hash',
      new Date().toISOString()
    );
    const book = createWorldBook(database, 'wb-user', result.worldBook);
    const entry = createEntry(database, 'wb-user', book.id, result.worldBook.entries[0]);

    assert.equal(result.worldBook.scanDepth, 8);
    assert.equal(result.worldBook.entries[0].group, 'noble-rumor');
    assert.equal(result.worldBook.entries[0].role, 2);
    assert.equal(entry.group, 'noble-rumor');
    assert.equal(entry.role, 2);
    assert.equal(entry.position, 'at_depth');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('world book assistant skips non-object AI entries', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => jsonResponse({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'wb-mixed-entries',
                type: 'function',
                function: {
                  name: 'replace_world_book_entries',
                  arguments: JSON.stringify({
                    entries: [
                      null,
                      'not an entry',
                      {
                        name: 'Hidden Gate',
                        triggerKeys: 'gate,hidden',
                        content: 'The hidden gate opens at moonrise.'
                      }
                    ]
                  })
                }
              }
            ]
          }
        }
      ]
    });

    const result = await completeWorldBookDraft(
      {
        providerType: 'deepseek',
        gatewayName: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        apiKey: 'sk-test',
        extraBody: {}
      },
      { requirement: 'hidden gate lore', current: null }
    );

    assert.equal(result.worldBook.entries.length, 1);
    assert.equal(result.worldBook.entries[0].name, 'Hidden Gate');
    assert.equal(result.worldBook.entries[0].content, 'The hidden gate opens at moonrise.');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('world book assistant treats null request as defaults', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (_url, request = {}) => {
      calls += 1;
      const body = JSON.parse(request.body);
      if (calls === 1) {
        const payload = JSON.parse(body.messages[1].content);
        assert.equal(payload.requirement, '');
        assert.equal(payload.currentWorldBook.name, '');
        assert.equal(payload.currentWorldBook.entries.length, 0);

        return jsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'wb-null-request-entry',
                    type: 'function',
                    function: {
                      name: 'replace_world_book_entries',
                      arguments: JSON.stringify({
                        entries: [
                          {
                            name: 'Fallback Entry',
                            triggerKeys: 'fallback',
                            content: 'A safe default request can still create lore.'
                          }
                        ]
                      })
                    }
                  }
                ]
              }
            }
          ]
        });
      }

      return jsonResponse({
        choices: [{ message: { role: 'assistant', content: 'Done.' } }]
      });
    };

    const result = await completeWorldBookDraft(
      {
        providerType: 'deepseek',
        gatewayName: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        apiKey: 'sk-test',
        extraBody: {}
      },
      null
    );

    assert.equal(calls, 2);
    assert.equal(result.worldBook.name, 'Fallback Entry世界书');
    assert.equal(result.worldBook.entries.length, 1);
    assert.equal(result.worldBook.entries[0].content, 'A safe default request can still create lore.');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('world book assistant accepts fenced JSON drafts without no-tool retries', async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  try {
    globalThis.fetch = async () => {
      callCount += 1;
      return jsonResponse({
        choices: [
          {
            message: {
              role: 'assistant',
              content: [
                'The draft is ready:',
                '```json',
                JSON.stringify(
                  {
                    name: 'Fenced Lore',
                    description: 'Recovered from markdown JSON.',
                    entries: [
                      {
                        name: 'Hidden Gate',
                        triggerKeys: 'gate,hidden',
                        content: 'The hidden gate opens at moonrise.',
                        position: 'before_char'
                      }
                    ]
                  },
                  null,
                  2
                ),
                '```'
              ].join('\n')
            }
          }
        ]
      });
    };

    const result = await completeWorldBookDraft(
      {
        providerType: 'deepseek',
        gatewayName: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        apiKey: 'sk-test',
        extraBody: {}
      },
      { requirement: 'hidden gate lore' }
    );

    assert.equal(callCount, 1);
    assert.equal(result.worldBook.name, 'Fenced Lore');
    assert.equal(result.worldBook.entries.length, 1);
    assert.equal(result.worldBook.entries[0].name, 'Hidden Gate');
    assert.equal(result.worldBook.entries[0].content, 'The hidden gate opens at moonrise.');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('world book assistant rejects null tool arguments as empty draft', async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  try {
    globalThis.fetch = async () => {
      callCount += 1;
      if (callCount === 1) {
        return jsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'wb-null-entries',
                    type: 'function',
                    function: {
                      name: 'replace_world_book_entries',
                      arguments: 'null'
                    }
                  }
                ]
              }
            }
          ]
        });
      }
      return jsonResponse({
        choices: [{ message: { role: 'assistant', content: 'No usable entries.' } }]
      });
    };

    await assert.rejects(
      completeWorldBookDraft(
        {
          providerType: 'deepseek',
          gatewayName: 'DeepSeek',
          baseUrl: 'https://api.deepseek.com',
          model: 'deepseek-v4-flash',
          apiKey: 'sk-test',
          extraBody: {}
        },
        { requirement: 'null tool args' }
      ),
      (error) => error instanceof Error && error.message.startsWith('AI ')
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('world book assistant rejects empty AI drafts', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => jsonResponse({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'wb-profile',
                type: 'function',
                function: {
                  name: 'set_world_book_profile',
                  arguments: JSON.stringify({
                    name: 'Empty Lore',
                    description: 'No usable entries'
                  })
                }
              },
              {
                id: 'wb-entries',
                type: 'function',
                function: {
                  name: 'replace_world_book_entries',
                  arguments: JSON.stringify({ entries: [] })
                }
              }
            ]
          }
        }
      ]
    });

    await assert.rejects(
      completeWorldBookDraft(
        {
          providerType: 'deepseek',
          gatewayName: 'DeepSeek',
          baseUrl: 'https://api.deepseek.com',
          model: 'deepseek-v4-flash',
          apiKey: 'sk-test',
          extraBody: {}
        },
        { requirement: 'empty lore' }
      ),
      /没有生成有效/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('world book assistant rejects entries without usable content', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => jsonResponse({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'wb-invalid-entries',
                type: 'function',
                function: {
                  name: 'replace_world_book_entries',
                  arguments: JSON.stringify({
                    entries: [
                      { name: 'Only Name', content: '' },
                      { name: 'Whitespace', content: '   ' }
                    ]
                  })
                }
              }
            ]
          }
        }
      ]
    });

    await assert.rejects(
      completeWorldBookDraft(
        {
          providerType: 'deepseek',
          gatewayName: 'DeepSeek',
          baseUrl: 'https://api.deepseek.com',
          model: 'deepseek-v4-flash',
          apiKey: 'sk-test',
          extraBody: {}
        },
        { requirement: 'invalid lore' }
      ),
      /没有生成有效/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('world book assistant continues when model promises entries without tool call', async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  try {
    globalThis.fetch = async () => {
      callCount += 1;
      if (callCount === 1) {
        return jsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'wb-profile',
                    type: 'function',
                    function: {
                      name: 'set_world_book_profile',
                      arguments: JSON.stringify({
                        name: 'Court Lore',
                        description: 'Faction lore'
                      })
                    }
                  }
                ]
              }
            }
          ]
        });
      }
      if (callCount === 2) {
        return jsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: '基本信息已设定。接下来一次性写入全部条目。'
              }
            }
          ]
        });
      }
      if (callCount === 3) {
        return jsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'wb-entries',
                    type: 'function',
                    function: {
                      name: 'replace_world_book_entries',
                      arguments: JSON.stringify({
                        entries: [
                          {
                            name: 'Duke House',
                            triggerKeys: 'duke,house',
                            content: 'The duke house controls the old port.'
                          }
                        ]
                      })
                    }
                  }
                ]
              }
            }
          ]
        });
      }
      return jsonResponse({
        choices: [
          {
            message: {
              role: 'assistant',
              content: '完成。'
            }
          }
        ]
      });
    };

    const result = await completeWorldBookDraft(
      {
        providerType: 'deepseek',
        gatewayName: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        apiKey: 'sk-test',
        extraBody: {}
      },
      { requirement: 'noble court lore' }
    );

    assert.equal(callCount, 4);
    assert.equal(result.worldBook.entries.length, 1);
    assert.equal(result.worldBook.entries[0].name, 'Duke House');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('new users start without built-in characters', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'user-2';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    'seeded',
    'hash',
    new Date().toISOString()
  );

  const count = database.prepare('SELECT COUNT(*) AS count FROM characters WHERE user_id = ?').get(userId);
  assert.equal(count.count, 0);
});

test('owned character stats preserve newest insertion order when activity timestamps tie', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'owned-character-order-user';
  const timestamp = '2026-01-01T00:00:00.000Z';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'owned-character-order', 'hash', timestamp
  );
  const character1 = createCharacter(database, userId, { name: 'First Owned Character', visibility: 'private' });
  const character2 = createCharacter(database, userId, { name: 'Second Owned Character', visibility: 'public' });
  database
    .prepare('UPDATE characters SET created_at = ?, last_used_at = ? WHERE id IN (?, ?)')
    .run(timestamp, timestamp, character1.id, character2.id);

  assert.deepEqual(
    getOwnedCharacterStats(database, userId).map((character) => character.id),
    [character2.id, character1.id]
  );
});

test('character visibility separates owners from public users', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'owner-1',
    'owner',
    'hash',
    new Date().toISOString()
  );
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1',
    'visitor',
    'hash',
    new Date().toISOString()
  );

  const privateRole = createCharacter(database, 'owner-1', {
    name: '私人角色',
    persona: '只给拥有者使用',
    visibility: 'private'
  });
  const publicRole = createCharacter(database, 'owner-1', {
    name: '公开角色',
    persona: '可以被其他用户使用',
    visibility: 'public',
    regexRules: [{ label: '公开规则', pattern: '猫', replacement: '伙伴', scope: 'input' }]
  });

  assert.equal(getCharacter(database, 'user-1', privateRole.id), null);

  const publicForUser = getCharacter(database, 'user-1', publicRole.id);
  assert.equal(publicForUser.canUse, true);
  assert.equal(publicForUser.canEdit, false);
  assert.equal(publicForUser.isOwner, false);
  assert.equal(publicForUser.regexRules.length, 1);

  const visibleToUser = listCharacters(database, 'user-1').map((character) => character.id);
  assert.deepEqual(visibleToUser, [publicRole.id]);

  assert.equal(updateCharacter(database, 'user-1', publicRole.id, { name: '篡改' }), null);
  assert.equal(deleteCharacter(database, 'user-1', publicRole.id), false);

  const updated = updateCharacter(database, 'owner-1', publicRole.id, { visibility: 'private' });
  assert.equal(updated.visibility, 'private');
  assert.equal(getCharacter(database, 'user-1', publicRole.id), null);
});

test('character likes and favorites persist per viewer', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'owner-1',
    'owner',
    'hash',
    new Date().toISOString()
  );
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'viewer-1',
    'viewer',
    'hash',
    new Date().toISOString()
  );

  const character = createCharacter(database, 'owner-1', {
    name: 'Reaction Test',
    visibility: 'public'
  });

  assert.equal(setCharacterLike(database, 'viewer-1', character.id, true).likedByMe, true);
  assert.equal(setCharacterFavorite(database, 'viewer-1', character.id, true).favoritedByMe, true);

  const viewerCharacter = listCharacters(database, 'viewer-1')[0];
  assert.equal(viewerCharacter.likeCount, 1);
  assert.equal(viewerCharacter.favoriteCount, 1);
  assert.equal(viewerCharacter.likedByMe, true);
  assert.equal(viewerCharacter.favoritedByMe, true);

  const ownerCharacter = listCharacters(database, 'owner-1')[0];
  assert.equal(ownerCharacter.likeCount, 1);
  assert.equal(ownerCharacter.favoriteCount, 1);
  assert.equal(ownerCharacter.likedByMe, false);
  assert.equal(ownerCharacter.favoritedByMe, false);

  assert.equal(setCharacterLike(database, 'viewer-1', character.id, false).likedByMe, false);
  assert.equal(setCharacterFavorite(database, 'viewer-1', character.id, false).favoritedByMe, false);
});

test('avatars are stored as base64 assets and exposed through short URLs', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'owner-1',
    'owner',
    'hash',
    new Date().toISOString()
  );
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'viewer-1',
    'viewer',
    'hash',
    new Date().toISOString()
  );

  const dataUrl = 'data:image/png;base64,AQIDBA==';
  const character = createCharacter(database, 'owner-1', {
    name: 'Avatar Test',
    avatarUrl: dataUrl,
    visibility: 'private'
  });
  assert.match(character.avatarUrl, /^\/api\/avatars\/[-0-9a-f]+$/);

  const assetId = character.avatarUrl.split('/').pop();
  const assetRow = database.prepare('SELECT * FROM avatar_assets WHERE id = ?').get(assetId);
  assert.equal(assetRow.owner_type, 'character');
  assert.equal(assetRow.owner_id, character.id);
  assert.equal(assetRow.base64_data, 'AQIDBA==');
  assert.equal(assetRow.mime_type, 'image/png');
  assert.equal(database.prepare('SELECT avatar_url FROM characters WHERE id = ?').get(character.id).avatar_url, character.avatarUrl);

  assert.equal(getAvatarAssetForViewer(database, 'owner-1', assetId).base64Data, 'AQIDBA==');
  assert.equal(getAvatarAssetForViewer(database, 'viewer-1', assetId), null);

  updateCharacter(database, 'owner-1', character.id, { visibility: 'public' });
  assert.equal(getAvatarAssetForViewer(database, 'viewer-1', assetId).base64Data, 'AQIDBA==');

  const userAvatarUrl = saveAvatarInput(database, {
    userId: 'owner-1',
    ownerType: 'user',
    ownerId: 'owner-1',
    value: dataUrl
  });
  assert.match(userAvatarUrl, /^\/api\/avatars\/[-0-9a-f]+$/);
  assert.equal(getUserAvatarUrl(database, 'owner-1'), userAvatarUrl);
  assert.equal(getAvatarAssetForViewer(database, 'viewer-1', userAvatarUrl.split('/').pop()), null);
});

test('avatar data URLs reject malformed base64 payloads', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'owner-1',
    'owner',
    'hash',
    new Date().toISOString()
  );

  assert.throws(
    () => saveAvatarInput(database, {
      userId: 'owner-1',
      ownerType: 'user',
      ownerId: 'owner-1',
      value: 'data:image/png;base64,A'
    }),
    /Invalid avatar image data/
  );
  assert.throws(
    () => saveAvatarInput(database, {
      userId: 'owner-1',
      ownerType: 'user',
      ownerId: 'owner-1',
      value: 'data:image/png;base64,AA=A'
    }),
    /Invalid avatar image data/
  );
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM avatar_assets').get().count, 0);
});

test('conversation appearance settings persist empty values and custom code', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'owner-1',
    'owner',
    'hash',
    new Date().toISOString()
  );

  const character = createCharacter(database, 'owner-1', {
    name: 'Appearance Test',
    visibility: 'private'
  });

  const conversationId = 'conversation-1';
  const timestamp = new Date().toISOString();
  database.prepare(
    `INSERT INTO conversations (id, user_id, character_id, title, desktop_background_url, mobile_background_url, custom_css, custom_js, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    conversationId,
    'owner-1',
    character.id,
    'Appearance Test 的故事',
    '',
    '',
    '',
    '',
    timestamp,
    timestamp
  );

  const saved = saveConversationAppearance(database, 'owner-1', conversationId, {
    desktopBackgroundUrl: 'data:image/png;base64,AQID',
    mobileBackgroundUrl: '',
    customCss: ' .deep-bubble { border-radius: 24px; } ',
    customJs: 'return () => {}'
  });

  assert.match(saved.desktopBackgroundUrl, /^\/api\/avatars\/[-0-9a-f]+$/i);
  assert.deepEqual(saved, {
    desktopBackgroundUrl: saved.desktopBackgroundUrl,
    mobileBackgroundUrl: '',
    customCss: ' .deep-bubble { border-radius: 24px; } ',
    customJs: 'return () => {}'
  });

  assert.deepEqual(getConversationAppearance(database, 'owner-1', conversationId), saved);
  const row = database
    .prepare('SELECT desktop_background_url, mobile_background_url FROM conversations WHERE id = ?')
    .get(conversationId);
  const asset = database
    .prepare(
      `SELECT owner_type, owner_id, mime_type, base64_data, byte_size
       FROM avatar_assets
       WHERE owner_type = ? AND owner_id = ?`
    )
    .get(conversationBackgroundOwnerTypes.desktop, conversationId);

  assert.equal(row.desktop_background_url, saved.desktopBackgroundUrl);
  assert.equal(row.mobile_background_url, '');
  assert.equal(asset.owner_type, conversationBackgroundOwnerTypes.desktop);
  assert.equal(asset.owner_id, conversationId);
  assert.equal(asset.mime_type, 'image/png');
  assert.equal(asset.base64_data, 'AQID');
  assert.equal(asset.byte_size, 3);

  const cleared = saveConversationAppearance(database, 'owner-1', conversationId, {
    desktopBackgroundUrl: '',
    mobileBackgroundUrl: '',
    customCss: saved.customCss,
    customJs: saved.customJs
  });
  const remainingAssets = database
    .prepare('SELECT COUNT(*) AS count FROM avatar_assets WHERE owner_type = ? AND owner_id = ?')
    .get(conversationBackgroundOwnerTypes.desktop, conversationId);

  assert.equal(cleared.desktopBackgroundUrl, '');
  assert.equal(remainingAssets.count, 0);
});

test('conversation appearance treats null input as defaults', () => {
  assert.deepEqual(normalizeConversationAppearance(null), {
    desktopBackgroundUrl: '',
    mobileBackgroundUrl: '',
    customCss: '',
    customJs: '',
    statusBarPrompt: ''
  });
});

test('conversation settings schema accepts large background data URLs', () => {
  const dataUrl = `data:image/png;base64,${'A'.repeat(5200)}`;
  const parsed = saveConversationSettingsSchema.parse({
    desktopBackgroundUrl: dataUrl,
    mobileBackgroundUrl: dataUrl
  });

  assert.equal(parsed.desktopBackgroundUrl, dataUrl);
  assert.equal(parsed.mobileBackgroundUrl, dataUrl);
});

test('OpenAI-compatible streaming parser separates reasoning and content', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(sseStream([
      'data: {"choices":[{"delta":{"reasoning_content":"思考"}}]}',
      'data: {"choices":[{"delta":{"content":"你好"}}]}',
      'data: [DONE]'
    ]));

  let events;
  let result;
  try {
    events = [];
    result = await streamCompletion(
      {
        providerType: 'deepseek',
        gatewayName: 'DeepSeek',
        baseUrl: 'https://example.test',
        model: 'deepseek-reasoner',
        apiKey: 'sk-test',
        supportsReasoning: true,
        extraBody: {}
      },
      [{ role: 'user', content: 'hi' }],
      (event, data) => events.push({ event, data })
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(result.reasoning, '思考');
  assert.equal(result.content, '你好');
  assert.deepEqual(
    events.map((event) => event.event),
    ['reasoning', 'content']
  );
});

test('streamToolCompletion treats null options as defaults', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody = null;
  try {
    globalThis.fetch = async (_url, request = {}) => {
      requestBody = JSON.parse(request.body);
      return new Response(sseStream([
        'data: {"choices":[{"delta":{"content":"done"}}]}',
        'data: [DONE]'
      ]));
    };

    const events = [];
    const result = await streamToolCompletion(
      {
        providerType: 'custom',
        gatewayName: 'Custom',
        baseUrl: 'https://provider.test',
        model: 'custom-model',
        apiKey: 'sk-test',
        supportsReasoning: false,
        extraBody: {}
      },
      [{ role: 'user', content: 'hi' }],
      [
        {
          type: 'function',
          function: {
            name: 'set_value',
            description: 'set a value',
            parameters: {
              type: 'object',
              properties: { value: { type: 'number' } }
            }
          }
        }
      ],
      async () => ({ ok: true }),
      (event, data) => events.push({ event, data }),
      undefined,
      null
    );

    assert.equal(result.content, 'done');
    assert.equal(requestBody.tool_choice, 'auto');
    assert.equal(requestBody.tools[0].function.name, 'set_value');
    assert.deepEqual(events.map((event) => event.event), ['step', 'content']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('generateCompletion treats null options as defaults', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody = null;
  try {
    globalThis.fetch = async (_url, request = {}) => {
      requestBody = JSON.parse(request.body);
      return jsonResponse({
        output_text: 'done',
        usage: { total_tokens: 3 }
      });
    };

    const result = await generateCompletion(
      {
        providerType: 'xai',
        gatewayName: 'xAI',
        baseUrl: 'https://api.x.ai/v1',
        model: 'grok-4.1',
        apiKey: 'sk-test',
        supportsReasoning: true,
        extraBody: {}
      },
      [{ role: 'user', content: 'hi' }],
      null
    );

    assert.equal(result.content, 'done');
    assert.equal(result.usage.total_tokens, 3);
    assert.equal(requestBody.model, 'grok-4.1');
    assert.deepEqual(requestBody.reasoning, { effort: 'high' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamCompletion treats null options as defaults', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody = null;
  try {
    globalThis.fetch = async (_url, request = {}) => {
      requestBody = JSON.parse(request.body);
      return new Response(sseStream([
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"done"}',
        'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"total_tokens":4}}}'
      ]));
    };

    const events = [];
    const result = await streamCompletion(
      {
        providerType: 'xai',
        gatewayName: 'xAI',
        baseUrl: 'https://api.x.ai/v1',
        model: 'grok-4.1',
        apiKey: 'sk-test',
        supportsReasoning: true,
        extraBody: {}
      },
      [{ role: 'user', content: 'hi' }],
      (event, data) => events.push({ event, data }),
      undefined,
      null
    );

    assert.equal(result.content, 'done');
    assert.equal(result.usage.total_tokens, 4);
    assert.equal(requestBody.stream, true);
    assert.deepEqual(requestBody.reasoning, { effort: 'high' });
    assert.deepEqual(events.map((event) => event.event), ['content']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OpenAI-compatible parser strips thinking tags from non-stream content', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    jsonResponse({
      choices: [
        {
          message: {
            content: '<thinking>plan</thinking>正文'
          }
        }
      ]
    });

  try {
    const result = await generateCompletion(
      {
        providerType: 'custom',
        gatewayName: 'Custom',
        baseUrl: 'https://example.test',
        model: 'local-model',
        apiKey: 'sk-test',
        supportsReasoning: false,
        extraBody: {}
      },
      [{ role: 'user', content: 'hi' }]
    );

    assert.equal(result.content, '正文');
    assert.equal(result.reasoning, 'plan');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('generateCompletion rejects non-object JSON responses', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse('upstream-ok-but-invalid-shape');

  try {
    await assert.rejects(
      generateCompletion(
        {
          providerType: 'custom',
          gatewayName: 'Custom',
          baseUrl: 'https://example.test',
          model: 'local-model',
          apiKey: 'sk-test',
          supportsReasoning: false,
          extraBody: {}
        },
        [{ role: 'user', content: 'hi' }]
      ),
      /response JSON must be an object/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OpenAI-compatible streaming parser strips split thinking tags from content', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(sseStream([
      'data: {"choices":[{"delta":{"content":"<thin"}}]}',
      'data: {"choices":[{"delta":{"content":"king>plan</thi"}}]}',
      'data: {"choices":[{"delta":{"content":"nking>正文"}}]}',
      'data: [DONE]'
    ]));

  const events = [];
  try {
    const result = await streamCompletion(
      {
        providerType: 'custom',
        gatewayName: 'Custom',
        baseUrl: 'https://example.test',
        model: 'local-model',
        apiKey: 'sk-test',
        supportsReasoning: false,
        extraBody: {}
      },
      [{ role: 'user', content: 'hi' }],
      (event, data) => events.push({ event, data })
    );

    assert.equal(result.content, '正文');
    assert.equal(result.reasoning, 'plan');
    assert.deepEqual(
      events.filter((event) => event.event === 'content').map((event) => event.data.text),
      ['正文']
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OpenAI-compatible streaming parser reads reasoning_details deltas', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(sseStream([
        'data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.text.delta","text":"plan"}]}}]}',
        'data: {"choices":[{"delta":{"content":" done"}}]}',
        'data: [DONE]'
      ]));

    const result = await streamCompletion(
      {
        providerType: 'custom',
        gatewayName: 'Custom',
        baseUrl: 'https://example.test',
        model: 'claude-thinking',
        apiKey: 'sk-test',
        supportsReasoning: true,
        extraBody: {}
      },
      [{ role: 'user', content: 'hi' }],
      () => {}
    );

    assert.equal(result.reasoning, 'plan');
    assert.equal(result.content, ' done');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OpenAI-compatible parser reads DashScope-style output message reasoning', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    jsonResponse({
      output: {
        choices: [
          {
            message: {
              reasoning_content: 'plan',
              content: 'answer'
            }
          }
        ]
      }
    });

  try {
    const result = await generateCompletion(
      {
        providerType: 'qwen',
        gatewayName: 'Qwen',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: 'qwen3-plus',
        apiKey: 'sk-test',
        supportsReasoning: true,
        extraBody: {}
      },
      [{ role: 'user', content: 'hi' }]
    );

    assert.equal(result.reasoning, 'plan');
    assert.equal(result.content, 'answer');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OpenAI-compatible streaming parser reads output message reasoning chunks', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(sseStream([
      'data: {"output":{"choices":[{"message":{"reasoning_content":"plan"}}]}}',
      'data: {"output":{"choices":[{"message":{"content":"answer"}}]}}',
      'data: [DONE]'
    ]));

  const events = [];
  try {
    const result = await streamCompletion(
      {
        providerType: 'qwen',
        gatewayName: 'Qwen',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: 'qwen3-plus',
        apiKey: 'sk-test',
        supportsReasoning: true,
        extraBody: {}
      },
      [{ role: 'user', content: 'hi' }],
      (event, data) => events.push({ event, data })
    );

    assert.equal(result.reasoning, 'plan');
    assert.equal(result.content, 'answer');
    assert.deepEqual(events.map((event) => event.event), ['reasoning', 'content']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OpenAI-compatible streaming parser reads thought content array chunks', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(sseStream([
      'data: {"choices":[{"delta":{"content":[{"type":"text","thought":true,"text":"plan"}]}}]}',
      'data: {"choices":[{"delta":{"content":[{"type":"text","text":"answer"}]}}]}',
      'data: [DONE]'
    ]));

  const events = [];
  try {
    const result = await streamCompletion(
      {
        providerType: 'gemini',
        gatewayName: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        model: 'gemini-2.5-flash',
        apiKey: 'sk-test',
        supportsReasoning: true,
        extraBody: {}
      },
      [{ role: 'user', content: 'hi' }],
      (event, data) => events.push({ event, data })
    );

    assert.equal(result.reasoning, 'plan');
    assert.equal(result.content, 'answer');
    assert.deepEqual(events.map((event) => event.event), ['reasoning', 'content']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OpenAI Responses streaming parser reads summary deltas', async () => {
  const originalFetch = globalThis.fetch;
  let result;
  try {
    globalThis.fetch = async () =>
      new Response(sseStream([
      'event: response.reasoning_summary_text.delta\ndata: {"type":"response.reasoning_summary_text.delta","delta":"摘要"}',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"正文"}',
      'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"total_tokens":12}}}'
    ]));

    result = await streamCompletion(
      {
        providerType: 'openai',
        gatewayName: 'OpenAI',
        baseUrl: 'https://example.test/v1',
        model: 'o4-mini',
        apiKey: 'sk-test',
        supportsReasoning: true,
        extraBody: {}
      },
      [{ role: 'user', content: 'hi' }],
      () => {}
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(result.reasoning, '摘要');
  assert.equal(result.content, '正文');
  assert.equal(result.usage.total_tokens, 12);
});

test('Responses streaming parser forwards non-summary reasoning deltas', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(sseStream([
      'event: response.reasoning_text.delta\ndata: {"type":"response.reasoning_text.delta","delta":"plan"}',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"answer"}',
      'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"total_tokens":12}}}'
    ]));

  const events = [];
  try {
    const result = await streamCompletion(
      {
        providerType: 'xai',
        gatewayName: 'xAI',
        baseUrl: 'https://api.x.ai/v1',
        model: 'grok-4.1',
        apiKey: 'sk-test',
        supportsReasoning: true,
        extraBody: {}
      },
      [{ role: 'user', content: 'hi' }],
      (event, data) => events.push({ event, data })
    );

    assert.equal(result.reasoning, 'plan');
    assert.equal(result.content, 'answer');
    assert.deepEqual(events.map((event) => event.event), ['reasoning', 'content']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OpenAI Responses request protects reserved fields from extra body', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody = null;
  globalThis.fetch = async (_url, request = {}) => {
    requestBody = JSON.parse(request.body);
    return jsonResponse({
      output_text: 'done',
      model: 'o4-mini',
      usage: { total_tokens: 1 }
    });
  };

  try {
    const result = await generateCompletion(
      {
        providerType: 'openai',
        gatewayName: 'OpenAI',
        baseUrl: 'https://example.test/v1',
        model: 'o4-mini',
        apiKey: 'sk-test',
        supportsReasoning: true,
        extraBody: {
          model: 'bad-model',
          input: 'bad-input',
          stream: true,
          custom_flag: 'kept',
          reasoning: { effort: 'high' }
        }
      },
      [{ role: 'user', content: 'hi' }],
      { thinkingEnabled: true }
    );

    assert.equal(result.content, 'done');
    assert.equal(requestBody.model, 'o4-mini');
    assert.deepEqual(requestBody.input, [{ role: 'user', content: 'hi' }]);
    assert.equal(requestBody.stream, false);
    assert.equal(requestBody.custom_flag, 'kept');
    assert.deepEqual(requestBody.reasoning, { effort: 'high' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('provider model list normalizes official /models responses', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: 'deepseek-chat', owned_by: 'deepseek' },
            { id: 'deepseek-reasoner', owned_by: 'deepseek' }
          ]
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );

    const models = await listProviderModels({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-test'
    });

    assert.deepEqual(
      models.map((model) => model.id),
      ['deepseek-chat', 'deepseek-reasoner']
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('provider model list treats null options as defaults', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ models: ['zeta-model', 'alpha-model'] }), {
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const models = await listProviderModels(
      {
        providerType: 'custom',
        gatewayName: 'Null Options Models',
        baseUrl: 'https://null-options-models.example/v1',
        model: 'alpha-model',
        apiKey: 'sk-null-options',
        extraBody: {}
      },
      null
    );

    assert.equal(calls, 1);
    assert.deepEqual(models.map((model) => model.id), ['alpha-model', 'zeta-model']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('provider model cache refreshes when API key changes', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, request = {}) => {
    const authorization = new Headers(request.headers).get('authorization') || '';
    calls.push(authorization);
    const suffix = authorization.endsWith('sk-second') ? 'second' : 'first';
    return new Response(JSON.stringify({ data: [{ id: `model-${suffix}` }] }), {
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const settings = {
      providerType: 'custom',
      gatewayName: 'Cache Test',
      baseUrl: 'https://cache-key.example/v1',
      model: 'model-first',
      apiKey: 'sk-first',
      extraBody: {}
    };

    const first = await listProviderModels(settings);
    const cached = await listProviderModels(settings);
    const refreshed = await listProviderModels({ ...settings, apiKey: 'sk-second' });

    assert.deepEqual(first.map((model) => model.id), ['model-first']);
    assert.deepEqual(cached.map((model) => model.id), ['model-first']);
    assert.deepEqual(refreshed.map((model) => model.id), ['model-second']);
    assert.deepEqual(calls, ['Bearer sk-first', 'Bearer sk-second']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('provider model list preserves non-JSON upstream error text', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response('upstream gateway overloaded', {
        status: 502,
        statusText: 'Bad Gateway',
        headers: { 'Content-Type': 'text/plain' }
      });

    await assert.rejects(
      () =>
        listProviderModels({
          providerType: 'custom',
          gatewayName: 'Plain Text Error',
          baseUrl: 'https://plain-error.example/v1',
          model: 'model',
          apiKey: 'sk-test',
          extraBody: {}
        }),
      { message: /upstream gateway overloaded/ }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('custom local proxy can be used without an API key', async () => {
  const settings = {
    providerType: 'custom',
    gatewayName: 'Local proxy',
    baseUrl: 'http://127.0.0.1:8317/v1',
    model: 'local-model',
    apiKey: ''
  };
  const originalFetch = globalThis.fetch;
  let authorization = 'unset';
  try {
    globalThis.fetch = async (_url, request = {}) => {
      authorization = new Headers(request.headers).get('authorization');
      return new Response(JSON.stringify({ data: [{ id: 'local-model' }] }), {
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const models = await listProviderModels(settings);

    assert.equal(hasUsableProvider(settings), true);
    assert.equal(authorization, null);
    assert.deepEqual(models.map((model) => model.id), ['local-model']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('custom local proxy retries without Authorization after auth rejection', async () => {
  const originalFetch = globalThis.fetch;
  const authorizations = [];
  try {
    globalThis.fetch = async (_url, request = {}) => {
      authorizations.push(new Headers(request.headers).get('authorization'));
      if (authorizations.length === 1) {
        return new Response(JSON.stringify({ error: { message: 'bad token' } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ data: [{ id: 'local-model' }] }), {
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const models = await listProviderModels({
      providerType: 'custom',
      gatewayName: 'Local proxy',
      baseUrl: 'http://127.0.0.1:8317/v1',
      model: 'local-model',
      apiKey: 'sk-wrong'
    });

    assert.deepEqual(authorizations, ['Bearer sk-wrong', null]);
    assert.deepEqual(models.map((model) => model.id), ['local-model']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('DeepSeek usage snapshots calculate total tokens and CNY cost', () => {
  const usage = buildUsageSnapshot(
    {
      prompt_tokens: 3000,
      prompt_cache_hit_tokens: 1000,
      prompt_cache_miss_tokens: 2000,
      completion_tokens: 3000,
      total_tokens: 6000
    },
    {
      providerType: 'deepseek',
      model: 'deepseek-v4-flash'
    }
  );

  assert.equal(usage._flai.totalTokens, 6000);
  assert.equal(usage._flai.totalCostCny, 0.00802);
  assert.deepEqual(summarizeUsageSnapshots([usage, usage]), {
    totalTokens: 12000,
    totalCostCny: 0.01604,
    currency: 'CNY'
  });
});

test('unknown provider usage snapshots count tokens without pricing', () => {
  const usage = buildUsageSnapshot(
    {
      total_tokens: 123
    },
    {
      providerType: 'custom',
      model: 'unknown-model'
    }
  );

  assert.equal(usage._flai.totalTokens, 123);
  assert.equal(usage._flai.totalCostCny, null);
  assert.deepEqual(summarizeUsageSnapshots([usage]), {
    totalTokens: 123,
    totalCostCny: null,
    currency: 'CNY'
  });
});

test('usage snapshots treat null metadata as defaults', () => {
  const usage = buildUsageSnapshot(
    {
      prompt_tokens: 4,
      completion_tokens: 6
    },
    null
  );

  assert.equal(usage._flai.providerType, '');
  assert.equal(usage._flai.totalTokens, 10);
  assert.equal(usage._flai.totalCostCny, null);
});

test('DeepSeek thinking switch maps to official V4 thinking request fields', () => {
  const enabled = buildProviderBody(
    {
      providerType: 'deepseek',
      model: 'deepseek-v4-flash',
      supportsReasoning: true,
      extraBody: {}
    },
    [{ role: 'user', content: 'hi' }],
    true,
    { thinkingEnabled: true, temperature: 0.7, topP: 0.9 }
  );
  const disabled = buildProviderBody(
    {
      providerType: 'deepseek',
      model: 'deepseek-v4-flash',
      supportsReasoning: true,
      extraBody: {}
    },
    [{ role: 'user', content: 'hi' }],
    true,
    { thinkingEnabled: false, temperature: 0.7 }
  );

  assert.deepEqual(enabled.thinking, { type: 'enabled' });
  assert.equal(enabled.reasoning_effort, 'high');
  assert.equal(enabled.temperature, undefined);
  assert.deepEqual(disabled.thinking, { type: 'disabled' });
  assert.equal(enabled.model, 'deepseek-v4-flash');
  assert.equal(disabled.model, 'deepseek-v4-flash');
  assert.equal(disabled.reasoning_effort, undefined);
  assert.equal(disabled.temperature, 0.7);
});

test('custom reasoning provider does not synthesize provider-specific thinking fields', () => {
  const enabled = buildProviderBody(
    {
      providerType: 'custom',
      model: 'claude-opus-thinking',
      supportsReasoning: true,
      extraBody: {}
    },
    [{ role: 'user', content: 'hi' }],
    true,
    { thinkingEnabled: true }
  );
  const preserved = buildProviderBody(
    {
      providerType: 'custom',
      model: 'claude-opus-thinking',
      supportsReasoning: true,
      extraBody: { thinking: { type: 'enabled', budget_tokens: 2048 } }
    },
    [{ role: 'user', content: 'hi' }],
    true,
    { thinkingEnabled: false }
  );

  assert.equal(enabled.thinking, undefined);
  assert.deepEqual(preserved.thinking, { type: 'enabled', budget_tokens: 2048 });
});

test('Gemini thinking switch uses OpenAI-compatible native reasoning effort', () => {
  const enabled = buildProviderBody(
    {
      providerType: 'gemini',
      model: 'gemini-2.5-flash',
      supportsReasoning: true,
      extraBody: {}
    },
    [{ role: 'user', content: 'hi' }],
    true,
    { thinkingEnabled: true, temperature: 0.7, topP: 0.9 }
  );
  const disabled = buildProviderBody(
    {
      providerType: 'gemini',
      model: 'gemini-2.5-flash',
      supportsReasoning: true,
      extraBody: {}
    },
    [{ role: 'user', content: 'hi' }],
    true,
    { thinkingEnabled: false, temperature: 0.7 }
  );

  assert.equal(enabled.reasoning_effort, 'high');
  assert.equal(disabled.reasoning_effort, 'none');
  assert.equal(enabled.thinking, undefined);
});

test('Mistral thinking switch uses native reasoning effort', () => {
  const enabled = buildProviderBody(
    {
      providerType: 'mistral',
      model: 'mistral-medium-3-5',
      supportsReasoning: true,
      extraBody: {}
    },
    [{ role: 'user', content: 'hi' }],
    true,
    { thinkingEnabled: true }
  );
  const disabled = buildProviderBody(
    {
      providerType: 'mistral',
      model: 'mistral-medium-3-5',
      supportsReasoning: true,
      extraBody: {}
    },
    [{ role: 'user', content: 'hi' }],
    true,
    { thinkingEnabled: false }
  );

  assert.equal(enabled.reasoning_effort, 'high');
  assert.equal(disabled.reasoning_effort, 'none');
});

test('Qwen thinking switch uses native enable_thinking flag', () => {
  const enabled = buildProviderBody(
    {
      providerType: 'qwen',
      model: 'qwen3-plus',
      supportsReasoning: true,
      extraBody: {}
    },
    [{ role: 'user', content: 'hi' }],
    true,
    { thinkingEnabled: true }
  );
  const disabled = buildProviderBody(
    {
      providerType: 'qwen',
      model: 'qwen3-plus',
      supportsReasoning: true,
      extraBody: {}
    },
    [{ role: 'user', content: 'hi' }],
    true,
    { thinkingEnabled: false }
  );

  assert.equal(enabled.enable_thinking, true);
  assert.equal(disabled.enable_thinking, false);
  assert.equal(enabled.thinking, undefined);
});

test('GLM thinking switch uses native thinking object', () => {
  const enabled = buildProviderBody(
    {
      providerType: 'glm',
      model: 'glm-5.1',
      supportsReasoning: true,
      extraBody: {}
    },
    [{ role: 'user', content: 'hi' }],
    true,
    { thinkingEnabled: true }
  );
  const disabled = buildProviderBody(
    {
      providerType: 'glm',
      model: 'glm-5.1',
      supportsReasoning: true,
      extraBody: {}
    },
    [{ role: 'user', content: 'hi' }],
    true,
    { thinkingEnabled: false }
  );

  assert.deepEqual(enabled.thinking, { type: 'enabled' });
  assert.deepEqual(disabled.thinking, { type: 'disabled' });
});

test('Kimi thinking switch uses native disabled flag and drops fixed sampling fields', () => {
  const enabled = buildProviderBody(
    {
      providerType: 'kimi',
      model: 'kimi-k2.5',
      supportsReasoning: true,
      extraBody: {}
    },
    [{ role: 'user', content: 'hi' }],
    true,
    { thinkingEnabled: true, temperature: 0.7, topP: 0.9 }
  );
  const disabled = buildProviderBody(
    {
      providerType: 'kimi',
      model: 'kimi-k2.5',
      supportsReasoning: true,
      extraBody: {}
    },
    [{ role: 'user', content: 'hi' }],
    true,
    { thinkingEnabled: false }
  );

  assert.equal(enabled.thinking, undefined);
  assert.deepEqual(disabled.thinking, { type: 'disabled' });
  assert.equal(enabled.temperature, undefined);
  assert.equal(enabled.top_p, undefined);
});

test('xAI reasoning provider uses Responses API native reasoning object', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, request = {}) => {
    requests.push({
      url: String(url),
      body: JSON.parse(request.body)
    });
    return jsonResponse({
      output_text: '正文',
      usage: { total_tokens: 3 }
    });
  };

  try {
    const result = await generateCompletion(
      {
        providerType: 'xai',
        gatewayName: 'xAI',
        baseUrl: 'https://api.x.ai/v1',
        model: 'grok-4.1',
        apiKey: 'xai-test',
        supportsReasoning: true,
        extraBody: {}
      },
      [{ role: 'user', content: 'hi' }],
      { thinkingEnabled: true }
    );

    assert.equal(requests[0].url, 'https://api.x.ai/v1/responses');
    assert.deepEqual(requests[0].body.reasoning, { effort: 'high' });
    assert.equal(result.content, '正文');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Anthropic provider uses Messages API native thinking config and x-api-key auth', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, request = {}) => {
    const headers = new Headers(request.headers);
    requests.push({
      url: String(url),
      headers,
      body: JSON.parse(request.body)
    });
    return jsonResponse({
      model: 'claude-sonnet-4-6',
      content: [
        { type: 'thinking', thinking: 'plan' },
        { type: 'text', text: '正文' }
      ],
      usage: { input_tokens: 1, output_tokens: 2 }
    });
  };

  try {
    const result = await generateCompletion(
      {
        providerType: 'anthropic',
        gatewayName: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        model: 'claude-sonnet-4-6',
        apiKey: 'sk-ant-test',
        supportsReasoning: true,
        extraBody: {}
      },
      [
        { role: 'system', content: 'system note' },
        { role: 'user', content: 'hi' }
      ],
      { thinkingEnabled: true }
    );

    assert.equal(requests[0].url, 'https://api.anthropic.com/v1/messages');
    assert.equal(requests[0].headers.get('x-api-key'), 'sk-ant-test');
    assert.equal(requests[0].headers.get('authorization'), null);
    assert.equal(requests[0].headers.get('anthropic-version'), '2023-06-01');
    assert.deepEqual(requests[0].body.thinking, { type: 'adaptive', display: 'summarized' });
    assert.equal(requests[0].body.output_config.effort, 'high');
    assert.equal(requests[0].body.system, 'system note');
    assert.equal(result.content, '正文');
    assert.equal(result.reasoning, 'plan');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Anthropic streaming parser separates thinking deltas and text deltas', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(sseStream([
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"plan"}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"正文"}}',
      'event: message_stop\ndata: {"type":"message_stop"}'
    ]));

  const events = [];
  try {
    const result = await streamCompletion(
      {
        providerType: 'anthropic',
        gatewayName: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        model: 'claude-sonnet-4-6',
        apiKey: 'sk-ant-test',
        supportsReasoning: true,
        extraBody: {}
      },
      [{ role: 'user', content: 'hi' }],
      (event, data) => events.push({ event, data })
    );

    assert.equal(result.reasoning, 'plan');
    assert.equal(result.content, '正文');
    assert.deepEqual(events.map((event) => event.event), ['reasoning', 'content']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Anthropic completion falls back for invalid numeric request options', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody = null;
  globalThis.fetch = async (_url, request = {}) => {
    requestBody = JSON.parse(request.body);
    return jsonResponse({
      content: [{ type: 'text', text: 'done' }],
      model: 'claude-sonnet-4-6',
      usage: { input_tokens: 1, output_tokens: 1 }
    });
  };

  try {
    const result = await generateCompletion(
      {
        providerType: 'anthropic',
        gatewayName: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        model: 'claude-sonnet-4-6',
        apiKey: 'sk-ant-test',
        supportsReasoning: true,
        extraBody: {
          model: 'bad-model',
          messages: 'bad-messages',
          stream: true,
          max_tokens: 'not-a-number',
          custom_flag: 'kept'
        }
      },
      [{ role: 'user', content: 'hi' }],
      {
        maxTokens: 'not-a-number',
        temperature: 'hot',
        topP: 'Infinity'
      }
    );

    assert.equal(result.content, 'done');
    assert.equal(requestBody.model, 'claude-sonnet-4-6');
    assert.deepEqual(requestBody.messages, [{ role: 'user', content: 'hi' }]);
    assert.equal(requestBody.stream, false);
    assert.equal(requestBody.custom_flag, 'kept');
    assert.equal(requestBody.max_tokens, 4096);
    assert.equal(requestBody.temperature, undefined);
    assert.equal(requestBody.top_p, undefined);
    assert.equal(JSON.stringify(requestBody).includes('null'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Anthropic tool completion maps OpenAI tool schema to native tool_use loop', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, request = {}) => {
    const body = JSON.parse(request.body);
    requests.push(body);
    if (requests.length === 1) {
      return jsonResponse({
        content: [
          { type: 'thinking', thinking: 'plan' },
          { type: 'tool_use', id: 'toolu_1', name: 'set_value', input: { value: 42 } }
        ],
        usage: { input_tokens: 1, output_tokens: 2 }
      });
    }
    return jsonResponse({
      content: [
        { type: 'text', text: 'done' }
      ],
      usage: { input_tokens: 2, output_tokens: 1 }
    });
  };

  try {
    const result = await runToolCompletion(
      {
        providerType: 'anthropic',
        gatewayName: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        model: 'claude-sonnet-4-6',
        apiKey: 'sk-ant-test',
        supportsReasoning: true,
        extraBody: {}
      },
      [{ role: 'user', content: 'set it' }],
      [
        {
          type: 'function',
          function: {
            name: 'set_value',
            description: 'set a value',
            parameters: {
              type: 'object',
              properties: { value: { type: 'number' } },
              required: ['value']
            }
          }
        }
      ],
      async (_name, args) => ({ ok: true, value: args.value }),
      { thinkingEnabled: true }
    );

    assert.equal(requests[0].tools[0].name, 'set_value');
    assert.deepEqual(requests[0].tools[0].input_schema.required, ['value']);
    assert.equal(requests[1].messages.at(-1).content[0].type, 'tool_result');
    assert.equal(requests[1].messages.at(-1).content[0].tool_use_id, 'toolu_1');
    assert.equal(result.content, 'done');
    assert.equal(result.process[0].reasoning, 'plan');
    assert.equal(result.toolCalls[0].arguments.value, 42);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('runToolCompletion treats null options as defaults', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  try {
    globalThis.fetch = async (_url, request = {}) => {
      const body = JSON.parse(request.body);
      requests.push(body);
      return jsonResponse({
        choices: [{ message: { role: 'assistant', content: 'done' } }],
        usage: { total_tokens: 3 }
      });
    };

    const result = await runToolCompletion(
      {
        providerType: 'custom',
        gatewayName: 'Custom',
        baseUrl: 'https://provider.test',
        model: 'custom-model',
        apiKey: 'sk-test',
        supportsReasoning: false,
        extraBody: {}
      },
      [{ role: 'user', content: 'hi' }],
      [
        {
          type: 'function',
          function: {
            name: 'set_value',
            description: 'set a value',
            parameters: {
              type: 'object',
              properties: { value: { type: 'number' } }
            }
          }
        }
      ],
      async () => ({ ok: true }),
      null
    );

    assert.equal(result.content, 'done');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].tool_choice, 'auto');
    assert.equal(requests[0].tools[0].function.name, 'set_value');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('runToolCompletion falls back for invalid max rounds', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls += 1;
      return jsonResponse({
        choices: [{ message: { role: 'assistant', content: 'still needs tools' } }]
      });
    };

    const result = await runToolCompletion(
      {
        providerType: 'custom',
        gatewayName: 'Custom',
        baseUrl: 'https://provider.test',
        model: 'custom-model',
        apiKey: 'sk-test',
        supportsReasoning: false,
        extraBody: {}
      },
      [{ role: 'user', content: 'hi' }],
      [],
      async () => ({ ok: true }),
      {
        maxRounds: 'not-a-number',
        onNoToolCall: () => 'call a tool now'
      }
    );

    assert.equal(calls, 6);
    assert.equal(result.process.length, 6);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('runToolCompletion caps requested tool rounds at one hundred', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls += 1;
      return jsonResponse({
        choices: [{ message: { role: 'assistant', content: 'still needs tools' } }]
      });
    };

    const result = await runToolCompletion(
      {
        providerType: 'custom',
        gatewayName: 'Custom',
        baseUrl: 'https://provider.test',
        model: 'custom-model',
        apiKey: 'sk-test',
        supportsReasoning: false,
        extraBody: {}
      },
      [{ role: 'user', content: 'hi' }],
      [],
      async () => ({ ok: true }),
      {
        maxRounds: 101,
        onNoToolCall: () => 'call a tool now'
      }
    );

    assert.equal(calls, 100);
    assert.equal(result.process.length, 100);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('buildProviderBody applies preset parameters', () => {
  const body = buildProviderBody(
    {
      providerType: 'deepseek',
      model: 'deepseek-v4-flash',
      supportsReasoning: true,
      extraBody: {}
    },
    [{ role: 'user', content: 'hi' }],
    false,
    {
      thinkingEnabled: false,
      temperature: 0.7,
      maxTokens: 4096,
      topP: 0.9,
      frequencyPenalty: 0.5,
      presencePenalty: 0.3
    }
  );

  assert.equal(body.temperature, 0.7);
  assert.equal(body.max_tokens, 4096);
  assert.equal(body.top_p, 0.9);
  assert.equal(body.frequency_penalty, 0.5);
  assert.equal(body.presence_penalty, 0.3);
});

test('buildProviderBody ignores invalid numeric overrides', () => {
  const body = buildProviderBody(
    {
      providerType: 'custom',
      model: 'custom-model',
      supportsReasoning: false,
      extraBody: {
        temperature: 0.2,
        max_tokens: 512,
        top_p: 0.8
      }
    },
    [{ role: 'user', content: 'hi' }],
    false,
    {
      temperature: 'hot',
      maxTokens: 'Infinity',
      topP: '   ',
      frequencyPenalty: {},
      presencePenalty: true
    }
  );
  const zeroBody = buildProviderBody(
    {
      providerType: 'custom',
      model: 'custom-model',
      supportsReasoning: false,
      extraBody: {}
    },
    [{ role: 'user', content: 'hi' }],
    false,
    {
      temperature: '0',
      maxTokens: 0,
      topP: 0,
      frequencyPenalty: '0',
      presencePenalty: 0
    }
  );

  assert.equal(body.temperature, 0.2);
  assert.equal(body.max_tokens, 512);
  assert.equal(body.top_p, 0.8);
  assert.equal(body.frequency_penalty, undefined);
  assert.equal(body.presence_penalty, undefined);
  assert.equal(JSON.stringify(body).includes('null'), false);

  assert.equal(zeroBody.temperature, 0);
  assert.equal(zeroBody.max_tokens, 0);
  assert.equal(zeroBody.top_p, 0);
  assert.equal(zeroBody.frequency_penalty, 0);
  assert.equal(zeroBody.presence_penalty, 0);
});

test('buildProviderBody protects reserved fields from extra body', () => {
  const messages = [{ role: 'user', content: 'hi' }];
  const body = buildProviderBody(
    {
      providerType: 'custom',
      model: 'custom-model',
      supportsReasoning: false,
      extraBody: {
        model: 'bad-model',
        messages: 'bad-messages',
        stream: true,
        custom_flag: 'kept'
      }
    },
    messages,
    false
  );

  assert.equal(body.model, 'custom-model');
  assert.deepEqual(body.messages, messages);
  assert.equal(body.stream, false);
  assert.equal(body.custom_flag, 'kept');
});

test('buildProviderBody ignores non-object extra body values', () => {
  const arrayBody = buildProviderBody(
    {
      providerType: 'custom',
      model: 'custom-model',
      supportsReasoning: false,
      extraBody: ['unexpected']
    },
    [{ role: 'user', content: 'hi' }],
    false
  );
  const stringBody = buildProviderBody(
    {
      providerType: 'custom',
      model: 'custom-model',
      supportsReasoning: false,
      extraBody: 'bad'
    },
    [{ role: 'user', content: 'hi' }],
    false
  );

  assert.equal(arrayBody[0], undefined);
  assert.equal(stringBody[0], undefined);
  assert.deepEqual(Object.keys(arrayBody).sort(), ['messages', 'model', 'stream']);
  assert.deepEqual(Object.keys(stringBody).sort(), ['messages', 'model', 'stream']);
});

test('buildProviderBody treats null options as defaults', () => {
  const body = buildProviderBody(
    {
      providerType: 'custom',
      model: 'custom-model',
      supportsReasoning: false,
      extraBody: {}
    },
    [{ role: 'user', content: 'hi' }],
    false,
    null
  );

  assert.deepEqual(body, {
    model: 'custom-model',
    messages: [{ role: 'user', content: 'hi' }],
    stream: false
  });
});

function sseStream(lines) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`${lines.join('\n\n')}\n\n`));
      controller.close();
    }
  });
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' }
  });
}

test('world book schema accepts null characterId for unlinked books', () => {
  const createResult = createWorldBookSchema.safeParse({
    name: 'Unlinked World Book',
    characterId: null
  });
  const updateResult = updateWorldBookSchema.safeParse({
    characterId: null
  });

  assert.equal(createResult.success, true);
  assert.equal(createResult.data.characterId, null);
  assert.equal(updateResult.success, true);
  assert.equal(updateResult.data.characterId, null);
});

test('world book create stores null characterId as unlinked', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'wb-null-user',
    'nullworldbooker',
    'hash',
    new Date().toISOString()
  );

  const book = createWorldBook(database, 'wb-null-user', {
    name: 'Unlinked World Book',
    characterId: null
  });

  assert.equal(book.characterId, null);
});

test('world book entries treat null payload as defaults', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'wb-entry-null-user',
    'entrynullworldbooker',
    'hash',
    new Date().toISOString()
  );
  const book = createWorldBook(database, 'wb-entry-null-user', {
    name: 'Entry Defaults'
  });

  const entry = createEntry(database, 'wb-entry-null-user', book.id, null);

  assert.ok(entry);
  assert.equal(entry.name, '');
  assert.equal(entry.triggerKeys, '');
  assert.equal(entry.content, '');
  assert.equal(entry.position, 'before_char');
  assert.equal(entry.enabled, true);
  assert.equal(entry.orderIndex, 0);
  assert.equal(entry.probability, 100);
  assert.equal(entry.useProbability, false);
});

test('world book entries normalize string boolean flags', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'wb-entry-boolean-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    'entrybooleanworldbooker',
    'hash',
    new Date().toISOString()
  );
  const book = createWorldBook(database, userId, {
    name: 'Entry Boolean Flags'
  });

  const entry = createEntry(database, userId, book.id, {
    name: 'String Boolean Entry',
    enabled: 'false',
    regexMode: 'false',
    alwaysActive: 'false',
    selective: 'false',
    useProbability: 'false'
  });

  assert.equal(entry.enabled, false);
  assert.equal(entry.regexMode, false);
  assert.equal(entry.alwaysActive, false);
  assert.equal(entry.selective, false);
  assert.equal(entry.useProbability, false);

  const updated = updateEntry(database, userId, book.id, entry.id, {
    enabled: 'true',
    regexMode: 'true',
    alwaysActive: 'true',
    selective: 'true',
    useProbability: 'true'
  });

  assert.equal(updated.enabled, true);
  assert.equal(updated.regexMode, true);
  assert.equal(updated.alwaysActive, true);
  assert.equal(updated.selective, true);
  assert.equal(updated.useProbability, true);
});

test('world book entry order index normalizes unsafe update values', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'wb-entry-order-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    'entryorderworldbooker',
    'hash',
    new Date().toISOString()
  );
  const book = createWorldBook(database, userId, {
    name: 'Entry Order Index'
  });

  const first = createEntry(database, userId, book.id, { name: 'First order entry' });
  const second = createEntry(database, userId, book.id, { name: 'Second order entry' });

  const nonFinite = updateEntry(database, userId, book.id, second.id, {
    orderIndex: 'Infinity'
  });
  const negative = updateEntry(database, userId, book.id, second.id, {
    orderIndex: -5
  });
  const decimal = updateEntry(database, userId, book.id, first.id, {
    orderIndex: 2.9
  });

  assert.equal(first.orderIndex, 0);
  assert.equal(second.orderIndex, 1);
  assert.equal(nonFinite.orderIndex, 1);
  assert.equal(negative.orderIndex, 0);
  assert.equal(decimal.orderIndex, 2);
});

test('world book entry enum fields preserve existing values on invalid updates', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'wb-entry-enum-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    'entryenumworldbooker',
    'hash',
    new Date().toISOString()
  );
  const book = createWorldBook(database, userId, {
    name: 'Entry Enum Fields'
  });

  const entry = createEntry(database, userId, book.id, {
    name: 'Enum Entry',
    selective: true,
    selectiveLogic: '2',
    role: '2'
  });
  const booleanUpdate = updateEntry(database, userId, book.id, entry.id, {
    selectiveLogic: true,
    role: true
  });
  const invalidUpdate = updateEntry(database, userId, book.id, entry.id, {
    selectiveLogic: 1.5,
    role: 'Infinity'
  });
  const invalidCreate = createEntry(database, userId, book.id, {
    name: 'Invalid enum create',
    selectiveLogic: true,
    role: true
  });

  assert.equal(entry.selectiveLogic, 2);
  assert.equal(entry.role, 2);
  assert.equal(booleanUpdate.selectiveLogic, 2);
  assert.equal(booleanUpdate.role, 2);
  assert.equal(invalidUpdate.selectiveLogic, 2);
  assert.equal(invalidUpdate.role, 2);
  assert.equal(invalidCreate.selectiveLogic, 0);
  assert.equal(invalidCreate.role, 0);
});

test('world book entry partial updates preserve omitted fields', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'wb-entry-partial-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    'entrypartialworldbooker',
    'hash',
    new Date().toISOString()
  );
  const book = createWorldBook(database, userId, {
    name: 'Entry Partial Update Book'
  });

  const entry = createEntry(database, userId, book.id, {
    name: 'Original Entry',
    triggerKeys: 'alpha,beta',
    content: 'Original lore content',
    position: 'at_depth',
    enabled: false,
    regexMode: true,
    alwaysActive: true,
    depth: 4,
    selective: true,
    selectiveLogic: 2,
    keysSecondary: 'gamma,delta',
    probability: 25,
    useProbability: true,
    group: 'rare-group',
    groupWeight: 3.5,
    role: 2,
    sticky: 3,
    cooldown: 4,
    delay: 5
  });

  const updated = updateEntry(database, userId, book.id, entry.id, {
    name: 'Renamed Entry'
  });

  assert.equal(updated.name, 'Renamed Entry');
  assert.equal(updated.triggerKeys, 'alpha,beta');
  assert.equal(updated.content, 'Original lore content');
  assert.equal(updated.position, 'at_depth');
  assert.equal(updated.enabled, false);
  assert.equal(updated.orderIndex, entry.orderIndex);
  assert.equal(updated.regexMode, true);
  assert.equal(updated.alwaysActive, true);
  assert.equal(updated.depth, 4);
  assert.equal(updated.selective, true);
  assert.equal(updated.selectiveLogic, 2);
  assert.equal(updated.keysSecondary, 'gamma,delta');
  assert.equal(updated.probability, 25);
  assert.equal(updated.useProbability, true);
  assert.equal(updated.group, 'rare-group');
  assert.equal(updated.groupWeight, 3.5);
  assert.equal(updated.role, 2);
  assert.equal(updated.sticky, 3);
  assert.equal(updated.cooldown, 4);
  assert.equal(updated.delay, 5);
});

test('world book entry numeric fields normalize legacy row values on read and match', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'wb-entry-legacy-number-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    'entrylegacynumberworldbooker',
    'hash',
    new Date().toISOString()
  );
  const character = createCharacter(database, userId, {
    name: 'Legacy Number Character',
    visibility: 'private'
  });
  const book = createWorldBook(database, userId, {
    name: 'Legacy Number Book',
    characterId: character.id
  });
  const entry = createEntry(database, userId, book.id, {
    name: 'Legacy Number Entry',
    triggerKeys: 'legacy-number-trigger',
    content: 'legacy number content',
    enabled: true,
    useProbability: true,
    probability: 0
  });

  database
    .prepare(
      `UPDATE world_book_entries
       SET depth = ?, selective_logic = ?, probability = ?, group_weight = ?, role = ?, sticky = ?, cooldown = ?, delay = ?
       WHERE id = ?`
    )
    .run(99, 99, 'not-a-number', -10, 99, 'Infinity', -5, 'not-a-number', entry.id);

  const legacyEntry = getWorldBook(database, userId, book.id).entries.find((item) => item.id === entry.id);
  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const matches = matchWorldBookEntries(database, character.id, 'legacy-number-trigger');

    assert.equal(legacyEntry.depth, 10);
    assert.equal(legacyEntry.selectiveLogic, 0);
    assert.equal(legacyEntry.probability, 100);
    assert.equal(legacyEntry.groupWeight, 0);
    assert.equal(legacyEntry.role, 0);
    assert.equal(legacyEntry.sticky, null);
    assert.equal(legacyEntry.cooldown, 0);
    assert.equal(legacyEntry.delay, null);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].depth, 10);
    assert.equal(matches[0].role, 0);
  } finally {
    Math.random = originalRandom;
  }
});

test('world books CRUD with entries', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, 'user-1', { name: '测试角色', visibility: 'private' });

  const book = createWorldBook(database, 'user-1', {
    name: '世界观设定',
    description: '包含世界的基本设定',
    characterId: character.id
  });
  assert.equal(book.name, '世界观设定');
  assert.equal(book.characterId, character.id);
  assert.equal(book.entryCount, 0);

  const entry1 = createEntry(database, 'user-1', book.id, {
    name: '魔法系统',
    triggerKeys: '魔法,魔力,法术',
    content: '这个世界使用元素魔法系统。',
    position: 'before_char',
    enabled: true
  });
  assert.equal(entry1.name, '魔法系统');
  assert.equal(entry1.orderIndex, 0);

  const entry2 = createEntry(database, 'user-1', book.id, {
    name: '地理信息',
    triggerKeys: '城市,大陆,地图',
    content: '大陆分为五个王国。',
    position: 'at_start'
  });
  assert.equal(entry2.orderIndex, 1);

  const retrieved = getWorldBook(database, 'user-1', book.id);
  assert.equal(retrieved.entries.length, 2);
  assert.equal(retrieved.entryCount, 2);

  const updated = updateEntry(database, 'user-1', book.id, entry1.id, {
    triggerKeys: '魔法,魔力,法术,咒语',
    enabled: false
  });
  assert.equal(updated.triggerKeys, '魔法,魔力,法术,咒语');
  assert.equal(updated.enabled, false);

  assert.equal(deleteEntry(database, 'user-1', book.id, entry2.id), true);
  assert.equal(getWorldBook(database, 'user-1', book.id).entries.length, 1);

  const books = listWorldBooks(database, 'user-1');
  assert.equal(books.length, 1);
  assert.equal(books[0].entryCount, 1);

  assert.equal(deleteWorldBook(database, 'user-1', book.id), true);
  assert.equal(listWorldBooks(database, 'user-1').length, 0);
});

test('world book lists preserve deterministic tie order', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'world-book-order-user';
  const timestamp = '2025-01-01T00:00:00.000Z';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    'worldbookorder',
    'hash',
    timestamp
  );
  const character = createCharacter(database, userId, { name: 'WorldBookOrder', visibility: 'private' });
  database.prepare(
    'INSERT INTO world_books (id, user_id, name, description, character_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run('world-book-first', userId, 'First Book', '', character.id, timestamp, timestamp);
  database.prepare(
    'INSERT INTO world_books (id, user_id, name, description, character_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run('world-book-second', userId, 'Second Book', '', null, timestamp, timestamp);
  database.prepare(
    'INSERT INTO world_book_entries (id, world_book_id, name, trigger_keys, content, enabled, order_index, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('world-entry-first', 'world-book-first', 'First Entry', 'alpha', 'first content', 1, 0, timestamp);
  database.prepare(
    'INSERT INTO world_book_entries (id, world_book_id, name, trigger_keys, content, enabled, order_index, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('world-entry-second', 'world-book-first', 'Second Entry', 'alpha', 'second content', 1, 0, timestamp);

  assert.deepEqual(
    listWorldBooks(database, userId).map((book) => book.id),
    ['world-book-second', 'world-book-first']
  );
  assert.deepEqual(
    getWorldBook(database, userId, 'world-book-first').entries.map((entry) => entry.id),
    ['world-entry-first', 'world-entry-second']
  );
  assert.deepEqual(
    matchWorldBookEntries(database, character.id, ['alpha']).map((entry) => entry.id),
    ['world-entry-first', 'world-entry-second']
  );
});

test('world book trigger matching finds entries by keywords', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, 'user-1', { name: '测试角色', visibility: 'private' });

  const book = createWorldBook(database, 'user-1', {
    name: '设定书',
    characterId: character.id
  });

  createEntry(database, 'user-1', book.id, {
    name: '魔法',
    triggerKeys: '魔法,魔力',
    content: '魔法系统说明',
    position: 'before_char',
    enabled: true
  });
  createEntry(database, 'user-1', book.id, {
    name: '地理',
    triggerKeys: '城市,王国',
    content: '王国地理信息',
    position: 'at_start',
    enabled: true
  });
  createEntry(database, 'user-1', book.id, {
    name: '禁用条目',
    triggerKeys: '禁用',
    content: '不应出现',
    enabled: false
  });

  const matches = matchWorldBookEntries(database, character.id, '我想学习魔法');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].name, '魔法');

  const multiMatches = matchWorldBookEntries(database, character.id, '魔法城市里有王国');
  assert.equal(multiMatches.length, 2);

  const noMatches = matchWorldBookEntries(database, character.id, '今天天气不错');
  assert.equal(noMatches.length, 0);

  const nullOptionsMatches = matchWorldBookEntries(database, character.id, '魔法', null);
  assert.equal(nullOptionsMatches.length, 1);
  assert.equal(nullOptionsMatches[0].name, '魔法');

  const context = buildWorldBookContext(matches);
  assert.equal(context, '魔法系统说明');

  const emptyContext = buildWorldBookContext([]);
  assert.equal(emptyContext, '');
});

test('world book trigger matching ignores non-string scan text items', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, 'user-1', { name: 'Scan Text Types', visibility: 'private' });
  const book = createWorldBook(database, 'user-1', { name: 'Scan Text Types Book' });
  linkWorldBookToCharacter(database, book.id, character.id);
  createEntry(database, 'user-1', book.id, {
    name: 'Object text',
    triggerKeys: '[object Object]',
    content: 'object text content',
    enabled: true
  });
  createEntry(database, 'user-1', book.id, {
    name: 'Symbol text',
    triggerKeys: 'symbol-trigger',
    content: 'symbol text content',
    enabled: true
  });

  const objectMatches = matchWorldBookEntries(database, character.id, [{ maybe: 'text' }]);
  const symbolMatches = matchWorldBookEntries(database, character.id, [Symbol('symbol-trigger')]);
  const stringMatches = matchWorldBookEntries(database, character.id, ['ignored', 'symbol-trigger']);

  assert.deepEqual(objectMatches.map((entry) => entry.name), []);
  assert.deepEqual(symbolMatches.map((entry) => entry.name), []);
  assert.deepEqual(stringMatches.map((entry) => entry.name), ['Symbol text']);
});

test('world book scanDepth override does not scan all history for invalid values', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, 'user-1', { name: 'ScanDepth', visibility: 'private' });
  const book = createWorldBook(database, 'user-1', {
    name: 'ScanDepth Book',
    characterId: character.id,
    scanDepth: 1
  });
  createEntry(database, 'user-1', book.id, {
    name: 'Old trigger',
    triggerKeys: 'ancient-key',
    content: 'Only old history should match',
    enabled: true
  });

  const history = ['ancient-key appeared earlier', 'latest message has no trigger'];
  assert.equal(matchWorldBookEntries(database, character.id, history, { scanDepth: 'not-a-number' }).length, 0);
  assert.equal(matchWorldBookEntries(database, character.id, history, { scanDepth: '0' }).length, 0);

  const expanded = matchWorldBookEntries(database, character.id, history, { scanDepth: '2' });
  assert.equal(expanded.length, 1);
  assert.equal(expanded[0].name, 'Old trigger');
});

test('world book context treats null entries as empty', () => {
  assert.equal(buildWorldBookContext(null), '');
});

test('world book context preserves position and depth order in one pass', () => {
  const context = buildWorldBookContext([
    { position: 'after_char', depth: 2, content: 'after-2' },
    { position: 'before_char', depth: 3, content: 'before-3' },
    { position: 'at_depth', depth: 0, content: 'separate-message' },
    { position: 'at_start', depth: 5, content: 'start-5' },
    { position: 'before_char', depth: 1, content: 'before-1' },
    { position: 'at_start', depth: 1, content: 'start-1' },
    { position: 'after_char', depth: 1, content: 'after-1' }
  ]);

  assert.equal(context, ['start-1', 'start-5', 'before-1', 'before-3', 'after-1', 'after-2'].join('\n\n'));
});

test('world book at_depth injection treats null entries as empty', () => {
  const messages = [{ role: 'user', content: 'hello' }];
  const result = injectAtDepthEntries(messages, null);

  assert.equal(result, messages);
  assert.deepEqual(messages, [{ role: 'user', content: 'hello' }]);
});

test('world book name validation rejects empty or too long names', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );

  assert.throws(() => createWorldBook(database, 'user-1', { name: '' }), /名称长度/);
  assert.throws(() => createWorldBook(database, 'user-1', { name: 'a'.repeat(81) }), /名称长度/);

  const book = createWorldBook(database, 'user-1', { name: '正常名称' });
  assert.equal(book.name, '正常名称');
});

test('world book entries respect ownership', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'owner', 'owner', 'hash', new Date().toISOString()
  );
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'other', 'other', 'hash', new Date().toISOString()
  );

  const book = createWorldBook(database, 'owner', { name: '我的世界书' });
  assert.equal(getWorldBook(database, 'other', book.id), null);
  assert.equal(createEntry(database, 'other', book.id, { name: '入侵' }), null);
  assert.equal(deleteWorldBook(database, 'other', book.id), false);
});

test('world book character links respect ownership', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'owner', 'owner', 'hash', new Date().toISOString()
  );
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'other', 'other', 'hash', new Date().toISOString()
  );

  const ownerCharacter = createCharacter(database, 'owner', { name: 'Owner Character' });
  const otherCharacter = createCharacter(database, 'other', { name: 'Other Character' });
  const ownerBook = createWorldBook(database, 'owner', { name: 'Owner World Book' });

  assert.equal(linkWorldBookToCharacter(database, ownerBook.id, ownerCharacter.id, 0, 'owner'), true);
  assert.equal(linkWorldBookToCharacter(database, ownerBook.id, otherCharacter.id, 0, 'other'), false);
  assert.deepEqual(listCharacterWorldBooks(database, otherCharacter.id), []);
});

test('character world books preserve link insertion order when order indexes tie', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'linked-world-book-order-user';
  const timestamp = '2025-01-01T00:00:00.000Z';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    'linkedworldbookorder',
    'hash',
    timestamp
  );
  const character = createCharacter(database, userId, { name: 'LinkedWorldBookOrder', visibility: 'private' });
  database.prepare(
    'INSERT INTO world_books (id, user_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('linked-book-first', userId, 'First Linked Book', '', timestamp, timestamp);
  database.prepare(
    'INSERT INTO world_books (id, user_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('linked-book-second', userId, 'Second Linked Book', '', timestamp, timestamp);
  database.prepare(
    'INSERT INTO character_world_books (character_id, world_book_id, order_index, created_at) VALUES (?, ?, ?, ?)'
  ).run(character.id, 'linked-book-first', 0, timestamp);
  database.prepare(
    'INSERT INTO character_world_books (character_id, world_book_id, order_index, created_at) VALUES (?, ?, ?, ?)'
  ).run(character.id, 'linked-book-second', 0, timestamp);

  assert.deepEqual(
    listCharacterWorldBooks(database, character.id).map((book) => book.id),
    ['linked-book-first', 'linked-book-second']
  );
});

test('world book linked characters preserve link insertion order when timestamps tie', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'world-book-linked-character-user';
  const timestamp = '2025-01-01T00:00:00.000Z';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    'worldbooklinkedcharacter',
    'hash',
    timestamp
  );
  const firstCharacter = createCharacter(database, userId, { name: 'First Linked Character', visibility: 'private' });
  const secondCharacter = createCharacter(database, userId, { name: 'Second Linked Character', visibility: 'private' });
  const book = createWorldBook(database, userId, { name: 'Linked Character Book' });
  database
    .prepare('UPDATE world_books SET created_at = ?, updated_at = ? WHERE id = ?')
    .run(timestamp, timestamp, book.id);
  database.prepare(
    'INSERT INTO character_world_books (character_id, world_book_id, order_index, created_at) VALUES (?, ?, ?, ?)'
  ).run(firstCharacter.id, book.id, 0, timestamp);
  database.prepare(
    'INSERT INTO character_world_books (character_id, world_book_id, order_index, created_at) VALUES (?, ?, ?, ?)'
  ).run(secondCharacter.id, book.id, 0, timestamp);

  database.exec('PRAGMA reverse_unordered_selects = ON');
  try {
    assert.deepEqual(
      getWorldBook(database, userId, book.id).linkedCharacters,
      [firstCharacter.id, secondCharacter.id]
    );
  } finally {
    database.exec('PRAGMA reverse_unordered_selects = OFF');
  }
});

test('world book regex key auto-detection in string mode', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );

  const book = createWorldBook(database, 'user-1', { name: '正则测试书' });
  const character = createCharacter(database, 'user-1', { name: '正则测试角色' });
  linkWorldBookToCharacter(database, book.id, character.id);

  // Entry with /pattern/flags key, regex_mode = false
  createEntry(database, 'user-1', book.id, {
    name: 'dragon entry',
    triggerKeys: '/dragon|wyrm/i',
    content: '龙族知识',
    enabled: true
    // regexMode defaults to false
  });

  // Should match because key is auto-detected as regex
  const matches = matchWorldBookEntries(database, character.id, 'I saw a Dragon flying overhead');
  assert.ok(matches.length > 0, 'should match Dragon via auto-detected regex key');
  assert.equal(matches[0].content, '龙族知识');
});

test('world book invalid regex key falls back to literal match', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );

  const book = createWorldBook(database, 'user-1', { name: '无效正则测试书' });
  const character = createCharacter(database, 'user-1', { name: '无效正则角色' });
  linkWorldBookToCharacter(database, book.id, character.id);

  // Entry with invalid regex key, regex_mode = false
  createEntry(database, 'user-1', book.id, {
    name: 'invalid regex entry',
    triggerKeys: '/[/invalid/',
    content: '无效正则内容',
    enabled: true
  });

  // Should NOT throw 500 / exception; falls back to literal match which won't match
  const matches = matchWorldBookEntries(database, character.id, 'some text here');
  assert.ok(matches.length === 0, 'invalid regex should not match and should not throw');

  // But literal match should work if text contains the key literally
  const literalMatches = matchWorldBookEntries(database, character.id, 'test /[/invalid/ more');
  assert.ok(literalMatches.length > 0, 'literal fallback should match the key string');
});

test('world book selective AND_ANY activates when secondary key matches', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );

  const book = createWorldBook(database, 'user-1', { name: '选择性过滤书' });
  const character = createCharacter(database, 'user-1', { name: '选择性角色' });
  linkWorldBookToCharacter(database, book.id, character.id);

  // selective=true, selectiveLogic=0 (AND_ANY), keysSecondary=魔法,战斗
  createEntry(database, 'user-1', book.id, {
    name: '魔法战斗条目',
    triggerKeys: '冒险',
    content: '魔法与战斗的冒险内容',
    enabled: true,
    selective: true,
    selectiveLogic: 0,
    keysSecondary: '魔法,战斗'
  });

  // Primary key matches AND secondary key "魔法" present -> activated
  const matches = matchWorldBookEntries(database, character.id, '我想开始一次冒险，学习魔法');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].content, '魔法与战斗的冒险内容');

  // Primary key matches but no secondary key present -> NOT activated
  const noSecondary = matchWorldBookEntries(database, character.id, '我想开始一次冒险');
  assert.equal(noSecondary.length, 0);
});

test('world book selective NOT_ANY blocks when secondary key matches', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );

  const book = createWorldBook(database, 'user-1', { name: 'NOT_ANY测试书' });
  const character = createCharacter(database, 'user-1', { name: 'NOT_ANY角色' });
  linkWorldBookToCharacter(database, book.id, character.id);

  // selective=true, selectiveLogic=1 (NOT_ANY), keysSecondary=战斗
  createEntry(database, 'user-1', book.id, {
    name: '和平条目',
    triggerKeys: '冒险',
    content: '和平冒险内容',
    enabled: true,
    selective: true,
    selectiveLogic: 1,
    keysSecondary: '战斗'
  });

  // Primary key matches AND secondary key "战斗" present -> BLOCKED
  const blocked = matchWorldBookEntries(database, character.id, '我想开始一次冒险，参与战斗');
  assert.equal(blocked.length, 0);

  // Primary key matches and no secondary key present -> activated
  const activated = matchWorldBookEntries(database, character.id, '我想开始一次冒险');
  assert.equal(activated.length, 1);
  assert.equal(activated[0].content, '和平冒险内容');
});

test('world book selective NOT_ALL blocks when all secondary keys match', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );

  const book = createWorldBook(database, 'user-1', { name: 'NOT_ALL测试书' });
  const character = createCharacter(database, 'user-1', { name: 'NOT_ALL角色' });
  linkWorldBookToCharacter(database, book.id, character.id);

  // selective=true, selectiveLogic=2 (NOT_ALL), keysSecondary=火焰,冰霜
  createEntry(database, 'user-1', book.id, {
    name: '元素条目',
    triggerKeys: '魔法',
    content: '元素魔法内容',
    enabled: true,
    selective: true,
    selectiveLogic: 2,
    keysSecondary: '火焰,冰霜'
  });

  // Primary key matches AND ALL secondary keys present -> BLOCKED
  const allMatch = matchWorldBookEntries(database, character.id, '我使用魔法，释放火焰和冰霜');
  assert.equal(allMatch.length, 0);

  // Primary key matches but only one secondary key present -> activated
  const partialMatch = matchWorldBookEntries(database, character.id, '我使用魔法，释放火焰');
  assert.equal(partialMatch.length, 1);
  assert.equal(partialMatch[0].content, '元素魔法内容');

  // Primary key matches, no secondary keys present -> activated
  const noSecondary = matchWorldBookEntries(database, character.id, '我使用魔法');
  assert.equal(noSecondary.length, 1);
});

test('tags CRUD with usage count', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'tag-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'tagger', 'hash', new Date().toISOString()
  );

  // Create tags
  const tag1 = createTag(database, userId, { name: '温柔', color: '#ff6b6b' });
  const tag2 = createTag(database, userId, { name: '悬疑' });
  assert.equal(tag1.name, '温柔');
  assert.equal(tag1.color, '#ff6b6b');
  assert.equal(tag2.name, '悬疑');
  assert.equal(tag2.color, '');

  // Create a character and assign tags
  const character = createCharacter(database, userId, { name: '标签测试角色' });
  setCharacterTags(database, userId, character.id, ['温柔', '悬疑']);

  // List tags with usage count
  const tags = listTags(database, userId);
  assert.equal(tags.length, 2);
  assert.equal(tags[0].usageCount, 1); // sorted by usage desc
  assert.equal(tags[1].usageCount, 1);

  // Duplicate tag name rejected
  assert.throws(() => createTag(database, userId, { name: '温柔' }), /标签名已存在/);

  // Delete tag
  assert.equal(deleteTag(database, userId, tag1.id), true);
  assert.equal(deleteTag(database, userId, 'nonexistent'), false);

  // After deletion, usage count updates
  const remaining = listTags(database, userId);
  assert.equal(remaining.length, 1);
});

test('tag name reads use deterministic case-insensitive tie order', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'tag-order-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'tagorder', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, userId, { name: 'Tag Order' });

  setCharacterTags(database, userId, character.id, ['beta', 'alpha', 'Alpha']);

  assert.deepEqual(getCharacterTagNames(database, character.id, userId), ['Alpha', 'alpha', 'beta']);
  assert.deepEqual(listTags(database, userId).map((tag) => tag.name), ['Alpha', 'alpha', 'beta']);
});

test('tags are isolated per user', () => {
  const database = createAppDatabase(':memory:');
  const createdAt = new Date().toISOString();
  const userA = 'tag-user-a';
  const userB = 'tag-user-b';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userA, 'taggera', 'hash', createdAt
  );
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userB, 'taggerb', 'hash', createdAt
  );

  const tagA = createTag(database, userA, { name: '共享名', color: '#111111' });
  const tagB = createTag(database, userB, { name: '共享名', color: '#222222' });
  assert.notEqual(tagA.id, tagB.id);
  assert.deepEqual(listTags(database, userA).map((tag) => tag.color), ['#111111']);
  assert.deepEqual(listTags(database, userB).map((tag) => tag.color), ['#222222']);

  const charA = createCharacter(database, userA, { name: '用户A角色' });
  const charB = createCharacter(database, userB, { name: '用户B角色' });
  setCharacterTags(database, userA, charA.id, ['共享名']);
  setCharacterTags(database, userB, charB.id, ['共享名']);

  assert.deepEqual(listCharacters(database, userA, { tag: '共享名' }).map((item) => item.name), ['用户A角色']);
  assert.deepEqual(listCharacters(database, userB, { tag: '共享名' }).map((item) => item.name), ['用户B角色']);
  assert.equal(deleteTag(database, userA, tagB.id), false);
  assert.equal(listTags(database, userB).length, 1);
});

test('legacy global tags migrate into user scoped tags', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flai-tags-'));
  const dbPath = path.join(dir, 'legacy.sqlite');
  let database = createAppDatabase(dbPath);
  try {
    const createdAt = new Date().toISOString();
    const userA = 'legacy-tag-user-a';
    const userB = 'legacy-tag-user-b';
    database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
      userA, 'legacya', 'hash', createdAt
    );
    database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
      userB, 'legacyb', 'hash', createdAt
    );
    const charA = createCharacter(database, userA, { name: '旧库A' });
    const charB = createCharacter(database, userB, { name: '旧库B' });

    database.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE character_tags;
      DROP TABLE tags;
      CREATE TABLE tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE TABLE character_tags (
        character_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        PRIMARY KEY (character_id, tag_id)
      );
      PRAGMA foreign_keys = ON;
    `);
    database.prepare('INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)').run(
      'legacy-shared-tag', '???', '#333333', createdAt
    );
    database.prepare('INSERT INTO character_tags (character_id, tag_id) VALUES (?, ?)').run(charA.id, 'legacy-shared-tag');
    database.prepare('INSERT INTO character_tags (character_id, tag_id) VALUES (?, ?)').run(charB.id, 'legacy-shared-tag');
    database.close();
    database = null;

    database = createAppDatabase(dbPath);
    const columns = database.prepare('PRAGMA table_info(tags)').all().map((column) => column.name);
    assert.ok(columns.includes('user_id'));
    const tagsA = listTags(database, userA);
    const tagsB = listTags(database, userB);
    assert.deepEqual(tagsA.map((tag) => tag.name), ['???']);
    assert.deepEqual(tagsB.map((tag) => tag.name), ['???']);
    assert.notEqual(tagsA[0].id, tagsB[0].id);
    assert.equal(/[?#/]/.test(tagsA[0].id), false);
    assert.equal(/[?#/]/.test(tagsB[0].id), false);
    assert.deepEqual(listCharacters(database, userA, { tag: '???' }).map((item) => item.name), ['旧库A']);
    assert.deepEqual(listCharacters(database, userB, { tag: '???' }).map((item) => item.name), ['旧库B']);
  } finally {
    if (database) {
      database.close();
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('unsafe migrated tag ids are normalized on startup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flai-tags-unsafe-'));
  const dbPath = path.join(dir, 'unsafe.sqlite');
  let database = createAppDatabase(dbPath);
  try {
    const userId = 'unsafe-tag-user';
    const createdAt = new Date().toISOString();
    database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
      userId, 'unsafe', 'hash', createdAt
    );
    const character = createCharacter(database, userId, { name: '危险ID角色' });
    database.prepare('INSERT INTO tags (id, user_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)').run(
      `tag:${userId}:???`, userId, '???', '', createdAt
    );
    database.prepare('INSERT INTO character_tags (character_id, tag_id) VALUES (?, ?)').run(
      character.id, `tag:${userId}:???`
    );
    database.close();
    database = null;

    database = createAppDatabase(dbPath);
    const tag = listTags(database, userId)[0];
    assert.equal(tag.name, '???');
    assert.equal(/[?#/]/.test(tag.id), false);
    assert.deepEqual(getCharacterTagNames(database, character.id), ['???']);
  } finally {
    if (database) {
      database.close();
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('character tags sync replaces old tags', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'sync-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'syncer', 'hash', new Date().toISOString()
  );

  const character = createCharacter(database, userId, { name: '同步测试' });

  // Set initial tags
  setCharacterTags(database, userId, character.id, ['A', 'B', 'C']);
  assert.deepEqual(getCharacterTagNames(database, character.id), ['A', 'B', 'C']);

  // Replace with new tags
  setCharacterTags(database, userId, character.id, ['B', 'D']);
  assert.deepEqual(getCharacterTagNames(database, character.id), ['B', 'D']);

  // Clear all tags
  setCharacterTags(database, userId, character.id, []);
  assert.deepEqual(getCharacterTagNames(database, character.id), []);
});

test('setCharacterTags works inside an existing transaction', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'tag-savepoint-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'tagsavepoint', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, userId, { name: 'Tag Savepoint' });

  database.exec('BEGIN');
  try {
    setCharacterTags(database, userId, character.id, ['Nested', 'Tags']);
    assert.deepEqual(getCharacterTagNames(database, character.id), ['Nested', 'Tags']);
  } finally {
    database.exec('ROLLBACK');
  }

  assert.deepEqual(getCharacterTagNames(database, character.id), []);
});

test('setCharacterTags rolls back old links when a new link insert fails', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'tag-rollback-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'tagrollback', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, userId, { name: 'Tag Rollback' });
  setCharacterTags(database, userId, character.id, ['Original']);
  const failingTag = createTag(database, userId, { name: 'Fail Link' });

  database.exec(`
    CREATE TRIGGER fail_character_tag_link
    BEFORE INSERT ON character_tags
    WHEN NEW.tag_id = '${failingTag.id}'
    BEGIN
      SELECT RAISE(ABORT, 'forced character tag link failure');
    END
  `);

  assert.throws(
    () => setCharacterTags(database, userId, character.id, ['Fail Link']),
    /forced character tag link failure/
  );
  assert.deepEqual(getCharacterTagNames(database, character.id), ['Original']);
});

test('character list filters by tag name', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'filter-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'filterer', 'hash', new Date().toISOString()
  );

  const c1 = createCharacter(database, userId, { name: '角色A' });
  const c2 = createCharacter(database, userId, { name: '角色B' });
  const c3 = createCharacter(database, userId, { name: '角色C' });
  setCharacterTags(database, userId, c1.id, ['温柔']);
  setCharacterTags(database, userId, c2.id, ['温柔', '悬疑']);
  setCharacterTags(database, userId, c3.id, ['悬疑']);

  const all = listCharacters(database, userId, {});
  assert.equal(all.length, 3);

  const gentle = listCharacters(database, userId, { tag: '温柔' });
  assert.equal(gentle.length, 2);
  assert.ok(gentle.every((c) => ['角色A', '角色B'].includes(c.name)));

  const mystery = listCharacters(database, userId, { tag: '悬疑' });
  assert.equal(mystery.length, 2);
  assert.ok(mystery.every((c) => ['角色B', '角色C'].includes(c.name)));

  const none = listCharacters(database, userId, { tag: '不存在的标签' });
  assert.equal(none.length, 0);
});

test('tag color validation rejects invalid hex', () => {
  const database = createAppDatabase(':memory:');

  const userId = 'color-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'colorer', 'hash', new Date().toISOString()
  );

  const tag1 = createTag(database, userId, { name: '颜色测试', color: '#abc' });
  assert.equal(tag1.color, '#abc');

  const tag2 = createTag(database, userId, { name: '无颜色', color: 'not-a-color' });
  assert.equal(tag2.color, '');
});

test('presets CRUD with default management', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'preset-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'presetter', 'hash', new Date().toISOString()
  );

  // Create preset
  const preset1 = createPreset(database, userId, {
    name: '创意写作',
    systemPrompt: '你是一个创意写作助手。',
    temperature: 1.2,
    maxTokens: 8192,
    topP: 0.9,
    frequencyPenalty: 0.5,
    presencePenalty: 0.3,
    isDefault: true
  });
  assert.equal(preset1.name, '创意写作');
  assert.equal(preset1.systemPrompt, '你是一个创意写作助手。');
  assert.equal(preset1.temperature, 1.2);
  assert.equal(preset1.maxTokens, 8192);
  assert.equal(preset1.topP, 0.9);
  assert.equal(preset1.frequencyPenalty, 0.5);
  assert.equal(preset1.presencePenalty, 0.3);
  assert.equal(preset1.isDefault, true);

  // Create second preset
  const preset2 = createPreset(database, userId, {
    name: '精确回答',
    systemPrompt: '请精确、简洁地回答。',
    temperature: 0.3,
    maxTokens: 2048
  });
  assert.equal(preset2.isDefault, false);

  // List presets - default should be first
  const presets = listPresets(database, userId);
  assert.equal(presets.length, 2);
  assert.equal(presets[0].id, preset1.id); // default first

  // Get preset
  const fetched = getPreset(database, userId, preset1.id);
  assert.equal(fetched.name, '创意写作');

  // Update preset
  const updated = updatePreset(database, userId, preset2.id, {
    name: '精确回答 v2',
    temperature: 0.2
  });
  assert.equal(updated.name, '精确回答 v2');
  assert.equal(updated.temperature, 0.2);

  // Set default to second preset
  const newDefault = setDefaultPreset(database, userId, preset2.id);
  assert.equal(newDefault.isDefault, true);
  assert.equal(getPreset(database, userId, preset1.id).isDefault, false);

  // Get default preset
  const defaultPreset = getDefaultPreset(database, userId);
  assert.equal(defaultPreset.id, preset2.id);

  // Delete preset
  assert.equal(deletePreset(database, userId, preset1.id), true);
  assert.equal(listPresets(database, userId).length, 1);
  assert.equal(deletePreset(database, userId, 'nonexistent'), false);
});

test('presets treat string false isDefault as false', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'preset-string-false-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'presetstringfalse', 'hash', new Date().toISOString()
  );

  const existingDefault = createPreset(database, userId, {
    name: 'Existing default',
    isDefault: true
  });

  const created = createPreset(database, userId, {
    name: 'String false create',
    isDefault: 'false'
  });
  assert.equal(created.isDefault, false);
  assert.equal(getDefaultPreset(database, userId).id, existingDefault.id);

  const target = createPreset(database, userId, {
    name: 'String false update target'
  });
  const updated = updatePreset(database, userId, target.id, {
    isDefault: 'false'
  });
  assert.equal(updated.isDefault, false);
  assert.equal(getDefaultPreset(database, userId).id, existingDefault.id);
});

test('createPreset keeps existing default when default insert fails', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'preset-create-rollback-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'presetcreaterollback', 'hash', new Date().toISOString()
  );

  const existing = createPreset(database, userId, {
    name: 'Existing default',
    isDefault: true
  });

  database.exec(`
    CREATE TRIGGER fail_default_preset_insert
    BEFORE INSERT ON presets
    WHEN NEW.name = 'forced insert failure'
    BEGIN
      SELECT RAISE(ABORT, 'forced insert failure');
    END
  `);

  assert.throws(() => createPreset(database, userId, {
    name: 'forced insert failure',
    isDefault: true
  }), /forced insert failure/);

  assert.equal(getPreset(database, userId, existing.id).isDefault, true);
  assert.equal(getDefaultPreset(database, userId).id, existing.id);
  assert.equal(listPresets(database, userId).length, 1);
});

test('updatePreset keeps existing default when default update fails', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'preset-update-rollback-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'presetupdaterollback', 'hash', new Date().toISOString()
  );

  const existingDefault = createPreset(database, userId, {
    name: 'Existing default',
    isDefault: true
  });
  const target = createPreset(database, userId, {
    name: 'Target preset',
    isDefault: false
  });

  database.exec(`
    CREATE TRIGGER fail_default_preset_update
    BEFORE UPDATE ON presets
    WHEN NEW.name = 'forced update failure'
    BEGIN
      SELECT RAISE(ABORT, 'forced update failure');
    END
  `);

  assert.throws(() => updatePreset(database, userId, target.id, {
    name: 'forced update failure',
    isDefault: true
  }), /forced update failure/);

  assert.equal(getPreset(database, userId, existingDefault.id).isDefault, true);
  assert.equal(getPreset(database, userId, target.id).isDefault, false);
  assert.equal(getDefaultPreset(database, userId).id, existingDefault.id);
});

test('presets preserve newest insertion order when update timestamps tie', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'preset-order-user';
  const timestamp = '2000-01-01T00:00:00.000Z';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    'presetorder',
    'hash',
    timestamp
  );
  database.prepare(
    `INSERT INTO presets (
      id, user_id, name, system_prompt, temperature, max_tokens, top_p,
      frequency_penalty, presence_penalty, is_default, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('preset-first', userId, 'First Preset', '', 1, 4096, 1, 0, 0, 0, timestamp, timestamp);
  database.prepare(
    `INSERT INTO presets (
      id, user_id, name, system_prompt, temperature, max_tokens, top_p,
      frequency_penalty, presence_penalty, is_default, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('preset-second', userId, 'Second Preset', '', 1, 4096, 1, 0, 0, 0, timestamp, timestamp);

  assert.deepEqual(
    listPresets(database, userId).map((preset) => preset.id),
    ['preset-second', 'preset-first']
  );
});

test('preset name validation and defaults', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'preset-validate';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'validator', 'hash', new Date().toISOString()
  );

  // Empty name defaults to '未命名预设'
  const preset = createPreset(database, userId, { name: '' });
  assert.equal(preset.name, '未命名预设');

  // Temperature clamping
  const hot = createPreset(database, userId, { name: '太热', temperature: 5.0 });
  assert.equal(hot.temperature, 2.0);

  const cold = createPreset(database, userId, { name: '太冷', temperature: -1 });
  assert.equal(cold.temperature, 0);

  // MaxTokens clamping
  const tooMany = createPreset(database, userId, { name: '太多', maxTokens: 999999 });
  assert.equal(tooMany.maxTokens, 128000);
});

test('preset ownership isolation', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'owner-1', 'owner', 'hash', new Date().toISOString()
  );
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'other-1', 'other', 'hash', new Date().toISOString()
  );

  const preset = createPreset(database, 'owner-1', { name: '我的预设' });

  // Other user cannot see owner's preset
  assert.equal(getPreset(database, 'other-1', preset.id), null);
  assert.equal(listPresets(database, 'other-1').length, 0);

  // Other user cannot update or delete owner's preset
  assert.equal(updatePreset(database, 'other-1', preset.id, { name: '入侵' }), null);
  assert.equal(deletePreset(database, 'other-1', preset.id), false);
  assert.equal(setDefaultPreset(database, 'other-1', preset.id), null);
});

function encryptWithSecret(value, secret) {
  const key = crypto.createHash('sha256').update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

test('character export includes character, regex rules, tags and world book', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'export-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'exporter', 'hash', new Date().toISOString()
  );

  const character = createCharacter(database, userId, {
    name: '导出测试',
    gender: '女',
    persona: '温柔的助手',
    visibility: 'private',
    regexRules: [
      { label: '替换规则', pattern: '猫', replacement: '伙伴', flags: 'g', scope: 'input', enabled: true }
    ],
    tags: ['温柔', '助手']
  });
  setCharacterTags(database, userId, character.id, ['温柔', '助手']);

  // Create a world book linked to the character
  const book = createWorldBook(database, userId, {
    name: '世界观',
    description: '测试世界书',
    characterId: character.id
  });
  createEntry(database, userId, book.id, {
    name: '魔法',
    triggerKeys: '魔法',
    content: '魔法系统',
    position: 'before_char'
  });
  database.prepare(
    'INSERT INTO world_book_entries (id, world_book_id, name, trigger_keys, content, position, enabled, order_index, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    'export-world-entry-tied',
    book.id,
    '同序号目',
    '同序号',
    '同序号内容',
    'before_char',
    1,
    0,
    '2025-01-01T00:00:00.000Z'
  );

  // Simulate export logic
  const regexRules = getRegexRules(database, userId, character.id);
  const characterTags = database
    .prepare(
      `SELECT tags.name FROM character_tags
       JOIN tags ON tags.id = character_tags.tag_id
       WHERE character_tags.character_id = ?`
    )
    .all(character.id);
  const worldBookRow = database.prepare('SELECT id, name, description FROM world_books WHERE character_id = ?').get(character.id);
  let worldBook = null;
  if (worldBookRow) {
    const entries = database
      .prepare(
        `SELECT name, trigger_keys, content, position, enabled, order_index
         FROM world_book_entries WHERE world_book_id = ? ORDER BY order_index ASC, rowid ASC`
      )
      .all(worldBookRow.id);
    worldBook = { name: worldBookRow.name, description: worldBookRow.description, entries };
  }

  const exportData = {
    _flai_export_version: 1,
    character: {
      name: character.name,
      gender: character.gender,
      persona: character.persona,
      visibility: character.visibility
    },
    regex_rules: regexRules,
    tags: characterTags.map((t) => t.name),
    world_book: worldBook
  };

  assert.equal(exportData._flai_export_version, 1);
  assert.equal(exportData.character.name, '导出测试');
  assert.equal(exportData.character.gender, '女');
  assert.equal(exportData.regex_rules.length, 1);
  assert.equal(exportData.regex_rules[0].pattern, '猫');
  assert.deepEqual([...exportData.tags].sort(), ['助手', '温柔'].sort());
  assert.equal(exportData.world_book.name, '世界观');
  assert.equal(exportData.world_book.entries.length, 2);
  assert.equal(exportData.world_book.entries[0].name, '魔法');
  assert.equal(exportData.world_book.entries[1].name, '同序号目');
});

test('character export tags use deterministic name order', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'export-tag-order-user';
  const timestamp = '2026-01-01T00:00:00.000Z';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'exporttagorder', 'hash', timestamp
  );
  const character = createCharacter(database, userId, { name: 'Export Tag Order', visibility: 'private' });
  const insertTag = database.prepare('INSERT INTO tags (id, user_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)');
  const insertLink = database.prepare('INSERT INTO character_tags (character_id, tag_id) VALUES (?, ?)');
  insertTag.run('tag-beta', userId, 'beta', '', timestamp);
  insertTag.run('tag-alpha-lower', userId, 'alpha', '', timestamp);
  insertTag.run('tag-alpha-upper', userId, 'Alpha', '', timestamp);
  insertLink.run(character.id, 'tag-beta');
  insertLink.run(character.id, 'tag-alpha-lower');
  insertLink.run(character.id, 'tag-alpha-upper');

  const app = express();
  app.use(express.json());
  app.use('/api/characters', createCharactersRouter({
    db: database,
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: userId, username: 'exporttagorder' } };
      next();
    },
    asyncRoute: (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    withCharacterTags: (routeCharacter) => routeCharacter,
    withWorldBookId: (routeCharacter) => routeCharacter,
    hasUsableProvider: () => false,
    getChatProviderSettings: () => ({ ok: false, error: 'unused' }),
    withEtag: (_request, response, data) => response.json(data),
    withListCache: (_request, response, data) => response.json(data),
    nowIso: () => timestamp
  }));
  app.use((error, _request, response, _next) => {
    response.status(500).json({ error: error.message });
  });

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${baseUrl}/api/characters/${character.id}/export`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.tags, ['Alpha', 'alpha', 'beta']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('character import creates new character with new ID', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'import-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'importer', 'hash', new Date().toISOString()
  );

  const importData = {
    _flai_export_version: 1,
    character: {
      name: '导入角色',
      gender: '男',
      persona: '勇敢的冒险者',
      background: '来自远方',
      openingMessage: '你好，旅行者！',
      visibility: 'private'
    },
    regex_rules: [
      { label: '规则1', pattern: '火', replacement: '冰', flags: 'g', scope: 'input', enabled: true }
    ],
    tags: ['冒险', '勇敢']
  };

  // Simulate import logic
  const character = createCharacter(database, userId, {
    name: importData.character.name,
    gender: importData.character.gender,
    persona: importData.character.persona,
    background: importData.character.background,
    openingMessage: importData.character.openingMessage,
    visibility: 'private',
    regexRules: importData.regex_rules,
    tags: importData.tags
  });
  setCharacterTags(database, userId, character.id, importData.tags);

  assert.equal(character.name, '导入角色');
  assert.equal(character.gender, '男');
  assert.equal(character.persona, '勇敢的冒险者');
  assert.equal(character.regexRules.length, 1);
  assert.equal(character.regexRules[0].pattern, '火');

  // Verify tags were auto-created
  const tagNames = getCharacterTagNames(database, character.id);
  assert.deepEqual(tagNames, ['冒险', '勇敢']);

  // Verify the character is in the list
  const all = listCharacters(database, userId, {});
  assert.equal(all.length, 1);
  assert.equal(all[0].name, '导入角色');
});

test('character import with world book creates book and entries', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'import-wb-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'importer-wb', 'hash', new Date().toISOString()
  );

  const importData = {
    character: { name: '带世界书角色' },
    regex_rules: [],
    tags: [],
    world_book: {
      name: '导入的世界书',
      description: '测试描述',
      entries: [
        { name: '条目1', trigger_keys: '关键词1', content: '内容1', position: 'before_char', enabled: true },
        { name: '条目2', trigger_keys: '关键词2', content: '内容2', position: 'at_start', enabled: true }
      ]
    }
  };

  const character = createCharacter(database, userId, {
    name: importData.character.name,
    visibility: 'private',
    regexRules: [],
    tags: []
  });

  const book = createWorldBook(database, userId, {
    name: importData.world_book.name,
    description: importData.world_book.description,
    characterId: character.id
  });

  for (const entry of importData.world_book.entries) {
    createEntry(database, userId, book.id, {
      name: entry.name,
      triggerKeys: entry.trigger_keys,
      content: entry.content,
      position: entry.position,
      enabled: entry.enabled
    });
  }

  const retrieved = getWorldBook(database, userId, book.id);
  assert.equal(retrieved.name, '导入的世界书');
  assert.equal(retrieved.characterId, character.id);
  assert.equal(retrieved.entries.length, 2);
  assert.equal(retrieved.entries[0].name, '条目1');
  assert.equal(retrieved.entries[1].triggerKeys, '关键词2');
});

test('character import validates required name field', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'import-validate';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'validator', 'hash', new Date().toISOString()
  );

  // Import with empty name should fail
  assert.throws(
    () => createCharacter(database, userId, { name: '', visibility: 'private' }),
    /角色名长度/
  );

  // Import with valid name should succeed
  const character = createCharacter(database, userId, { name: '有效名称', visibility: 'private' });
  assert.equal(character.name, '有效名称');
});

test('mods CRUD with type and ordering', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'mod-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'modder', 'hash', new Date().toISOString()
  );

  // Create mod
  const mod1 = createMod(database, userId, {
    name: '文风增强',
    description: '让回复更文艺',
    type: 'style_enhance',
    content: '请使用优美的文学语言回复。',
    enabled: true
  });
  assert.equal(mod1.name, '文风增强');
  assert.equal(mod1.type, 'style_enhance');
  assert.equal(mod1.enabled, true);
  assert.equal(mod1.orderIndex, 0);

  // Create second mod
  const mod2 = createMod(database, userId, {
    name: '世界观注入',
    type: 'prompt_inject',
    content: '这是一个魔法世界。'
  });
  assert.equal(mod2.orderIndex, 1);

  // List mods - ordered by order_index
  const mods = listMods(database, userId);
  assert.equal(mods.length, 2);
  assert.equal(mods[0].id, mod1.id);
  assert.equal(mods[1].id, mod2.id);

  // Get mod
  const fetched = getMod(database, userId, mod1.id);
  assert.equal(fetched.name, '文风增强');

  // Update mod
  const updated = updateMod(database, userId, mod2.id, {
    name: '世界观注入 v2',
    enabled: false
  });
  assert.equal(updated.name, '世界观注入 v2');
  assert.equal(updated.enabled, false);

  // Reorder mods
  const reordered = reorderMods(database, userId, [mod2.id, mod1.id]);
  assert.equal(reordered[0].id, mod2.id);
  assert.equal(reordered[1].id, mod1.id);

  // Get enabled mods only
  const enabled = getEnabledModsForUser(database, userId);
  assert.equal(enabled.length, 1);
  assert.equal(enabled[0].id, mod1.id);

  // Delete mod
  assert.equal(deleteMod(database, userId, mod1.id), true);
  assert.equal(listMods(database, userId).length, 1);
  assert.equal(deleteMod(database, userId, 'nonexistent'), false);
});

test('mods normalize string booleans and non-finite order indexes', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'mod-normalize-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'mod-normalizer', 'hash', new Date().toISOString()
  );

  const disabled = createMod(database, userId, {
    name: 'String disabled mod',
    enabled: 'false'
  });
  const ordered = createMod(database, userId, {
    name: 'Ordered mod',
    enabled: true
  });

  assert.equal(disabled.enabled, false);
  assert.equal(ordered.orderIndex, 1);

  const updated = updateMod(database, userId, ordered.id, {
    name: 'Ordered mod updated',
    enabled: 'false',
    orderIndex: 'Infinity'
  });

  assert.equal(updated.enabled, false);
  assert.equal(updated.orderIndex, 1);
});

test('enabled mods filter by loading scope and character bindings', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'mod-scope-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'mod-scope', 'hash', new Date().toISOString()
  );
  const characterA = createCharacter(database, userId, { name: 'Scope A' });
  const characterB = createCharacter(database, userId, { name: 'Scope B' });

  const globalMod = createMod(database, userId, { name: 'Global mod', content: 'global' });
  const allCharactersMod = createMod(database, userId, {
    name: 'All characters mod',
    content: 'all',
    scope: 'all_characters'
  });
  const characterAMod = createMod(database, userId, {
    name: 'Character A mod',
    content: 'a',
    scope: 'characters',
    characterIds: [characterA.id, characterA.id, '']
  });
  const characterBMod = createMod(database, userId, {
    name: 'Character B mod',
    content: 'b',
    scope: 'characters',
    characterIds: [characterB.id]
  });
  assert.throws(
    () => createMod(database, userId, {
      name: 'Unbound character mod',
      content: 'none',
      scope: 'characters',
      characterIds: []
    }),
    /至少需要绑定一个角色/
  );
  const legacyUnboundId = 'legacy-unbound-character-mod';
  database
    .prepare(
      `INSERT INTO mods (
        id, user_id, name, description, type, content, enabled, scope, character_ids, order_index, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      legacyUnboundId,
      userId,
      'Legacy unbound character mod',
      '',
      'prompt_inject',
      'legacy',
      0,
      'characters',
      '[]',
      99,
      nowIso()
    );
  assert.equal(updateMod(database, userId, legacyUnboundId, { enabled: false }).enabled, false);
  assert.throws(
    () => updateMod(database, userId, legacyUnboundId, { enabled: true }),
    /至少需要绑定一个角色/
  );
  createMod(database, userId, {
    name: 'Disabled all character mod',
    content: 'disabled',
    scope: 'all_characters',
    enabled: false
  });

  assert.deepEqual(getMod(database, userId, characterAMod.id).characterIds, [characterA.id]);
  assert.deepEqual(
    getEnabledModsForUser(database, userId, { characterId: characterA.id }).map((mod) => mod.id),
    [globalMod.id, allCharactersMod.id, characterAMod.id]
  );
  assert.deepEqual(
    getEnabledModsForUser(database, userId, { characterId: characterB.id }).map((mod) => mod.id),
    [globalMod.id, allCharactersMod.id, characterBMod.id]
  );
  assert.deepEqual(
    getEnabledModsForUser(database, userId).map((mod) => mod.id),
    [globalMod.id]
  );
});

test('mod schemas preserve snake case character bindings', () => {
  const result = createModSchema.safeParse({
    name: 'Snake case binding',
    scope: 'characters',
    character_ids: ['character-snake']
  });

  assert.equal(result.success, true);
  assert.equal(Object.hasOwn(result.data, 'characterIds'), false);
  assert.deepEqual(result.data.character_ids, ['character-snake']);
});

test('mod update schema does not default omitted content fields', () => {
  const result = updateModSchema.safeParse({ enabled: false });

  assert.equal(result.success, true);
  assert.deepEqual(result.data, { enabled: false });
  assert.equal(Object.hasOwn(result.data, 'content'), false);
  assert.equal(Object.hasOwn(result.data, 'description'), false);
  assert.equal(Object.hasOwn(result.data, 'type'), false);
});

test('mods partial reorder keeps order indexes unique', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'mod-partial-order';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'modder-partial', 'hash', new Date().toISOString()
  );

  const mod1 = createMod(database, userId, { name: 'First mod' });
  const mod2 = createMod(database, userId, { name: 'Second mod' });
  const mod3 = createMod(database, userId, { name: 'Third mod' });

  const reordered = reorderMods(database, userId, ['missing-mod', mod3.id, mod3.id]);

  assert.deepEqual(reordered.map((mod) => mod.id), [mod3.id, mod1.id, mod2.id]);
  assert.deepEqual(reordered.map((mod) => mod.orderIndex), [0, 1, 2]);
});

test('mods preserve deterministic order when order indexes and timestamps tie', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'mod-tie-order';
  const timestamp = '2026-01-01T00:00:00.000Z';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'mod-tie-order', 'hash', timestamp
  );
  const mod1 = createMod(database, userId, { name: 'First mod', content: 'first content', enabled: true });
  const mod2 = createMod(database, userId, { name: 'Second mod', content: 'second content', enabled: true });
  const mod3 = createMod(database, userId, { name: 'Third mod', content: 'third content', enabled: true });
  database
    .prepare('UPDATE mods SET order_index = 0, created_at = ? WHERE id IN (?, ?, ?)')
    .run(timestamp, mod1.id, mod2.id, mod3.id);

  assert.deepEqual(
    listMods(database, userId).map((mod) => mod.id),
    [mod3.id, mod2.id, mod1.id]
  );
  assert.deepEqual(
    getEnabledModsForUser(database, userId).map((mod) => mod.id),
    [mod3.id, mod2.id, mod1.id]
  );
  const prompt = buildModSystemPrompt(getEnabledModsForUser(database, userId));
  assert.ok(prompt.indexOf('third content') < prompt.indexOf('second content'));
  assert.ok(prompt.indexOf('second content') < prompt.indexOf('first content'));

  const reordered = reorderMods(database, userId, [mod1.id]);
  assert.deepEqual(reordered.map((mod) => mod.id), [mod1.id, mod3.id, mod2.id]);
  assert.deepEqual(reordered.map((mod) => mod.orderIndex), [0, 1, 2]);
});

test('mod name validation rejects empty names', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'mod-validate';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'validator', 'hash', new Date().toISOString()
  );

  assert.throws(() => createMod(database, userId, { name: '' }), /名称不能为空/);

  const mod = createMod(database, userId, { name: '正常名称' });
  assert.equal(mod.name, '正常名称');
});

test('mod ownership isolation', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'owner-1', 'owner', 'hash', new Date().toISOString()
  );
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'other-1', 'other', 'hash', new Date().toISOString()
  );

  const mod = createMod(database, 'owner-1', { name: '我的 Mod' });

  // Other user cannot see owner's mod
  assert.equal(getMod(database, 'other-1', mod.id), null);
  assert.equal(listMods(database, 'other-1').length, 0);

  // Other user cannot update or delete owner's mod
  assert.equal(updateMod(database, 'other-1', mod.id, { name: '入侵' }), null);
  assert.equal(deleteMod(database, 'other-1', mod.id), false);
});

test('buildModSystemPrompt combines enabled mod contents', () => {
  const mods = [
    { name: '文风', type: 'style_enhance', content: '使用文艺风格' },
    { name: '世界观', type: 'prompt_inject', content: '这是一个魔法世界' },
    { name: '自定义', type: 'custom', content: '自定义指令' }
  ];

  const prompt = buildModSystemPrompt(mods);
  assert.match(prompt, /\[文风要求\]/);
  assert.match(prompt, /使用文艺风格/);
  assert.match(prompt, /这是一个魔法世界/);
  assert.match(prompt, /\[Mod: 自定义\]/);
  assert.match(prompt, /自定义指令/);

  // Empty mods list
  assert.equal(buildModSystemPrompt([]), '');
});

test('advanced settings normalize status bar blueprint', () => {
  const longTemplate = `<style>${'a'.repeat(6000)}</style><div>{{HP}}</div>`;
  const settings = normalizeAdvancedSettings({
    statusBarPrompt: '状态变化时更新',
    statusBarBlueprint: {
      name: '战斗面板',
      variables: [
        { name: 'HP', value: 80, max: 100, color: '#e74c3c' },
        { name: '', value: 1 },
        { name: 'Mood', value: '5', max: '10', color: 'bad-color' }
      ],
      template: '<div>HP: {{HP}} / {{HP.max}}</div>'
    }
  });

  assert.equal(settings.statusBarBlueprint.name, '战斗面板');
  assert.equal(settings.statusBarBlueprint.variables.length, 2);
  assert.equal(settings.statusBarBlueprint.variables[0].name, 'HP');
  assert.equal(settings.statusBarBlueprint.variables[1].value, 5);
  assert.equal(settings.statusBarBlueprint.variables[1].color, '');
  assert.equal(settings.statusBarBlueprint.template, '<div>HP: {{HP}} / {{HP.max}}</div>');

  const longSettings = normalizeAdvancedSettings({
    statusBarBlueprint: {
      name: '长模板',
      variables: [{ name: 'HP', value: 80, max: 100, color: '#e74c3c' }],
      template: longTemplate
    }
  });
  assert.equal(longSettings.statusBarBlueprint.template.length, longTemplate.length);
  assert.equal(updateCharacterSchema.safeParse({
    authorAdvancedSettings: {
      statusBarBlueprint: {
        name: '长模板',
        variables: [{ name: 'HP', value: 80, max: 100, color: '#e74c3c' }],
        template: longTemplate
      }
    }
  }).success, true);

  const maxVariables = Array.from({ length: 60 }, (_item, index) => ({
    name: `Var${index + 1}`,
    value: index
  }));
  assert.equal(updateCharacterSchema.safeParse({
    authorAdvancedSettings: {
      statusBarBlueprint: {
        variables: maxVariables
      }
    }
  }).success, true);
  assert.equal(updateCharacterSchema.safeParse({
    authorAdvancedSettings: {
      statusBarBlueprint: {
        variables: [...maxVariables, { name: 'Var61', value: 61 }]
      }
    }
  }).success, false);
});

test('advanced settings helpers treat null inputs as defaults', () => {
  const normalized = normalizeAdvancedSettings(null);
  assert.equal(normalized.desktopBackgroundUrl, '');
  assert.equal(normalized.statusBarPrompt, '');
  assert.equal(normalized.statusBarBlueprint.variables.length, 0);
  assert.equal(normalized.accessorySkills.statusBarAgent.enabled, 'auto');

  const merged = mergeAdvancedSettings({ statusBarPrompt: 'author prompt' }, null);
  assert.equal(merged.statusBarPrompt, 'author prompt');
  assert.equal(merged.accessorySkills.statusBarAgent.enabled, 'auto');

  assert.equal(isAccessorySkillActive({ statusBarAgent: { enabled: 'auto' } }, 'statusBarAgent', null), false);
});

test('creating a conversation applies character status bar blueprint', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'conv-blueprint-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'conv-blueprint', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, userId, {
    name: '状态角色',
    visibility: 'private',
    authorAdvancedSettings: {
      statusBarPrompt: '受伤时更新 HP',
      statusBarBlueprint: {
        name: '角色状态',
        variables: [{ name: 'HP', value: 100, max: 100, color: '#e74c3c' }],
        template: '<div class="state">HP {{HP}}</div>'
      }
    }
  });

  const app = express();
  app.use(express.json());
  app.use('/api/conversations', createConversationsRouter({
    db: database,
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: userId, username: 'conv-blueprint' } };
      next();
    },
    asyncRoute: (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    newId: (() => {
      let counter = 0;
      return () => `conv-blueprint-${++counter}`;
    })(),
    nowIso: () => new Date().toISOString(),
    withEtag: (_request, response, data) => response.json(data),
    withListCache: (_request, response, data) => response.json(data),
    providerWithSecret: (row) => row,
    getProviderRow: () => null,
    hasUsableProvider
  }));
  app.use((error, _request, response, _next) => {
    response.status(500).json({ error: error.message });
  });

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const createdResponse = await fetch(`${baseUrl}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId: character.id })
    });
    const created = await createdResponse.json();

    assert.equal(createdResponse.status, 201);
    const statusBar = getStatusBar(database, userId, created.id);
    assert.equal(statusBar.name, '角色状态');
    assert.equal(statusBar.variables[0].name, 'HP');
    assert.equal(statusBar.variables[0].value, 100);
    assert.equal(statusBar.template, '<div class="state">HP {{HP}}</div>');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('conversation settings invalid lorebook rolls back appearance inside transaction', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'conv-settings-user';
  const timestamp = new Date().toISOString();
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'conv-settings', 'hash', timestamp
  );
  const character = createCharacter(database, userId, { name: 'Settings Character', visibility: 'private' });
  const conversationId = 'conv-settings-rollback';
  database.prepare(
    'INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(conversationId, userId, character.id, 'Settings Rollback', timestamp, timestamp);

  const app = express();
  app.use(express.json());
  app.use('/api/conversations', createConversationsRouter({
    db: database,
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: userId, username: 'conv-settings' } };
      next();
    },
    asyncRoute: (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    newId: () => 'unused-settings-id',
    nowIso: () => '2026-01-01T00:00:00.000Z',
    withEtag: (_request, response, data) => response.json(data),
    withListCache: (_request, response, data) => response.json(data),
    providerWithSecret: (row) => row,
    getProviderRow: () => null,
    hasUsableProvider
  }));
  app.use((error, _request, response, _next) => {
    response.status(500).json({ error: error.message });
  });

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    database.exec('BEGIN');
    try {
      const response = await fetch(`${baseUrl}/api/conversations/${conversationId}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          desktopBackgroundUrl: '/should-not-stick.png',
          customCss: '.should-not-stick { color: red; }',
          chatLorebookId: 'missing-lorebook'
        })
      });

      assert.equal(response.status, 400);
      assert.deepEqual(getConversationAppearance(database, userId, conversationId), {
        desktopBackgroundUrl: '',
        mobileBackgroundUrl: '',
        customCss: '',
        customJs: ''
      });

      database.prepare('UPDATE conversations SET title = ? WHERE id = ?').run('Outer Transaction Still Open', conversationId);
      assert.equal(
        database.prepare('SELECT title FROM conversations WHERE id = ?').get(conversationId).title,
        'Outer Transaction Still Open'
      );
    } finally {
      database.exec('ROLLBACK');
    }

    assert.equal(
      database.prepare('SELECT title FROM conversations WHERE id = ?').get(conversationId).title,
      'Settings Rollback'
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('conversation settings save succeeds inside an existing transaction', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'conv-settings-nested-user';
  const timestamp = new Date().toISOString();
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'conv-settings-nested', 'hash', timestamp
  );
  const character = createCharacter(database, userId, { name: 'Settings Nested Character', visibility: 'private' });
  const book = createWorldBook(database, userId, { name: 'Settings Nested Book' });
  const conversationId = 'conv-settings-nested';
  database.prepare(
    'INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(conversationId, userId, character.id, 'Settings Nested', timestamp, timestamp);

  const app = express();
  app.use(express.json());
  app.use('/api/conversations', createConversationsRouter({
    db: database,
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: userId, username: 'conv-settings-nested' } };
      next();
    },
    asyncRoute: (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    newId: () => 'unused-settings-nested-id',
    nowIso: () => '2026-01-01T00:00:00.000Z',
    withEtag: (_request, response, data) => response.json(data),
    withListCache: (_request, response, data) => response.json(data),
    providerWithSecret: (row) => row,
    getProviderRow: () => null,
    hasUsableProvider
  }));
  app.use((error, _request, response, _next) => {
    response.status(500).json({ error: error.message });
  });

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    database.exec('BEGIN');
    try {
      const response = await fetch(`${baseUrl}/api/conversations/${conversationId}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          desktopBackgroundUrl: '/nested-settings.png',
          customCss: '.nested-settings { color: green; }',
          chatLorebookId: book.id
        })
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.desktopBackgroundUrl, '/nested-settings.png');
      assert.equal(body.chatLorebookId, book.id);
      assert.deepEqual(getConversationAppearance(database, userId, conversationId), {
        desktopBackgroundUrl: '/nested-settings.png',
        mobileBackgroundUrl: '',
        customCss: '.nested-settings { color: green; }',
        customJs: ''
      });
      assert.equal(
        database.prepare('SELECT chat_lorebook_id FROM conversations WHERE id = ?').get(conversationId).chat_lorebook_id,
        book.id
      );
    } finally {
      database.exec('ROLLBACK');
    }

    assert.deepEqual(getConversationAppearance(database, userId, conversationId), {
      desktopBackgroundUrl: '',
      mobileBackgroundUrl: '',
      customCss: '',
      customJs: ''
    });
    assert.equal(
      database.prepare('SELECT chat_lorebook_id FROM conversations WHERE id = ?').get(conversationId).chat_lorebook_id,
      null
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('conversation list preserves newest insertion order when update timestamps tie', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'conversation-list-order-user';
  const timestamp = '2026-01-01T00:00:00.000Z';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'conversation-list-order', 'hash', timestamp
  );
  const character = createCharacter(database, userId, { name: 'Conversation List Order', visibility: 'private' });
  database.prepare(
    'INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('conversation-first', userId, character.id, 'First Conversation', timestamp, timestamp);
  database.prepare(
    'INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('conversation-second', userId, character.id, 'Second Conversation', timestamp, timestamp);

  const app = express();
  app.use(express.json());
  app.use('/api/conversations', createConversationsRouter({
    db: database,
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: userId, username: 'conversation-list-order' } };
      next();
    },
    asyncRoute: (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    newId: () => 'unused-conversation-list-order-id',
    nowIso: () => timestamp,
    withEtag: (_request, response, data) => response.json(data),
    withListCache: (_request, response, data) => response.json(data),
    providerWithSecret: (row) => row,
    getProviderRow: () => null,
    hasUsableProvider
  }));
  app.use((error, _request, response, _next) => {
    response.status(500).json({ error: error.message });
  });

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${baseUrl}/api/conversations`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.map((conversation) => conversation.id), ['conversation-second', 'conversation-first']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('streaming chat does not persist empty assistant messages', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'empty-stream-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'empty-stream', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, userId, { name: 'EmptyStream', visibility: 'private' });
  const conversationId = 'empty-stream-conv';
  const timestamp = new Date().toISOString();
  database.prepare(
    'INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(conversationId, userId, character.id, 'Empty Stream', timestamp, timestamp);
  database.prepare(
    'INSERT INTO messages (id, user_id, conversation_id, role, content, reasoning, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('stale-empty-assistant', userId, conversationId, 'assistant', '', '', null, timestamp);

  const app = express();
  app.use(express.json());
  app.use('/api/conversations', createConversationsRouter({
    db: database,
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: userId, username: 'empty-stream' } };
      next();
    },
    asyncRoute: (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    newId: (() => {
      let counter = 0;
      return () => `empty-stream-${++counter}`;
    })(),
    nowIso: () => new Date().toISOString(),
    withEtag: (_request, response, data) => response.json(data),
    withListCache: (_request, response, data) => response.json(data),
    providerWithSecret: (row) => row,
    getProviderRow: () => ({
      providerType: 'deepseek',
      gatewayName: 'Test Gateway',
      baseUrl: 'https://provider.test',
      model: 'test-model',
      apiKey: 'sk-test',
      supportsReasoning: false,
      extraBody: {}
    }),
    hasUsableProvider
  }));
  app.use((error, _request, response, _next) => {
    response.status(500).json({ error: error.message });
  });

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const href = String(url);
    if (href.startsWith('http://127.0.0.1:')) {
      return originalFetch(url, options);
    }
    return new Response(sseStream(['data: [DONE]']), {
      headers: { 'Content-Type': 'text/event-stream' }
    });
  };

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${baseUrl}/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'next chapter' })
    });
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.match(text, /event: error/);
    assert.match(text, /模型没有返回正文/);

    const rows = database.prepare(
      'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
    ).all(conversationId);
    assert.equal(rows.filter((row) => row.role === 'assistant').length, 1);
    assert.equal(rows.filter((row) => row.role === 'user').length, 1);
    assert.equal(rows.find((row) => row.role === 'user').content, 'next chapter');

    const listResponse = await fetch(`${baseUrl}/api/conversations/${conversationId}/messages`);
    const listed = await listResponse.json();
    assert.deepEqual(listed.messages.map((message) => message.role), ['user']);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('chat message route normalizes string boolean request flags', async () => {
  const database = createAppDatabase(':memory:');
  const { userId, conversationId } = createTestSetup(database);

  let providerBody = null;
  const app = express();
  app.use(express.json());
  app.use('/api/conversations', createConversationsRouter({
    db: database,
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: userId, username: 'string-bool-chat-user' } };
      next();
    },
    asyncRoute: (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    newId: (() => {
      let counter = 0;
      return () => `string-bool-chat-${++counter}`;
    })(),
    nowIso: () => '2026-01-01T00:00:01.000Z',
    withEtag: (_request, response, data) => response.json(data),
    withListCache: (_request, response, data) => response.json(data),
    providerWithSecret: (row) => row,
    getProviderRow: () => ({
      providerType: 'deepseek',
      gatewayName: 'Test Gateway',
      baseUrl: 'https://provider.test',
      model: 'deepseek-v4-flash',
      apiKey: 'sk-test',
      supportsReasoning: true,
      extraBody: {}
    }),
    hasUsableProvider
  }));
  app.use((error, _request, response, _next) => {
    response.status(500).json({ error: error.message });
  });

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.startsWith('http://127.0.0.1:')) {
      return originalFetch(url, options);
    }
    providerBody = JSON.parse(options.body);
    return jsonResponse({
      choices: [{ message: { content: 'assistant answer' } }],
      usage: { total_tokens: 1 }
    });
  };

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${baseUrl}/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'string flag prompt',
        stream: 'false',
        thinkingEnabled: 'false'
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.assistantMessage.content, 'assistant answer');
    assert.equal(providerBody.stream, false);
    assert.deepEqual(providerBody.thinking, { type: 'disabled' });
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('conversation messages preserve insertion order when timestamps tie', async () => {
  const database = createAppDatabase(':memory:');
  const { userId, conversationId } = createTestSetup(database);
  const tiedTimestamp = '2026-01-01T00:00:00.000Z';
  insertMessage(database, userId, conversationId, 'user', 'First tied message', tiedTimestamp);
  insertMessage(database, userId, conversationId, 'assistant', 'Second tied message', tiedTimestamp);
  insertMessage(database, userId, conversationId, 'user', 'Third tied message', tiedTimestamp);

  const app = express();
  app.use(express.json());
  app.use('/api/conversations', createConversationsRouter({
    db: database,
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: userId, username: 'message-order-user' } };
      next();
    },
    asyncRoute: (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    newId: () => 'unused-message-order-id',
    nowIso: () => tiedTimestamp,
    withEtag: (_request, response, data) => response.json(data),
    withListCache: (_request, response, data) => response.json(data),
    providerWithSecret: (row) => row,
    getProviderRow: () => null,
    hasUsableProvider
  }));
  app.use((error, _request, response, _next) => {
    response.status(500).json({ error: error.message });
  });

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${baseUrl}/api/conversations/${conversationId}/messages`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(
      body.messages.map((message) => message.content),
      ['First tied message', 'Second tied message', 'Third tied message']
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('chat prompt history keeps latest tied-timestamp messages in insertion order', async () => {
  const database = createAppDatabase(':memory:');
  const { userId, conversationId } = createTestSetup(database);
  const tiedTimestamp = '2026-01-01T00:00:00.000Z';
  for (let index = 1; index <= 25; index += 1) {
    insertMessage(database, userId, conversationId, 'user', `history-${String(index).padStart(2, '0')}`, tiedTimestamp);
  }

  let providerBody = null;
  const app = express();
  app.use(express.json());
  app.use('/api/conversations', createConversationsRouter({
    db: database,
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: userId, username: 'history-window-user' } };
      next();
    },
    asyncRoute: (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    newId: (() => {
      let counter = 0;
      return () => `history-window-${++counter}`;
    })(),
    nowIso: () => '2026-01-01T00:00:01.000Z',
    withEtag: (_request, response, data) => response.json(data),
    withListCache: (_request, response, data) => response.json(data),
    providerWithSecret: (row) => row,
    getProviderRow: () => ({
      providerType: 'deepseek',
      gatewayName: 'Test Gateway',
      baseUrl: 'https://provider.test',
      model: 'test-model',
      apiKey: 'sk-test',
      supportsReasoning: false,
      extraBody: {}
    }),
    hasUsableProvider
  }));
  app.use((error, _request, response, _next) => {
    response.status(500).json({ error: error.message });
  });

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.startsWith('http://127.0.0.1:')) {
      return originalFetch(url, options);
    }
    providerBody = JSON.parse(options.body);
    return jsonResponse({
      choices: [{ message: { content: 'assistant answer' } }],
      usage: { total_tokens: 1 }
    });
  };

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${baseUrl}/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'new prompt', stream: false })
    });

    assert.equal(response.status, 200);
    assert.deepEqual(
      providerBody.messages
        .map((message) => message.content)
        .filter((content) => /^history-\d+$/.test(content)),
      Array.from({ length: 20 }, (_, index) => `history-${String(index + 6).padStart(2, '0')}`)
    );
    assert.equal(providerBody.messages.at(-1).content, 'new prompt');
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('chat prompt does not inject status bar context into main model', async () => {
  const database = createAppDatabase(':memory:');
  const { userId, conversationId } = createTestSetup(database);
  database
    .prepare('UPDATE conversations SET user_advanced_settings = ? WHERE id = ?')
    .run(
      JSON.stringify({
        statusBarPrompt: 'STATUS_RULE_SENTINEL',
        accessorySkills: { statusBarAgent: { enabled: false, modelOverride: '' } }
      }),
      conversationId
    );
  upsertStatusBar(database, userId, conversationId, {
    name: 'STATUS_BAR_NAME_SENTINEL',
    variables: [{ name: 'STATUS_VAR_SENTINEL', value: 65, max: 100 }],
    template: '<div>{{STATUS_VAR_SENTINEL}}</div>'
  });

  let providerBody = null;
  const app = express();
  app.use(express.json());
  app.use('/api/conversations', createConversationsRouter({
    db: database,
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: userId, username: 'status-prompt-user' } };
      next();
    },
    asyncRoute: (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    newId: (() => {
      let counter = 0;
      return () => `status-prompt-${++counter}`;
    })(),
    nowIso: () => '2026-01-01T00:00:01.000Z',
    withEtag: (_request, response, data) => response.json(data),
    withListCache: (_request, response, data) => response.json(data),
    providerWithSecret: (row) => row,
    getProviderRow: () => ({
      providerType: 'deepseek',
      gatewayName: 'Test Gateway',
      baseUrl: 'https://provider.test',
      model: 'test-model',
      apiKey: 'sk-test',
      supportsReasoning: false,
      extraBody: {}
    }),
    hasUsableProvider
  }));
  app.use((error, _request, response, _next) => {
    response.status(500).json({ error: error.message });
  });

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.startsWith('http://127.0.0.1:')) {
      return originalFetch(url, options);
    }
    providerBody = JSON.parse(options.body);
    return jsonResponse({
      choices: [{ message: { content: 'assistant answer' } }],
      usage: { total_tokens: 1 }
    });
  };

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${baseUrl}/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'new prompt', stream: false })
    });

    assert.equal(response.status, 200);
    const promptText = JSON.stringify(providerBody.messages);
    assert.equal(promptText.includes('STATUS_RULE_SENTINEL'), false);
    assert.equal(promptText.includes('STATUS_VAR_SENTINEL'), false);
    assert.equal(promptText.includes('STATUS_BAR_NAME_SENTINEL'), false);
    assert.equal(providerBody.messages.at(-1).content, 'new prompt');
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('chat prompt injects NPC memories and behaviors when NPC agent is active', async () => {
  const database = createAppDatabase(':memory:');
  const { userId, conversationId } = createTestSetup(database);
  database
    .prepare('UPDATE conversations SET user_advanced_settings = ? WHERE id = ?')
    .run(
      JSON.stringify({
        accessorySkills: { npcAgent: { enabled: true, modelOverride: '' } }
      }),
      conversationId
    );
  database
    .prepare(
      `INSERT INTO npc_memories (id, conversation_id, npc_name, memory_type, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run('npc-route-memory-1', conversationId, 'PromptNpc', 'event', 'NPC_MEMORY_SENTINEL', '2026-01-01T00:00:00.000Z');
  database
    .prepare(
      `INSERT INTO npc_memories (id, conversation_id, npc_name, memory_type, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run('npc-route-memory-only-1', conversationId, 'MemoryOnlyNpc', 'knowledge', 'NPC_MEMORY_ONLY_SENTINEL', '2026-01-01T00:00:01.000Z');
  database
    .prepare(
      `INSERT INTO npc_behaviors (id, conversation_id, npc_name, behavior_type, trigger_condition, action, priority, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      'npc-route-behavior-1',
      conversationId,
      'PromptNpc',
      'reaction',
      'NPC_TRIGGER_SENTINEL',
      'NPC_ACTION_SENTINEL',
      10,
      1,
      '2026-01-01T00:00:00.000Z'
    );

  const providerBodies = [];
  const app = express();
  app.use(express.json());
  app.use('/api/conversations', createConversationsRouter({
    db: database,
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: userId, username: 'npc-prompt-user' } };
      next();
    },
    asyncRoute: (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    newId: (() => {
      let counter = 0;
      return () => `npc-prompt-${++counter}`;
    })(),
    nowIso: () => '2026-01-01T00:00:02.000Z',
    withEtag: (_request, response, data) => response.json(data),
    withListCache: (_request, response, data) => response.json(data),
    providerWithSecret: (row) => row,
    getProviderRow: () => ({
      providerType: 'deepseek',
      gatewayName: 'Test Gateway',
      baseUrl: 'https://provider.test',
      model: 'test-model',
      apiKey: 'sk-test',
      supportsReasoning: false,
      extraBody: {}
    }),
    hasUsableProvider
  }));
  app.use((error, _request, response, _next) => {
    response.status(500).json({ error: error.message });
  });

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.startsWith('http://127.0.0.1:')) {
      return originalFetch(url, options);
    }
    providerBodies.push(JSON.parse(options.body));
    return jsonResponse({
      choices: [{ message: { content: 'assistant answer' } }],
      usage: { total_tokens: 1 }
    });
  };

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${baseUrl}/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'new prompt', stream: false })
    });

    assert.equal(response.status, 200);
    const providerBody = providerBodies.find((body) => (
      Array.isArray(body.messages) && body.messages.at(-1)?.content === 'new prompt'
    ));
    assert.ok(providerBody);
    const promptText = JSON.stringify(providerBody.messages);
    assert.match(promptText, /NPC_MEMORY_SENTINEL/);
    assert.match(promptText, /NPC_ACTION_SENTINEL/);
    assert.match(promptText, /NPC_TRIGGER_SENTINEL/);
    assert.match(promptText, /NPC_MEMORY_ONLY_SENTINEL/);
    assert.equal(providerBody.messages.at(-1).content, 'new prompt');
    for (let attempt = 0; attempt < 20 && providerBodies.length < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('branchConversation works inside an existing transaction', () => {
  const database = createAppDatabase(':memory:');
  const { userId, conversationId } = createTestSetup(database);
  insertMessage(database, userId, conversationId, 'user', 'Branch start', '2026-01-01T00:00:00.000Z');
  const branchMessageId = insertMessage(
    database,
    userId,
    conversationId,
    'assistant',
    'Branch point',
    '2026-01-01T00:00:01.000Z'
  );

  let branchId = '';
  database.exec('BEGIN');
  try {
    const branch = branchConversation(database, userId, conversationId, branchMessageId);
    assert.ok(branch);
    branchId = branch.id;
    assert.equal(branch.branchedFromId, conversationId);
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?').get(branchId).count,
      2
    );
  } finally {
    database.exec('ROLLBACK');
  }

  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM conversations WHERE id = ?').get(branchId).count,
    0
  );
});

test('branchConversation rolls back partial branch when message copy fails', () => {
  const database = createAppDatabase(':memory:');
  const { userId, conversationId } = createTestSetup(database);
  insertMessage(database, userId, conversationId, 'user', 'Branch survives source', '2026-01-01T00:00:00.000Z');
  const branchMessageId = insertMessage(
    database,
    userId,
    conversationId,
    'assistant',
    'Force branch failure',
    '2026-01-01T00:00:01.000Z'
  );

  database.exec(`
    CREATE TRIGGER fail_branch_message_copy
    BEFORE INSERT ON messages
    WHEN NEW.conversation_id <> '${conversationId}' AND NEW.content = 'Force branch failure'
    BEGIN
      SELECT RAISE(ABORT, 'forced branch message copy failure');
    END
  `);

  assert.throws(
    () => branchConversation(database, userId, conversationId, branchMessageId),
    /forced branch message copy failure/
  );
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM conversations WHERE branched_from_id = ?').get(conversationId).count,
    0
  );
});

test('branchConversation stops at the selected message when timestamps tie', () => {
  const database = createAppDatabase(':memory:');
  const { userId, conversationId } = createTestSetup(database);
  const tiedTimestamp = '2026-01-01T00:00:00.000Z';
  insertMessage(database, userId, conversationId, 'user', 'Before branch', tiedTimestamp);
  const branchMessageId = insertMessage(database, userId, conversationId, 'assistant', 'Branch here', tiedTimestamp);
  insertMessage(database, userId, conversationId, 'user', 'After branch', tiedTimestamp);

  const branch = branchConversation(database, userId, conversationId, branchMessageId);

  assert.ok(branch);
  const copied = database.prepare(
    'SELECT content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC'
  ).all(branch.id);
  assert.deepEqual(copied.map((row) => row.content), ['Before branch', 'Branch here']);
});

test('conversation branches preserve newest insertion order when timestamps tie', () => {
  const database = createAppDatabase(':memory:');
  const { userId, conversationId, character } = createTestSetup(database);
  const branchMessageId = insertMessage(
    database,
    userId,
    conversationId,
    'assistant',
    'Branch point',
    '2026-01-01T00:00:00.000Z'
  );
  const tiedTimestamp = '2026-01-01T00:00:01.000Z';

  database.prepare(
    `INSERT INTO conversations (id, user_id, character_id, title, branched_from_id, branched_from_message_id, branched_from_title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('branch-first', userId, character.id, 'First Branch', conversationId, branchMessageId, 'Parent', tiedTimestamp, tiedTimestamp);
  database.prepare(
    `INSERT INTO conversations (id, user_id, character_id, title, branched_from_id, branched_from_message_id, branched_from_title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('branch-second', userId, character.id, 'Second Branch', conversationId, branchMessageId, 'Parent', tiedTimestamp, tiedTimestamp);

  const branches = getConversationBranches(database, userId, conversationId);

  assert.deepEqual(branches.map((branch) => branch.id), ['branch-second', 'branch-first']);
});

test('status bar CRUD operations', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'statusbar-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'statusbar-tester', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, userId, { name: 'StateTest', visibility: 'private' });

  const conversationId = 'conv-statusbar';
  const timestamp = new Date().toISOString();
  database.prepare(
    'INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(conversationId, userId, character.id, 'StatusBar Test', timestamp, timestamp);

  assert.equal(getStatusBar(database, userId, conversationId), null);

  const statusBar = upsertStatusBar(database, userId, conversationId, {
    name: 'Character State',
    variables: [
      { name: 'HP', value: 100, max: 100, color: '#e74c3c' },
      { name: 'MP', value: 50, max: 80, color: '#3498db' }
    ],
    template: '<div>HP: {{HP}}</div>'
  });
  assert.equal(statusBar.name, 'Character State');
  assert.equal(statusBar.variables.length, 2);
  assert.equal(statusBar.variables[0].name, 'HP');
  assert.equal(statusBar.variables[0].value, 100);
  assert.equal(statusBar.variables[0].max, 100);
  assert.equal(statusBar.variables[0].color, '#e74c3c');
  assert.equal(statusBar.template, '<div>HP: {{HP}}</div>');

  const fetched = getStatusBar(database, userId, conversationId);
  assert.equal(fetched.name, 'Character State');
  assert.equal(fetched.variables.length, 2);

  const updated = upsertStatusBar(database, userId, conversationId, {
    name: 'Updated State',
    variables: [
      { name: 'HP', value: 85, max: 100, color: '#e74c3c' }
    ]
  });
  assert.equal(updated.name, 'Updated State');
  assert.equal(updated.variables.length, 1);
  assert.equal(updated.variables[0].value, 85);

  assert.equal(deleteStatusBar(database, userId, conversationId), true);
  assert.equal(getStatusBar(database, userId, conversationId), null);
  assert.equal(deleteStatusBar(database, userId, conversationId), false);
});

test('status bar ownership isolation', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'owner', 'owner', 'hash', new Date().toISOString()
  );
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'other', 'other', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, 'owner', { name: 'Test', visibility: 'private' });
  const conversationId = 'conv-owner';
  const timestamp = new Date().toISOString();
  database.prepare(
    'INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(conversationId, 'owner', character.id, 'My Conv', timestamp, timestamp);

  upsertStatusBar(database, 'owner', conversationId, {
    name: 'HP',
    variables: [{ name: 'HP', value: 100, max: 100 }]
  });

  assert.equal(getStatusBar(database, 'other', conversationId), null);
  assert.equal(upsertStatusBar(database, 'other', conversationId, { name: 'hack' }), null);
  assert.equal(deleteStatusBar(database, 'other', conversationId), false);
});

test('extractVariablesFromText finds HP and MP patterns', () => {
  const variables = [
    { name: 'HP', value: 100, max: 100 },
    { name: 'MP', value: 50, max: 80 },
    { name: 'Favor', value: 0, max: 100 }
  ];

  const updates1 = extractVariablesFromText('HP: 85/100, MP: 30/80', variables);
  assert.equal(updates1.length, 2);
  assert.equal(updates1[0].name, 'HP');
  assert.equal(updates1[0].value, 85);
  assert.equal(updates1[0].max, 100);
  assert.equal(updates1[1].name, 'MP');
  assert.equal(updates1[1].value, 30);

  const updates2 = extractVariablesFromText('[HP] 60', variables);
  assert.equal(updates2.length, 1);
  assert.equal(updates2[0].name, 'HP');
  assert.equal(updates2[0].value, 60);

  const updates3 = extractVariablesFromText('Nice weather today', variables);
  assert.equal(updates3.length, 0);

  assert.deepEqual(extractVariablesFromText('', variables), []);
  assert.deepEqual(extractVariablesFromText('test', []), []);
});

test('applyVariableUpdates merges changes correctly', () => {
  const variables = [
    { name: 'HP', value: 100, max: 100, color: '#ff0000' },
    { name: 'MP', value: 50, max: 80, color: '#0000ff' }
  ];

  const updates = [{ name: 'HP', value: 85 }];
  const result = applyVariableUpdates(variables, updates);
  assert.equal(result[0].value, 85);
  assert.equal(result[0].max, 100);
  assert.equal(result[0].color, '#ff0000');
  assert.equal(result[1].value, 50);

  const updates2 = [{ name: 'MP', value: 60, max: '120' }];
  const result2 = applyVariableUpdates(variables, updates2);
  assert.equal(result2[1].value, 60);
  assert.equal(result2[1].max, 120);

  const updatesWithBlankMax = [{ name: 'HP', value: 70, max: '   ' }];
  const blankMaxResult = applyVariableUpdates(variables, updatesWithBlankMax);
  assert.equal(blankMaxResult[0].value, 70);
  assert.equal(blankMaxResult[0].max, 100);

  const result3 = applyVariableUpdates(variables, []);
  assert.equal(result3, variables);
});

// ── Talent Pool CRUD ──

test('talent pools CRUD operations', () => {
  const database = createAppDatabase(':memory:');

  // Create talent pool
  const pool = createTalentPool(database, {
    name: '战斗天赋',
    description: '与战斗相关的天赋',
    talents: [
      { name: '剑术精通', description: '擅长使用剑', rarity: 'rare', effect: '攻击力+20%' },
      { name: '天生神力', description: '力量超群', rarity: 'epic', effect: '力量+50%' },
      { name: '普通体质', description: '普通体质', rarity: 'common', effect: '' },
      { name: '不死之身', description: '传说中的不死能力', rarity: 'legendary', effect: '免疫致命伤害' }
    ]
  });
  assert.equal(pool.name, '战斗天赋');
  assert.equal(pool.description, '与战斗相关的天赋');
  assert.equal(pool.talents.length, 4);
  assert.equal(pool.talents[0].name, '剑术精通');
  assert.equal(pool.talents[0].rarity, 'rare');

  // List pools
  const pools = listTalentPools(database);
  assert.equal(pools.length, 1);
  assert.equal(pools[0].name, '战斗天赋');

  // Get pool
  const fetched = getTalentPool(database, pool.id);
  assert.equal(fetched.name, '战斗天赋');
  assert.equal(fetched.talents.length, 4);

  // Update pool
  const updated = updateTalentPool(database, pool.id, {
    name: '战斗天赋 v2',
    talents: [
      { name: '剑术精通', description: '擅长使用剑', rarity: 'rare', effect: '攻击力+20%' }
    ]
  });
  assert.equal(updated.name, '战斗天赋 v2');
  assert.equal(updated.talents.length, 1);

  // Delete pool
  assert.equal(deleteTalentPool(database, pool.id), true);
  assert.equal(listTalentPools(database).length, 0);
  assert.equal(deleteTalentPool(database, 'nonexistent'), false);
});

test('talent pool name validation', () => {
  const database = createAppDatabase(':memory:');

  assert.throws(() => createTalentPool(database, { name: '' }), /名称长度/);
  assert.throws(() => createTalentPool(database, { name: 'a'.repeat(81) }), /名称长度/);

  const pool = createTalentPool(database, { name: '正常名称' });
  assert.equal(pool.name, '正常名称');
});

test('talent pool update returns null for nonexistent pool', () => {
  const database = createAppDatabase(':memory:');
  assert.equal(updateTalentPool(database, 'nonexistent', { name: 'test' }), null);
});

test('talent lists preserve newest insertion order when timestamps tie', () => {
  const database = createAppDatabase(':memory:');
  const timestamp = '2000-01-01T00:00:00.000Z';
  database.prepare(
    'INSERT INTO talent_pools (id, name, description, talents_json, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run('talent-pool-first', 'First Pool', '', '[]', timestamp);
  database.prepare(
    'INSERT INTO talent_pools (id, name, description, talents_json, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run('talent-pool-second', 'Second Pool', '', '[]', timestamp);

  assert.deepEqual(
    listTalentPools(database).map((pool) => pool.id),
    ['talent-pool-second', 'talent-pool-first']
  );

  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'talent-order-user',
    'talentorder',
    'hash',
    timestamp
  );
  const character = createCharacter(database, 'talent-order-user', { name: 'TalentOrder', visibility: 'private' });
  database.prepare(
    'INSERT INTO character_talents (id, character_id, talent_name, talent_rarity, talent_description, talent_effect, pool_id, rolled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('character-talent-first', character.id, 'First Talent', 'common', '', '', 'talent-pool-first', timestamp);
  database.prepare(
    'INSERT INTO character_talents (id, character_id, talent_name, talent_rarity, talent_description, talent_effect, pool_id, rolled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('character-talent-second', character.id, 'Second Talent', 'rare', '', '', 'talent-pool-second', timestamp);

  assert.deepEqual(
    getCharacterTalents(database, character.id).map((talent) => talent.id),
    ['character-talent-second', 'character-talent-first']
  );
  const prompt = buildTalentSystemPrompt(database, character.id);
  assert.ok(prompt.indexOf('Second Talent') < prompt.indexOf('First Talent'));
});

// ── Roll Engine ──

test('roll talent selects from pool based on rarity weights', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'roll-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'roller', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, userId, { name: 'RollTest', visibility: 'private' });

  const pool = createTalentPool(database, {
    name: '测试池',
    talents: [
      { name: '普通天赋', rarity: 'common', effect: '' },
      { name: '稀有天赋', rarity: 'rare', effect: '' },
      { name: '史诗天赋', rarity: 'epic', effect: '' },
      { name: '传说天赋', rarity: 'legendary', effect: '' }
    ]
  });

  // Roll multiple times - should always get a valid result
  const results = [];
  for (let i = 0; i < 50; i++) {
    const result = rollTalent(database, character.id, pool.id);
    assert.ok(!result.error, `Roll ${i} should not error`);
    assert.ok(result.talentName, 'Should have talent name');
    assert.ok(result.talentRarity, 'Should have rarity');
    assert.ok(result.talentRarityLabel, 'Should have rarity label');
    assert.equal(result.poolId, pool.id);
    assert.equal(result.poolName, '测试池');
    results.push(result.talentRarity);
  }

  // With 50 rolls, we should get a variety of rarities
  const unique = new Set(results);
  assert.ok(unique.size >= 1, 'Should roll at least one type');

  // Check that all 50 talents were saved
  const talents = getCharacterTalents(database, character.id);
  assert.equal(talents.length, 50);
});

test('roll talent returns error for nonexistent pool', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'err-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'errorer', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, userId, { name: 'ErrTest', visibility: 'private' });

  const result = rollTalent(database, character.id, 'nonexistent');
  assert.equal(result.error, '天赋池不存在');
});

test('roll talent returns error for empty pool', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'empty-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'empty', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, userId, { name: 'EmptyTest', visibility: 'private' });

  const pool = createTalentPool(database, { name: '空池', talents: [] });
  const result = rollTalent(database, character.id, pool.id);
  assert.equal(result.error, '天赋池为空，无法 Roll');
});

test('roll talent returns error for nonexistent character', () => {
  const database = createAppDatabase(':memory:');
  const pool = createTalentPool(database, {
    name: '测试',
    talents: [{ name: '天赋', rarity: 'common' }]
  });

  const result = rollTalent(database, 'nonexistent', pool.id);
  assert.equal(result.error, '角色不存在');
});

// ── Character Talents ──

test('character talents can be listed and deleted', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'ct-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'ct-tester', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, userId, { name: 'CTTest', visibility: 'private' });

  const pool = createTalentPool(database, {
    name: '测试池',
    talents: [
      { name: '天赋A', rarity: 'common', effect: '效果A' },
      { name: '天赋B', rarity: 'rare', description: '描述B', effect: '效果B' }
    ]
  });

  // Roll two talents
  const r1 = rollTalent(database, character.id, pool.id);
  const r2 = rollTalent(database, character.id, pool.id);

  const talents = getCharacterTalents(database, character.id);
  assert.equal(talents.length, 2);
  assert.equal(talents[0].characterId, character.id);

  // Delete one talent
  assert.equal(deleteCharacterTalent(database, r1.id), true);
  assert.equal(getCharacterTalents(database, character.id).length, 1);

  // Delete all talents
  assert.equal(deleteAllCharacterTalents(database, character.id), true);
  assert.equal(getCharacterTalents(database, character.id).length, 0);
});

test('delete character talent returns false for nonexistent', () => {
  const database = createAppDatabase(':memory:');
  assert.equal(deleteCharacterTalent(database, 'nonexistent'), false);
});

// ── Talent System Prompt ──

test('buildTalentSystemPrompt generates prompt from character talents', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'prompt-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'prompter', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, userId, { name: 'PromptTest', visibility: 'private' });

  // No talents = empty prompt
  assert.equal(buildTalentSystemPrompt(database, character.id), '');

  const pool = createTalentPool(database, {
    name: '测试',
    talents: [
      { name: '剑术', description: '精通剑术', rarity: 'rare', effect: '攻击+20%' },
      { name: '智慧', description: '', rarity: 'epic', effect: '智力+30%' }
    ]
  });

  rollTalent(database, character.id, pool.id);
  rollTalent(database, character.id, pool.id);

  const prompt = buildTalentSystemPrompt(database, character.id);
  assert.match(prompt, /\[角色天赋\]/);
  assert.match(prompt, /该角色拥有以下天赋/);
  assert.match(prompt, /剑术|智慧/);
});

// ── Weighted Random Pick ──

test('weightedRandomPick respects rarity weights statistically', () => {
  const talents = [
    { name: 'common', rarity: 'common' },
    { name: 'rare', rarity: 'rare' },
    { name: 'epic', rarity: 'epic' },
    { name: 'legendary', rarity: 'legendary' }
  ];

  const counts = { common: 0, rare: 0, epic: 0, legendary: 0 };
  const iterations = 10000;

  for (let i = 0; i < iterations; i++) {
    const result = weightedRandomPick(talents);
    counts[result.rarity]++;
  }

  // Common should be most frequent
  assert.ok(counts.common > counts.rare, 'common > rare');
  assert.ok(counts.rare > counts.epic, 'rare > epic');
  assert.ok(counts.epic > counts.legendary, 'epic > legendary');

  // Rough percentages (with generous margin for randomness)
  const commonPct = counts.common / iterations;
  const rarePct = counts.rare / iterations;
  const epicPct = counts.epic / iterations;
  const legendaryPct = counts.legendary / iterations;

  assert.ok(commonPct > 0.35 && commonPct < 0.65, `common ${commonPct} should be ~50%`);
  assert.ok(rarePct > 0.15 && rarePct < 0.45, `rare ${rarePct} should be ~30%`);
  assert.ok(epicPct > 0.05 && epicPct < 0.25, `epic ${epicPct} should be ~15%`);
  assert.ok(legendaryPct > 0.0 && legendaryPct < 0.15, `legendary ${legendaryPct} should be ~5%`);
});

test('RARITY_CONFIG contains correct weights', () => {
  assert.equal(RARITY_CONFIG.common, 50);
  assert.equal(RARITY_CONFIG.rare, 30);
  assert.equal(RARITY_CONFIG.epic, 15);
  assert.equal(RARITY_CONFIG.legendary, 5);
});

test('RARITY_LABEL_MAP contains correct labels', () => {
  assert.equal(RARITY_LABEL_MAP.common, '普通');
  assert.equal(RARITY_LABEL_MAP.rare, '稀有');
  assert.equal(RARITY_LABEL_MAP.epic, '史诗');
  assert.equal(RARITY_LABEL_MAP.legendary, '传说');
});

// ── Saves ──

function createTestSetup(database) {
  const userId = 'save-user';
  const otherUserId = 'other-user';
  const timestamp = new Date().toISOString();

  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'save-tester', 'hash', timestamp
  );
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    otherUserId, 'other-tester', 'hash', timestamp
  );

  const character = createCharacter(database, userId, { name: 'SaveTestChar', visibility: 'private' });

  const conversationId = newId();
  database.prepare(
    'INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(conversationId, userId, character.id, 'Save Test Conversation', timestamp, timestamp);

  return { userId, otherUserId, character, conversationId, timestamp };
}

function insertMessage(database, userId, conversationId, role, content, timestamp) {
  const id = newId();
  database.prepare(
    'INSERT INTO messages (id, user_id, conversation_id, role, content, reasoning, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, userId, conversationId, role, content, '', null, timestamp || new Date().toISOString());
  return id;
}

test('saves create and list for a conversation', () => {
  const database = createAppDatabase(':memory:');
  const { userId, conversationId, timestamp } = createTestSetup(database);

  insertMessage(database, userId, conversationId, 'user', '你好', timestamp);
  insertMessage(database, userId, conversationId, 'assistant', '你好！有什么可以帮助你的吗？', timestamp);

  const save = createSave(database, userId, conversationId, { name: '第一次存档' });
  assert.equal(save.name, '第一次存档');
  assert.ok(save.id);
  assert.equal(save.conversationId, conversationId);
  assert.ok(save.createdAt);

  const saves = listSaves(database, userId, conversationId);
  assert.equal(saves.length, 1);
  assert.equal(saves[0].id, save.id);
  assert.equal(saves[0].name, '第一次存档');
});

test('saves getSave returns snapshot with messages', () => {
  const database = createAppDatabase(':memory:');
  const { userId, conversationId, timestamp } = createTestSetup(database);

  insertMessage(database, userId, conversationId, 'user', '今天天气怎么样？', timestamp);
  insertMessage(database, userId, conversationId, 'assistant', '今天天气晴朗，适合出门。', timestamp);

  const save = createSave(database, userId, conversationId, { name: '天气存档' });
  const detail = getSave(database, userId, save.id);

  assert.ok(detail);
  assert.equal(detail.name, '天气存档');
  assert.equal(detail.conversationId, conversationId);
  assert.ok(detail.snapshot);
  assert.ok(Array.isArray(detail.snapshot.messages));
  assert.equal(detail.snapshot.messages.length, 2);
  assert.equal(detail.snapshot.messages[0].role, 'user');
  assert.equal(detail.snapshot.messages[0].content, '今天天气怎么样？');
  assert.equal(detail.snapshot.messages[1].role, 'assistant');
  assert.equal(detail.snapshot.messages[1].content, '今天天气晴朗，适合出门。');
});

test('saves snapshot preserves insertion order when timestamps tie', () => {
  const database = createAppDatabase(':memory:');
  const { userId, conversationId } = createTestSetup(database);
  const tiedTimestamp = '2026-01-01T00:00:00.000Z';
  insertMessage(database, userId, conversationId, 'user', 'First tied message', tiedTimestamp);
  insertMessage(database, userId, conversationId, 'assistant', 'Second tied message', tiedTimestamp);
  insertMessage(database, userId, conversationId, 'user', 'Third tied message', tiedTimestamp);

  const save = createSave(database, userId, conversationId, { name: 'Tied timestamp save' });
  const detail = getSave(database, userId, save.id);

  assert.deepEqual(
    detail.snapshot.messages.map((message) => message.content),
    ['First tied message', 'Second tied message', 'Third tied message']
  );
});

test('saves list preserves newest insertion order when timestamps tie', () => {
  const database = createAppDatabase(':memory:');
  const { userId, conversationId } = createTestSetup(database);
  const tiedTimestamp = '2026-01-01T00:00:00.000Z';

  database.prepare(
    'INSERT INTO saves (id, conversation_id, user_id, name, snapshot, preview, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run('save-first', conversationId, userId, 'First Save', '{}', 'first preview', tiedTimestamp);
  database.prepare(
    'INSERT INTO saves (id, conversation_id, user_id, name, snapshot, preview, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run('save-second', conversationId, userId, 'Second Save', '{}', 'second preview', tiedTimestamp);

  const saves = listSaves(database, userId, conversationId);

  assert.deepEqual(saves.map((save) => save.id), ['save-second', 'save-first']);
});

test('saves updateSave renames a save', () => {
  const database = createAppDatabase(':memory:');
  const { userId, conversationId, timestamp } = createTestSetup(database);

  insertMessage(database, userId, conversationId, 'user', '测试消息', timestamp);

  const save = createSave(database, userId, conversationId, { name: '原名' });
  assert.equal(save.name, '原名');

  const updated = updateSave(database, userId, save.id, { name: '新名字' });
  assert.ok(updated);
  assert.equal(updated.name, '新名字');
  assert.equal(updated.id, save.id);

  // Verify through getSave
  const detail = getSave(database, userId, save.id);
  assert.equal(detail.name, '新名字');
});

test('saves deleteSave removes a save', () => {
  const database = createAppDatabase(':memory:');
  const { userId, conversationId, timestamp } = createTestSetup(database);

  insertMessage(database, userId, conversationId, 'user', '删除测试', timestamp);

  const save = createSave(database, userId, conversationId, { name: '待删除' });
  assert.equal(listSaves(database, userId, conversationId).length, 1);

  assert.equal(deleteSave(database, userId, save.id), true);
  assert.equal(listSaves(database, userId, conversationId).length, 0);
  assert.equal(getSave(database, userId, save.id), null);

  // Delete nonexistent returns false
  assert.equal(deleteSave(database, userId, 'nonexistent-id'), false);
});

test('saves loadSave restores messages to saved state', () => {
  const database = createAppDatabase(':memory:');
  const { userId, conversationId, timestamp } = createTestSetup(database);

  // Create initial messages
  insertMessage(database, userId, conversationId, 'user', '第一条消息', timestamp);
  insertMessage(database, userId, conversationId, 'assistant', '第一条回复', timestamp);

  // Save the state
  const save = createSave(database, userId, conversationId, { name: '初始状态' });

  // Add more messages after saving
  insertMessage(database, userId, conversationId, 'user', '第二条消息', timestamp);
  insertMessage(database, userId, conversationId, 'assistant', '第二条回复', timestamp);

  // Verify we now have 4 messages
  const beforeLoad = database.prepare(
    'SELECT COUNT(*) AS count FROM messages WHERE user_id = ? AND conversation_id = ?'
  ).get(userId, conversationId);
  assert.equal(beforeLoad.count, 4);

  // Load the save - should restore to 2 messages
  const result = loadSave(database, userId, save.id);
  assert.ok(result);
  assert.equal(result.conversationId, conversationId);
  assert.equal(result.messageCount, 2);

  // Verify messages are restored
  const afterLoad = database.prepare(
    'SELECT * FROM messages WHERE user_id = ? AND conversation_id = ? ORDER BY created_at ASC'
  ).all(userId, conversationId);
  assert.equal(afterLoad.length, 2);
  assert.equal(afterLoad[0].content, '第一条消息');
  assert.equal(afterLoad[1].content, '第一条回复');
});

test('saves loadSave works inside an existing transaction', () => {
  const database = createAppDatabase(':memory:');
  const { userId, conversationId, timestamp } = createTestSetup(database);

  insertMessage(database, userId, conversationId, 'user', 'Before save', timestamp);
  const save = createSave(database, userId, conversationId, { name: 'Nested transaction save' });
  insertMessage(database, userId, conversationId, 'assistant', 'After save', timestamp);

  database.exec('BEGIN');
  try {
    const result = loadSave(database, userId, save.id);
    assert.ok(result);
    assert.equal(result.messageCount, 1);

    const restored = database.prepare(
      'SELECT content FROM messages WHERE user_id = ? AND conversation_id = ? ORDER BY created_at ASC'
    ).all(userId, conversationId);
    assert.deepEqual(restored.map((row) => row.content), ['Before save']);
  } finally {
    database.exec('ROLLBACK');
  }
});

test('saves loadSave rolls back deleted messages when restore insert fails', () => {
  const database = createAppDatabase(':memory:');
  const { userId, conversationId, timestamp } = createTestSetup(database);

  insertMessage(database, userId, conversationId, 'user', 'Force save restore failure', timestamp);
  const save = createSave(database, userId, conversationId, { name: 'Failing restore save' });
  database.prepare('DELETE FROM messages WHERE user_id = ? AND conversation_id = ?').run(userId, conversationId);
  insertMessage(database, userId, conversationId, 'assistant', 'Current message should remain', timestamp);

  database.exec(`
    CREATE TRIGGER fail_save_message_restore
    BEFORE INSERT ON messages
    WHEN NEW.content = 'Force save restore failure'
    BEGIN
      SELECT RAISE(ABORT, 'forced save restore failure');
    END
  `);

  assert.throws(
    () => loadSave(database, userId, save.id),
    /forced save restore failure/
  );

  const messages = database
    .prepare('SELECT content FROM messages WHERE user_id = ? AND conversation_id = ? ORDER BY created_at ASC, rowid ASC')
    .all(userId, conversationId);
  assert.deepEqual(messages.map((row) => row.content), ['Current message should remain']);
});

test('saves ownership isolation between users', () => {
  const database = createAppDatabase(':memory:');
  const { userId, otherUserId, conversationId, timestamp } = createTestSetup(database);

  insertMessage(database, userId, conversationId, 'user', '隔离测试', timestamp);

  const save = createSave(database, userId, conversationId, { name: '用户A的存档' });

  // Other user cannot list saves for this conversation
  assert.equal(listSaves(database, otherUserId, conversationId).length, 0);
  assert.throws(
    () => createSave(database, otherUserId, conversationId, { name: '入侵存档' }),
    /对话不存在/
  );

  // Other user cannot get the save
  assert.equal(getSave(database, otherUserId, save.id), null);

  // Other user cannot update the save
  assert.equal(updateSave(database, otherUserId, save.id, { name: '入侵' }), null);

  // Other user cannot delete the save
  assert.equal(deleteSave(database, otherUserId, save.id), false);

  // Other user cannot load the save
  assert.equal(loadSave(database, otherUserId, save.id), null);
});

test('saves auto-generate timestamped name when empty', () => {
  const database = createAppDatabase(':memory:');
  const { userId, conversationId, timestamp } = createTestSetup(database);

  insertMessage(database, userId, conversationId, 'user', '空名称测试', timestamp);

  const save = createSave(database, userId, conversationId, { name: '' });
  assert.ok(save.name);
  assert.match(save.name, /^存档 /);

  const save2 = createSave(database, userId, conversationId, {});
  assert.ok(save2.name);
  assert.match(save2.name, /^存档 /);
});

// ── World Book Probability ──

test('world book probability=0 never activates entry', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, 'user-1', { name: '概率角色', visibility: 'private' });
  const book = createWorldBook(database, 'user-1', { name: '概率测试书' });
  linkWorldBookToCharacter(database, book.id, character.id);

  createEntry(database, 'user-1', book.id, {
    name: '零概率条目',
    triggerKeys: '触发',
    content: '不应出现',
    enabled: true,
    probability: 0,
    useProbability: true
  });

  const origRandom = Math.random;
  Math.random = () => 0.01;
  let matches;
  try {
    matches = matchWorldBookEntries(database, character.id, '触发关键词');
  } finally {
    Math.random = origRandom;
  }

  assert.equal(matches.length, 0);
});

test('world book probability=100 always activates entry', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, 'user-1', { name: '满概率角色', visibility: 'private' });
  const book = createWorldBook(database, 'user-1', { name: '满概率测试书' });
  linkWorldBookToCharacter(database, book.id, character.id);

  createEntry(database, 'user-1', book.id, {
    name: '满概率条目',
    triggerKeys: '触发',
    content: '必定出现',
    enabled: true,
    probability: 100,
    useProbability: true
  });

  const origRandom = Math.random;
  Math.random = () => 0.99;
  let matches;
  try {
    matches = matchWorldBookEntries(database, character.id, '触发关键词');
  } finally {
    Math.random = origRandom;
  }

  assert.equal(matches.length, 1);
  assert.equal(matches[0].content, '必定出现');
});

test('world book blank probability keeps default activation chance', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, 'user-1', { name: 'Blank Probability', visibility: 'private' });
  const book = createWorldBook(database, 'user-1', { name: 'Blank Probability Book' });
  linkWorldBookToCharacter(database, book.id, character.id);

  const entry = createEntry(database, 'user-1', book.id, {
    name: 'Blank Probability Entry',
    triggerKeys: 'blank-probability-trigger',
    content: 'blank probability content',
    enabled: true,
    probability: '   ',
    useProbability: true
  });

  const origRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const matches = matchWorldBookEntries(database, character.id, 'blank-probability-trigger');

    assert.equal(entry.probability, 100);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].content, 'blank probability content');
  } finally {
    Math.random = origRandom;
  }
});

test('world book probability=50 activates conditionally based on Math.random', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, 'user-1', { name: '半概率角色', visibility: 'private' });
  const book = createWorldBook(database, 'user-1', { name: '半概率测试书' });
  linkWorldBookToCharacter(database, book.id, character.id);

  createEntry(database, 'user-1', book.id, {
    name: '半概率条目',
    triggerKeys: '触发',
    content: '概率出现',
    enabled: true,
    probability: 50,
    useProbability: true
  });

  const origRandom = Math.random;

  try {
    // random < 0.5 -> activates
    Math.random = () => 0.3;
    const hit = matchWorldBookEntries(database, character.id, '触发关键词');
    assert.equal(hit.length, 1);
    assert.equal(hit[0].content, '概率出现');

    // random > 0.5 -> does not activate
    Math.random = () => 0.8;
    const miss = matchWorldBookEntries(database, character.id, '触发关键词');
    assert.equal(miss.length, 0);
  } finally {
    Math.random = origRandom;
  }
});

test('world book group inclusion keeps only one entry per group', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, 'user-1', { name: '分组角色', visibility: 'private' });
  const book = createWorldBook(database, 'user-1', { name: '分组测试书' });
  linkWorldBookToCharacter(database, book.id, character.id);

  createEntry(database, 'user-1', book.id, {
    name: '条目A',
    triggerKeys: '触发',
    content: '内容A',
    alwaysActive: true,
    group: '测试组',
    groupWeight: 10
  });
  createEntry(database, 'user-1', book.id, {
    name: '条目B',
    triggerKeys: '触发',
    content: '内容B',
    alwaysActive: true,
    group: '测试组',
    groupWeight: 20
  });
  createEntry(database, 'user-1', book.id, {
    name: '条目C',
    triggerKeys: '触发',
    content: '内容C',
    alwaysActive: true,
    group: '测试组',
    groupWeight: 70
  });

  const matches = matchWorldBookEntries(database, character.id, '无关键词');
  assert.equal(matches.length, 1, 'group inclusion should keep exactly 1 of 3 entries');
  assert.ok(['内容A', '内容B', '内容C'].includes(matches[0].content));
});

test('world book recursive activation preserves group inclusion', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, 'user-1', { name: 'Recursive Group', visibility: 'private' });
  const book = createWorldBook(database, 'user-1', { name: 'Recursive Group Book' });
  linkWorldBookToCharacter(database, book.id, character.id);

  createEntry(database, 'user-1', book.id, {
    name: 'Recursive source',
    content: 'recursive-group-trigger',
    alwaysActive: true,
    group: 'recursive-group',
    groupWeight: 10
  });
  createEntry(database, 'user-1', book.id, {
    name: 'Recursive target',
    triggerKeys: 'recursive-group-trigger',
    content: 'recursive target content',
    group: 'recursive-group',
    groupWeight: 1
  });

  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const matches = matchWorldBookEntries(database, character.id, 'initial prompt');

    assert.equal(matches.length, 1);
    assert.equal(matches[0].name, 'Recursive source');
  } finally {
    Math.random = originalRandom;
  }
});

test('world book at_depth entry role field controls injected message role', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, 'user-1', { name: '测试角色', visibility: 'private' });

  const book = createWorldBook(database, 'user-1', { name: '深度角色测试书', characterId: character.id });

  // Create entries with different roles
  createEntry(database, 'user-1', book.id, {
    name: '系统提示',
    triggerKeys: '触发',
    content: '这是一条系统消息',
    position: 'at_depth',
    depth: 2,
    role: 0,
    alwaysActive: true
  });
  createEntry(database, 'user-1', book.id, {
    name: '用户提示',
    triggerKeys: '触发',
    content: '这是一条用户消息',
    position: 'at_depth',
    depth: 1,
    role: 1,
    alwaysActive: true
  });
  createEntry(database, 'user-1', book.id, {
    name: '助手提示',
    triggerKeys: '触发',
    content: '这是一条助手消息',
    position: 'at_depth',
    depth: 0,
    role: 2,
    alwaysActive: true
  });

  const matches = matchWorldBookEntries(database, character.id, '触发');
  assert.equal(matches.length, 3);

  // Verify role field is preserved in matched entries
  const systemEntry = matches.find((m) => m.name === '系统提示');
  assert.equal(systemEntry.role, 0);
  const userEntry = matches.find((m) => m.name === '用户提示');
  assert.equal(userEntry.role, 1);
  const assistantEntry = matches.find((m) => m.name === '助手提示');
  assert.equal(assistantEntry.role, 2);

  // Verify at_depth entries are excluded from buildWorldBookContext (system prompt)
  const context = buildWorldBookContext(matches);
  assert.equal(context, '', 'at_depth entries should not appear in system prompt context');

  // Verify injectAtDepthEntries inserts messages with correct roles
  const messages = [
    { role: 'system', content: '系统' },
    { role: 'user', content: '你好' },
    { role: 'assistant', content: '你好呀' },
    { role: 'user', content: '触发关键词' }
  ];
  injectAtDepthEntries(messages, matches);

  // After injection: 4 original + 3 injected = 7 messages
  assert.equal(messages.length, 7);

  // Find injected messages by content
  const injectedSystem = messages.find((m) => m.content === '这是一条系统消息');
  assert.equal(injectedSystem.role, 'system');
  const injectedUser = messages.find((m) => m.content === '这是一条用户消息');
  assert.equal(injectedUser.role, 'user');
  const injectedAssistant = messages.find((m) => m.content === '这是一条助手消息');
  assert.equal(injectedAssistant.role, 'assistant');

  // Verify depth=2 entry is inserted 2 positions before the last message of the original array
  // depth=0 goes at the very end, depth=1 goes before the last, depth=2 goes 2 before the end
  const lastContent = messages[messages.length - 1].content;
  assert.equal(lastContent, '这是一条助手消息', 'last message should be depth=0 assistant entry');
  const secondToLast = messages[messages.length - 2].content;
  assert.equal(secondToLast, '触发关键词', 'second-to-last should be the original user text');
  const thirdToLast = messages[messages.length - 3].content;
  assert.equal(thirdToLast, '这是一条用户消息', 'depth=1 user entry should be right before the original last user text');
});

test('saves preview uses last assistant message', () => {
  const database = createAppDatabase(':memory:');
  const { userId, character, conversationId, timestamp } = createTestSetup(database);

  // Only user messages - preview should be message count
  insertMessage(database, userId, conversationId, 'user', '只有用户消息', timestamp);
  const save1 = createSave(database, userId, conversationId, { name: '用户消息存档' });
  const detail1 = getSave(database, userId, save1.id);
  assert.equal(detail1.preview, '1 条消息');

  // With assistant message - preview should be assistant content
  insertMessage(database, userId, conversationId, 'assistant', '这是助手的回复内容', timestamp);
  const save2 = createSave(database, userId, conversationId, { name: '助手消息存档' });
  const detail2 = getSave(database, userId, save2.id);
  assert.equal(detail2.preview, '这是助手的回复内容');

  // Empty conversation - preview should indicate empty
  const emptyConvId = newId();
  database.prepare(
    'INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(emptyConvId, userId, character.id, 'Empty', timestamp, timestamp);
  const save3 = createSave(database, userId, emptyConvId, { name: '空会话存档' });
  const detail3 = getSave(database, userId, save3.id);
  assert.equal(detail3.preview, '空会话');
});

// ── World Book Sticky / Cooldown / Delay ──

test('world book sticky=3 keeps entry active for 3 messages after activation', () => {
  resetMessageCounter();
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, 'user-1', { name: 'Sticky角色', visibility: 'private' });
  const book = createWorldBook(database, 'user-1', { name: 'Sticky测试书' });
  linkWorldBookToCharacter(database, book.id, character.id);

  createEntry(database, 'user-1', book.id, {
    name: '粘性条目',
    triggerKeys: '触发',
    content: '粘性内容',
    enabled: true,
    sticky: 3
  });

  // Message 1: key matches, entry activates with sticky=3
  const m1 = matchWorldBookEntries(database, character.id, '触发关键词', { messageCount: 1 });
  assert.equal(m1.length, 1);
  assert.equal(m1[0].content, '粘性内容');

  // Message 2: key does NOT match, but sticky_remaining should keep it active
  const m2 = matchWorldBookEntries(database, character.id, '无关文本', { messageCount: 2 });
  assert.equal(m2.length, 1);
  assert.equal(m2[0].content, '粘性内容');

  // Message 3: still sticky (sticky_remaining was 3, decremented: 2->1)
  const m3 = matchWorldBookEntries(database, character.id, '无关文本', { messageCount: 3 });
  assert.equal(m3.length, 1);
  assert.equal(m3[0].content, '粘性内容');

  // Message 4: sticky expired (sticky_remaining reached 0 after 3 decrements)
  const m4 = matchWorldBookEntries(database, character.id, '无关文本', { messageCount: 4 });
  assert.equal(m4.length, 0);
});

test('world book cooldown prevents re-activation for N messages', () => {
  resetMessageCounter();
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, 'user-1', { name: 'Cooldown角色', visibility: 'private' });
  const book = createWorldBook(database, 'user-1', { name: 'Cooldown测试书' });
  linkWorldBookToCharacter(database, book.id, character.id);

  createEntry(database, 'user-1', book.id, {
    name: '冷却条目',
    triggerKeys: '触发',
    content: '冷却内容',
    enabled: true,
    cooldown: 3
  });

  // Message 1: key matches, activates
  const m1 = matchWorldBookEntries(database, character.id, '触发关键词', { messageCount: 1 });
  assert.equal(m1.length, 1);

  // Message 2: key absent, entry deactivates (cooldown starts from msg2)
  const m2 = matchWorldBookEntries(database, character.id, '无关文本', { messageCount: 2 });
  assert.equal(m2.length, 0);

  // Message 3: key matches but cooldown active (1 msg since deactivation at msg2)
  const m3 = matchWorldBookEntries(database, character.id, '触发关键词', { messageCount: 3 });
  assert.equal(m3.length, 0);

  // Message 4: still in cooldown (2 msgs since deactivation)
  const m4 = matchWorldBookEntries(database, character.id, '触发关键词', { messageCount: 4 });
  assert.equal(m4.length, 0);

  // Message 5: cooldown expired (3 msgs since deactivation at msg2, 5-2=3 >= cooldown=3)
  const m5 = matchWorldBookEntries(database, character.id, '触发关键词', { messageCount: 5 });
  assert.equal(m5.length, 1);
  assert.equal(m5[0].content, '冷却内容');
});

test('world book delay prevents activation until N messages after first seen', () => {
  resetMessageCounter();
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, 'user-1', { name: 'Delay角色', visibility: 'private' });
  const book = createWorldBook(database, 'user-1', { name: 'Delay测试书' });
  linkWorldBookToCharacter(database, book.id, character.id);

  createEntry(database, 'user-1', book.id, {
    name: '延迟条目',
    triggerKeys: '触发',
    content: '延迟内容',
    enabled: true,
    delay: 3
  });

  // Message 1: first seen, but delay=3 so should NOT activate
  const m1 = matchWorldBookEntries(database, character.id, '触发关键词', { messageCount: 1 });
  assert.equal(m1.length, 0);

  // Message 2: still delayed (1 msg since first seen)
  const m2 = matchWorldBookEntries(database, character.id, '触发关键词', { messageCount: 2 });
  assert.equal(m2.length, 0);

  // Message 3: still delayed (2 msgs since first seen)
  const m3 = matchWorldBookEntries(database, character.id, '触发关键词', { messageCount: 3 });
  assert.equal(m3.length, 0);

  // Message 4: delay expired (3 msgs since first seen at msg 1, 4-1=3 >= delay=3)
  const m4 = matchWorldBookEntries(database, character.id, '触发关键词', { messageCount: 4 });
  assert.equal(m4.length, 1);
  assert.equal(m4[0].content, '延迟内容');
});

test('world book sticky and cooldown work together', () => {
  resetMessageCounter();
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, 'user-1', { name: '组合角色', visibility: 'private' });
  const book = createWorldBook(database, 'user-1', { name: '组合测试书' });
  linkWorldBookToCharacter(database, book.id, character.id);

  createEntry(database, 'user-1', book.id, {
    name: '组合条目',
    triggerKeys: '触发',
    content: '组合内容',
    enabled: true,
    sticky: 2,
    cooldown: 2
  });

  // msg1: key matches, activates, sticky=2 -> remaining=2, decremented to 1
  const m1 = matchWorldBookEntries(database, character.id, '触发关键词', { messageCount: 1 });
  assert.equal(m1.length, 1);

  // msg2: key absent, but sticky_remaining=1 -> still active, decremented to 0
  const m2 = matchWorldBookEntries(database, character.id, '无关', { messageCount: 2 });
  assert.equal(m2.length, 1);

  // msg3: key absent, sticky expired (remaining=0), deactivates. Cooldown starts from msg3.
  const m3 = matchWorldBookEntries(database, character.id, '无关', { messageCount: 3 });
  assert.equal(m3.length, 0);

  // msg4: key matches, but cooldown active (1 msg since deactivation at msg3)
  const m4 = matchWorldBookEntries(database, character.id, '触发关键词', { messageCount: 4 });
  assert.equal(m4.length, 0);

  // msg5: cooldown expired (2 msgs since deactivation at msg3, 5-3=2 >= cooldown=2)
  const m5 = matchWorldBookEntries(database, character.id, '触发关键词', { messageCount: 5 });
  assert.equal(m5.length, 1);
  assert.equal(m5[0].content, '组合内容');
});

test('world book matcher normalizes unsafe message count state', () => {
  resetMessageCounter();
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, 'user-1', { name: 'Message Count Character', visibility: 'private' });
  const book = createWorldBook(database, 'user-1', { name: 'Message Count Book' });
  linkWorldBookToCharacter(database, book.id, character.id);

  const entry = createEntry(database, 'user-1', book.id, {
    name: 'Message Count Entry',
    triggerKeys: 'unsafe-message-count-trigger',
    content: 'message count content',
    enabled: true,
    sticky: 2
  });

  const first = matchWorldBookEntries(database, character.id, 'unsafe-message-count-trigger', {
    messageCount: 'Infinity'
  });
  let state = database.prepare('SELECT * FROM world_book_entry_state WHERE entry_id = ?').get(entry.id);

  assert.equal(first.length, 1);
  assert.equal(state.last_activated_message, 1);
  assert.equal(state.sticky_remaining, 1);

  const unsafeFiniteEntry = createEntry(database, 'user-1', book.id, {
    name: 'Unsafe Finite Count Entry',
    triggerKeys: 'unsafe-finite-message-count-trigger',
    content: 'unsafe finite count content',
    enabled: true
  });
  const unsafeFiniteMatches = matchWorldBookEntries(database, character.id, 'unsafe-finite-message-count-trigger', {
    messageCount: '9007199254740993'
  });
  const unsafeFiniteState = database
    .prepare('SELECT * FROM world_book_entry_state WHERE entry_id = ?')
    .get(unsafeFiniteEntry.id);

  assert.ok(unsafeFiniteMatches.some((match) => match.name === 'Unsafe Finite Count Entry'));
  assert.equal(unsafeFiniteState.last_activated_message, 2);

  database
    .prepare(
      `UPDATE world_book_entry_state
       SET last_activated_message = ?, last_deactivated_message = ?, first_seen_message = ?, sticky_remaining = ?, was_active = ?
       WHERE entry_id = ?`
    )
    .run('Infinity', 'not-a-number', '   ', 'Infinity', 1, entry.id);

  const legacyStateMatches = matchWorldBookEntries(database, character.id, 'no trigger here', {
    messageCount: 3
  });
  state = database.prepare('SELECT * FROM world_book_entry_state WHERE entry_id = ?').get(entry.id);

  assert.deepEqual(legacyStateMatches.map((match) => match.name), []);
  assert.equal(state.last_deactivated_message, 3);
  assert.equal(state.sticky_remaining, 0);
});

test('world book entry CRUD persists sticky, cooldown, delay fields', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );
  const book = createWorldBook(database, 'user-1', { name: '字段持久化测试' });

  const entry = createEntry(database, 'user-1', book.id, {
    name: '测试条目',
    triggerKeys: '关键词',
    content: '内容',
    sticky: 5,
    cooldown: 3,
    delay: 2
  });
  const blankOptionalEntry = createEntry(database, 'user-1', book.id, {
    name: 'Blank optional fields',
    content: 'Blank optional content',
    sticky: '',
    cooldown: '   ',
    delay: '0'
  });

  assert.equal(entry.sticky, 5);
  assert.equal(entry.cooldown, 3);
  assert.equal(entry.delay, 2);
  assert.equal(blankOptionalEntry.sticky, null);
  assert.equal(blankOptionalEntry.cooldown, null);
  assert.equal(blankOptionalEntry.delay, 0);

  // Update fields
  const updated = updateEntry(database, 'user-1', book.id, entry.id, {
    sticky: 10,
    cooldown: null,
    delay: 0
  });
  assert.equal(updated.sticky, 10);
  assert.equal(updated.cooldown, null);
  assert.equal(updated.delay, 0);

  // Verify persistence via getWorldBook
  const bookData = getWorldBook(database, 'user-1', book.id);
  const persisted = bookData.entries[0];
  assert.equal(persisted.sticky, 10);
  assert.equal(persisted.cooldown, null);
  assert.equal(persisted.delay, 0);
});

// ── Token Budget ──

test('world book token budget truncates entries exceeding budget', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, 'user-1', { name: 'Budget角色', visibility: 'private' });
  const book = createWorldBook(database, 'user-1', { name: 'Budget测试书' });
  linkWorldBookToCharacter(database, book.id, character.id);

  // Create entries with known content lengths
  // Entry A: 200 chars -> 50 tokens (order 0)
  // Entry B: 200 chars -> 50 tokens (order 1)
  // Entry C: 200 chars -> 50 tokens (order 2)
  // Total: 150 tokens
  createEntry(database, 'user-1', book.id, {
    name: '条目A',
    triggerKeys: '触发',
    content: 'A'.repeat(200),
    enabled: true,
    alwaysActive: true
  });
  createEntry(database, 'user-1', book.id, {
    name: '条目B',
    triggerKeys: '触发',
    content: 'B'.repeat(200),
    enabled: true,
    alwaysActive: true
  });
  createEntry(database, 'user-1', book.id, {
    name: '条目C',
    triggerKeys: '触发',
    content: 'C'.repeat(200),
    enabled: true,
    alwaysActive: true
  });

  // With budget of 100 tokens (contextSize=1000, percent=10), should truncate
  const matches = matchWorldBookEntries(database, character.id, '触发', {
    contextSize: 1000,
    lorebookContextPercent: 10
  });
  // budget = 1000 * 10 / 100 = 100 tokens
  // Entry A (50 tokens) + Entry B (50 tokens) = 100 tokens (fits)
  // Entry C (50 tokens) would exceed -> truncated
  assert.equal(matches.length, 2);
  assert.equal(matches[0].name, '条目A');
  assert.equal(matches[1].name, '条目B');

  // Without budget, all entries should be returned
  const allMatches = matchWorldBookEntries(database, character.id, '触发');
  assert.equal(allMatches.length, 3);

  const booleanContextMatches = matchWorldBookEntries(database, character.id, 'ignored prompt', {
    contextSize: true,
    lorebookContextPercent: 10
  });
  assert.equal(booleanContextMatches.length, 3);

  const infiniteContextMatches = matchWorldBookEntries(database, character.id, 'ignored prompt', {
    contextSize: 'Infinity',
    lorebookContextPercent: 10
  });
  assert.equal(infiniteContextMatches.length, 3);

  // Invalid override falls back to 25%, so 200 * 25% = 50 tokens.
  const fallbackMatches = matchWorldBookEntries(database, character.id, '触发', {
    contextSize: 200,
    lorebookContextPercent: 'not-a-number'
  });
  assert.equal(fallbackMatches.length, 1);
});

test('world book token budget does not activate sticky state for truncated entries', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, 'user-1', { name: 'Budget Sticky', visibility: 'private' });
  const book = createWorldBook(database, 'user-1', { name: 'Budget Sticky Book' });
  linkWorldBookToCharacter(database, book.id, character.id);

  createEntry(database, 'user-1', book.id, {
    name: 'Budget kept entry',
    triggerKeys: 'budget-sticky-trigger',
    content: 'keep',
    enabled: true
  });
  createEntry(database, 'user-1', book.id, {
    name: 'Budget truncated sticky entry',
    triggerKeys: 'budget-sticky-trigger',
    content: 'trimmed '.repeat(20),
    enabled: true,
    sticky: 2
  });

  const budgetedMatches = matchWorldBookEntries(database, character.id, 'budget-sticky-trigger', {
    contextSize: 8,
    lorebookContextPercent: 100
  });
  const stickyMatches = matchWorldBookEntries(database, character.id, 'no trigger here');

  assert.deepEqual(budgetedMatches.map((match) => match.name), ['Budget kept entry']);
  assert.deepEqual(stickyMatches.map((match) => match.name), []);
});

test('world book lorebookContextPercent persists and defaults to 25', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );

  // Default value
  const book1 = createWorldBook(database, 'user-1', { name: '默认百分比' });
  assert.equal(book1.lorebookContextPercent, 25);

  // Custom value
  const book2 = createWorldBook(database, 'user-1', { name: '自定义百分比', lorebookContextPercent: 40 });
  assert.equal(book2.lorebookContextPercent, 40);

  // Update value
  const updated = updateWorldBook(database, 'user-1', book2.id, { lorebookContextPercent: 15 });
  assert.equal(updated.lorebookContextPercent, 15);

  // Clamping
  const book3 = createWorldBook(database, 'user-1', { name: '超出范围', lorebookContextPercent: 150 });
  assert.equal(book3.lorebookContextPercent, 100);

  const book4 = createWorldBook(database, 'user-1', { name: '低于范围', lorebookContextPercent: 0 });
  assert.equal(book4.lorebookContextPercent, 1);

  const updatedLow = updateWorldBook(database, 'user-1', book2.id, { lorebookContextPercent: '0' });
  assert.equal(updatedLow.lorebookContextPercent, 1);
});

test('chat lorebook entries activate only in the bound conversation', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, 'user-1', { name: '角色A', visibility: 'private' });

  const chatBook = createWorldBook(database, 'user-1', {
    name: '对话专属世界书',
    description: '仅绑定对话可见'
  });
  createEntry(database, 'user-1', chatBook.id, {
    name: '秘密事件',
    triggerKeys: '秘密,暗号',
    content: '这段内容只在绑定对话中出现',
    enabled: true
  });

  const now = new Date().toISOString();
  const boundConvId = 'conv-bound-1';
  const otherConvId = 'conv-other-1';
  database.prepare(
    'INSERT INTO conversations (id, user_id, character_id, title, chat_lorebook_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(boundConvId, 'user-1', character.id, '绑定对话', chatBook.id, now, now);
  database.prepare(
    'INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(otherConvId, 'user-1', character.id, '普通对话', now, now);

  const boundMatches = matchWorldBookEntries(database, character.id, '这里提到了秘密', { conversationId: boundConvId });
  assert.equal(boundMatches.length, 1);
  assert.equal(boundMatches[0].name, '秘密事件');
  assert.equal(boundMatches[0].content, '这段内容只在绑定对话中出现');

  const otherMatches = matchWorldBookEntries(database, character.id, '这里提到了秘密', { conversationId: otherConvId });
  assert.equal(otherMatches.length, 0);

  const noConvMatches = matchWorldBookEntries(database, character.id, '这里提到了秘密');
  assert.equal(noConvMatches.length, 0);
});

test('chat lorebook coexists with character world books', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, 'user-1', { name: '角色B', visibility: 'private' });

  const charBook = createWorldBook(database, 'user-1', {
    name: '角色世界书',
    characterId: character.id
  });
  createEntry(database, 'user-1', charBook.id, {
    name: '世界观',
    triggerKeys: '世界',
    content: '角色世界观设定',
    enabled: true
  });

  const chatBook = createWorldBook(database, 'user-1', {
    name: '对话专属世界书'
  });
  createEntry(database, 'user-1', chatBook.id, {
    name: '对话剧情',
    triggerKeys: '剧情',
    content: '对话专属剧情内容',
    enabled: true
  });

  const now = new Date().toISOString();
  const convId = 'conv-bound-2';
  database.prepare(
    'INSERT INTO conversations (id, user_id, character_id, title, chat_lorebook_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(convId, 'user-1', character.id, '测试对话', chatBook.id, now, now);

  const matches = matchWorldBookEntries(database, character.id, '这个世界有新的剧情', { conversationId: convId });
  assert.equal(matches.length, 2);
  const names = matches.map((m) => m.name).sort();
  assert.deepEqual(names, ['世界观', '对话剧情']);
});

// ══════════════════════════════════════════════════════════════════
// BACKEND-TEST-001: Streaming Error Paths & Provider Settings
// ══════════════════════════════════════════════════════════════════

// ── Streaming Error Paths ──

test('streamCompletion throws on HTTP 401 response', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    await assert.rejects(
      () =>
        streamCompletion(
          {
            providerType: 'deepseek',
            gatewayName: 'DeepSeek',
            baseUrl: 'https://example.test',
            model: 'deepseek-chat',
            apiKey: 'sk-test',
            supportsReasoning: false,
            extraBody: {}
          },
          [{ role: 'user', content: 'hi' }],
          () => {}
        ),
      { message: /401|Unauthorized/ }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamCompletion throws on HTTP 500 response', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' });

    await assert.rejects(
      () =>
        streamCompletion(
          {
            providerType: 'deepseek',
            gatewayName: 'DeepSeek',
            baseUrl: 'https://example.test',
            model: 'deepseek-chat',
            apiKey: 'sk-test',
            supportsReasoning: false,
            extraBody: {}
          },
          [{ role: 'user', content: 'hi' }],
          () => {}
        ),
      { message: /500|Internal Server Error/ }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamCompletion normalizes provider fetch failures', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new TypeError('fetch failed');
    };

    await assert.rejects(
      () =>
        streamCompletion(
          {
            providerType: 'deepseek',
            gatewayName: 'DeepSeek',
            baseUrl: 'https://network-error.example',
            model: 'deepseek-chat',
            apiKey: 'sk-test',
            supportsReasoning: false,
            extraBody: {}
          },
          [{ role: 'user', content: 'hi' }],
          () => {}
        ),
      { message: /请求失败/ }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamCompletion skips invalid JSON in SSE data lines without crashing', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(sseStream([
        'data: {invalid json}',
        'data: {"choices":[{"delta":{"content":"ok"}}]}',
        'data: [DONE]'
      ]));

    const events = [];
    const result = await streamCompletion(
      {
        providerType: 'deepseek',
        gatewayName: 'DeepSeek',
        baseUrl: 'https://example.test',
        model: 'deepseek-chat',
        apiKey: 'sk-test',
        supportsReasoning: false,
        extraBody: {}
      },
      [{ role: 'user', content: 'hi' }],
      (event, data) => events.push({ event, data })
    );

    assert.equal(result.content, 'ok');
    assert.equal(result.reasoning, '');
    assert.equal(events.length, 1);
    assert.equal(events[0].event, 'content');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamCompletion parses final SSE event without trailing blank line', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"tail"}}]}'));
            controller.close();
          }
        }),
        { headers: { 'Content-Type': 'text/event-stream' } }
      );
    };

    const events = [];
    const result = await streamCompletion(
      {
        providerType: 'deepseek',
        gatewayName: 'DeepSeek',
        baseUrl: 'https://example.test',
        model: 'deepseek-chat',
        apiKey: 'sk-test',
        supportsReasoning: false,
        extraBody: {}
      },
      [{ role: 'user', content: 'hi' }],
      (event, data) => events.push({ event, data })
    );

    assert.equal(result.content, 'tail');
    assert.deepEqual(events.map((event) => event.event), ['content']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamCompletion returns empty content for immediately closed empty stream', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(''));
            controller.close();
          }
        })
      );
    };

    const events = [];
    const result = await streamCompletion(
      {
        providerType: 'deepseek',
        gatewayName: 'DeepSeek',
        baseUrl: 'https://example.test',
        model: 'deepseek-chat',
        apiKey: 'sk-test',
        supportsReasoning: false,
        extraBody: {}
      },
      [{ role: 'user', content: 'hi' }],
      (event, data) => events.push({ event, data })
    );

    assert.equal(result.content, '');
    assert.equal(result.reasoning, '');
    assert.equal(events.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamCompletion throws a friendly error when SSE body is missing', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(null, {
        headers: { 'Content-Type': 'text/event-stream' }
      });

    await assert.rejects(
      () =>
        streamCompletion(
          {
            providerType: 'deepseek',
            gatewayName: 'DeepSeek',
            baseUrl: 'https://api.deepseek.com',
            model: 'deepseek-chat',
            apiKey: 'sk-test'
          },
          [{ role: 'user', content: 'hi' }],
          () => {}
        ),
      { message: /流式响应不可用/ }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamCompletion throws a friendly error when SSE reader fails', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new TypeError('socket closed unexpectedly'));
          }
        }),
        { headers: { 'Content-Type': 'text/event-stream' } }
      );

    await assert.rejects(
      () =>
        streamCompletion(
          {
            providerType: 'deepseek',
            gatewayName: 'DeepSeek',
            baseUrl: 'https://api.deepseek.com',
            model: 'deepseek-chat',
            apiKey: 'sk-test'
          },
          [{ role: 'user', content: 'hi' }],
          () => {}
        ),
      { message: /流式响应中断/ }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamCompletion handles AbortController signal', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let fetchCalled = false;

  try {
    globalThis.fetch = async (_url, options = {}) => {
      fetchCalled = true;
      assert.equal(options.signal, controller.signal);
      controller.abort();
      const error = new DOMException('The operation was aborted.', 'AbortError');
      throw error;
    };

    await assert.rejects(
      () =>
        streamCompletion(
          {
            providerType: 'deepseek',
            gatewayName: 'DeepSeek',
            baseUrl: 'https://example.test',
            model: 'deepseek-chat',
            apiKey: 'sk-test',
            supportsReasoning: false,
            extraBody: {}
          },
          [{ role: 'user', content: 'hi' }],
          () => {},
          controller.signal
        ),
      { name: 'AbortError' }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetchCalled, true);
});

test('streamCompletion handles SSE data with missing choices field gracefully', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(sseStream([
        'data: {"id":"chatcmpl-1","object":"chat.completion.chunk"}',
        'data: {"choices":[{"delta":{"content":"hello"}}]}',
        'data: {"usage":{"prompt_tokens":10,"completion_tokens":5}}',
        'data: [DONE]'
      ]));

    const result = await streamCompletion(
      {
        providerType: 'deepseek',
        gatewayName: 'DeepSeek',
        baseUrl: 'https://example.test',
        model: 'deepseek-chat',
        apiKey: 'sk-test',
        supportsReasoning: false,
        extraBody: {}
      },
      [{ role: 'user', content: 'hi' }],
      () => {}
    );

    assert.equal(result.content, 'hello');
    assert.ok(result.usage);
    assert.equal(result.usage.prompt_tokens, 10);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamOpenAiResponse throws on HTTP error', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response('Forbidden', { status: 403, statusText: 'Forbidden' });

    await assert.rejects(
      () =>
        streamCompletion(
          {
            providerType: 'openai',
            gatewayName: 'OpenAI',
            baseUrl: 'https://example.test/v1',
            model: 'o4-mini',
            apiKey: 'sk-test',
            supportsReasoning: true,
            extraBody: {}
          },
          [{ role: 'user', content: 'hi' }],
          () => {}
        ),
      { message: /403|Forbidden/ }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── Provider Settings Persistence ──

test('provider settings route normalizes string extra body to a plain object', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'provider-extra-body-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'provider-extra-body', 'hash', new Date().toISOString()
  );

  const app = express();
  app.use(express.json());
  app.use('/api', createSettingsRouter({
    db: database,
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: userId } };
      next();
    },
    asyncRoute: (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    nowIso: () => new Date().toISOString(),
    getUserProfile: () => ({ id: userId })
  }));

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${baseUrl}/api/settings/provider`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerType: 'custom',
        gatewayName: 'Local proxy',
        baseUrl: 'http://127.0.0.1:8317/v1',
        model: 'local-model',
        supportsReasoning: false,
        extraBody: '["unexpected"]'
      })
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    const row = database.prepare('SELECT extra_body FROM provider_settings WHERE user_id = ?').get(userId);

    assert.deepEqual(body.extraBody, {});
    assert.equal(row.extra_body, '{}');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('provider model probe treats string false forceRefresh as false', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'provider-force-refresh-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'provider-force-refresh', 'hash', new Date().toISOString()
  );

  const app = express();
  app.use(express.json());
  app.use('/api', createSettingsRouter({
    db: database,
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: userId } };
      next();
    },
    asyncRoute: (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    nowIso: () => new Date().toISOString(),
    getUserProfile: () => ({ id: userId })
  }));

  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (url, request) => {
    if (String(url).startsWith('http://127.0.0.1:')) {
      return originalFetch(url, request);
    }
    requests += 1;
    return jsonResponse({ data: [{ id: 'cached-model' }] });
  };

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const payload = {
      providerType: 'custom',
      gatewayName: 'Local probe',
      baseUrl: 'https://force-refresh-false.example/v1',
      model: 'local-model',
      apiKey: 'sk-test',
      forceRefresh: 'false'
    };

    const first = await fetch(`${baseUrl}/api/providers/models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const second = await fetch(`${baseUrl}/api/providers/models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('provider_settings table INSERT and ON CONFLICT UPDATE', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'ps-user-1';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'provider-tester', 'hash', new Date().toISOString()
  );

  const encryptedKey = encryptSecret('sk-test-key-12345');
  const timestamp = new Date().toISOString();

  // INSERT
  database.prepare(
    `INSERT INTO provider_settings (
      user_id, provider_type, gateway_name, base_url, model, encrypted_api_key,
      api_key_hint, supports_reasoning, extra_body, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, 'deepseek', 'DeepSeek', 'https://api.deepseek.com', 'deepseek-chat', encryptedKey, 'sk-...345', 1, '{}', timestamp);

  const row = database.prepare('SELECT * FROM provider_settings WHERE user_id = ?').get(userId);
  assert.equal(row.provider_type, 'deepseek');
  assert.equal(row.gateway_name, 'DeepSeek');
  assert.equal(row.encrypted_api_key, encryptedKey);
  assert.equal(decryptSecret(row.encrypted_api_key), 'sk-test-key-12345');

  // ON CONFLICT UPDATE
  const newEncryptedKey = encryptSecret('sk-new-key-67890');
  const newTimestamp = new Date().toISOString();
  database.prepare(
    `INSERT INTO provider_settings (
      user_id, provider_type, gateway_name, base_url, model, encrypted_api_key,
      api_key_hint, supports_reasoning, extra_body, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      provider_type = excluded.provider_type,
      gateway_name = excluded.gateway_name,
      base_url = excluded.base_url,
      model = excluded.model,
      encrypted_api_key = excluded.encrypted_api_key,
      api_key_hint = excluded.api_key_hint,
      supports_reasoning = excluded.supports_reasoning,
      extra_body = excluded.extra_body,
      updated_at = excluded.updated_at`
  ).run(userId, 'openai', 'OpenAI', 'https://api.openai.com/v1', 'gpt-4.1-mini', newEncryptedKey, 'sk-...7890', 0, '{}', newTimestamp);

  const updated = database.prepare('SELECT * FROM provider_settings WHERE user_id = ?').get(userId);
  assert.equal(updated.provider_type, 'openai');
  assert.equal(updated.gateway_name, 'OpenAI');
  assert.equal(updated.model, 'gpt-4.1-mini');
  assert.equal(updated.supports_reasoning, 0);
  assert.equal(decryptSecret(updated.encrypted_api_key), 'sk-new-key-67890');

  // Verify only one row exists
  const count = database.prepare('SELECT COUNT(*) AS count FROM provider_settings').get();
  assert.equal(count.count, 1);
});

test('getPublicProviderSettings creates defaults for new user', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'default-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'default-tester', 'hash', new Date().toISOString()
  );

  // No provider_settings row yet — simulate getPublicProviderSettings behavior
  const row = database.prepare('SELECT * FROM provider_settings WHERE user_id = ?').get(userId);
  assert.equal(row, undefined);

  // normalizeProviderRow(null) returns defaults
  const defaults = normalizeProviderRow(null);
  assert.equal(defaults.providerType, 'deepseek');
  assert.equal(defaults.gatewayName, 'DeepSeek');
  assert.equal(defaults.baseUrl, 'https://api.deepseek.com');
  assert.equal(defaults.apiKeySet, false);
  assert.equal(defaults.apiKeyNeedsReset, false);
});

test('saveProviderSettings encrypts API key and updates hint', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'save-provider-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'save-tester', 'hash', new Date().toISOString()
  );

  const apiKey = 'sk-abcdefgh12345678';
  const encryptedKey = encryptSecret(apiKey);
  const hint = apiKeyHint(apiKey);
  const timestamp = new Date().toISOString();

  database.prepare(
    `INSERT INTO provider_settings (
      user_id, provider_type, gateway_name, base_url, model, encrypted_api_key,
      api_key_hint, supports_reasoning, extra_body, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, 'deepseek', 'DeepSeek', 'https://api.deepseek.com', 'deepseek-v4-flash', encryptedKey, hint, 1, '{}', timestamp);

  const row = database.prepare('SELECT * FROM provider_settings WHERE user_id = ?').get(userId);
  assert.equal(row.api_key_hint, 'sk-...5678');
  assert.equal(decryptSecret(row.encrypted_api_key), apiKey);

  // Verify providerWithSecret returns decrypted key
  const withSecret = providerWithSecret(row);
  assert.equal(withSecret.apiKey, apiKey);
  assert.equal(withSecret.apiKeySet, true);
  assert.equal(withSecret.apiKeyNeedsReset, false);
});

test('clearApiKey removes encrypted key and hint', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'clear-key-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'clear-tester', 'hash', new Date().toISOString()
  );

  const timestamp = new Date().toISOString();
  const encryptedKey = encryptSecret('sk-to-be-cleared');

  // Insert with key
  database.prepare(
    `INSERT INTO provider_settings (
      user_id, provider_type, gateway_name, base_url, model, encrypted_api_key,
      api_key_hint, supports_reasoning, extra_body, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, 'deepseek', 'DeepSeek', 'https://api.deepseek.com', 'deepseek-chat', encryptedKey, 'sk-...ared', 1, '{}', timestamp);

  // Simulate clearApiKey: update encrypted_api_key and api_key_hint to null
  database.prepare(
    'UPDATE provider_settings SET encrypted_api_key = NULL, api_key_hint = NULL, updated_at = ? WHERE user_id = ?'
  ).run(new Date().toISOString(), userId);

  const cleared = database.prepare('SELECT * FROM provider_settings WHERE user_id = ?').get(userId);
  assert.equal(cleared.encrypted_api_key, null);
  assert.equal(cleared.api_key_hint, null);

  // normalizeProviderRow should show key not set
  const normalized = normalizeProviderRow(cleared);
  assert.equal(normalized.apiKeySet, false);
  assert.equal(normalized.apiKeyHint, null);

  // providerWithSecret should return empty key
  const withSecret = providerWithSecret(cleared);
  assert.equal(withSecret.apiKey, '');
});

// ── Character CRUD Boundary ──

test('character name over 40 characters is rejected', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'name-len-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'name-tester', 'hash', new Date().toISOString()
  );

  // Exactly 40 should work
  const ok = createCharacter(database, userId, { name: 'a'.repeat(40) });
  assert.equal(ok.name.length, 40);

  // 41 should throw
  assert.throws(
    () => createCharacter(database, userId, { name: 'b'.repeat(41) }),
    /角色名长度/
  );
});

test('character create rejects null payload with validation error', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'character-null-payload-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    'characternull',
    'hash',
    new Date().toISOString()
  );

  assert.throws(
    () => createCharacter(database, userId, null),
    /1-40/
  );
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM characters WHERE user_id = ?').get(userId).count, 0);
});

test('batch created characters list in descending created_at order by default', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'batch-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'batch-tester', 'hash', new Date().toISOString()
  );

  // Create characters with explicit different timestamps to test sort order
  const id1 = newId();
  const id2 = newId();
  const id3 = newId();
  database.prepare(
    'INSERT INTO characters (id, user_id, name, visibility, tags, render_plugins, author_advanced_settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id1, userId, 'First', 'private', '[]', '[]', '{}', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
  database.prepare(
    'INSERT INTO characters (id, user_id, name, visibility, tags, render_plugins, author_advanced_settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id2, userId, 'Second', 'private', '[]', '[]', '{}', '2025-06-01T00:00:00.000Z', '2025-06-01T00:00:00.000Z');
  database.prepare(
    'INSERT INTO characters (id, user_id, name, visibility, tags, render_plugins, author_advanced_settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id3, userId, 'Third', 'private', '[]', '[]', '{}', '2025-12-01T00:00:00.000Z', '2025-12-01T00:00:00.000Z');

  const list = listCharacters(database, userId);
  assert.equal(list.length, 3);

  // Default sort is created_at DESC — newest first
  assert.equal(list[0].id, id3);
  assert.equal(list[1].id, id2);
  assert.equal(list[2].id, id1);
});

test('batch created characters sort by name alphabetically when sort=name', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'sort-name-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'sort-tester', 'hash', new Date().toISOString()
  );

  createCharacter(database, userId, { name: 'Charlie' });
  createCharacter(database, userId, { name: 'Alpha' });
  createCharacter(database, userId, { name: 'Bravo' });

  const list = listCharacters(database, userId, { sort: 'name' });
  assert.equal(list.length, 3);

  // Should be sorted by name COLLATE NOCASE ASC
  const names = list.map((c) => c.name);
  assert.deepEqual(names, ['Alpha', 'Bravo', 'Charlie']);
});

test('character lists preserve deterministic tie order across sort modes', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'character-order-user';
  const timestamp = '2025-01-01T00:00:00.000Z';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    'characterorder',
    'hash',
    timestamp
  );
  database.prepare(
    'INSERT INTO characters (id, user_id, name, visibility, tags, render_plugins, author_advanced_settings, created_at, updated_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('character-first', userId, 'Alpha', 'private', '[]', '[]', '{}', timestamp, timestamp, timestamp);
  database.prepare(
    'INSERT INTO characters (id, user_id, name, visibility, tags, render_plugins, author_advanced_settings, created_at, updated_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('character-second', userId, 'Alpha', 'private', '[]', '[]', '{}', timestamp, timestamp, timestamp);
  database.prepare(
    'INSERT INTO characters (id, user_id, name, visibility, tags, render_plugins, author_advanced_settings, created_at, updated_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('character-bravo', userId, 'Bravo', 'private', '[]', '[]', '{}', timestamp, timestamp, timestamp);

  assert.deepEqual(
    listCharacters(database, userId).map((character) => character.id),
    ['character-bravo', 'character-second', 'character-first']
  );
  assert.deepEqual(
    listCharacters(database, userId, null).map((character) => character.id),
    ['character-bravo', 'character-second', 'character-first']
  );
  assert.deepEqual(
    listCharacters(database, userId, { sort: 'used' }).map((character) => character.id),
    ['character-bravo', 'character-second', 'character-first']
  );
  assert.deepEqual(
    listCharacters(database, userId, { sort: 'name' }).map((character) => character.id),
    ['character-second', 'character-first', 'character-bravo']
  );
});

test('world book alwaysActive entry matches without any trigger keys', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, 'user-1', { name: 'AlwaysActive角色', visibility: 'private' });
  const book = createWorldBook(database, 'user-1', { name: 'AlwaysActive测试书' });
  linkWorldBookToCharacter(database, book.id, character.id);

  createEntry(database, 'user-1', book.id, {
    name: '永久条目',
    triggerKeys: '',
    content: '永久激活的内容',
    enabled: true,
    alwaysActive: true
  });

  const matches = matchWorldBookEntries(database, character.id, '');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].name, '永久条目');
  assert.equal(matches[0].content, '永久激活的内容');
});

test('world book regexMode entry matches by regex pattern', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, 'user-1', { name: 'RegexMode角色', visibility: 'private' });
  const book = createWorldBook(database, 'user-1', { name: 'RegexMode测试书' });
  linkWorldBookToCharacter(database, book.id, character.id);

  createEntry(database, 'user-1', book.id, {
    name: '数字匹配',
    triggerKeys: '\\d+',
    content: '检测到数字',
    enabled: true,
    regexMode: true
  });

  const matches = matchWorldBookEntries(database, character.id, '我有42个苹果');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].content, '检测到数字');

  const noMatches = matchWorldBookEntries(database, character.id, '我没有苹果');
  assert.equal(noMatches.length, 0);
});

test('world book selective NOT logic filters out when secondary key present', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, 'user-1', { name: 'SelectiveNot角色', visibility: 'private' });
  const book = createWorldBook(database, 'user-1', { name: 'SelectiveNot测试书' });
  linkWorldBookToCharacter(database, book.id, character.id);

  createEntry(database, 'user-1', book.id, {
    name: '和平场景',
    triggerKeys: '场景',
    content: '和平的场景描述',
    enabled: true,
    selective: true,
    selectiveLogic: 1,
    keysSecondary: '战斗'
  });

  const matches = matchWorldBookEntries(database, character.id, '一个美丽的场景');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].content, '和平的场景描述');

  const blocked = matchWorldBookEntries(database, character.id, '一个激烈的战斗场景');
  assert.equal(blocked.length, 0);
});
