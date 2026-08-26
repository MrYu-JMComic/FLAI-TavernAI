/**
 * Shared helper functions for route modules.
 * These were extracted from server.js during the modularization refactor.
 */

import { normalizeAdvancedSettings, mergeAdvancedSettings } from '../modules/advancedSettings.js';
import { summarizeUsageSnapshots } from '../services/providers.js';
import { parseJson } from '../utils/json.js';
import {
  createCursorScope,
  decodeCursor,
  encodeCursor,
  normalizeCursorLimit
} from '../services/cursorPagination.js';
import { measureSync } from '../services/performanceMetrics.js';

export { parseJson };

/**
 * Override the model in provider settings if a valid override is provided.
 */
export function withModelOverride(settings, modelOverride) {
  const model = String(modelOverride || '').trim();
  return model ? { ...settings, model } : settings;
}

/**
 * Write a single SSE event to the response stream.
 * Safe to call after response is destroyed (no-op).
 */
export function writeSse(response, event, data) {
  if (!response || response.destroyed || response.writableEnded) {
    return Promise.resolve(false);
  }

  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  try {
    const flushed = response.write(frame);
    response.flush?.();
    if (flushed) {
      return Promise.resolve(true);
    }
    return waitForResponseDrain(response);
  } catch {
    // Response stream may have been destroyed by client disconnect
    return Promise.resolve(false);
  }
}

function waitForResponseDrain(response) {
  if (response.destroyed || response.writableEnded || typeof response.once !== 'function') {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    let settled = false;
    const removeListener = typeof response.off === 'function'
      ? response.off.bind(response)
      : response.removeListener?.bind(response);

    const cleanup = () => {
      if (!removeListener) {
        return;
      }
      removeListener('drain', onDrain);
      removeListener('close', onClose);
      removeListener('error', onError);
      removeListener('finish', onFinish);
    };
    const settle = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };
    const onDrain = () => settle(true);
    const onClose = () => settle(false);
    const onError = () => settle(false);
    const onFinish = () => settle(false);

    response.once('drain', onDrain);
    response.once('close', onClose);
    response.once('error', onError);
    response.once('finish', onFinish);

    if (response.destroyed || response.writableEnded) {
      settle(false);
    }
  });
}

export function toConversation(row, db) {
  const authorAdvancedSettings = normalizeAdvancedSettings(parseJson(row.author_advanced_settings, {}));
  const rawUserAdvancedSettings = {
    ...mergeConversationAppearance(row),
    ...parseJson(row.user_advanced_settings, {})
  };
  const userAdvancedSettings = normalizeAdvancedSettings(rawUserAdvancedSettings);
  const mergedSettings = mergeAdvancedSettings(authorAdvancedSettings, rawUserAdvancedSettings);
  return {
    id: row.id,
    characterId: row.character_id,
    title: row.title,
    chatLorebookId: row.chat_lorebook_id || null,
    settings: mergedSettings,
    authorSettings: authorAdvancedSettings,
    userSettings: userAdvancedSettings,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    character: {
      name: row.character_name,
      avatarUrl: row.avatar_url || ''
    }
  };
}

function mergeConversationAppearance(row) {
  return {
    desktopBackgroundUrl: row.desktop_background_url || '',
    mobileBackgroundUrl: row.mobile_background_url || '',
    customCss: row.custom_css || '',
    customJs: row.custom_js || '',
    statusBarPrompt: row.status_bar_prompt || ''
  };
}

function getConversationUsage(userId, conversationId, db) {
  const rows = db
    .prepare(
      `SELECT usage_json FROM messages
       WHERE user_id = ? AND conversation_id = ? AND usage_json IS NOT NULL`
    )
    .all(userId, conversationId);

  const usages = [];
  for (const row of rows) {
    const usage = parseJson(row.usage_json, null);
    if (usage) {
      usages.push(usage);
    }
  }

  return summarizeUsageSnapshots(usages);
}

export function withConversationUsage(conversation, userId, db) {
  return {
    ...conversation,
    usage: getConversationUsage(userId, conversation.id, db)
  };
}

