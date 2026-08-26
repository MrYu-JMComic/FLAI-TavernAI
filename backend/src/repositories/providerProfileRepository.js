import { newId, nowIso } from '../security.js';

export function getProviderProfileRow(database, userId, providerId = '') {
  if (providerId) {
    return database.prepare(
      'SELECT * FROM provider_presets WHERE id = ? AND user_id = ?'
    ).get(providerId, userId);
  }
  return getSelectedProviderProfileRow(database, userId);
}

export function requireProviderProfileRow(database, userId, providerId) {
  return requireOwnedProviderProfile(database, userId, providerId);
}

export function getSelectedProviderProfileRow(database, userId) {
  const selected = database.prepare(
    `SELECT presets.*
     FROM provider_selections selection
     JOIN provider_presets presets
       ON presets.id = selection.provider_id AND presets.user_id = selection.user_id
     WHERE selection.user_id = ?`
  ).get(userId);
  if (selected) {
    return selected;
  }
  return database.prepare('SELECT * FROM provider_settings WHERE user_id = ?').get(userId);
}

export function ensureSelectedProviderProfile(database, userId, options = {}) {
  const existing = database.prepare(
    `SELECT presets.*
     FROM provider_selections selection
     JOIN provider_presets presets
       ON presets.id = selection.provider_id AND presets.user_id = selection.user_id
     WHERE selection.user_id = ?`
  ).get(userId);
  if (existing) {
    return existing;
  }

  return withSavepoint(database, 'ensure_provider_profile', () => {
    let profile = database.prepare(
      'SELECT * FROM provider_presets WHERE user_id = ? ORDER BY updated_at DESC, id ASC LIMIT 1'
    ).get(userId);
    if (!profile) {
      const legacy = database.prepare('SELECT * FROM provider_settings WHERE user_id = ?').get(userId);
      profile = legacy
        ? insertProviderProfileRow(database, userId, valuesFromRow(legacy), legacy.updated_at)
        : insertProviderProfileRow(database, userId, options.defaultSettings || {}, options.timestamp);
    }
    selectProviderProfileRow(database, userId, profile, options.timestamp);
    return profile;
  });
}

export function listProviderProfileRows(database, userId) {
  return database.prepare(
    `SELECT presets.*,
            CASE WHEN selection.provider_id = presets.id THEN 1 ELSE 0 END AS is_selected
     FROM provider_presets presets
     LEFT JOIN provider_selections selection ON selection.user_id = presets.user_id
     WHERE presets.user_id = ?
     ORDER BY is_selected DESC, presets.updated_at DESC, presets.id ASC`
  ).all(userId);
}

export function createProviderProfile(database, userId, values, options = {}) {
  return withSavepoint(database, 'create_provider_profile', () => {
    const profile = insertProviderProfileRow(database, userId, values, options.timestamp);
    if (options.select !== false) {
      selectProviderProfileRow(database, userId, profile, options.timestamp);
    }
    return profile;
  });
}

export function updateProviderProfile(database, userId, providerId, values, options = {}) {
  return withSavepoint(database, 'update_provider_profile', () => {
    const existing = requireOwnedProviderProfile(database, userId, providerId);
    const timestamp = options.timestamp || nowIso();
    database.prepare(
      `UPDATE provider_presets SET
        name = ?, provider_type = ?, gateway_name = ?, base_url = ?, model = ?,
        encrypted_api_key = ?, api_key_hint = ?, supports_reasoning = ?,
        allow_private_network = ?, extra_body = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`
    ).run(
      values.gatewayName || existing.gateway_name,
      values.providerType,
      values.gatewayName,
      values.baseUrl,
      values.model,
      values.encryptedApiKey,
      values.apiKeyHint,
      values.supportsReasoning ? 1 : 0,
      values.allowPrivateNetwork ? 1 : 0,
      serializeExtraBody(values.extraBody),
      timestamp,
      providerId,
      userId
    );
    const updated = requireOwnedProviderProfile(database, userId, providerId);
    if (isSelectedProviderProfile(database, userId, providerId)) {
      syncLegacyProviderSettings(database, updated);
    }
    return updated;
  });
}

export function selectProviderProfile(database, userId, providerId, options = {}) {
  return withSavepoint(database, 'select_provider_profile', () => {
    const profile = requireOwnedProviderProfile(database, userId, providerId);
    selectProviderProfileRow(database, userId, profile, options.timestamp);
    return profile;
  });
}

