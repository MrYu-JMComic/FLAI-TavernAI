import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { db, uploadsDir } from './db.js';
import {
  apiKeyHint,
  clearSessionCookie,
  createSession,
  decryptSecret,
  destroySession,
  encryptSecret,
  hashPassword,
  newId,
  nowIso,
  resolveSession,
  setSessionCookie,
  verifyPassword
} from './security.js';
import {
  applyRegexRules,
  createCharacter,
  deleteCharacter,
  getCharacter,
  getRegexRules,
  listCharacters,
  saveAvatarDataUrl,
  touchCharacter,
  updateCharacter
} from './modules/characters.js';
import {
  buildUsageSnapshot,
  defaultProviderSettings,
  fetchDeepSeekBalance,
  generateCompletion,
  hasUsableProvider,
  listProviderModels,
  normalizeProviderRow,
  providerPresets,
  providerWithSecret,
  summarizeUsageSnapshots,
  streamCompletion
} from './services/providers.js';

const app = express();
const port = Number(process.env.PORT || 3001);
const clientOrigins = (process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5173,http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: clientOrigins,
    credentials: true
  })
);
app.use(express.json({ limit: '5mb' }));
app.use('/uploads', express.static(uploadsDir));
app.use(attachAuth);

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    service: 'flai-tavern-backend'
  });
});

app.post('/api/auth/register', asyncRoute(async (request, response) => {
  const { username, password } = validateCredentials(request.body);
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    response.status(409).json({ error: '用户名已存在' });
    return;
  }

  const userId = newId();
  db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    username,
    await hashPassword(password),
    nowIso()
  );
  saveDefaultProvider(userId);

  const sessionId = createSession(db, userId);
  setSessionCookie(response, sessionId);
  response.status(201).json({ user: publicUser({ id: userId, username, created_at: nowIso() }) });
}));

app.post('/api/auth/login', asyncRoute(async (request, response) => {
  const { username, password } = validateCredentials(request.body);
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    response.status(401).json({ error: '用户名或密码错误' });
    return;
  }

  const sessionId = createSession(db, row.id);
  setSessionCookie(response, sessionId);
  response.json({ user: publicUser(row) });
}));

app.post('/api/auth/logout', requireAuth, (request, response) => {
  destroySession(db, request.auth.sessionId);
  clearSessionCookie(response);
  response.json({ ok: true });
});

app.get('/api/auth/me', (request, response) => {
  response.json({ user: request.auth?.user || null });
});

app.get('/api/characters', requireAuth, (request, response) => {
  response.json(
    listCharacters(db, request.auth.user.id, {
      search: request.query.search,
      sort: request.query.sort
    })
  );
});

app.post('/api/characters', requireAuth, (request, response) => {
  const payload = prepareCharacterPayload(request.auth.user.id, request.body);
  response.status(201).json(createCharacter(db, request.auth.user.id, payload));
});

app.get('/api/characters/:id', requireAuth, (request, response) => {
  const character = getCharacter(db, request.auth.user.id, request.params.id);
  if (!character) {
    response.status(404).json({ error: '角色不存在' });
    return;
  }
  response.json(character);
});

app.patch('/api/characters/:id', requireAuth, (request, response) => {
  const existing = getCharacter(db, request.auth.user.id, request.params.id);
  if (!existing) {
    response.status(404).json({ error: '角色不存在' });
    return;
  }
  if (!existing.canEdit) {
    response.status(403).json({ error: '只有角色拥有者可以编辑此角色' });
    return;
  }

  const payload = prepareCharacterPayload(request.auth.user.id, request.body);
  const character = updateCharacter(db, request.auth.user.id, request.params.id, payload);
  if (!character) {
    response.status(404).json({ error: '角色不存在' });
    return;
  }
  response.json(character);
});

