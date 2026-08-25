import { appConfig } from '../config.js';
import { listStatusBarTemplates } from '../modules/statusBarTemplates.js';
import { parseJson } from '../utils/json.js';
import { listProviderCapabilities } from './providerCapabilities.js';
import { buildUserCastSnapshot } from './cast/castSnapshot.js';

const snapshotVersion = 2;

export function buildProjectSnapshot(database, userId) {
  const createdAt = new Date().toISOString();
  const conversations = listConversationSummaries(database, userId);
  return stripSecrets({
    version: snapshotVersion,
    kind: 'project_snapshot',
    createdAt,
    app: {
      serviceName: appConfig.serviceName,
      version: appConfig.version
    },
    items: {
      characters: listCharacters(database, userId),
      characterImages: listCharacterImages(database, userId),
      characterTalents: listCharacterTalents(database, userId),
      worldBooks: listWorldBooks(database, userId),
      presets: listPresets(database, userId),
      mods: listMods(database, userId),
      regexRules: listRegexRules(database, userId),
      statusBars: listStatusBars(database, userId),
      statusBarTemplates: listStatusBarTemplates(database, userId),
      conversations,
      cast: buildUserCastSnapshot(
        database,
        userId,
        conversations.map((conversation) => conversation.id)
      ),
      conversationMemories: listConversationMemories(database, userId),
      economyAccounts: listEconomyAccounts(database, userId),
      saves: listSaveSummaries(database, userId)
    },
    dependencies: {
      assets: listAssets(database, userId),
      avatarAssets: listAvatarAssets(database, userId),
      provider: getProviderSummary(database, userId),
      providerCapabilities: listProviderCapabilities()
    }
  });
}

function listCharacters(database, userId) {
  const rows = database
    .prepare(
      `SELECT id, name, avatar_url, gender, age, background, worldview, persona,
              opening_message, visibility, tags, render_plugins,
              author_advanced_settings, created_at, updated_at, last_used_at
       FROM characters
       WHERE user_id = ?
       ORDER BY created_at ASC, rowid ASC`
    )
    .all(userId);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    avatarUrl: row.avatar_url || '',
    gender: row.gender || '',
    age: row.age || '',
    background: row.background || '',
    worldview: row.worldview || '',
    persona: row.persona || '',
    openingMessage: row.opening_message || '',
    visibility: row.visibility || 'private',
    tags: parseJson(row.tags, []),
    renderPlugins: parseJson(row.render_plugins, []),
    authorAdvancedSettings: parseJson(row.author_advanced_settings, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at || null
  }));
}

function listCharacterImages(database, userId) {
  const rows = database
    .prepare(
      `SELECT character_images.*
       FROM character_images
       JOIN characters ON characters.id = character_images.character_id
       WHERE characters.user_id = ?
       ORDER BY character_images.character_id ASC, character_images.order_index ASC, character_images.created_at ASC`
    )
    .all(userId);
  return rows.map((row) => ({
    id: row.id,
    characterId: row.character_id,
    imageUrl: row.image_url || '',
    sceneTag: row.scene_tag || '',
    emotionTag: row.emotion_tag || '',
    isDefault: Boolean(row.is_default),
    orderIndex: Number(row.order_index || 0),
    createdAt: row.created_at
  }));
}

function listCharacterTalents(database, userId) {
  const rows = database
    .prepare(
      `SELECT character_talents.*
       FROM character_talents
       JOIN characters ON characters.id = character_talents.character_id
       WHERE characters.user_id = ?
       ORDER BY character_talents.character_id ASC, character_talents.rolled_at ASC`
    )
    .all(userId);
  return rows.map((row) => ({
    id: row.id,
    characterId: row.character_id,
    name: row.talent_name,
    rarity: row.talent_rarity || 'common',
    description: row.talent_description || '',
    effect: row.talent_effect || '',
    poolId: row.pool_id || null,
    rolledAt: row.rolled_at
  }));
}

function listWorldBooks(database, userId) {
  const books = database
    .prepare(
      `SELECT id, name, description, character_id, scan_depth,
              lorebook_context_percent, created_at, updated_at
       FROM world_books
       WHERE user_id = ?
       ORDER BY updated_at ASC, rowid ASC`
    )
    .all(userId);
  const result = [];
  const entries = database.prepare(
    `SELECT *
     FROM world_book_entries
     WHERE world_book_id = ?
     ORDER BY order_index ASC, rowid ASC`
  );
  const links = database.prepare(
    `SELECT character_id, order_index, created_at
     FROM character_world_books
     WHERE world_book_id = ?
     ORDER BY order_index ASC, created_at ASC`
  );
  for (const book of books) {
    result.push({
      id: book.id,
      name: book.name,
      description: book.description || '',
      characterId: book.character_id || null,
      scanDepth: Number(book.scan_depth || 1),
      lorebookContextPercent: Number(book.lorebook_context_percent || 25),
      linkedCharacters: links.all(book.id).map((row) => ({
        characterId: row.character_id,
        orderIndex: Number(row.order_index || 0),
        createdAt: row.created_at
      })),
      entries: entries.all(book.id).map(toWorldBookEntry),
      createdAt: book.created_at,
      updatedAt: book.updated_at
    });
  }
  return result;
}

