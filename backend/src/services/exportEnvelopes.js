import { createCharacter, getCharacter, getRegexRulesByGroup } from '../modules/characters.js';
import { assetIdFromUrl } from '../modules/assets.js';
import { listCharacterImages } from '../modules/characterImages.js';
import { createMod, listMods } from '../modules/mods.js';
import { createPreset, listPresets } from '../modules/presets.js';
import { withSavepoint } from '../modules/savepoint.js';
import { createStatusBarTemplate, listStatusBarTemplates } from '../modules/statusBarTemplates.js';
import { setCharacterTags } from '../modules/tags.js';
import {
  createEntry,
  createWorldBook,
  getWorldBook,
  linkWorldBookToCharacter,
  listWorldBooks
} from '../modules/worldBooks.js';
import { newId } from '../security.js';
import { normalizeBoolean } from '../utils/boolean.js';
import { normalizeFiniteNumber } from '../utils/number.js';
import { normalizeRegexFlags } from '../../../shared/regexFlags.js';

export const exportEnvelopeVersion = 1;

const kindAliases = new Map([
  ['character', 'characters'],
  ['characters', 'characters'],
  ['worldbook', 'world_books'],
  ['worldbooks', 'world_books'],
  ['world-book', 'world_books'],
  ['world-books', 'world_books'],
  ['world_book', 'world_books'],
  ['world_books', 'world_books'],
  ['preset', 'presets'],
  ['presets', 'presets'],
  ['mod', 'mods'],
  ['mods', 'mods'],
  ['regex', 'regex_rules'],
  ['regex-rule', 'regex_rules'],
  ['regex-rules', 'regex_rules'],
  ['regex_rule', 'regex_rules'],
  ['regex_rules', 'regex_rules'],
  ['status-bar-template', 'status_bar_templates'],
  ['status-bar-templates', 'status_bar_templates'],
  ['status_bar_template', 'status_bar_templates'],
  ['status_bar_templates', 'status_bar_templates']
]);

export function normalizeEnvelopeKind(value) {
  const key = String(value || '').trim().toLowerCase();
  return kindAliases.get(key) || '';
}

export function buildExportEnvelope(database, userId, rawKind, options = {}) {
  const kind = normalizeEnvelopeKind(rawKind);
  if (!kind) {
    return null;
  }
  const exportOptions = normalizeExportOptions(options);
  const items = exportItems(database, userId, kind, exportOptions);
  return {
    version: exportEnvelopeVersion,
    kind,
    createdAt: new Date().toISOString(),
    items,
    dependencies: buildEnvelopeDependencies(database, userId, kind, items)
  };
}

export function importExportEnvelope(database, userId, rawKind, payload = {}) {
  const kind = normalizeEnvelopeKind(rawKind);
  if (!kind) {
    return null;
  }
  const items = readEnvelopeItems(kind, payload);
  const result = {
    version: exportEnvelopeVersion,
    kind,
    createdAt: new Date().toISOString(),
    dependencies: normalizeEnvelopeDependencies(payload?.dependencies),
    imported: 0,
    skipped: [],
    items: []
  };

  for (let index = 0; index < items.length; index += 1) {
    try {
      const item = withSavepoint(database, 'sp_envelope_item_import', () => (
        importItem(database, userId, kind, items[index], index)
      ));
      result.imported += 1;
      result.items.push(item);
    } catch (error) {
      result.skipped.push({ index, reason: error?.message || 'import failed' });
    }
  }

  return result;
}

function exportItems(database, userId, kind, options = {}) {
  if (kind === 'characters') {
    return listCharacterEnvelopeItems(database, userId, options.ids);
  }
  if (kind === 'world_books') {
    return listWorldBookEnvelopeItems(database, userId);
  }
  if (kind === 'presets') {
    return listPresets(database, userId);
  }
  if (kind === 'mods') {
    return listMods(database, userId);
  }
  if (kind === 'regex_rules') {
    return getRegexRulesByGroup(database, userId, null);
  }
  if (kind === 'status_bar_templates') {
    return listStatusBarTemplateEnvelopeItems(database, userId);
  }
  return [];
}

