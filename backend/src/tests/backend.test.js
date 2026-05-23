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
  listCharacters,
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

function sseStream(lines) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`${lines.join('\n\n')}\n\n`));
      controller.close();
    }
  });
}

function encryptWithSecret(value, secret) {
  const key = crypto.createHash('sha256').update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}