function toWorldBookEntry(row) {
  return {
    id: row.id,
    name: row.name || '',
    triggerKeys: row.trigger_keys || '',
    content: row.content || '',
    position: row.position || 'before_char',
    enabled: Boolean(row.enabled),
    orderIndex: Number(row.order_index || 0),
    regexMode: Boolean(row.regex_mode),
    alwaysActive: Boolean(row.always_active),
    depth: Number(row.depth || 0),
    selective: Boolean(row.selective),
    selectiveLogic: Number(row.selective_logic || 0),
    keysSecondary: row.keys_secondary || '',
    probability: Number(row.probability || 100),
    useProbability: Boolean(row.use_probability),
    group: row.inclusion_group || '',
    groupWeight: Number(row.group_weight || 0),
    role: Number(row.role || 0),
    sticky: row.sticky ?? null,
    cooldown: row.cooldown ?? null,
    delay: row.delay ?? null,
    createdAt: row.created_at
  };
}

function listPresets(database, userId) {
  const rows = database
    .prepare(
      `SELECT id, name, system_prompt, temperature, max_tokens, top_p,
              frequency_penalty, presence_penalty, is_default, created_at, updated_at
       FROM presets
       WHERE user_id = ?
       ORDER BY is_default DESC, updated_at ASC, rowid ASC`
    )
    .all(userId);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    systemPrompt: row.system_prompt || '',
    temperature: Number(row.temperature),
    maxTokens: Number(row.max_tokens),
    topP: Number(row.top_p),
    frequencyPenalty: Number(row.frequency_penalty),
    presencePenalty: Number(row.presence_penalty),
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

function listMods(database, userId) {
  const rows = database
    .prepare(
      `SELECT id, name, description, type, content, enabled, scope,
              character_ids, order_index, created_at
       FROM mods
       WHERE user_id = ?
       ORDER BY order_index ASC, created_at ASC, rowid ASC`
    )
    .all(userId);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description || '',
    type: row.type || 'prompt_inject',
    content: row.content || '',
    enabled: Boolean(row.enabled),
    scope: row.scope || 'global',
    characterIds: parseJson(row.character_ids, []),
    orderIndex: Number(row.order_index || 0),
    createdAt: row.created_at
  }));
}

function listRegexRules(database, userId) {
  const rows = database
    .prepare(
      `SELECT id, character_id, label, pattern, replacement, flags, scope,
              enabled, order_index, group_name, priority, script_mode, js_script
       FROM regex_rules
       WHERE user_id = ?
       ORDER BY group_name ASC, priority ASC, order_index ASC, rowid ASC`
    )
    .all(userId);
  return rows.map((row) => ({
    id: row.id,
    characterId: row.character_id || '',
    label: row.label || '',
    pattern: row.pattern || '',
    replacement: row.replacement || '',
    flags: row.flags || 'g',
    scope: row.scope || 'input',
    enabled: Boolean(row.enabled),
    orderIndex: Number(row.order_index || 0),
    groupName: row.group_name || '全局',
    priority: Number(row.priority || 0),
    scriptMode: Boolean(row.script_mode),
    jsScript: row.js_script || ''
  }));
}