app.delete('/api/characters/:id', requireAuth, (request, response) => {
  const existing = getCharacter(db, request.auth.user.id, request.params.id);
  if (!existing) {
    response.status(404).json({ error: '角色不存在' });
    return;
  }
  if (!existing.canEdit) {
    response.status(403).json({ error: '只有角色拥有者可以删除此角色' });
    return;
  }

  if (!deleteCharacter(db, request.auth.user.id, request.params.id)) {
    response.status(404).json({ error: '角色不存在' });
    return;
  }
  response.json({ ok: true });
});

app.get('/api/settings/provider', requireAuth, (request, response) => {
  response.json(getPublicProviderSettings(request.auth.user.id));
});

app.put('/api/settings/provider', requireAuth, (request, response) => {
  const settings = saveProviderSettings(request.auth.user.id, request.body || {});
  response.json(settings);
});

app.get('/api/providers/deepseek/balance', requireAuth, asyncRoute(async (request, response) => {
  const row = getProviderRow(request.auth.user.id);
  const settings = providerWithSecret(row);
  if (settings.providerType !== 'deepseek') {
    response.status(400).json({ error: '当前供应商不是 DeepSeek' });
    return;
  }

  response.json(await fetchDeepSeekBalance(settings));
}));

app.get('/api/providers/models', requireAuth, asyncRoute(async (request, response) => {
  const settings = providerWithSecret(getProviderRow(request.auth.user.id));
  response.json({ models: await listProviderModels(settings) });
}));

app.post('/api/providers/models', requireAuth, asyncRoute(async (request, response) => {
  const settings = buildProviderProbeSettings(request.auth.user.id, request.body || {});
  response.json({ models: await listProviderModels(settings) });
}));

app.get('/api/conversations', requireAuth, (request, response) => {
  const characterId = String(request.query.characterId || '').trim();
  const params = [request.auth.user.id];
  let where = 'WHERE conversations.user_id = ?';
  if (characterId) {
    where += ' AND conversations.character_id = ?';
    params.push(characterId);
  }

  const rows = db
    .prepare(
      `SELECT conversations.*, characters.name AS character_name, characters.avatar_url
       FROM conversations
       JOIN characters ON characters.id = conversations.character_id
       ${where}
       ORDER BY conversations.updated_at DESC`
    )
    .all(...params);

  response.json(rows.map((row) => withConversationUsage(toConversation(row), request.auth.user.id)));
});

app.post('/api/conversations/bulk-delete', requireAuth, (request, response) => {
  const ids = normalizeIdList(request.body?.ids);
  if (!ids.length) {
    response.status(400).json({ error: '请选择要删除的会话' });
    return;
  }

  const deletedIds = deleteConversations(request.auth.user.id, ids);
  response.json({ ok: true, deletedIds });
});

app.post('/api/conversations', requireAuth, (request, response) => {
  const character = getCharacter(db, request.auth.user.id, request.body?.characterId);
  if (!character) {
    response.status(404).json({ error: '角色不存在' });
    return;
  }

  const conversationId = newId();
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(conversationId, request.auth.user.id, character.id, `${character.name} 的故事`, timestamp, timestamp);

  if (character.openingMessage) {
    insertMessage({
      userId: request.auth.user.id,
      conversationId,
      role: 'assistant',
      content: character.openingMessage,
      reasoning: '',
      usage: null
    });
  }

  touchCharacter(db, request.auth.user.id, character.id);
  response.status(201).json(getConversation(request.auth.user.id, conversationId));
});

app.delete('/api/conversations/:id', requireAuth, (request, response) => {
  if (!deleteConversation(request.auth.user.id, request.params.id)) {
    response.status(404).json({ error: '对话不存在' });
    return;
  }

  response.json({ ok: true, deletedId: request.params.id });
});

app.get('/api/conversations/:id/messages', requireAuth, (request, response) => {
  const conversation = getConversation(request.auth.user.id, request.params.id);
  if (!conversation) {
    response.status(404).json({ error: '对话不存在' });
    return;
  }

  response.json({
    conversation,
    messages: getMessages(request.auth.user.id, request.params.id)
  });
});

