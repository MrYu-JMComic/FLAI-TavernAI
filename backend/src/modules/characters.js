import { newId, nowIso } from '../security.js';
import { avatarShortUrl, deleteAvatarAsset, saveAvatarInput } from '../services/avatars.js';
import { normalizeAdvancedSettings } from './advancedSettings.js';

const characterColumns = `characters.*,
  avatar_assets.id AS avatar_asset_id,
  (SELECT COUNT(*) FROM character_likes WHERE character_id = characters.id) AS like_count,
  (SELECT COUNT(*) FROM character_favorites WHERE character_id = characters.id) AS favorite_count,
  EXISTS(SELECT 1 FROM character_likes WHERE user_id = ? AND character_id = characters.id) AS liked_by_me,
  EXISTS(SELECT 1 FROM character_favorites WHERE user_id = ? AND character_id = characters.id) AS favorited_by_me`;
const avatarAssetJoin =
  "LEFT JOIN avatar_assets ON avatar_assets.owner_type = 'character' AND avatar_assets.owner_id = characters.id";

export function listCharacters(database, userId, { search = '', sort = 'created', tag = '' } = {}) {
  const query = String(search || '').trim();
  const tagFilter = String(tag || '').trim();
  const params = [userId, userId, userId];
  let sql = `SELECT ${characterColumns} FROM characters ${avatarAssetJoin} WHERE (characters.user_id = ? OR visibility = 'public')`;

  if (query) {
    sql += ' AND (name LIKE ? OR tags LIKE ? OR persona LIKE ? OR background LIKE ?)';
    const like = `%${query}%`;
    params.push(like, like, like, like);
  }

  if (tagFilter) {
    sql += ' AND EXISTS (SELECT 1 FROM character_tags JOIN tags ON tags.id = character_tags.tag_id WHERE character_tags.character_id = characters.id AND tags.name = ?)';
    params.push(tagFilter);
  }

  if (sort === 'used') {
    sql += ' ORDER BY COALESCE(characters.last_used_at, characters.created_at) DESC';
  } else if (sort === 'name') {
    sql += ' ORDER BY characters.name COLLATE NOCASE ASC';
  } else {
    sql += ' ORDER BY characters.created_at DESC';
  }

  return database.prepare(sql).all(...params).map((row) => toCharacter(row, undefined, userId));
}

export function getCharacter(database, userId, characterId) {
  const row = database
    .prepare(
      `SELECT ${characterColumns}
       FROM characters
       ${avatarAssetJoin}
       WHERE characters.id = ? AND (characters.user_id = ? OR visibility = 'public')`
    )
    .get(userId, userId, characterId, userId);
  if (!row) {
    return null;
  }

  return toCharacter(row, getRegexRules(database, row.user_id, characterId), userId);
}