function listStatusBars(database, userId) {
  const rows = database
    .prepare(
      `SELECT status_bars.*
       FROM status_bars
       JOIN conversations ON conversations.id = status_bars.conversation_id
       WHERE conversations.user_id = ?
       ORDER BY status_bars.updated_at ASC, status_bars.rowid ASC`
    )
    .all(userId);
  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    name: row.name || '状态栏',
    variables: parseJson(row.variables, []),
    template: row.template || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

function listConversationSummaries(database, userId) {
  const rows = database
    .prepare(
      `SELECT conversations.*,
              COUNT(messages.id) AS message_count,
              MAX(messages.created_at) AS last_message_at
       FROM conversations
       LEFT JOIN messages ON messages.conversation_id = conversations.id
       WHERE conversations.user_id = ?
       GROUP BY conversations.id
       ORDER BY conversations.updated_at ASC, conversations.rowid ASC`
    )
    .all(userId);
  return rows.map((row) => ({
    id: row.id,
    characterId: row.character_id,
    title: row.title,
    desktopBackgroundUrl: row.desktop_background_url || '',
    mobileBackgroundUrl: row.mobile_background_url || '',
    hasCustomCss: Boolean(row.custom_css),
    hasCustomJs: Boolean(row.custom_js),
    userAdvancedSettings: parseJson(row.user_advanced_settings, {}),
    chatLorebookId: row.chat_lorebook_id || null,
    branchedFromId: row.branched_from_id || null,
    branchedFromMessageId: row.branched_from_message_id || null,
    branchedFromTitle: row.branched_from_title || '',
    messageCount: Number(row.message_count || 0),
    lastMessageAt: row.last_message_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

function listConversationMemories(database, userId) {
  const rows = database
    .prepare(
      `SELECT id, conversation_id, memory_type, subject, content, confidence,
              source_message_id, source_kind, source_excerpt,
              enabled, archived, created_at, updated_at
       FROM conversation_memories
       WHERE user_id = ?
       ORDER BY conversation_id ASC, updated_at ASC`
    )
    .all(userId);
  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    memoryType: row.memory_type || 'event',
    subject: row.subject || '',
    content: row.content || '',
    confidence: Number(row.confidence || 0),
    sourceMessageId: row.source_message_id || '',
    sourceKind: row.source_kind || 'manual',
    sourceExcerpt: row.source_excerpt || '',
    enabled: Boolean(row.enabled),
    archived: Boolean(row.archived),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

function listEconomyAccounts(database, userId) {
  const rows = database
    .prepare(
      `SELECT id, conversation_id, currency_type, balance, created_at, updated_at
       FROM economy_accounts
       WHERE user_id = ?
       ORDER BY conversation_id ASC, currency_type ASC`
    )
    .all(userId);
  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    currencyType: row.currency_type || 'gold',
    balance: Number(row.balance || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

function listSaveSummaries(database, userId) {
  const rows = database
    .prepare(
      `SELECT id, conversation_id, name, preview, created_at
       FROM saves
       WHERE user_id = ?
       ORDER BY conversation_id ASC, created_at ASC`
    )
    .all(userId);
  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    name: row.name || '',
    preview: row.preview || '',
    createdAt: row.created_at
  }));
}

function listAssets(database, userId) {
  const rows = database
    .prepare(
      `SELECT id, owner_type, owner_id, kind, mime_type, name, alt, byte_size,
              metadata_json, created_at, updated_at
       FROM assets
       WHERE user_id = ?
       ORDER BY created_at ASC, rowid ASC`
    )
    .all(userId);
  return rows.map((row) => ({
    id: row.id,
    ownerType: row.owner_type || '',
    ownerId: row.owner_id || '',
    kind: row.kind || 'generic',
    mimeType: row.mime_type,
    name: row.name || '',
    alt: row.alt || '',
    byteSize: Number(row.byte_size || 0),
    metadata: parseJson(row.metadata_json, {}),
    url: `/api/assets/${row.id}`,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

function listAvatarAssets(database, userId) {
  const rows = database
    .prepare(
      `SELECT id, owner_type, owner_id, mime_type, byte_size, created_at, updated_at
       FROM avatar_assets
       WHERE user_id = ?
       ORDER BY created_at ASC, rowid ASC`
    )
    .all(userId);
  return rows.map((row) => ({
    id: row.id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size || 0),
    url: `/api/avatars/${row.id}`,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

function getProviderSummary(database, userId) {
  const row = database
    .prepare(
      `SELECT provider_type, gateway_name, base_url, model, api_key_hint,
              supports_reasoning, extra_body, updated_at
       FROM provider_settings
       WHERE user_id = ?`
    )
    .get(userId);
  if (!row) {
    return null;
  }
  return {
    providerType: row.provider_type,
    gatewayName: row.gateway_name,
    baseUrl: row.base_url || '',
    model: row.model || '',
    apiKeySet: Boolean(row.api_key_hint),
    apiKeyHint: row.api_key_hint || null,
    supportsReasoning: Boolean(row.supports_reasoning),
    extraBody: parseJson(row.extra_body, {}),
    updatedAt: row.updated_at
  };
}

function stripSecrets(value) {
  if (Array.isArray(value)) {
    const cleaned = [];
    for (const item of value) {
      cleaned.push(stripSecrets(item));
    }
    return cleaned;
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const cleaned = {};
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key) || isSecretKey(key)) {
      continue;
    }
    cleaned[key] = stripSecrets(value[key]);
  }
  return cleaned;
}

function isSecretKey(key) {
  const normalized = String(key || '').toLowerCase();
  return normalized.includes('secret') ||
    normalized.includes('encrypted') ||
    normalized === 'apikey' ||
    normalized === 'api_key' ||
    normalized === 'base64data' ||
    normalized === 'base64_data' ||
    normalized === 'dataurl' ||
    normalized === 'data_url';
}