function importItem(database, userId, kind, item, index) {
  if (kind === 'characters') {
    return importCharacterItem(database, userId, item);
  }
  if (kind === 'world_books') {
    return importWorldBookItem(database, userId, item);
  }
  if (kind === 'presets') {
    return { id: createPreset(database, userId, item).id };
  }
  if (kind === 'mods') {
    return { id: createMod(database, userId, normalizeModImportItem(database, userId, item)).id };
  }
  if (kind === 'regex_rules') {
    return importRegexRuleItem(database, userId, item, index);
  }
  if (kind === 'status_bar_templates') {
    return { id: createStatusBarTemplate(database, userId, item).id };
  }
  throw new Error('unsupported envelope kind');
}

function readEnvelopeItems(kind, payload = {}) {
  const source = payload && typeof payload === 'object' ? payload : {};
  validateEnvelopeVersion(source);
  const payloadKind = normalizeEnvelopeKind(source.kind);
  if (payloadKind && payloadKind !== kind) {
    throw new Error('envelope kind does not match route kind');
  }
  if (Array.isArray(source.items)) {
    return source.items;
  }
  if (Array.isArray(payload)) {
    return payload;
  }
  return [source].filter((item) => item && typeof item === 'object');
}

function validateEnvelopeVersion(source = {}) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return;
  }
  if (source.version === undefined || source.version === null || source.version === '') {
    return;
  }
  if (Number(source.version) !== exportEnvelopeVersion) {
    throw new Error(`unsupported envelope version: ${source.version}`);
  }
}

function listCharacterEnvelopeItems(database, userId, requestedIds = []) {
  const ids = normalizeExportIds(requestedIds);
  const query = ids.length
    ? `SELECT id FROM characters
       WHERE user_id = ? AND id IN (${ids.map(() => '?').join(', ')})
       ORDER BY created_at ASC, rowid ASC`
    : 'SELECT id FROM characters WHERE user_id = ? ORDER BY created_at ASC, rowid ASC';
  const rows = database
    .prepare(query)
    .all(userId, ...ids);
  const items = [];
  for (const row of rows) {
    const character = getCharacter(database, userId, row.id);
    if (!character) {
      continue;
    }
    items.push({
      id: character.id,
      name: character.name,
      avatarUrl: character.avatarUrl || '',
      gender: character.gender || '',
      age: character.age || '',
      background: character.background || '',
      worldview: character.worldview || '',
      persona: character.persona || '',
      openingMessage: character.openingMessage || '',
      visibility: character.visibility || 'private',
      tags: listCharacterTagNames(database, userId, character.id, character.tags),
      renderPlugins: character.renderPlugins || [],
      authorAdvancedSettings: character.authorAdvancedSettings || {},
      regexRules: character.regexRules || [],
      images: listCharacterImages(database, character.id),
      worldBooks: listCharacterWorldBookEnvelopeReferences(database, userId, character.id),
      createdAt: character.createdAt,
      updatedAt: character.updatedAt
    });
  }
  return items;
}

function normalizeExportOptions(options = {}) {
  return {
    ids: normalizeExportIds(options.ids ?? options.id)
  };
}

function normalizeExportIds(value) {
  const ids = [];
  const seen = new Set();
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  for (const raw of source) {
    const id = String(raw || '').trim();
    if (!id || seen.has(id)) {
      continue;
    }
    ids.push(id);
    seen.add(id);
  }
  return ids;
}

function listCharacterTagNames(database, userId, characterId, fallback = []) {
  const rows = database
    .prepare(
      `SELECT tags.name
       FROM character_tags
       JOIN tags ON tags.id = character_tags.tag_id
       WHERE character_tags.character_id = ? AND tags.user_id = ?
       ORDER BY tags.name COLLATE NOCASE ASC, tags.name ASC, tags.rowid ASC`
    )
    .all(characterId, userId);
  if (rows.length) {
    return rows.map((row) => row.name);
  }
  return Array.isArray(fallback) ? fallback : [];
}

