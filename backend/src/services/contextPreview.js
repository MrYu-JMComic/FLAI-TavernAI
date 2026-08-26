import { getCharacter } from '../modules/characters.js';
import { normalizeAdvancedSettings } from '../modules/advancedSettings.js';
import { getDefaultPreset, getPreset } from '../modules/presets.js';
import { parseJson } from '../utils/json.js';
import { resolveChatAttachmentsForModel } from './chatAttachments.js';
import { createDiagnosticId } from './conversationGenerationDiagnostics.js';
import { describeProviderCapabilities } from './providerCapabilities.js';
import { searchUserContent } from './fullTextSearch.js';
import { measureSync } from './performanceMetrics.js';
import { getSelectedProviderProfileRow } from '../repositories/providerProfileRepository.js';
import {
  PROMPT_PIPELINE_HISTORY_LIMIT,
  buildPromptPipeline,
  sanitizePromptMessagesForPreview
} from './promptPipeline.js';

export function buildConversationContextPreview(database, user, conversationId, payload = {}) {
  return measureSync(
    'context.preview',
    () => buildConversationContextPreviewUnmeasured(database, user, conversationId, payload),
    { rows: (result) => (result?.messages?.length || 0) + (result?.retrieval?.returned || 0) }
  );
}

function buildConversationContextPreviewUnmeasured(database, user, conversationId, payload = {}) {
  const conversation = getConversation(database, user.id, conversationId);
  if (!conversation) {
    return null;
  }
  const character = getCharacter(database, user.id, conversation.characterId);
  if (!character) {
    return null;
  }

  const activePreset = getPreviewPreset(database, user.id, payload);
  const pipeline = buildPromptPipeline(database, {
    character,
    conversation,
    user,
    content: payload.content || payload.message || '',
    userAttachments: resolveChatAttachmentsForModel(database, user.id, payload.attachments),
    history: getRecentMessages(database, user.id, conversation.id),
    activePreset,
    contextBudgetCharacters: payload.contextBudgetCharacters ?? payload.contextBudgetChars ?? payload.contextBudget,
    // Preview must not consume sticky/cooldown/delay state or advance the message counter.
    persistWorldBookState: false,
    resolveAttachmentsForModel: (attachments) => resolveChatAttachmentsForModel(database, user.id, attachments)
  });
  const providerDiagnostics = buildProviderDiagnostics(database, user.id);
  const retrievalQuery = String(payload.searchQuery || pipeline.input || '').trim();
  const retrieval = searchUserContent(database, user.id, retrievalQuery, {
    conversationId: conversation.id,
    limit: payload.searchLimit || 12
  });

  return {
    conversationId: conversation.id,
    character: {
      id: character.id,
      name: character.name
    },
    input: pipeline.input,
    messages: sanitizePromptMessagesForPreview(pipeline.messages),
    sections: pipeline.sections,
    priority: pipeline.priority,
    budget: pipeline.budget,
    retrieval: {
      query: retrieval.query,
      evidence: retrieval.results,
      budget: payload.searchLimit || 12,
      sources: retrieval.sources,
      returned: retrieval.results.length,
      truncated: retrieval.truncated,
      truncationReason: retrieval.truncationReason
    },
    providerDiagnostics,
    diagnostics: {
      ...pipeline.diagnostics,
      providerDiagnosticId: providerDiagnostics.diagnosticId,
      providerConfigured: providerDiagnostics.configured
    }
  };
}

function buildProviderDiagnostics(database, userId) {
  const row = getSelectedProviderProfileRow(database, userId);
  const diagnosticId = createDiagnosticId('context');
  if (!row) {
    return {
      diagnosticId,
      configured: false,
      provider: null,
      capability: null
    };
  }

  const provider = {
    providerType: row.provider_type,
    gatewayName: row.gateway_name,
    model: row.model || '',
    baseUrlHost: safeUrlHost(row.base_url),
    supportsReasoning: Boolean(row.supports_reasoning),
    apiKeySet: Boolean(row.api_key_hint),
    updatedAt: row.updated_at
  };
  return {
    diagnosticId,
    configured: Boolean(row.base_url && row.model),
    provider,
    capability: describeProviderCapabilities(provider.providerType, provider)
  };
}

function getConversation(database, userId, conversationId) {
  const row = database
    .prepare(
      `SELECT conversations.*, characters.name AS character_name, characters.avatar_url,
              characters.author_advanced_settings
       FROM conversations
       JOIN characters ON characters.id = conversations.character_id
       WHERE conversations.id = ? AND conversations.user_id = ?`
    )
    .get(conversationId, userId);
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    userId: row.user_id,
    characterId: row.character_id,
    title: row.title,
    userSettings: normalizeAdvancedSettings(parseJson(row.user_advanced_settings, {})),
    authorSettings: normalizeAdvancedSettings(parseJson(row.author_advanced_settings, {})),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function getRecentMessages(database, userId, conversationId) {
  const rows = database
    .prepare(
      `SELECT role, content, attachments_json, reasoning, created_at
       FROM messages
       WHERE user_id = ? AND conversation_id = ?
       ORDER BY created_at DESC, rowid DESC
       LIMIT ?`
    )
    .all(userId, conversationId, PROMPT_PIPELINE_HISTORY_LIMIT);
  const messages = [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row.role === 'assistant' && !String(row.content || '').trim() && !String(row.reasoning || '').trim()) {
      continue;
    }
    messages.push({
      role: row.role,
      content: row.content,
      attachments: parseJson(row.attachments_json, [])
    });
  }
  return messages;
}

function getPreviewPreset(database, userId, payload = {}) {
  const presetId = String(payload.presetId || '').trim();
  return presetId
    ? getPreset(database, userId, presetId)
    : getDefaultPreset(database, userId);
}

function safeUrlHost(value) {
  try {
    return value ? new URL(String(value)).host : '';
  } catch {
    return '';
  }
}