app.patch('/api/conversations/:id/messages/:messageId', requireAuth, (request, response) => {
  const conversation = getConversation(request.auth.user.id, request.params.id);
  if (!conversation) {
    response.status(404).json({ error: '对话不存在' });
    return;
  }

  const message = getMessage(request.auth.user.id, request.params.id, request.params.messageId);
  if (!message) {
    response.status(404).json({ error: '消息不存在' });
    return;
  }

  const content = String(request.body?.content ?? '').trim();
  if (!content) {
    response.status(400).json({ error: '消息内容不能为空' });
    return;
  }

  response.json(updateMessage(request.auth.user.id, request.params.id, request.params.messageId, { content }));
});

app.delete('/api/conversations/:id/messages/:messageId', requireAuth, (request, response) => {
  const conversation = getConversation(request.auth.user.id, request.params.id);
  if (!conversation) {
    response.status(404).json({ error: '对话不存在' });
    return;
  }

  const deletedMessage = deleteMessage(request.auth.user.id, request.params.id, request.params.messageId);
  if (!deletedMessage) {
    response.status(404).json({ error: '消息不存在' });
    return;
  }

  response.json({
    ok: true,
    deletedId: deletedMessage.deletedId,
    deletedReasoning: deletedMessage.deletedReasoning
  });
});

app.post('/api/conversations/:id/messages', requireAuth, asyncRoute(async (request, response) => {
  const conversation = getConversation(request.auth.user.id, request.params.id);
  if (!conversation) {
    response.status(404).json({ error: '对话不存在' });
    return;
  }

  const character = getCharacter(db, request.auth.user.id, conversation.characterId);
  if (!character) {
    response.status(404).json({ error: '角色不存在' });
    return;
  }

  const userText = String(request.body?.content || request.body?.message || '').trim();
  if (!userText) {
    response.status(400).json({ error: '消息不能为空' });
    return;
  }

  const rules = getRegexRules(db, character.ownerId, character.id);
  const settings = getChatProviderSettings(request.auth.user.id);
  if (!settings.ok) {
    response.status(400).json({ error: settings.error, accepted: false });
    return;
  }

  const modelMessages = buildModelMessages({
    character,
    history: getRecentMessages(request.auth.user.id, conversation.id),
    userText: applyRegexRules(userText, rules, 'input')
  });

  const userMessage = insertMessage({
    userId: request.auth.user.id,
    conversationId: conversation.id,
    role: 'user',
    content: userText,
    reasoning: '',
    usage: null
  });
  updateConversationTimestamp(request.auth.user.id, conversation.id);
  const aiOptions = {
    thinkingEnabled: request.body?.thinkingEnabled !== false
  };

  if (request.body?.stream !== false) {
    await streamAssistantResponse({
      request,
      response,
      userId: request.auth.user.id,
      conversation,
      character,
      rules,
      modelMessages,
      settings: settings.value,
      userMessage,
      thinkingEnabled: aiOptions.thinkingEnabled
    });
    return;
  }

  const result = await generateCompletion(settings.value, modelMessages, aiOptions);
  const assistantMessage = saveAssistantResult({
    userId: request.auth.user.id,
    conversation,
    character,
    rules,
    result
  });

  response.json({
    userMessage,
    assistantMessage,
    usage: assistantMessage.usage,
    provider: result.provider
  });
}));

app.use((error, _request, response, _next) => {
  const message = error?.message || '服务器错误';
  if (response.headersSent) {
    return;
  }
  response.status(400).json({ error: message });
});

app.listen(port, () => {
  console.log(`FLAI Tavern backend listening on http://localhost:${port}`);
});

function attachAuth(request, _response, next) {
  request.auth = resolveSession(db, request);
  next();
}

function requireAuth(request, response, next) {
  if (!request.auth?.user) {
    response.status(401).json({ error: '请先登录' });
    return;
  }
  next();
}

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function validateCredentials(body = {}) {
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!/^[\w\u4e00-\u9fa5.-]{3,32}$/.test(username)) {
    throw new Error('用户名需为 3-32 位，可包含中文、字母、数字、下划线、点和横线');
  }
  if (password.length < 6 || password.length > 128) {
    throw new Error('密码长度需为 6-128 位');
  }
  return { username, password };
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    createdAt: row.created_at || row.createdAt
  };
}