function listWorldBookEnvelopeItems(database, userId) {
  const books = listWorldBooks(database, userId);
  const items = [];
  for (const book of books) {
    const item = getWorldBook(database, userId, book.id);
    if (!item) {
      continue;
    }
    items.push({
      ...item,
      linkedCharacters: listWorldBookLinkedCharacterEnvelopeReferences(database, userId, book.id)
    });
  }
  return items;
}

function listWorldBookLinkedCharacterEnvelopeReferences(database, userId, worldBookId) {
  return database
    .prepare(
      `SELECT characters.id, characters.name, character_world_books.order_index,
              character_world_books.created_at
       FROM character_world_books
       JOIN characters ON characters.id = character_world_books.character_id
       WHERE character_world_books.world_book_id = ? AND characters.user_id = ?
       ORDER BY character_world_books.order_index ASC, character_world_books.created_at ASC, character_world_books.rowid ASC`
    )
    .all(worldBookId, userId)
    .map((row) => ({
      characterId: row.id,
      name: row.name || '',
      orderIndex: normalizeFiniteNumber(row.order_index, 0),
      createdAt: row.created_at
    }));
}

function listCharacterWorldBookEnvelopeReferences(database, userId, characterId) {
  return database
    .prepare(
      `SELECT world_books.id, world_books.name, character_world_books.order_index,
              character_world_books.created_at
       FROM character_world_books
       JOIN world_books ON world_books.id = character_world_books.world_book_id
       WHERE character_world_books.character_id = ? AND world_books.user_id = ?
       ORDER BY character_world_books.order_index ASC, character_world_books.created_at ASC, character_world_books.rowid ASC`
    )
    .all(characterId, userId)
    .map((row) => ({
      id: row.id,
      name: row.name || '',
      linkOrder: normalizeFiniteNumber(row.order_index, 0),
      createdAt: row.created_at
    }));
}