export function deleteProviderProfile(database, userId, providerId, options = {}) {
  return withSavepoint(database, 'delete_provider_profile', () => {
    requireOwnedProviderProfile(database, userId, providerId);
    const count = database.prepare(
      'SELECT COUNT(*) AS count FROM provider_presets WHERE user_id = ?'
    ).get(userId).count;
    if (count <= 1) {
      throw providerProfileError('至少需要保留一个 AI 供应商', 409, 'PROVIDER_PROFILE_REQUIRED');
    }

    const wasSelected = isSelectedProviderProfile(database, userId, providerId);
    if (wasSelected) {
      const replacement = database.prepare(
        `SELECT * FROM provider_presets
         WHERE user_id = ? AND id <> ?
         ORDER BY updated_at DESC, id ASC
         LIMIT 1`
      ).get(userId, providerId);
      selectProviderProfileRow(database, userId, replacement, options.timestamp);
    }
    database.prepare('DELETE FROM provider_presets WHERE id = ? AND user_id = ?').run(providerId, userId);
    return getSelectedProviderProfileRow(database, userId);
  });
}

function insertProviderProfileRow(database, userId, values = {}, timestampValue) {
  const timestamp = timestampValue || nowIso();
  const id = newId();
  const gatewayName = String(values.gatewayName || values.gateway_name || 'AI 供应商').trim() || 'AI 供应商';
  database.prepare(
    `INSERT INTO provider_presets (
      id, user_id, name, provider_type, gateway_name, base_url, model,
      encrypted_api_key, api_key_hint, supports_reasoning, allow_private_network,
      extra_body, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    userId,
    gatewayName,
    values.providerType || values.provider_type || 'deepseek',
    gatewayName,
    values.baseUrl ?? values.base_url ?? '',
    values.model || '',
    values.encryptedApiKey ?? values.encrypted_api_key ?? null,
    values.apiKeyHint ?? values.api_key_hint ?? null,
    normalizeStoredBoolean(values.supportsReasoning ?? values.supports_reasoning),
    normalizeStoredBoolean(values.allowPrivateNetwork ?? values.allow_private_network),
    serializeExtraBody(values.extraBody ?? values.extra_body),
    timestamp,
    timestamp
  );
  return requireOwnedProviderProfile(database, userId, id);
}

function selectProviderProfileRow(database, userId, profile, timestampValue) {
  const timestamp = timestampValue || nowIso();
  database.prepare(
    `INSERT INTO provider_selections (user_id, provider_id, selected_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       provider_id = excluded.provider_id,
       selected_at = excluded.selected_at`
  ).run(userId, profile.id, timestamp);
  syncLegacyProviderSettings(database, profile);
}

function syncLegacyProviderSettings(database, profile) {
  database.prepare(
    `INSERT INTO provider_settings (
      user_id, provider_type, gateway_name, base_url, model, encrypted_api_key,
      api_key_hint, supports_reasoning, allow_private_network, extra_body, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      provider_type = excluded.provider_type,
      gateway_name = excluded.gateway_name,
      base_url = excluded.base_url,
      model = excluded.model,
      encrypted_api_key = excluded.encrypted_api_key,
      api_key_hint = excluded.api_key_hint,
      supports_reasoning = excluded.supports_reasoning,
      allow_private_network = excluded.allow_private_network,
      extra_body = excluded.extra_body,
      updated_at = excluded.updated_at`
  ).run(
    profile.user_id,
    profile.provider_type,
    profile.gateway_name,
    profile.base_url,
    profile.model,
    profile.encrypted_api_key,
    profile.api_key_hint,
    profile.supports_reasoning,
    profile.allow_private_network,
    profile.extra_body,
    profile.updated_at
  );
}

function requireOwnedProviderProfile(database, userId, providerId) {
  const row = database.prepare(
    'SELECT * FROM provider_presets WHERE id = ? AND user_id = ?'
  ).get(providerId, userId);
  if (!row) {
    throw providerProfileError('AI 供应商不存在', 404, 'PROVIDER_PROFILE_NOT_FOUND');
  }
  return row;
}

function isSelectedProviderProfile(database, userId, providerId) {
  return Boolean(database.prepare(
    'SELECT 1 FROM provider_selections WHERE user_id = ? AND provider_id = ?'
  ).get(userId, providerId));
}

function valuesFromRow(row) {
  return {
    providerType: row.provider_type,
    gatewayName: row.gateway_name,
    baseUrl: row.base_url,
    model: row.model,
    encryptedApiKey: row.encrypted_api_key,
    apiKeyHint: row.api_key_hint,
    supportsReasoning: row.supports_reasoning,
    allowPrivateNetwork: row.allow_private_network,
    extraBody: row.extra_body
  };
}

function serializeExtraBody(value) {
  if (typeof value === 'string') {
    return value || '{}';
  }
  return JSON.stringify(value || {});
}

function normalizeStoredBoolean(value) {
  return value ? 1 : 0;
}

function providerProfileError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function withSavepoint(database, name, callback) {
  database.exec(`SAVEPOINT ${name}`);
  try {
    const result = callback();
    database.exec(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (error) {
    database.exec(`ROLLBACK TO SAVEPOINT ${name}`);
    database.exec(`RELEASE SAVEPOINT ${name}`);
    throw error;
  }
}