function prepareCharacterPayload(userId, body = {}) {
  const payload = { ...body };
  const avatarData = payload.avatarDataUrl || payload.avatarUrl;
  if (avatarData && String(avatarData).startsWith('data:')) {
    payload.avatarUrl = saveAvatarDataUrl(userId, avatarData);
  }
  delete payload.avatarDataUrl;
  return payload;
}

function getProviderRow(userId) {
  return db.prepare('SELECT * FROM provider_settings WHERE user_id = ?').get(userId);
}

function getPublicProviderSettings(userId) {
  const row = getProviderRow(userId);
  if (row) {
    return normalizeProviderRow(row);
  }
  return saveDefaultProvider(userId);
}

function saveDefaultProvider(userId) {
  const preset = defaultProviderSettings();
  const timestamp = nowIso();
  db.prepare(
    `INSERT OR IGNORE INTO provider_settings (
      user_id, provider_type, gateway_name, base_url, model, encrypted_api_key,
      api_key_hint, supports_reasoning, extra_body, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId,
    preset.providerType,
    preset.gatewayName,
    preset.baseUrl,
    preset.model,
    null,
    null,
    preset.supportsReasoning ? 1 : 0,
    JSON.stringify(preset.extraBody),
    timestamp
  );
  return getPublicProviderSettings(userId);
}

function saveProviderSettings(userId, payload) {
  const preset = providerPresets[payload.providerType] || providerPresets.custom;
  const existing = getProviderRow(userId);
  const existingPublic = existing ? normalizeProviderRow(existing) : null;
  const apiKey = String(payload.apiKey || '').trim();
  const encryptedApiKey = apiKey
    ? encryptSecret(apiKey)
    : payload.clearApiKey || existingPublic?.apiKeyNeedsReset
      ? null
      : existing?.encrypted_api_key || null;

  const settings = {
    providerType: preset.providerType,
    gatewayName: String(payload.gatewayName || preset.gatewayName).trim() || preset.gatewayName,
    baseUrl: String(payload.baseUrl ?? preset.baseUrl).trim(),
    model: String(payload.model ?? preset.model).trim(),
    supportsReasoning: Boolean(payload.supportsReasoning),
    extraBody: parseExtraBody(payload.extraBody ?? preset.extraBody),
    encryptedApiKey,
    apiKeyHint: apiKey
      ? apiKeyHint(apiKey)
      : payload.clearApiKey || existingPublic?.apiKeyNeedsReset
        ? null
        : existing?.api_key_hint || null
  };

  if (!settings.baseUrl || !settings.model) {
    throw new Error('请填写网关地址和模型名');
  }

  db.prepare(
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
  ).run(
    userId,
    settings.providerType,
    settings.gatewayName,
    settings.baseUrl,
    settings.model,
    settings.encryptedApiKey,
    settings.apiKeyHint,
    settings.supportsReasoning ? 1 : 0,
    JSON.stringify(settings.extraBody),
    nowIso()
  );

  return getPublicProviderSettings(userId);
}

function buildProviderProbeSettings(userId, payload) {
  const existing = getProviderRow(userId);
  const saved = existing ? providerWithSecret(existing) : {};
  const providerType = payload.providerType || saved.providerType || 'custom';
  const preset = providerPresets[providerType] || providerPresets.custom;
  const apiKey = String(payload.apiKey || '').trim() || saved.apiKey || '';

  return {
    providerType: preset.providerType,
    gatewayName: String(payload.gatewayName || saved.gatewayName || preset.gatewayName).trim() || preset.gatewayName,
    baseUrl: String(payload.baseUrl ?? saved.baseUrl ?? preset.baseUrl).trim(),
    model: String(payload.model ?? saved.model ?? preset.model).trim(),
    supportsReasoning: Boolean(payload.supportsReasoning ?? saved.supportsReasoning ?? preset.supportsReasoning),
    extraBody: parseExtraBody(payload.extraBody ?? saved.extraBody ?? preset.extraBody),
    apiKey,
    apiKeyError: apiKey ? null : saved.apiKeyError || null
  };
}

function getChatProviderSettings(userId) {
  const settings = providerWithSecret(getProviderRow(userId));
  if (settings.apiKeyError) {
    return { ok: false, error: settings.apiKeyError };
  }
  if (!settings.apiKey) {
    return { ok: false, error: '请先在用户页保存 API Key / SK，再开始真实对话。' };
  }
  if (!hasUsableProvider(settings)) {
    return { ok: false, error: 'AI 供应商配置不完整，请检查网关地址、模型和 API Key。' };
  }
  return { ok: true, value: settings };
}

function parseExtraBody(value) {
  if (!value) {
    return {};
  }
  if (typeof value === 'string') {
    return JSON.parse(value);
  }
  return value;
}

function getConversation(userId, conversationId) {
  const row = db
    .prepare(
      `SELECT conversations.*, characters.name AS character_name, characters.avatar_url
       FROM conversations
       JOIN characters ON characters.id = conversations.character_id
       WHERE conversations.user_id = ? AND conversations.id = ?`
    )
    .get(userId, conversationId);
  return row ? withConversationUsage(toConversation(row), userId) : null;
}

function toConversation(row) {
  return {
    id: row.id,
    characterId: row.character_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    character: {
      name: row.character_name,
      avatarUrl: row.avatar_url || ''
    }
  };
}

function getMessages(userId, conversationId) {
  return db
    .prepare(
      `SELECT * FROM messages
       WHERE user_id = ? AND conversation_id = ?
       ORDER BY created_at ASC`
    )
    .all(userId, conversationId)
    .map(toMessage);
}

function getMessage(userId, conversationId, messageId) {
  const row = db
    .prepare(
      `SELECT * FROM messages
       WHERE user_id = ? AND conversation_id = ? AND id = ?`
    )
    .get(userId, conversationId, messageId);
  return row ? toMessage(row) : null;
}

function updateMessage(userId, conversationId, messageId, payload) {
  db.prepare(
    `UPDATE messages
     SET content = ?
     WHERE user_id = ? AND conversation_id = ? AND id = ?`
  ).run(payload.content, userId, conversationId, messageId);
  updateConversationTimestamp(userId, conversationId);
  return getMessage(userId, conversationId, messageId);
}

function deleteMessage(userId, conversationId, messageId) {
  const existing = getMessage(userId, conversationId, messageId);
  if (!existing) {
    return null;
  }

  const result = db
    .prepare('DELETE FROM messages WHERE user_id = ? AND conversation_id = ? AND id = ?')
    .run(userId, conversationId, messageId);
  if (result.changes > 0) {
    updateConversationTimestamp(userId, conversationId);
  }
  return result.changes > 0
    ? { deletedId: messageId, deletedReasoning: Boolean(existing.reasoning) }
    : null;
}

function deleteConversation(userId, conversationId) {
  const result = db
    .prepare('DELETE FROM conversations WHERE user_id = ? AND id = ?')
    .run(userId, conversationId);
  return result.changes > 0;
}

function deleteConversations(userId, ids) {
  const deletedIds = [];
  const statement = db.prepare('DELETE FROM conversations WHERE user_id = ? AND id = ?');
  for (const id of ids) {
    const result = statement.run(userId, id);
    if (result.changes > 0) {
      deletedIds.push(id);
    }
  }
  return deletedIds;
}

function normalizeIdList(ids) {
  if (!Array.isArray(ids)) {
    return [];
  }
  return [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))].slice(0, 100);
}

function getConversationUsage(userId, conversationId) {
  const usages = db
    .prepare(
      `SELECT usage_json FROM messages
       WHERE user_id = ? AND conversation_id = ? AND usage_json IS NOT NULL`
    )
    .all(userId, conversationId)
    .map((row) => parseJson(row.usage_json, null))
    .filter(Boolean);

  return summarizeUsageSnapshots(usages);
}

function withConversationUsage(conversation, userId) {
  return {
    ...conversation,
    usage: getConversationUsage(userId, conversation.id)
  };
}

function getRecentMessages(userId, conversationId) {
  return db
    .prepare(
      `SELECT * FROM (
        SELECT * FROM messages
        WHERE user_id = ? AND conversation_id = ?
        ORDER BY created_at DESC
        LIMIT 20
      ) ORDER BY created_at ASC`
    )
    .all(userId, conversationId);
}

function insertMessage({ userId, conversationId, role, content, reasoning, usage }) {
  const id = newId();
  db.prepare(
    `INSERT INTO messages (id, user_id, conversation_id, role, content, reasoning, usage_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, userId, conversationId, role, content, reasoning || '', usage ? JSON.stringify(usage) : null, nowIso());

  return toMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(id));
}