export function getConversationUsageSummaries(db, userId, conversationIds = null) {
  const ids = Array.isArray(conversationIds) ? [...new Set(conversationIds.filter(Boolean))] : null;
  if (ids && !ids.length) return new Map();
  const params = [userId];
  const idClause = ids ? ` AND conversation_id IN (${ids.map(() => '?').join(', ')})` : '';
  if (ids) params.push(...ids);
  const rows = db
    .prepare(
      `SELECT conversation_id, usage_json FROM messages
       WHERE user_id = ? AND usage_json IS NOT NULL${idClause}`
    )
    .all(...params);

  const buckets = new Map();
  for (const row of rows) {
    const usage = parseJson(row.usage_json, null);
    if (!usage) {
      continue;
    }
    let bucket = buckets.get(row.conversation_id);
    if (!bucket) {
      bucket = [];
      buckets.set(row.conversation_id, bucket);
    }
    bucket.push(usage);
  }

  const summaries = new Map();
  for (const [conversationId, usages] of buckets) {
    summaries.set(conversationId, summarizeUsageSnapshots(usages));
  }
  return summaries;
}

export function emptyUsageSummary() {
  return summarizeUsageSnapshots([]);
}

export function getConversationForUser(db, userId, conversationId, options = {}) {
  const row = db
    .prepare(
      `SELECT conversations.*, characters.name AS character_name, characters.avatar_url, characters.author_advanced_settings
       FROM conversations
       JOIN characters ON characters.id = conversations.character_id
       WHERE conversations.user_id = ? AND conversations.id = ?`
    )
    .get(userId, conversationId);
  if (!row) {
    return null;
  }
  const conversation = toConversation(row, db);
  // The generation hot path only needs authorization + settings; skip the
  // O(messages) usage aggregation there via includeUsage: false.
  if (options.includeUsage === false) {
    return conversation;
  }
  return withConversationUsage(conversation, userId, db);
}

export function toMessage(row) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    attachments: parseJson(row.attachments_json, []),
    reasoning: row.reasoning || '',
    usage: parseJson(row.usage_json, null),
    createdAt: row.created_at
  };
}

export function isDisplayableMessageRow(row = {}) {
  if (row.role !== 'assistant') {
    return true;
  }
  return Boolean(String(row.content || '').trim() || String(row.reasoning || '').trim());
}

export function listConversationMessages(db, userId, conversationId) {
  const rows = db
    .prepare(
      `SELECT * FROM messages
       WHERE user_id = ? AND conversation_id = ?
       ORDER BY created_at ASC, rowid ASC`
    )
    .all(userId, conversationId);
  const messages = [];
  for (const row of rows) {
    if (isDisplayableMessageRow(row)) {
      messages.push(toMessage(row));
    }
  }
  return messages;
}

export function listConversationMessagePage(db, userId, conversationId, options = {}) {
  const limit = normalizeCursorLimit(options.limit);
  const scope = createCursorScope('conversation-messages', { userId, conversationId });
  const params = [userId, conversationId];
  let cursorClause = '';
  if (options.cursor) {
    const [createdAt, rowId] = decodeCursor(options.cursor, scope, { values: 2 });
    cursorClause = ' AND (created_at < ? OR (created_at = ? AND rowid < ?))';
    params.push(createdAt, createdAt, rowId);
  }
  params.push(limit + 1);
  const rows = measureSync('sqlite.messages.list', () => db.prepare(
    `SELECT *, rowid AS _cursor_rowid FROM messages
     WHERE user_id = ? AND conversation_id = ?
       AND (role <> 'assistant' OR TRIM(content) <> '' OR TRIM(reasoning) <> '')
       ${cursorClause}
     ORDER BY created_at DESC, rowid DESC
     LIMIT ?`
  ).all(...params));
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const oldest = pageRows.at(-1);
  const messages = [];
  for (let index = pageRows.length - 1; index >= 0; index -= 1) {
    messages.push(toMessage(pageRows[index]));
  }
  return {
    messages,
    nextCursor: hasMore && oldest
      ? encodeCursor(scope, [oldest.created_at, Number(oldest._cursor_rowid)])
      : ''
  };
}

