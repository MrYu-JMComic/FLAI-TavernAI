import { newId, nowIso } from '../security.js';
import { normalizeBoolean } from '../utils/boolean.js';
import { withSavepoint } from './savepoint.js';

// ── Preset CRUD ──

export function listPresets(database, userId) {
  return database
    .prepare(
      `SELECT id, name, system_prompt, temperature, max_tokens, top_p,
              frequency_penalty, presence_penalty, is_default, created_at, updated_at
       FROM presets
       WHERE user_id = ?
       ORDER BY is_default DESC, updated_at DESC, rowid DESC`
    )
    .all(userId)
    .map(toPreset);
}

export function getPreset(database, userId, presetId) {
  const row = database
    .prepare('SELECT * FROM presets WHERE id = ? AND user_id = ?')
    .get(presetId, userId);
  return row ? toPreset(row) : null;
}

export function createPreset(database, userId, payload) {
  const id = newId();
  const timestamp = nowIso();
  const normalized = normalizePresetPayload(payload);

  const insertPreset = () => {
    if (normalized.isDefault) {
      database
        .prepare('UPDATE presets SET is_default = 0 WHERE user_id = ? AND is_default = 1')
        .run(userId);
    }

    database
      .prepare(
        `INSERT INTO presets (id, user_id, name, system_prompt, temperature, max_tokens,
          top_p, frequency_penalty, presence_penalty, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        userId,
        normalized.name,
        normalized.systemPrompt,
        normalized.temperature,
        normalized.maxTokens,
        normalized.topP,
        normalized.frequencyPenalty,
        normalized.presencePenalty,
        normalized.isDefault ? 1 : 0,
        timestamp,
        timestamp
      );
  };

  if (normalized.isDefault) {
    withSavepoint(database, 'sp_create_preset_default', insertPreset);
  } else {
    insertPreset();
  }

  return getPreset(database, userId, id);
}

export function updatePreset(database, userId, presetId, payload) {
  const existing = database
    .prepare('SELECT * FROM presets WHERE id = ? AND user_id = ?')
    .get(presetId, userId);
  if (!existing) {
    return null;
  }

  const normalized = normalizePresetPayload(payload, existing);

  const savePreset = () => {
    if (normalized.isDefault && !existing.is_default) {
      database
        .prepare('UPDATE presets SET is_default = 0 WHERE user_id = ? AND is_default = 1')
        .run(userId);
    }

    database
      .prepare(
        `UPDATE presets SET
          name = ?, system_prompt = ?, temperature = ?, max_tokens = ?,
          top_p = ?, frequency_penalty = ?, presence_penalty = ?,
          is_default = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`
      )
      .run(
        normalized.name,
        normalized.systemPrompt,
        normalized.temperature,
        normalized.maxTokens,
        normalized.topP,
        normalized.frequencyPenalty,
        normalized.presencePenalty,
        normalized.isDefault ? 1 : 0,
        nowIso(),
        presetId,
        userId
      );
  };

  if (normalized.isDefault && !existing.is_default) {
    withSavepoint(database, 'sp_update_preset_default', savePreset);
  } else {
    savePreset();
  }

  return getPreset(database, userId, presetId);
}

export function deletePreset(database, userId, presetId) {
  const result = database
    .prepare('DELETE FROM presets WHERE id = ? AND user_id = ?')
    .run(presetId, userId);
  return result.changes > 0;
}

export function setDefaultPreset(database, userId, presetId) {
  const existing = database
    .prepare('SELECT id FROM presets WHERE id = ? AND user_id = ?')
    .get(presetId, userId);
  if (!existing) {
    return null;
  }

  withSavepoint(database, 'sp_set_default_preset', () => {
    database
      .prepare('UPDATE presets SET is_default = 0 WHERE user_id = ? AND is_default = 1')
      .run(userId);
    database
      .prepare('UPDATE presets SET is_default = 1, updated_at = ? WHERE id = ? AND user_id = ?')
      .run(nowIso(), presetId, userId);
  });

  return getPreset(database, userId, presetId);
}

export function getDefaultPreset(database, userId) {
  const row = database
    .prepare('SELECT * FROM presets WHERE user_id = ? AND is_default = 1')
    .get(userId);
  return row ? toPreset(row) : null;
}

// ── Normalization ──

function normalizePresetPayload(payload = {}, existing = null) {
  const name = normalizeName(payload.name ?? existing?.name ?? '未命名预设');
  const systemPrompt = String(payload.systemPrompt ?? payload.system_prompt ?? existing?.system_prompt ?? '');
  const temperature = clampNumber(payload.temperature ?? existing?.temperature ?? 1.0, 0, 2);
  const maxTokens = clampInt(payload.maxTokens ?? payload.max_tokens ?? existing?.max_tokens ?? 4096, 1, 128000);
  const topP = clampNumber(payload.topP ?? payload.top_p ?? existing?.top_p ?? 1.0, 0, 1);
  const frequencyPenalty = clampNumber(payload.frequencyPenalty ?? payload.frequency_penalty ?? existing?.frequency_penalty ?? 0, -2, 2);
  const presencePenalty = clampNumber(payload.presencePenalty ?? payload.presence_penalty ?? existing?.presence_penalty ?? 0, -2, 2);
  const isDefault = normalizeBoolean(
    payload.isDefault ?? payload.is_default,
    normalizeBoolean(existing?.is_default, false)
  );

  return {
    name,
    systemPrompt,
    temperature,
    maxTokens,
    topP,
    frequencyPenalty,
    presencePenalty,
    isDefault
  };
}

function normalizeName(name) {
  const value = String(name || '').trim();
  if (!value) {
    return '未命名预设';
  }
  if (value.length > 80) {
    return value.slice(0, 80);
  }
  return value;
}

function clampNumber(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return min;
  }
  return Math.min(max, Math.max(min, num));
}

function clampInt(value, min, max) {
  const num = Math.round(Number(value));
  if (!Number.isFinite(num)) {
    return min;
  }
  return Math.min(max, Math.max(min, num));
}

// ── Mapper ──

function toPreset(row) {
  return {
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
  };
}
