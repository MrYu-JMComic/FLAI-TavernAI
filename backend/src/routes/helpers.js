/**
 * Shared helper functions for route modules.
 * These were extracted from server.js during the modularization refactor.
 */

import { normalizeAdvancedSettings, mergeAdvancedSettings } from '../modules/advancedSettings.js';
import { summarizeUsageSnapshots } from '../services/providers.js';

export function parseJson(value, fallback) {
  try {
    return JSON.parse(value || '');
  } catch {
    return fallback;
  }
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

export function mergeConversationAppearance(row) {
  return {
    desktopBackgroundUrl: row.desktop_background_url || '',
    mobileBackgroundUrl: row.mobile_background_url || '',
    customCss: row.custom_css || '',
    customJs: row.custom_js || '',
    statusBarPrompt: row.status_bar_prompt || ''
  };
}

export function getConversationUsage(userId, conversationId, db) {
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

export function withConversationUsage(conversation, userId, db) {
  return {
    ...conversation,
    usage: getConversationUsage(userId, conversation.id, db)
  };
}

export function toMessage(row) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    reasoning: row.reasoning || '',
    usage: parseJson(row.usage_json, null),
    createdAt: row.created_at
  };
}

export function normalizeIdList(ids) {
  if (!Array.isArray(ids)) {
    return [];
  }
  return [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))].slice(0, 100);
}
