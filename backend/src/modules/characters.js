import fs from 'node:fs';
import path from 'node:path';
import { avatarUploadDir } from '../db.js';
import { newId, nowIso } from '../security.js';

export function listCharacters(database, userId, { search = '', sort = 'created' } = {}) {
  const query = String(search || '').trim();
  const params = [userId];
  let sql = "SELECT * FROM characters WHERE (user_id = ? OR visibility = 'public')";

  if (query) {
    sql += ' AND (name LIKE ? OR tags LIKE ? OR persona LIKE ? OR background LIKE ?)';
    const like = `%${query}%`;
    params.push(like, like, like, like);
  }

  if (sort === 'used') {
    sql += ' ORDER BY COALESCE(last_used_at, created_at) DESC';
  } else if (sort === 'name') {
    sql += ' ORDER BY name COLLATE NOCASE ASC';
  } else {
    sql += ' ORDER BY created_at DESC';
  }

  return database.prepare(sql).all(...params).map((row) => toCharacter(row, undefined, userId));
}

export function getCharacter(database, userId, characterId) {
  const row = database
    .prepare("SELECT * FROM characters WHERE id = ? AND (user_id = ? OR visibility = 'public')")
    .get(characterId, userId);
  if (!row) {
    return null;
  }

  return toCharacter(row, getRegexRules(database, row.user_id, characterId), userId);
}

export function createCharacter(database, userId, payload) {
  const id = newId();
  const timestamp = nowIso();
  const data = normalizeCharacterPayload(payload);
  database
    .prepare(
      `INSERT INTO characters (
        id, user_id, name, avatar_url, gender, age, background, worldview, persona,
        opening_message, visibility, tags, created_at, updated_at, last_used_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
  database
    .prepare(
      `UPDATE characters
       SET name = ?, avatar_url = ?, gender = ?, age = ?, background = ?, worldview = ?,
           persona = ?, opening_message = ?, visibility = ?, tags = ?, updated_at = ?
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
  return result.changes > 0;
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
       WHERE user_id = ? AND character_id = ?
       ORDER BY order_index ASC`
    )
    .all(userId, characterId)
    .map((row) => ({
      id: row.id,
      label: row.label,
      pattern: row.pattern,
      replacement: row.replacement,
      flags: row.flags,
      scope: row.scope,
      enabled: Boolean(row.enabled),
      order: row.order_index
    }));
}

export function replaceRegexRules(database, userId, characterId, rules = []) {
  database
    .prepare('DELETE FROM regex_rules WHERE user_id = ? AND character_id = ?')
    .run(userId, characterId);

  const insert = database.prepare(
    `INSERT INTO regex_rules (
      id, user_id, character_id, label, pattern, replacement, flags, scope, enabled, order_index
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      index
    );
  });
}

export function applyRegexRules(text, rules, phase) {
  return rules.reduce((value, rule) => {
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

export function saveAvatarDataUrl(userId, dataUrl) {
  if (!dataUrl || !String(dataUrl).startsWith('data:')) {
    return dataUrl || '';
  }

  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  if (!match) {
    throw new Error('头像仅支持 PNG、JPG 或 WebP');
  }

  const extension = match[1] === 'jpeg' ? 'jpg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 2 * 1024 * 1024) {
    throw new Error('头像不能超过 2MB');
  }

  const filename = `${userId}-${newId()}.${extension}`;
  fs.writeFileSync(path.join(avatarUploadDir, filename), buffer);
  return `/uploads/avatars/${filename}`;
}

function normalizeCharacterPayload(payload = {}) {
  const name = String(payload.name || '').trim();
  if (name.length < 1 || name.length > 40) {
    throw new Error('角色名长度需为 1-40 个字符');
  }

  return {
    name,
    avatarUrl: String(payload.avatarUrl || '').trim(),
    gender: String(payload.gender || '').trim().slice(0, 24),
    age: String(payload.age || '').trim().slice(0, 24),
    background: String(payload.background || '').slice(0, 4000),
    worldview: String(payload.worldview || '').slice(0, 4000),
    persona: String(payload.persona || '').slice(0, 4000),
    openingMessage: String(payload.openingMessage || '').slice(0, 2000),
    visibility: normalizeVisibility(payload.visibility),
    tags: normalizeTags(payload.tags),
    regexRules: normalizeRegexRules(payload.regexRules)
  };
}

function getOwnedCharacter(database, userId, characterId) {
  const row = database
    .prepare('SELECT * FROM characters WHERE id = ? AND user_id = ?')
    .get(characterId, userId);
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
      enabled: rule.enabled !== false
    };
  });
}

function normalizeFlags(flags) {
  const unique = new Set(String(flags || 'g').replace(/[^dgimsuvy]/g, '').split(''));
  return [...unique].join('') || 'g';
}

function scopeApplies(scope, phase) {
  return scope === 'both' || scope === phase;
}

function toCharacter(row, regexRules = undefined, viewerId = undefined) {
  const visibility = row.visibility === 'public' ? 'public' : 'private';
  const isOwner = row.user_id === viewerId;
  return {
    id: row.id,
    ownerId: row.user_id,
    visibility,
    isOwner,
    canEdit: isOwner,
    canUse: isOwner || visibility === 'public',
    name: row.name,
    avatarUrl: row.avatar_url || '',
    gender: row.gender || '',
    age: row.age || '',
    background: row.background || '',
    worldview: row.worldview || '',
    persona: row.persona || '',
    openingMessage: row.opening_message || '',
    tags: parseJson(row.tags, []),
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
