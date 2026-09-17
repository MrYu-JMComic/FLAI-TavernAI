export function migrateProviderImageModel(database) {
  const ensure = (table) => {
    const columns = database.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some((column) => column.name === 'image_model')) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN image_model TEXT NOT NULL DEFAULT ''`);
    }
  };
  ensure('provider_settings');
  ensure('provider_presets');
  database.exec(`
    UPDATE provider_settings
    SET image_model = CASE provider_type
      WHEN 'openai' THEN 'gpt-image-2'
      WHEN 'gemini' THEN 'gemini-3.1-flash-image'
      WHEN 'xai' THEN 'grok-imagine-image'
      ELSE image_model
    END
    WHERE image_model = '';

    UPDATE provider_presets
    SET image_model = CASE provider_type
      WHEN 'openai' THEN 'gpt-image-2'
      WHEN 'gemini' THEN 'gemini-3.1-flash-image'
      WHEN 'xai' THEN 'grok-imagine-image'
      ELSE image_model
    END
    WHERE image_model = '';
  `);
}
