export function createDatabaseIndexes(database) {
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_provider_presets_user ON provider_presets(user_id);
    CREATE INDEX IF NOT EXISTS idx_avatar_assets_user ON avatar_assets(user_id);
    CREATE INDEX IF NOT EXISTS idx_avatar_assets_owner ON avatar_assets(owner_type, owner_id);
    CREATE INDEX IF NOT EXISTS idx_assets_user_kind_created ON assets(user_id, kind, created_at);
    CREATE INDEX IF NOT EXISTS idx_assets_user_created ON assets(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_assets_owner ON assets(owner_type, owner_id);
    CREATE INDEX IF NOT EXISTS idx_assets_owner_kind_updated ON assets(owner_type, owner_id, kind, updated_at);

    CREATE INDEX IF NOT EXISTS idx_characters_user ON characters(user_id);
    CREATE INDEX IF NOT EXISTS idx_characters_visibility ON characters(visibility);
    CREATE INDEX IF NOT EXISTS idx_characters_user_created ON characters(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_characters_user_last_used ON characters(user_id, last_used_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_characters_visibility_created ON characters(visibility, created_at);

    CREATE INDEX IF NOT EXISTS idx_character_likes_character ON character_likes(character_id);
    CREATE INDEX IF NOT EXISTS idx_character_favorites_character ON character_favorites(character_id);

    CREATE INDEX IF NOT EXISTS idx_regex_character ON regex_rules(character_id);
    CREATE INDEX IF NOT EXISTS idx_regex_user_global ON regex_rules(user_id, character_id);
    CREATE INDEX IF NOT EXISTS idx_regex_user_character_order ON regex_rules(user_id, character_id, priority, order_index);
    CREATE INDEX IF NOT EXISTS idx_regex_user_group_order ON regex_rules(user_id, group_name, priority, order_index);

    CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_conversations_branch_user_created ON conversations(branched_from_id, user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_conversations_character_user_updated ON conversations(character_id, user_id, updated_at);

    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_messages_user_conversation_created ON messages(user_id, conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_user_role_created ON messages(conversation_id, user_id, role, created_at);
    CREATE INDEX IF NOT EXISTS idx_conversation_memories_conversation_enabled ON conversation_memories(conversation_id, enabled, archived, updated_at);
    CREATE INDEX IF NOT EXISTS idx_conversation_memories_user_type ON conversation_memories(user_id, memory_type, updated_at);
    CREATE INDEX IF NOT EXISTS idx_conversation_memories_source ON conversation_memories(user_id, conversation_id, source_kind, archived);
    CREATE INDEX IF NOT EXISTS idx_conversation_memories_user_conversation_archived_enabled ON conversation_memories(user_id, conversation_id, archived, enabled, updated_at);

    CREATE INDEX IF NOT EXISTS idx_message_swipes_message ON message_swipes(message_id);
    CREATE INDEX IF NOT EXISTS idx_message_swipes_message_user_created ON message_swipes(message_id, user_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_world_books_user ON world_books(user_id);
    CREATE INDEX IF NOT EXISTS idx_world_books_character ON world_books(character_id);
    CREATE INDEX IF NOT EXISTS idx_world_books_user_updated ON world_books(user_id, updated_at);

    CREATE INDEX IF NOT EXISTS idx_world_book_entries_book ON world_book_entries(world_book_id);
    CREATE INDEX IF NOT EXISTS idx_world_book_entries_book_order ON world_book_entries(world_book_id, order_index);
    CREATE INDEX IF NOT EXISTS idx_world_book_entries_book_order_created ON world_book_entries(world_book_id, order_index, created_at);

    CREATE INDEX IF NOT EXISTS idx_cwb_character ON character_world_books(character_id);
    CREATE INDEX IF NOT EXISTS idx_cwb_book ON character_world_books(world_book_id);
    CREATE INDEX IF NOT EXISTS idx_cwb_character_order ON character_world_books(character_id, order_index, created_at);

    CREATE INDEX IF NOT EXISTS idx_tags_user_name ON tags(user_id, name);
    CREATE INDEX IF NOT EXISTS idx_character_tags_character ON character_tags(character_id);
    CREATE INDEX IF NOT EXISTS idx_character_tags_tag ON character_tags(tag_id);

    CREATE INDEX IF NOT EXISTS idx_saves_conversation ON saves(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_saves_user ON saves(user_id);
    CREATE INDEX IF NOT EXISTS idx_saves_user_conversation_created ON saves(user_id, conversation_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_presets_user ON presets(user_id);
    CREATE INDEX IF NOT EXISTS idx_presets_user_default_updated ON presets(user_id, is_default, updated_at);

    CREATE INDEX IF NOT EXISTS idx_status_bars_conversation ON status_bars(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_status_bar_templates_user_updated ON status_bar_templates(user_id, updated_at);

    CREATE INDEX IF NOT EXISTS idx_mods_user ON mods(user_id);
    CREATE INDEX IF NOT EXISTS idx_mods_user_order ON mods(user_id, order_index, created_at);

    CREATE INDEX IF NOT EXISTS idx_npc_memories_conversation ON npc_memories(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_npc_memories_npc ON npc_memories(conversation_id, npc_name);
    CREATE INDEX IF NOT EXISTS idx_npc_memories_conversation_npc_created ON npc_memories(conversation_id, npc_name, created_at);
    CREATE INDEX IF NOT EXISTS idx_npc_memories_conversation_created ON npc_memories(conversation_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_npc_behaviors_conversation ON npc_behaviors(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_npc_behaviors_npc ON npc_behaviors(conversation_id, npc_name);
    CREATE INDEX IF NOT EXISTS idx_npc_behaviors_conversation_npc_priority ON npc_behaviors(conversation_id, npc_name, priority, created_at);
    CREATE INDEX IF NOT EXISTS idx_npc_behaviors_conversation_enabled_priority ON npc_behaviors(conversation_id, enabled, priority, created_at);

    CREATE INDEX IF NOT EXISTS idx_npc_registry_conversation ON npc_registry(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_npc_registry_hidden ON npc_registry(conversation_id, hidden);
    CREATE INDEX IF NOT EXISTS idx_npc_profile_audit_npc_created ON npc_profile_audit(conversation_id, npc_name, created_at);
    CREATE INDEX IF NOT EXISTS idx_npc_item_audit_npc_created ON npc_item_audit(conversation_id, npc_name, created_at);
    CREATE INDEX IF NOT EXISTS idx_npc_item_audit_item ON npc_item_audit(item_type, item_id);

    CREATE INDEX IF NOT EXISTS idx_scene_nodes_conversation_type_name ON scene_nodes(conversation_id, node_type, name, created_at);
    CREATE INDEX IF NOT EXISTS idx_scene_nodes_parent ON scene_nodes(conversation_id, parent_id);
    CREATE INDEX IF NOT EXISTS idx_scene_routes_conversation_created ON scene_routes(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_scene_routes_endpoints ON scene_routes(conversation_id, from_node_id, to_node_id, bidirectional);
    CREATE INDEX IF NOT EXISTS idx_scene_items_node_name ON scene_items(conversation_id, node_id, name, created_at);
    CREATE INDEX IF NOT EXISTS idx_scene_items_owner ON scene_items(conversation_id, owner_type, owner_name, equipped, clothing_slot);
    CREATE INDEX IF NOT EXISTS idx_scene_items_code ON scene_items(conversation_id, item_code);
    CREATE INDEX IF NOT EXISTS idx_scene_item_audit_item_created ON scene_item_audit(conversation_id, item_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_scene_item_audit_before_owner ON scene_item_audit(conversation_id, before_owner_type, before_owner_name, created_at);
    CREATE INDEX IF NOT EXISTS idx_scene_item_audit_after_owner ON scene_item_audit(conversation_id, after_owner_type, after_owner_name, created_at);

    CREATE INDEX IF NOT EXISTS idx_economy_accounts_conversation ON economy_accounts(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_economy_accounts_user ON economy_accounts(user_id);
    CREATE INDEX IF NOT EXISTS idx_economy_transactions_account ON economy_transactions(account_id);
    CREATE INDEX IF NOT EXISTS idx_economy_transactions_account_created ON economy_transactions(account_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_character_images_character ON character_images(character_id);
    CREATE INDEX IF NOT EXISTS idx_character_images_character_order ON character_images(character_id, order_index, created_at);

    CREATE INDEX IF NOT EXISTS idx_talent_pools_name ON talent_pools(name);
    CREATE INDEX IF NOT EXISTS idx_character_talents_character ON character_talents(character_id);
    CREATE INDEX IF NOT EXISTS idx_character_talents_pool ON character_talents(pool_id);
    CREATE INDEX IF NOT EXISTS idx_character_talents_character_rolled ON character_talents(character_id, rolled_at);
  `);
}