export function createCharacter(database, userId, payload) {
  const id = newId();
  const timestamp = nowIso();
  const data = normalizeCharacterPayload(payload);
  data.avatarUrl = saveAvatarInput(database, {
    userId,
    ownerType: 'character',
    ownerId: id,
    value: data.avatarUrl
  });
  database
    .prepare(
      `INSERT INTO characters (
        id, user_id, name, avatar_url, gender, age, background, worldview, persona,
        opening_message, visibility, tags, render_plugins, author_advanced_settings, created_at, updated_at, last_used_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      userId,
      data.name,
      data.avatarUrl,
      data.gender,
      data.age,
      data.background,
      data.worldview,
      data.persona,
      data.openingMessage,
      data.visibility,
      JSON.stringify(data.tags),
      JSON.stringify(data.renderPlugins),
      JSON.stringify(normalizeAdvancedSettings(data.authorAdvancedSettings)),
      timestamp,
      timestamp,
      null
    );

  replaceRegexRules(database, userId, id, data.regexRules);
  return getCharacter(database, userId, id);
}

export function updateCharacter(database, userId, characterId, payload) {
  const current = getOwnedCharacter(database, userId, characterId);
  if (!current) {
    return null;
  }

  const data = normalizeCharacterPayload({ ...current, ...payload });
  data.avatarUrl = saveAvatarInput(database, {
    userId,
    ownerType: 'character',
    ownerId: characterId,
    value: data.avatarUrl
  });
  database
    .prepare(
      `UPDATE characters
       SET name = ?, avatar_url = ?, gender = ?, age = ?, background = ?, worldview = ?,
           persona = ?, opening_message = ?, visibility = ?, tags = ?, render_plugins = ?, author_advanced_settings = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`
    )
    .run(
      data.name,
      data.avatarUrl,
      data.gender,
      data.age,
      data.background,
      data.worldview,
      data.persona,
      data.openingMessage,
      data.visibility,
      JSON.stringify(data.tags),
      JSON.stringify(data.renderPlugins),
      JSON.stringify(normalizeAdvancedSettings(data.authorAdvancedSettings)),
      nowIso(),
      characterId,
      userId
    );

  replaceRegexRules(database, userId, characterId, data.regexRules);
  return getCharacter(database, userId, characterId);
}

export function deleteCharacter(database, userId, characterId) {
  const result = database
    .prepare('DELETE FROM characters WHERE id = ? AND user_id = ?')
    .run(characterId, userId);
  if (result.changes > 0) {
    deleteAvatarAsset(database, 'character', characterId);
  }
  return result.changes > 0;
}

export function setCharacterFavorite(database, userId, characterId, favorited) {
  const character = getCharacter(database, userId, characterId);
  if (!character?.canUse) {
    return null;
  }

  setCharacterReaction(database, 'character_favorites', userId, characterId, favorited);
  return getCharacter(database, userId, characterId);
}

export function setCharacterLike(database, userId, characterId, liked) {
  const character = getCharacter(database, userId, characterId);
  if (!character?.canUse) {
    return null;
  }

  setCharacterReaction(database, 'character_likes', userId, characterId, liked);
  return getCharacter(database, userId, characterId);
}

export function touchCharacter(database, userId, characterId) {
  database
    .prepare("UPDATE characters SET last_used_at = ?, updated_at = ? WHERE id = ? AND (user_id = ? OR visibility = 'public')")
    .run(nowIso(), nowIso(), characterId, userId);
}

export function getRegexRules(database, userId, characterId) {
  return database
    .prepare(
      `SELECT * FROM regex_rules
       WHERE user_id = ? AND character_id = ?`
    )
    .all(userId, characterId)
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.order_index - b.order_index)
    .map((row) => ({
      id: row.id,
      label: row.label,
      pattern: row.pattern,
      replacement: row.replacement,
      flags: row.flags,
      scope: row.scope,
      enabled: Boolean(row.enabled),
      order: row.order_index,
      groupName: row.group_name || '全局',
      priority: row.priority ?? 0
    }));
}

export function getRegexRulesByGroup(database, userId, group) {
  let sql = 'SELECT * FROM regex_rules WHERE user_id = ?';
  const params = [userId];
  if (group) {
    sql += ' AND group_name = ?';
    params.push(group);
  }
  return database
    .prepare(sql)
    .all(...params)
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.order_index - b.order_index)
    .map((row) => ({
      id: row.id,
      characterId: row.character_id,
      label: row.label,
      pattern: row.pattern,
      replacement: row.replacement,
      flags: row.flags,
      scope: row.scope,
      enabled: Boolean(row.enabled),
      order: row.order_index,
      groupName: row.group_name || '全局',
      priority: row.priority ?? 0
    }));
}

export function replaceRegexRules(database, userId, characterId, rules = []) {
  database
    .prepare('DELETE FROM regex_rules WHERE user_id = ? AND character_id = ?')
    .run(userId, characterId);

  const insert = database.prepare(
    `INSERT INTO regex_rules (
      id, user_id, character_id, label, pattern, replacement, flags, scope, enabled, order_index, group_name, priority
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  normalizeRegexRules(rules).forEach((rule, index) => {
    insert.run(
      rule.id || newId(),
      userId,
      characterId,
      rule.label,
      rule.pattern,
      rule.replacement,
      rule.flags,
      rule.scope,
      rule.enabled ? 1 : 0,
      index,
      rule.groupName || '全局',
      rule.priority ?? 0
    );
  });
}

export function toggleRegexRule(database, userId, ruleId) {
  const row = database.prepare('SELECT * FROM regex_rules WHERE id = ? AND user_id = ?').get(ruleId, userId);
  if (!row) return null;
  const newEnabled = row.enabled ? 0 : 1;
  database.prepare('UPDATE regex_rules SET enabled = ? WHERE id = ?').run(newEnabled, ruleId);
  return {
    id: row.id,
    characterId: row.character_id,
    label: row.label,
    pattern: row.pattern,
    replacement: row.replacement,
    flags: row.flags,
    scope: row.scope,
    enabled: Boolean(newEnabled),
    order: row.order_index,
    groupName: row.group_name || '全局',
    priority: row.priority ?? 0
  };
}

export function reorderRegexRules(database, userId, orderedIds) {
  const update = database.prepare('UPDATE regex_rules SET priority = ? WHERE id = ? AND user_id = ?');
  let changed = 0;
  orderedIds.forEach((id, index) => {
    const result = update.run(index, id, userId);
    changed += result.changes;
  });
  return changed;
}

export function applyRegexRules(text, rules, phase) {
  const sorted = [...rules].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  return sorted.reduce((value, rule) => {
    if (!rule.enabled || !rule.pattern || !scopeApplies(rule.scope, phase)) {
      return value;
    }

    try {
      return value.replace(new RegExp(rule.pattern, rule.flags || 'g'), rule.replacement || '');
    } catch {
      return value;
    }
  }, String(text || ''));
}

function normalizeCharacterPayload(payload = {}) {
  const name = String(payload.name || '').trim();
  if (name.length < 1 || name.length > 40) {
    throw new Error('角色名长度需为 1-40 个字符');
  }

  return {
    name,
    avatarUrl: String(payload.avatarDataUrl || payload.avatarUrl || '').trim(),
    gender: String(payload.gender || '').trim().slice(0, 24),
    age: String(payload.age || '').trim().slice(0, 24),
    background: String(payload.background || '').slice(0, 4000),
    worldview: String(payload.worldview || '').slice(0, 4000),
    persona: String(payload.persona || '').slice(0, 4000),
    openingMessage: String(payload.openingMessage || '').slice(0, 2000),
    visibility: normalizeVisibility(payload.visibility),
    tags: normalizeTags(payload.tags),
    renderPlugins: normalizeRenderPlugins(payload.renderPlugins),
    regexRules: normalizeRegexRules(payload.regexRules),
    authorAdvancedSettings: normalizeAdvancedSettings(payload.authorAdvancedSettings || payload.advancedSettings || {})
  };
}

function getOwnedCharacter(database, userId, characterId) {
  const row = database
    .prepare(
      `SELECT ${characterColumns}
       FROM characters
       ${avatarAssetJoin}
       WHERE characters.id = ? AND characters.user_id = ?`
    )
    .get(userId, userId, characterId, userId);
  if (!row) {
    return null;
  }

  return toCharacter(row, getRegexRules(database, userId, characterId), userId);
}

function normalizeVisibility(value) {
  return value === 'public' ? 'public' : 'private';
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) {
    return tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 12);
  }

  return String(tags || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeRegexRules(rules = []) {
  if (!Array.isArray(rules)) {
    return [];
  }

  return rules.slice(0, 40).map((rule, index) => {
    const flags = normalizeFlags(rule.flags);
    const pattern = String(rule.pattern || '').trim();
    if (pattern) {
      new RegExp(pattern, flags);
    }

    return {
      id: rule.id,
      label: String(rule.label || `规则 ${index + 1}`).trim().slice(0, 60),
      pattern,
      replacement: String(rule.replacement || '').slice(0, 1000),
      flags,
      scope: ['input', 'output', 'both'].includes(rule.scope) ? rule.scope : 'input',
      enabled: rule.enabled !== false,
      groupName: String(rule.groupName || '全局').trim().slice(0, 60) || '全局',
      priority: Math.max(0, Math.round(Number(rule.priority) || 0))
    };
  });
}

function normalizeRenderPlugins(plugins = []) {
  if (!Array.isArray(plugins)) {
    return [];
  }

  return plugins.slice(0, 20).map((plugin, index) => {
    const flags = normalizeFlags(plugin.flags || 'u').replace(/[gy]/g, '') || 'u';
    const pattern = String(plugin.pattern || '').trim().slice(0, 260);
    if (pattern) {
      new RegExp(pattern, flags);
    }

    return {
      id: plugin.id,
      label: String(plugin.label || `渲染插件 ${index + 1}`).trim().slice(0, 60),
      type: 'fold',
      pattern,
      flags,
      titleTemplate: String(plugin.titleTemplate || '$1').trim().slice(0, 120) || '$1',
      enabled: plugin.enabled !== false
    };
  }).filter((plugin) => plugin.pattern);
}

function normalizeFlags(flags) {
  const unique = new Set(String(flags || 'g').replace(/[^dgimsuvy]/g, '').split(''));
  return [...unique].join('') || 'g';
}

function scopeApplies(scope, phase) {
  return scope === 'both' || scope === phase;
}

function setCharacterReaction(database, tableName, userId, characterId, active) {
  if (active) {
    database
      .prepare(`INSERT OR IGNORE INTO ${tableName} (user_id, character_id, created_at) VALUES (?, ?, ?)`)
      .run(userId, characterId, nowIso());
    return;
  }

  database
    .prepare(`DELETE FROM ${tableName} WHERE user_id = ? AND character_id = ?`)
    .run(userId, characterId);
}

function toCharacter(row, regexRules = undefined, viewerId = undefined) {
  const visibility = row.visibility === 'public' ? 'public' : 'private';
  const isOwner = row.user_id === viewerId;
  const legacyTags = parseJson(row.tags, []);
  return {
    id: row.id,
    ownerId: row.user_id,
    visibility,
    isOwner,
    canEdit: isOwner,
    canUse: isOwner || visibility === 'public',
    name: row.name,
    avatarUrl: avatarShortUrl(row.avatar_asset_id) || row.avatar_url || '',
    gender: row.gender || '',
    age: row.age || '',
    background: row.background || '',
    worldview: row.worldview || '',
    persona: row.persona || '',
    openingMessage: row.opening_message || '',
    tags: legacyTags,
    renderPlugins: parseJson(row.render_plugins, []),
    authorAdvancedSettings: parseJson(row.author_advanced_settings, {}),
    likeCount: Number(row.like_count || 0),
    favoriteCount: Number(row.favorite_count || 0),
    likedByMe: Boolean(row.liked_by_me),
    favoritedByMe: Boolean(row.favorited_by_me),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at || null,
    regexRules
  };
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || '');
  } catch {
    return fallback;
  }
}
