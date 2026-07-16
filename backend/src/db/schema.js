import { createDatabaseIndexes } from './indexes.js';
import { applyStartupMigrations } from './migrations.js';

const tableColumnCache = new Map();

export function resetColumnCache() {
  tableColumnCache.clear();
}

export function getCachedTableColumns(database, tableName) {
  if (tableColumnCache.has(tableName)) {
    return tableColumnCache.get(tableName);
  }
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all();
  const nameSet = new Set(columns.map((column) => column.name));
  tableColumnCache.set(tableName, nameSet);
  return nameSet;
}

export function initializeDatabase(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      permission_group TEXT NOT NULL DEFAULT 'user',
      is_root_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS provider_settings (
      user_id TEXT PRIMARY KEY,
      provider_type TEXT NOT NULL,
      gateway_name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      model TEXT NOT NULL,
      encrypted_api_key TEXT,
      api_key_hint TEXT,
      supports_reasoning INTEGER NOT NULL DEFAULT 0,
      extra_body TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS provider_presets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      provider_type TEXT NOT NULL,
      gateway_name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      model TEXT NOT NULL,
      encrypted_api_key TEXT,
      api_key_hint TEXT,
      supports_reasoning INTEGER NOT NULL DEFAULT 0,
      extra_body TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS avatar_assets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      owner_type TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      base64_data TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(owner_type, owner_id)
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      owner_type TEXT NOT NULL DEFAULT '',
      owner_id TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'generic',
      mime_type TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      alt TEXT NOT NULL DEFAULT '',
      base64_data TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      avatar_url TEXT,
      gender TEXT,
      age TEXT,
      background TEXT,
      worldview TEXT,
      persona TEXT,
      opening_message TEXT,
      visibility TEXT NOT NULL DEFAULT 'private',
      tags TEXT NOT NULL DEFAULT '[]',
      render_plugins TEXT NOT NULL DEFAULT '[]',
      author_advanced_settings TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS regex_rules (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      character_id TEXT NOT NULL DEFAULT '',
      label TEXT NOT NULL,
      pattern TEXT NOT NULL,
      replacement TEXT NOT NULL DEFAULT '',
      flags TEXT NOT NULL DEFAULT 'g',
      scope TEXT NOT NULL DEFAULT 'input',
      enabled INTEGER NOT NULL DEFAULT 1,
      order_index INTEGER NOT NULL DEFAULT 0,
      group_name TEXT NOT NULL DEFAULT '全局',
      priority INTEGER NOT NULL DEFAULT 0,
      script_mode INTEGER NOT NULL DEFAULT 0,
      js_script TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      title TEXT NOT NULL,
      desktop_background_url TEXT NOT NULL DEFAULT '',
      mobile_background_url TEXT NOT NULL DEFAULT '',
      custom_css TEXT NOT NULL DEFAULT '',
      custom_js TEXT NOT NULL DEFAULT '',
      user_advanced_settings TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      attachments_json TEXT NOT NULL DEFAULT '[]',
      reasoning TEXT,
      usage_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS conversation_memories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      memory_type TEXT NOT NULL DEFAULT 'event',
      subject TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      confidence REAL NOT NULL DEFAULT 1,
      source_message_id TEXT NOT NULL DEFAULT '',
      source_kind TEXT NOT NULL DEFAULT 'manual',
      source_excerpt TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

  `);
  ensureColumn(database, 'users', 'display_name', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, 'users', 'permission_group', "TEXT NOT NULL DEFAULT 'user'");
  ensureColumn(database, 'users', 'is_root_admin', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(database, 'characters', 'visibility', "TEXT NOT NULL DEFAULT 'private'");
  ensureColumn(database, 'characters', 'render_plugins', "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(database, 'characters', 'author_advanced_settings', "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(database, 'conversations', 'desktop_background_url', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, 'conversations', 'mobile_background_url', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, 'conversations', 'custom_css', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, 'conversations', 'custom_js', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, 'conversations', 'user_advanced_settings', "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(database, 'conversations', 'chat_lorebook_id', 'TEXT');
  ensureColumn(database, 'messages', 'attachments_json', "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(database, 'conversation_memories', 'source_kind', "TEXT NOT NULL DEFAULT 'manual'");
  ensureColumn(database, 'conversation_memories', 'source_excerpt', "TEXT NOT NULL DEFAULT ''");
  database.exec(`
    CREATE TABLE IF NOT EXISTS character_likes (
      user_id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, character_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS character_favorites (
      user_id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, character_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );
  `);
  database.exec("UPDATE users SET permission_group = 'user' WHERE permission_group IS NULL OR permission_group = ''");
  database.exec("UPDATE characters SET visibility = 'private' WHERE visibility IS NULL OR visibility = ''");

  // Regex rules enhancement: group_name, priority
  ensureColumn(database, 'regex_rules', 'group_name', "TEXT NOT NULL DEFAULT '全局'");
  ensureColumn(database, 'regex_rules', 'priority', 'INTEGER NOT NULL DEFAULT 0');

  // Sprint 2: Regex engine upgrade — script mode + global rules
  ensureColumn(database, 'regex_rules', 'script_mode', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(database, 'regex_rules', 'js_script', "TEXT NOT NULL DEFAULT ''");

  // Sprint 3: Message Swipes
  database.exec(`
    CREATE TABLE IF NOT EXISTS message_swipes (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      reasoning TEXT NOT NULL DEFAULT '',
      usage_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // Sprint 3: Conversation Branching
  ensureColumn(database, 'conversations', 'branched_from_id', 'TEXT');
  ensureColumn(database, 'conversations', 'branched_from_message_id', 'TEXT');
  ensureColumn(database, 'conversations', 'branched_from_title', "TEXT NOT NULL DEFAULT ''");
  database.exec(`
    CREATE TABLE IF NOT EXISTS world_books (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      character_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS world_book_entries (
      id TEXT PRIMARY KEY,
      world_book_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      trigger_keys TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      position TEXT NOT NULL DEFAULT 'before_char',
      enabled INTEGER NOT NULL DEFAULT 1,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (world_book_id) REFERENCES world_books(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS character_world_books (
      character_id TEXT NOT NULL,
      world_book_id TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      PRIMARY KEY (character_id, world_book_id),
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
      FOREIGN KEY (world_book_id) REFERENCES world_books(id) ON DELETE CASCADE
    );
  `);

  // Sprint 1: World Info deep enhancements (must come AFTER CREATE TABLE world_books)
  ensureColumn(database, 'world_books', 'scan_depth', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(database, 'world_books', 'lorebook_context_percent', 'INTEGER NOT NULL DEFAULT 25');
  ensureColumn(database, 'world_book_entries', 'regex_mode', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(database, 'world_book_entries', 'always_active', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(database, 'world_book_entries', 'depth', 'INTEGER NOT NULL DEFAULT 0');

  // Selective filter for world book entries
  ensureColumn(database, 'world_book_entries', 'selective', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(database, 'world_book_entries', 'selective_logic', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(database, 'world_book_entries', 'keys_secondary', "TEXT NOT NULL DEFAULT ''");

  // Probability-based activation for world book entries
  ensureColumn(database, 'world_book_entries', 'probability', 'INTEGER NOT NULL DEFAULT 100');
  ensureColumn(database, 'world_book_entries', 'use_probability', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(database, 'world_book_entries', 'inclusion_group', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, 'world_book_entries', 'group_weight', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(database, 'world_book_entries', 'role', 'INTEGER NOT NULL DEFAULT 0');

  // Sticky / Cooldown / Delay for world book entries
  ensureColumn(database, 'world_book_entries', 'sticky', 'INTEGER');
  ensureColumn(database, 'world_book_entries', 'cooldown', 'INTEGER');
  ensureColumn(database, 'world_book_entries', 'delay', 'INTEGER');

  database.exec(`
    CREATE TABLE IF NOT EXISTS world_book_entry_state (
      entry_id TEXT PRIMARY KEY,
      last_activated_message INTEGER DEFAULT 0,
      last_deactivated_message INTEGER DEFAULT 0,
      first_seen_message INTEGER DEFAULT 0,
      sticky_remaining INTEGER DEFAULT 0,
      was_active INTEGER DEFAULT 0,
      FOREIGN KEY (entry_id) REFERENCES world_book_entries(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS character_tags (
      character_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      PRIMARY KEY (character_id, tag_id),
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS saves (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      snapshot TEXT NOT NULL DEFAULT '{}',
      preview TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS presets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '未命名预设',
      system_prompt TEXT NOT NULL DEFAULT '',
      temperature REAL NOT NULL DEFAULT 1.0,
      max_tokens INTEGER NOT NULL DEFAULT 4096,
      top_p REAL NOT NULL DEFAULT 1.0,
      frequency_penalty REAL NOT NULL DEFAULT 0,
      presence_penalty REAL NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS status_bars (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '状态栏',
      variables TEXT NOT NULL DEFAULT '[]',
      template TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS status_bar_templates (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '状态栏模板',
      variables TEXT NOT NULL DEFAULT '[]',
      template TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS mods (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'prompt_inject',
      content TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      scope TEXT NOT NULL DEFAULT 'global',
      character_ids TEXT NOT NULL DEFAULT '[]',
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS npc_memories (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      npc_name TEXT NOT NULL,
      memory_type TEXT NOT NULL DEFAULT 'event',
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS npc_behaviors (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      npc_name TEXT NOT NULL,
      behavior_type TEXT NOT NULL DEFAULT 'reaction',
      trigger_condition TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL DEFAULT '',
      priority INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS npc_registry (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      npc_name TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      evidence TEXT NOT NULL DEFAULT '',
      confidence REAL NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      UNIQUE(conversation_id, npc_name)
    );

    CREATE TABLE IF NOT EXISTS npc_profile_audit (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      npc_name TEXT NOT NULL,
      action TEXT NOT NULL DEFAULT 'update',
      actor TEXT NOT NULL DEFAULT 'system',
      before_json TEXT NOT NULL DEFAULT 'null',
      after_json TEXT NOT NULL DEFAULT 'null',
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS npc_item_audit (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      npc_name TEXT NOT NULL,
      item_type TEXT NOT NULL DEFAULT 'memory',
      item_id TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL DEFAULT 'update',
      actor TEXT NOT NULL DEFAULT 'system',
      before_json TEXT NOT NULL DEFAULT 'null',
      after_json TEXT NOT NULL DEFAULT 'null',
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scene_nodes (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      parent_id TEXT,
      node_type TEXT NOT NULL DEFAULT 'room',
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      layout_json TEXT NOT NULL DEFAULT '{}',
      tags_json TEXT NOT NULL DEFAULT '[]',
      permanent INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES scene_nodes(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS scene_routes (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      from_node_id TEXT NOT NULL,
      to_node_id TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      bidirectional INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (from_node_id) REFERENCES scene_nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (to_node_id) REFERENCES scene_nodes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scene_items (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      node_id TEXT,
      item_code TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      state_json TEXT NOT NULL DEFAULT '{}',
      position_json TEXT NOT NULL DEFAULT '{}',
      movable INTEGER NOT NULL DEFAULT 0,
      owner_type TEXT NOT NULL DEFAULT 'world',
      owner_name TEXT NOT NULL DEFAULT '',
      item_kind TEXT NOT NULL DEFAULT 'item',
      quantity INTEGER NOT NULL DEFAULT 1,
      clothing_slot TEXT NOT NULL DEFAULT '',
      equipped INTEGER NOT NULL DEFAULT 0,
      coverage_json TEXT NOT NULL DEFAULT '[]',
      icon_key TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (node_id) REFERENCES scene_nodes(id) ON DELETE SET NULL,
      UNIQUE(conversation_id, item_code)
    );

    CREATE TABLE IF NOT EXISTS scene_item_audit (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      action TEXT NOT NULL DEFAULT 'update',
      actor TEXT NOT NULL DEFAULT 'manual',
      before_owner_type TEXT NOT NULL DEFAULT '',
      before_owner_name TEXT NOT NULL DEFAULT '',
      after_owner_type TEXT NOT NULL DEFAULT '',
      after_owner_name TEXT NOT NULL DEFAULT '',
      before_json TEXT NOT NULL DEFAULT 'null',
      after_json TEXT NOT NULL DEFAULT 'null',
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS economy_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      currency_type TEXT NOT NULL DEFAULT 'gold',
      balance REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      UNIQUE(conversation_id, currency_type)
    );

    CREATE TABLE IF NOT EXISTS economy_transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      amount REAL NOT NULL,
      type TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      related_npc TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES economy_accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS character_images (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      image_url TEXT NOT NULL,
      scene_tag TEXT NOT NULL DEFAULT '',
      emotion_tag TEXT NOT NULL DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS talent_pools (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      talents_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS character_talents (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      talent_name TEXT NOT NULL,
      talent_rarity TEXT NOT NULL DEFAULT 'common',
      talent_description TEXT NOT NULL DEFAULT '',
      talent_effect TEXT NOT NULL DEFAULT '',
      pool_id TEXT,
      rolled_at TEXT NOT NULL,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
      FOREIGN KEY (pool_id) REFERENCES talent_pools(id) ON DELETE SET NULL
    );
  `);
  ensureColumn(database, 'npc_registry', 'status', "TEXT NOT NULL DEFAULT 'active'");
  ensureColumn(database, 'npc_registry', 'custom_status', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, 'npc_registry', 'aliases', "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(database, 'npc_registry', 'memory_sealed', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(database, 'npc_registry', 'current_location', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, 'npc_registry', 'relationship', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, 'mods', 'scope', "TEXT NOT NULL DEFAULT 'global'");
  ensureColumn(database, 'mods', 'character_ids', "TEXT NOT NULL DEFAULT '[]'");

  applyStartupMigrations(database, { getCachedTableColumns });
  createDatabaseIndexes(database);
}


export function ensureColumn(database, tableName, columnName, definition) {
  const rawName = columnName.replace(/[`"]/g, '');
  const columnNames = getCachedTableColumns(database, tableName);
  if (columnNames.has(rawName)) {
    return;
  }

  database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  // Invalidate cache so subsequent checks on the same table see the new column
  tableColumnCache.delete(tableName);
}
