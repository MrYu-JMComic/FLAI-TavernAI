import { newId } from '../../security.js';

export function migrateProviderProfiles(database) {
  database.exec('SAVEPOINT migration_0009_provider_profiles');
  try {
    ensureProviderPresetColumn(database, 'allow_private_network', 'INTEGER NOT NULL DEFAULT 0');
    database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_presets_id_user
        ON provider_presets(id, user_id);

      CREATE TABLE IF NOT EXISTS provider_selections (
        user_id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        selected_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (provider_id, user_id) REFERENCES provider_presets(id, user_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_provider_presets_user_updated
        ON provider_presets(user_id, updated_at DESC, id ASC);
      CREATE INDEX IF NOT EXISTS idx_provider_selections_provider
        ON provider_selections(provider_id, user_id);
    `);

    migrateCurrentProviderSettings(database);
    adoptUnselectedProviderPresets(database);
    syncSelectedProviderSettings(database);
    database.exec('RELEASE SAVEPOINT migration_0009_provider_profiles');
  } catch (error) {
    database.exec('ROLLBACK TO SAVEPOINT migration_0009_provider_profiles');
    database.exec('RELEASE SAVEPOINT migration_0009_provider_profiles');
    throw error;
  }
}

function ensureProviderPresetColumn(database, columnName, definition) {
  const columns = database.prepare('PRAGMA table_info(provider_presets)').all();
  if (columns.some((column) => column.name === columnName)) {
    return;
  }
  database.exec(`ALTER TABLE provider_presets ADD COLUMN ${columnName} ${definition}`);
}

function migrateCurrentProviderSettings(database) {
  const currentRows = database.prepare(
    `SELECT settings.*
     FROM provider_settings settings
     LEFT JOIN provider_selections selection ON selection.user_id = settings.user_id
     WHERE selection.user_id IS NULL
     ORDER BY settings.user_id ASC`
  ).all();
  const findMatchingProfile = database.prepare(
    `SELECT * FROM provider_presets
     WHERE user_id = ? AND provider_type = ? AND gateway_name = ? AND base_url = ? AND model = ?
     ORDER BY updated_at DESC, id ASC
     LIMIT 1`
  );
  const insertProfile = database.prepare(
    `INSERT INTO provider_presets (
      id, user_id, name, provider_type, gateway_name, base_url, model,
      encrypted_api_key, api_key_hint, supports_reasoning, allow_private_network,
      extra_body, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const updateProfile = database.prepare(
    `UPDATE provider_presets SET
      name = ?, provider_type = ?, gateway_name = ?, base_url = ?, model = ?,
      encrypted_api_key = ?, api_key_hint = ?, supports_reasoning = ?,
      allow_private_network = ?, extra_body = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`
  );
  const selectProfile = database.prepare(
    `INSERT INTO provider_selections (user_id, provider_id, selected_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       provider_id = excluded.provider_id,
       selected_at = excluded.selected_at`
  );

  for (const row of currentRows) {
    let profile = findMatchingProfile.get(
      row.user_id,
      row.provider_type,
      row.gateway_name,
      row.base_url,
      row.model
    );
    if (!profile) {
      const id = newId();
      insertProfile.run(
        id,
        row.user_id,
        row.gateway_name,
        row.provider_type,
        row.gateway_name,
        row.base_url,
        row.model,
        row.encrypted_api_key,
        row.api_key_hint,
        row.supports_reasoning,
        row.allow_private_network,
        row.extra_body,
        row.updated_at,
        row.updated_at
      );
      profile = { id };
    } else {
      updateProfile.run(
        row.gateway_name,
        row.provider_type,
        row.gateway_name,
        row.base_url,
        row.model,
        row.encrypted_api_key,
        row.api_key_hint,
        row.supports_reasoning,
        row.allow_private_network,
        row.extra_body,
        row.updated_at,
        profile.id,
        row.user_id
      );
    }
    selectProfile.run(row.user_id, profile.id, row.updated_at);
  }
}

function syncSelectedProviderSettings(database) {
  database.exec(`
    INSERT INTO provider_settings (
      user_id, provider_type, gateway_name, base_url, model, encrypted_api_key,
      api_key_hint, supports_reasoning, allow_private_network, extra_body, updated_at
    )
    SELECT presets.user_id, presets.provider_type, presets.gateway_name, presets.base_url,
           presets.model, presets.encrypted_api_key, presets.api_key_hint,
           presets.supports_reasoning, presets.allow_private_network, presets.extra_body,
           presets.updated_at
    FROM provider_selections selection
    JOIN provider_presets presets
      ON presets.id = selection.provider_id AND presets.user_id = selection.user_id
    WHERE true
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
      updated_at = excluded.updated_at;
  `);
}

function adoptUnselectedProviderPresets(database) {
  const rows = database.prepare(
    `SELECT presets.user_id, presets.id, presets.updated_at
     FROM provider_presets presets
     LEFT JOIN provider_selections selection ON selection.user_id = presets.user_id
     WHERE selection.user_id IS NULL
       AND presets.id = (
         SELECT candidate.id
         FROM provider_presets candidate
         WHERE candidate.user_id = presets.user_id
         ORDER BY candidate.updated_at DESC, candidate.id ASC
         LIMIT 1
       )
     ORDER BY presets.user_id ASC`
  ).all();
  const selectProfile = database.prepare(
    'INSERT INTO provider_selections (user_id, provider_id, selected_at) VALUES (?, ?, ?)'
  );
  for (const row of rows) {
    selectProfile.run(row.user_id, row.id, row.updated_at);
  }
}