function toMessage(row) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    reasoning: row.reasoning || '',
    usage: parseJson(row.usage_json, null),
    createdAt: row.created_at
  };
}

function buildModelMessages({ character, history, userText }) {
  const systemPrompt = [
    `你正在扮演角色「${character.name}」。`,
    character.gender ? `性别：${character.gender}` : '',
    character.age ? `年龄：${character.age}` : '',
    character.background ? `背景：${character.background}` : '',
    character.worldview ? `世界观：${character.worldview}` : '',
    character.persona ? `人设与表达风格：${character.persona}` : '',
    '保持角色一致，用自然中文回复。不要伪造内部思考；如果模型接口返回思考内容，系统会单独展示。'
  ]
    .filter(Boolean)
    .join('\n');

  return [
    { role: 'system', content: systemPrompt },
    ...history.map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content
    })),
    { role: 'user', content: userText }
  ];
}

async function streamAssistantResponse({
  request,
  response,
  userId,
  conversation,
  character,
  rules,
  modelMessages,
  settings,
  thinkingEnabled = true
}) {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  response.flushHeaders?.();

  const controller = new AbortController();
  request.on('aborted', () => controller.abort());
  response.on('close', () => {
    if (!response.writableEnded) {
      controller.abort();
    }
  });
  const emit = (event, data) => writeSse(response, event, data);
  emit('meta', {
    provider: settings.gatewayName,
    model: settings.model,
    reasoning: settings.supportsReasoning && thinkingEnabled
  });

  try {
    const result = await streamCompletion(settings, modelMessages, emit, controller.signal, { thinkingEnabled });
    const assistantMessage = saveAssistantResult({
      userId,
      conversation,
      character,
      rules,
      result
    });
    emit('done', {
      assistantMessage,
      usage: assistantMessage.usage,
      provider: result.provider
    });
    response.end();
  } catch (error) {
    if (isAbortError(error) || controller.signal.aborted || response.destroyed) {
      if (!response.destroyed) {
        response.end();
      }
      return;
    }

    if (!response.destroyed) {
      emit('error', { error: error?.message || '生成失败' });
      response.end();
    }
  }
}

function saveAssistantResult({ userId, conversation, character, rules, result }) {
  const content = applyRegexRules(result.content || '', rules, 'output');
  const usage = buildUsageSnapshot(result.usage, result);
  const assistantMessage = insertMessage({
    userId,
    conversationId: conversation.id,
    role: 'assistant',
    content,
    reasoning: result.reasoning || '',
    usage
  });
  updateConversationTimestamp(userId, conversation.id);
  touchCharacter(db, userId, character.id);
  return assistantMessage;
}

function updateConversationTimestamp(userId, conversationId) {
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ? AND user_id = ?').run(
    nowIso(),
    conversationId,
    userId
  );
}

function writeSse(response, event, data) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
  response.flush?.();
}

function isAbortError(error) {
  const message = String(error?.message || '');
  return error?.name === 'AbortError' || /aborted|abort/i.test(message);
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || '');
  } catch {
    return fallback;
  }
}