function listStatusBarTemplateEnvelopeItems(database, userId) {
  const items = listStatusBarTemplates(database, userId).map((template) => ({
    ...template,
    source: 'library'
  }));
  const rows = database
    .prepare(
      `SELECT status_bars.conversation_id, status_bars.name, status_bars.variables,
              status_bars.template, status_bars.created_at, status_bars.updated_at
       FROM status_bars
       JOIN conversations ON conversations.id = status_bars.conversation_id
       WHERE conversations.user_id = ?
       ORDER BY status_bars.updated_at DESC, status_bars.rowid DESC`
    )
    .all(userId);
  for (const row of rows) {
    items.push({
      conversationId: row.conversation_id,
      name: row.name || '状态栏模板',
      variables: parseVariables(row.variables),
      template: row.template || '',
      source: 'conversation',
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  }
  return items;
}

function importCharacterItem(database, userId, item = {}) {
  const source = item.character && typeof item.character === 'object' ? item.character : item;
  const character = createCharacter(database, userId, {
    name: source.name,
    avatarUrl: source.avatarUrl || source.avatar_url || source.avatarDataUrl || source.avatar_data_url || '',
    gender: source.gender || '',
    age: source.age || '',
    background: source.background || '',
    worldview: source.worldview || '',
    persona: source.persona || '',
    openingMessage: source.openingMessage || source.opening_message || '',
    visibility: 'private',
    renderPlugins: source.renderPlugins || source.render_plugins || [],
    authorAdvancedSettings: source.authorAdvancedSettings || source.author_advanced_settings || {},
    regexRules: item.regexRules || item.regex_rules || source.regexRules || [],
    tags: item.tags || source.tags || []
  });
  setCharacterTags(database, userId, character.id, item.tags || source.tags || []);

  const worldBook = item.worldBook || item.world_book;
  if (worldBook?.name) {
    importWorldBookItem(database, userId, {
      ...worldBook,
      characterId: character.id,
      linkedCharacters: [character.id]
    });
  }

  return { id: character.id };
}

function importWorldBookItem(database, userId, item = {}) {
  const characterId = resolveOwnedCharacterId(database, userId, item.characterId || item.character_id);
  const book = createWorldBook(database, userId, {
    name: item.name,
    description: item.description || '',
    characterId,
    scanDepth: item.scanDepth ?? item.scan_depth,
    lorebookContextPercent: item.lorebookContextPercent ?? item.lorebook_context_percent
  });

  const entries = Array.isArray(item.entries) ? item.entries : [];
  for (const entry of entries) {
    createEntry(database, userId, book.id, normalizeWorldBookEntryImportItem(entry));
  }

  const linkedCharacters = Array.isArray(item.linkedCharacters) ? item.linkedCharacters : [];
  for (const linked of linkedCharacters) {
    const linkedId = resolveOwnedCharacterId(database, userId, linked?.characterId || linked?.id || linked);
    if (linkedId) {
      linkWorldBookToCharacter(
        database,
        book.id,
        linkedId,
        normalizeFiniteNumber(linked?.orderIndex ?? linked?.linkOrder, 0),
        userId
      );
    }
  }

  return { id: book.id };
}

function normalizeWorldBookEntryImportItem(entry = {}) {
  return {
    name: entry.name || '',
    triggerKeys: entry.triggerKeys || entry.trigger_keys || '',
    content: entry.content || '',
    position: entry.position || 'before_char',
    enabled: normalizeBoolean(entry.enabled, true),
    orderIndex: normalizeFiniteNumber(entry.orderIndex ?? entry.order_index, 0),
    regexMode: normalizeBoolean(entry.regexMode ?? entry.regex_mode),
    alwaysActive: normalizeBoolean(entry.alwaysActive ?? entry.always_active),
    depth: normalizeFiniteNumber(entry.depth, 0),
    selective: normalizeBoolean(entry.selective),
    selectiveLogic: normalizeFiniteNumber(entry.selectiveLogic ?? entry.selective_logic, 0),
    keysSecondary: entry.keysSecondary || entry.keys_secondary || '',
    probability: normalizeFiniteNumber(entry.probability, 100),
    useProbability: normalizeBoolean(entry.useProbability ?? entry.use_probability),
    group: entry.group || entry.inclusion_group || '',
    groupWeight: normalizeFiniteNumber(entry.groupWeight ?? entry.group_weight, 0),
    role: normalizeFiniteNumber(entry.role, 0),
    sticky: entry.sticky,
    cooldown: entry.cooldown,
    delay: entry.delay
  };
}

function normalizeModImportItem(database, userId, item = {}) {
  const characterIds = [];
  const sourceIds = Array.isArray(item.characterIds) ? item.characterIds : [];
  for (const rawId of sourceIds) {
    const characterId = resolveOwnedCharacterId(database, userId, rawId);
    if (characterId) {
      characterIds.push(characterId);
    }
  }
  const scope = item.scope === 'characters' && !characterIds.length ? 'global' : item.scope;
  return {
    ...item,
    scope,
    characterIds
  };
}

function importRegexRuleItem(database, userId, item = {}, index = 0) {
  const rule = normalizeRegexRuleImportItem(item, index);
  if (!rule.characterId) {
    throw new Error('regex rule requires characterId');
  }
  if (!resolveOwnedCharacterId(database, userId, rule.characterId)) {
    throw new Error('regex rule character is not owned by the user');
  }

  withSavepoint(database, 'sp_envelope_regex_import', () => {
    database
      .prepare(
        `INSERT INTO regex_rules (
          id, user_id, character_id, label, pattern, replacement, flags, scope,
          enabled, order_index, group_name, priority, script_mode, js_script
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        newId(),
        userId,
        rule.characterId,
        rule.label,
        rule.pattern,
        rule.replacement,
        rule.flags,
        rule.scope,
        rule.enabled ? 1 : 0,
        rule.orderIndex,
        rule.groupName,
        rule.priority,
        rule.scriptMode ? 1 : 0,
        rule.jsScript
      );
  });
  return { characterId: rule.characterId };
}

function normalizeRegexRuleImportItem(item = {}, index = 0) {
  const flags = normalizeRegexFlags(item.flags);
  const pattern = String(item.pattern || '').trim();
  if (!pattern) {
    throw new Error('regex rule requires pattern');
  }
  new RegExp(pattern, flags);
  return {
    characterId: String(item.characterId || item.character_id || '').trim(),
    label: String(item.label || item.name || `Imported rule ${index + 1}`).trim().slice(0, 100),
    pattern,
    replacement: String(item.replacement || '').slice(0, 5000),
    flags,
    scope: ['input', 'output', 'both'].includes(item.scope) ? item.scope : 'input',
    enabled: normalizeBoolean(item.enabled, true),
    orderIndex: Math.max(0, Math.round(normalizeFiniteNumber(item.orderIndex ?? item.order_index, index))),
    groupName: String(item.groupName || item.group_name || '全局').trim().slice(0, 50) || '全局',
    priority: Math.max(0, Math.round(normalizeFiniteNumber(item.priority, index))),
    scriptMode: normalizeBoolean(item.scriptMode ?? item.script_mode),
    jsScript: String(item.jsScript || item.js_script || '').slice(0, 10000)
  };
}

function resolveOwnedCharacterId(database, userId, value) {
  const characterId = String(value || '').trim();
  if (!characterId) {
    return null;
  }
  const row = database
    .prepare('SELECT id FROM characters WHERE id = ? AND user_id = ?')
    .get(characterId, userId);
  return row?.id || null;
}

function parseVariables(value) {
  if (Array.isArray(value)) {
    return value;
  }
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildEnvelopeDependencies(database, userId, kind, items) {
  const dependencies = {};
  if (kind === 'characters') {
    addCharacterEnvelopeDependencies(database, userId, dependencies, items);
  } else if (kind === 'world_books') {
    addCharacterReferencesDependency(database, userId, dependencies, collectWorldBookCharacterIds(items));
  } else if (kind === 'mods') {
    addCharacterReferencesDependency(database, userId, dependencies, collectBoundCharacterIds(items));
  } else if (kind === 'regex_rules') {
    addCharacterReferencesDependency(database, userId, dependencies, collectRegexCharacterIds(items));
  }
  return dependencies;
}

function addCharacterEnvelopeDependencies(database, userId, dependencies, items) {
  const assetIds = new Set();
  const avatarAssetIds = new Set();
  const worldBookIds = new Set();
  for (const item of items) {
    collectAssetUrl(item.avatarUrl, assetIds, avatarAssetIds);
    collectAssetUrlsFromAdvancedSettings(item.authorAdvancedSettings, assetIds, avatarAssetIds);
    for (const image of Array.isArray(item.images) ? item.images : []) {
      collectAssetUrl(image?.imageUrl, assetIds, avatarAssetIds);
    }
    for (const book of Array.isArray(item.worldBooks) ? item.worldBooks : []) {
      const id = String(book?.id || '').trim();
      if (id) {
        worldBookIds.add(id);
      }
    }
  }
  addAssetDependencies(database, userId, dependencies, assetIds, avatarAssetIds);
  const worldBooks = listWorldBookDependencySummaries(database, userId, worldBookIds);
  if (worldBooks.length) {
    dependencies.worldBooks = worldBooks;
  }
}

function collectAssetUrlsFromAdvancedSettings(value, assetIds, avatarAssetIds) {
  if (!value || typeof value !== 'object') {
    return;
  }
  collectAssetUrl(value.desktopBackgroundUrl, assetIds, avatarAssetIds);
  collectAssetUrl(value.mobileBackgroundUrl, assetIds, avatarAssetIds);
}

function collectAssetUrl(value, assetIds, avatarAssetIds) {
  const text = String(value || '').trim();
  const assetId = assetIdFromUrl(text);
  if (assetId) {
    assetIds.add(assetId);
    return;
  }
  const avatarAssetId = avatarAssetIdFromUrl(text);
  if (avatarAssetId) {
    avatarAssetIds.add(avatarAssetId);
  }
}

function avatarAssetIdFromUrl(value) {
  const match = String(value || '').trim().match(/^\/api\/avatars\/([^/?#]+)$/);
  return match ? match[1] : '';
}

function addAssetDependencies(database, userId, dependencies, assetIds, avatarAssetIds) {
  const assets = listAssetDependencySummaries(database, userId, assetIds);
  const avatarAssets = listAvatarAssetDependencySummaries(database, userId, avatarAssetIds);
  if (assets.length) {
    dependencies.assets = assets;
  }
  if (avatarAssets.length) {
    dependencies.avatarAssets = avatarAssets;
  }
}

function listAssetDependencySummaries(database, userId, ids) {
  const source = Array.from(ids || []);
  if (!source.length) {
    return [];
  }
  const placeholders = source.map(() => '?').join(', ');
  return database
    .prepare(
      `SELECT id, owner_type, owner_id, kind, mime_type, name, alt, byte_size, created_at, updated_at
       FROM assets
       WHERE user_id = ? AND id IN (${placeholders})
       ORDER BY created_at ASC, rowid ASC`
    )
    .all(userId, ...source)
    .map((row) => ({
      id: row.id,
      ownerType: row.owner_type || '',
      ownerId: row.owner_id || '',
      kind: row.kind || 'generic',
      mimeType: row.mime_type,
      name: row.name || '',
      alt: row.alt || '',
      byteSize: Number(row.byte_size || 0),
      url: `/api/assets/${row.id}`,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
}

function listAvatarAssetDependencySummaries(database, userId, ids) {
  const source = Array.from(ids || []);
  if (!source.length) {
    return [];
  }
  const placeholders = source.map(() => '?').join(', ');
  return database
    .prepare(
      `SELECT id, owner_type, owner_id, mime_type, byte_size, created_at, updated_at
       FROM avatar_assets
       WHERE user_id = ? AND id IN (${placeholders})
       ORDER BY created_at ASC, rowid ASC`
    )
    .all(userId, ...source)
    .map((row) => ({
      id: row.id,
      ownerType: row.owner_type || '',
      ownerId: row.owner_id || '',
      mimeType: row.mime_type,
      byteSize: Number(row.byte_size || 0),
      url: `/api/avatars/${row.id}`,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
}

function collectWorldBookCharacterIds(items) {
  const ids = new Set();
  for (const item of items) {
    addId(ids, item?.characterId);
    for (const linked of Array.isArray(item?.linkedCharacters) ? item.linkedCharacters : []) {
      addId(ids, linked?.characterId || linked?.id || linked);
    }
  }
  return ids;
}

function collectBoundCharacterIds(items) {
  const ids = new Set();
  for (const item of items) {
    for (const characterId of Array.isArray(item?.characterIds) ? item.characterIds : []) {
      addId(ids, characterId);
    }
  }
  return ids;
}

function collectRegexCharacterIds(items) {
  const ids = new Set();
  for (const item of items) {
    addId(ids, item?.characterId);
  }
  return ids;
}

function addId(ids, value) {
  const id = String(value || '').trim();
  if (id) {
    ids.add(id);
  }
}

function addCharacterReferencesDependency(database, userId, dependencies, ids) {
  const characters = listCharacterDependencySummaries(database, userId, ids);
  if (characters.length) {
    dependencies.characters = characters;
  }
}

function listCharacterDependencySummaries(database, userId, ids) {
  const source = Array.from(ids || []);
  if (!source.length) {
    return [];
  }
  const placeholders = source.map(() => '?').join(', ');
  return database
    .prepare(
      `SELECT id, name, visibility, created_at, updated_at
       FROM characters
       WHERE user_id = ? AND id IN (${placeholders})
       ORDER BY created_at ASC, rowid ASC`
    )
    .all(userId, ...source)
    .map((row) => ({
      id: row.id,
      name: row.name,
      visibility: row.visibility || 'private',
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
}

function listWorldBookDependencySummaries(database, userId, ids) {
  const source = Array.from(ids || []);
  if (!source.length) {
    return [];
  }
  const placeholders = source.map(() => '?').join(', ');
  return database
    .prepare(
      `SELECT id, name, description, created_at, updated_at
       FROM world_books
       WHERE user_id = ? AND id IN (${placeholders})
       ORDER BY created_at ASC, rowid ASC`
    )
    .all(userId, ...source)
    .map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description || '',
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
}

function normalizeEnvelopeDependencies(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return {};
  }
  return value;
}