export function getConversationMessage(db, userId, conversationId, messageId) {
  const row = db
    .prepare(
      `SELECT * FROM messages
       WHERE user_id = ? AND conversation_id = ? AND id = ?`
    )
    .get(userId, conversationId, messageId);
  return row ? toMessage(row) : null;
}

export function updateConversationTimestamp(db, nowIso, userId, conversationId) {
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ? AND user_id = ?').run(
    nowIso(),
    conversationId,
    userId
  );
}

export function updateConversationMessage(db, nowIso, userId, conversationId, messageId, payload) {
  db.prepare(
    `UPDATE messages
     SET content = ?
     WHERE user_id = ? AND conversation_id = ? AND id = ?`
  ).run(payload.content, userId, conversationId, messageId);
  updateConversationTimestamp(db, nowIso, userId, conversationId);
  return getConversationMessage(db, userId, conversationId, messageId);
}

export function deleteConversationMessage(db, nowIso, userId, conversationId, messageId) {
  const existing = getConversationMessage(db, userId, conversationId, messageId);
  if (!existing) {
    return null;
  }

  const result = db
    .prepare('DELETE FROM messages WHERE user_id = ? AND conversation_id = ? AND id = ?')
    .run(userId, conversationId, messageId);
  if (result.changes > 0) {
    updateConversationTimestamp(db, nowIso, userId, conversationId);
  }
  return result.changes > 0
    ? { deletedId: messageId, deletedReasoning: Boolean(existing.reasoning) }
    : null;
}

export function listRecentConversationMessageRows(db, userId, conversationId) {
  const rows = db
    .prepare(
      `SELECT role, content, attachments_json, reasoning, created_at
       FROM messages
       WHERE user_id = ? AND conversation_id = ?
       ORDER BY created_at DESC, rowid DESC
       LIMIT 20`
    )
    .all(userId, conversationId);
  const recentMessages = [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (isDisplayableMessageRow(row)) {
      recentMessages.push(row);
    }
  }
  return recentMessages;
}

export function createConversationMessage(db, newId, nowIso, {
  userId,
  conversationId,
  role,
  content,
  attachments = [],
  reasoning,
  usage
}) {
  const id = newId();
  db.prepare(
    `INSERT INTO messages (id, user_id, conversation_id, role, content, attachments_json, reasoning, usage_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    userId,
    conversationId,
    role,
    content,
    JSON.stringify(Array.isArray(attachments) ? attachments : []),
    reasoning || '',
    usage ? JSON.stringify(usage) : null,
    nowIso()
  );

  return toMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(id));
}

export function normalizeIdList(ids) {
  if (!Array.isArray(ids)) {
    return [];
  }

  const normalizedIds = [];
  const seenIds = new Set();
  for (const id of ids) {
    const normalizedId = String(id || '').trim();
    if (!normalizedId || seenIds.has(normalizedId)) {
      continue;
    }

    seenIds.add(normalizedId);
    normalizedIds.push(normalizedId);
    if (normalizedIds.length >= 100) {
      break;
    }
  }

  return normalizedIds;
}

export function getChatProviderSettingsFromContext(ctx, userId) {
  if (typeof ctx.getChatProviderSettings === 'function') {
    return ctx.getChatProviderSettings(userId);
  }

  const settings = ctx.providerWithSecret(ctx.getProviderRow(userId));
  if (settings.apiKeyError) {
    return { ok: false, error: settings.apiKeyError };
  }
  const providerReady = ctx.hasUsableProvider(settings);
  if (!settings.apiKey && !providerReady) {
    if (ctx.mockProviderEnabled) {
      return { ok: true, value: mockProviderSettings(settings) };
    }
    return { ok: false, error: '请先在用户页保存 API Key / SK，再开始真实对话。' };
  }
  if (!providerReady) {
    return { ok: false, error: 'AI 供应商配置不完整，请检查网关地址、模型和 API Key。' };
  }
  return { ok: true, value: settings };
}

function mockProviderSettings(settings = {}) {
  return {
    ...settings,
    providerType: 'mock',
    gatewayName: 'Local Mock',
    baseUrl: '',
    model: 'local-mock',
    apiKey: '',
    apiKeyError: null,
    supportsReasoning: false,
    extraBody: {}
  };
}
