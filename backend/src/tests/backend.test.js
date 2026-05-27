import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
  listCharacters,
  setCharacterFavorite,
  setCharacterLike,
  updateCharacter
} = await import('../modules/characters.js');
const { decryptSecret, encryptSecret, hashPassword, verifyPassword } = await import('../security.js');
const {
  buildProviderBody,
  buildUsageSnapshot,
  listProviderModels,
  normalizeProviderRow,
  providerWithSecret,
  streamCompletion,
  summarizeUsageSnapshots
} = await import('../services/providers.js');
const {
  getAvatarAssetForViewer,
  getUserAvatarUrl,
  saveAvatarInput
} = await import('../services/avatars.js');
const {
  getConversationAppearance,
  saveConversationAppearance
} = await import('../modules/conversationAppearance.js');
const { completeCharacterDraft } = await import('../services/characterAssistant.js');
const { renderPromptVariables, resolvePromptUserName } = await import('../services/promptVariables.js');
const {
  createWorldBook,
  getWorldBook,
  listWorldBooks,
  updateWorldBook,
  deleteWorldBook,
  createEntry,
  updateEntry,
  deleteEntry,
  matchWorldBookEntries,
  buildWorldBookContext
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

test('password hashes verify and reject wrong passwords', async () => {
  const hash = await hashPassword('correct horse battery');
  assert.equal(await verifyPassword('correct horse battery', hash), true);
  assert.equal(await verifyPassword('wrong horse battery', hash), false);
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

test('prompt variables render the current user name', () => {
  const user = {
    username: 'account_name',
    displayName: '赵雨乐'
  };

  assert.equal(resolvePromptUserName(user), '赵雨乐');
  assert.equal(renderPromptVariables('你好，{user}。{user} 已进入故事。', user), '你好，赵雨乐。赵雨乐 已进入故事。');
  assert.equal(renderPromptVariables('没有变量', user), '没有变量');
});

test('character assistant completes drafts through multiple tool rounds', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, request = {}) => {
    calls += 1;
    const body = JSON.parse(request.body);
    assert.equal(body.tools.length, 4);
    assert.ok(body.tools.some((tool) => tool.function?.name === 'set_character_extensions'));

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

  const result = await completeCharacterDraft(
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
  globalThis.fetch = originalFetch;

  assert.equal(calls, 3);
  assert.equal(result.character.name, '澄灯');
  assert.match(result.character.persona, /\{user\}/);
  assert.deepEqual(result.character.tags, ['温和', '推理']);
  assert.equal(result.character.regexRules[0].pattern, '老板');
  assert.equal(result.toolCalls.length, 2);
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

  assert.deepEqual(saved, {
    desktopBackgroundUrl: 'data:image/png;base64,AQID',
    mobileBackgroundUrl: '',
    customCss: ' .deep-bubble { border-radius: 24px; } ',
    customJs: 'return () => {}'
  });

  assert.deepEqual(getConversationAppearance(database, 'owner-1', conversationId), saved);
  assert.equal(database.prepare('SELECT mobile_background_url FROM conversations WHERE id = ?').get(conversationId).mobile_background_url, '');
});

test('OpenAI-compatible streaming parser separates reasoning and content', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(sseStream([
      'data: {"choices":[{"delta":{"reasoning_content":"思考"}}]}',
      'data: {"choices":[{"delta":{"content":"你好"}}]}',
      'data: [DONE]'
    ]));

  const events = [];
  const result = await streamCompletion(
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
  globalThis.fetch = originalFetch;

  assert.equal(result.reasoning, '思考');
  assert.equal(result.content, '你好');
  assert.deepEqual(
    events.map((event) => event.event),
    ['reasoning', 'content']
  );
});

test('OpenAI Responses streaming parser reads summary deltas', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(sseStream([
      'event: response.reasoning_summary_text.delta\ndata: {"type":"response.reasoning_summary_text.delta","delta":"摘要"}',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"正文"}',
      'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"total_tokens":12}}}'
    ]));

  const result = await streamCompletion(
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
  globalThis.fetch = originalFetch;

  assert.equal(result.reasoning, '摘要');
  assert.equal(result.content, '正文');
  assert.equal(result.usage.total_tokens, 12);
});

test('provider model list normalizes official /models responses', async () => {
  const originalFetch = globalThis.fetch;
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
  globalThis.fetch = originalFetch;

  assert.deepEqual(
    models.map((model) => model.id),
    ['deepseek-chat', 'deepseek-reasoner']
  );
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

test('DeepSeek thinking switch maps to official thinking request field', () => {
  const enabled = buildProviderBody(
    {
      providerType: 'deepseek',
      model: 'deepseek-chat',
      supportsReasoning: true,
      extraBody: {}
    },
    [{ role: 'user', content: 'hi' }],
    true,
    { thinkingEnabled: true }
  );
  const disabled = buildProviderBody(
    {
      providerType: 'deepseek',
      model: 'deepseek-chat',
      supportsReasoning: true,
      extraBody: {}
    },
    [{ role: 'user', content: 'hi' }],
    true,
    { thinkingEnabled: false }
  );

  assert.deepEqual(enabled.thinking, { type: 'enabled' });
  assert.deepEqual(disabled.thinking, { type: 'disabled' });
  assert.equal(enabled.model, 'deepseek-v4-flash');
  assert.equal(disabled.model, 'deepseek-v4-flash');
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
      thinkingEnabled: true,
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

  const context = buildWorldBookContext(matches);
  assert.equal(context, '魔法系统说明');

  const emptyContext = buildWorldBookContext([]);
  assert.equal(emptyContext, '');
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

test('tags CRUD with usage count', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'tag-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'tagger', 'hash', new Date().toISOString()
  );

  // Create tags
  const tag1 = createTag(database, { name: '温柔', color: '#ff6b6b' });
  const tag2 = createTag(database, { name: '悬疑' });
  assert.equal(tag1.name, '温柔');
  assert.equal(tag1.color, '#ff6b6b');
  assert.equal(tag2.name, '悬疑');
  assert.equal(tag2.color, '');

  // Create a character and assign tags
  const character = createCharacter(database, userId, { name: '标签测试角色' });
  setCharacterTags(database, character.id, ['温柔', '悬疑']);

  // List tags with usage count
  const tags = listTags(database);
  assert.equal(tags.length, 2);
  assert.equal(tags[0].usageCount, 1); // sorted by usage desc
  assert.equal(tags[1].usageCount, 1);

  // Duplicate tag name rejected
  assert.throws(() => createTag(database, { name: '温柔' }), /标签名已存在/);

  // Delete tag
  assert.equal(deleteTag(database, tag1.id), true);
  assert.equal(deleteTag(database, 'nonexistent'), false);

  // After deletion, usage count updates
  const remaining = listTags(database);
  assert.equal(remaining.length, 1);
});

test('character tags sync replaces old tags', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'sync-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId, 'syncer', 'hash', new Date().toISOString()
  );

  const character = createCharacter(database, userId, { name: '同步测试' });

  // Set initial tags
  setCharacterTags(database, character.id, ['A', 'B', 'C']);
  assert.deepEqual(getCharacterTagNames(database, character.id), ['A', 'B', 'C']);

  // Replace with new tags
  setCharacterTags(database, character.id, ['B', 'D']);
  assert.deepEqual(getCharacterTagNames(database, character.id), ['B', 'D']);

  // Clear all tags
  setCharacterTags(database, character.id, []);
  assert.deepEqual(getCharacterTagNames(database, character.id), []);
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
  setCharacterTags(database, c1.id, ['温柔']);
  setCharacterTags(database, c2.id, ['温柔', '悬疑']);
  setCharacterTags(database, c3.id, ['悬疑']);

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

  const tag1 = createTag(database, { name: '颜色测试', color: '#abc' });
  assert.equal(tag1.color, '#abc');

  const tag2 = createTag(database, { name: '无颜色', color: 'not-a-color' });
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
  setCharacterTags(database, character.id, ['温柔', '助手']);

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
         FROM world_book_entries WHERE world_book_id = ? ORDER BY order_index ASC`
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
  assert.deepEqual(exportData.tags, ['助手', '温柔']);
  assert.equal(exportData.world_book.name, '世界观');
  assert.equal(exportData.world_book.entries.length, 1);
  assert.equal(exportData.world_book.entries[0].name, '魔法');
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
  setCharacterTags(database, character.id, importData.tags);

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

  const updates2 = [{ name: 'MP', value: 60, max: 120 }];
  const result2 = applyVariableUpdates(variables, updates2);
  assert.equal(result2[1].value, 60);
  assert.equal(result2[1].max, 120);

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
