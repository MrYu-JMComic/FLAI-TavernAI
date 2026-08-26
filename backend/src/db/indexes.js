export function createDatabaseIndexes(database) {
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_provider_presets_user ON provider_presets(user_id);
    CREATE INDEX IF NOT EXISTS idx_provider_presets_user_updated ON provider_presets(user_id, updated_at DESC, id ASC);
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

    CREATE INDEX IF NOT EXISTS idx_scene_nodes_conversation_type_name ON scene_nodes(conversation_id, node_type, name, created_at);
    CREATE INDEX IF NOT EXISTS idx_scene_nodes_parent ON scene_nodes(conversation_id, parent_id);
    CREATE INDEX IF NOT EXISTS idx_scene_routes_conversation_created ON scene_routes(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_scene_routes_endpoints ON scene_routes(conversation_id, from_node_id, to_node_id, bidirectional);
    CREATE INDEX IF NOT EXISTS idx_discovered_scene_nodes_conversation ON discovered_scene_nodes(conversation_id, discovered_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cast_members_one_protagonist
      ON cast_members(conversation_id) WHERE member_type = 'protagonist';
    CREATE INDEX IF NOT EXISTS idx_cast_members_roster
      ON cast_members(conversation_id, visibility, member_type, canonical_name);
    CREATE INDEX IF NOT EXISTS idx_cast_aliases_member
      ON cast_member_aliases(member_id, alias_key);
    CREATE INDEX IF NOT EXISTS idx_cast_memories_member_created
      ON cast_memories(conversation_id, member_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cast_memories_reinforcement
      ON cast_memories(member_id, forgotten_at, importance DESC, last_reinforced_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cast_behaviors_member_priority
      ON cast_behaviors(conversation_id, member_id, enabled, priority DESC, created_at);
    CREATE INDEX IF NOT EXISTS idx_cast_activities_time
      ON cast_activities(conversation_id, start_tick, end_tick, status);
    CREATE INDEX IF NOT EXISTS idx_cast_turn_queue_order
      ON cast_turn_queue(conversation_id, status, order_index, created_at);
    CREATE INDEX IF NOT EXISTS idx_conversation_turns_order
      ON conversation_turns(conversation_id, turn_index, created_at);
    CREATE INDEX IF NOT EXISTS idx_scene_items_world
      ON scene_items(conversation_id, owner_kind, node_id, name, created_at);
    CREATE INDEX IF NOT EXISTS idx_scene_items_cast
      ON scene_items(conversation_id, owner_member_id, equipped, clothing_slot, name);
    CREATE INDEX IF NOT EXISTS idx_cast_change_batches_status
      ON cast_change_batches(conversation_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cast_audit_member_created
      ON conversation_audit_events(conversation_id, member_id, created_at DESC, id);
    CREATE INDEX IF NOT EXISTS idx_cast_audit_subject
      ON conversation_audit_events(conversation_id, subject_type, subject_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cast_ooc_member_created
      ON cast_ooc_validations(conversation_id, member_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_encounters_conversation_status ON encounters(conversation_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_encounter_participants_order ON encounter_participants(encounter_id, initiative DESC, created_at);
    CREATE INDEX IF NOT EXISTS idx_encounter_participants_member ON encounter_participants(member_id, encounter_id);
    CREATE INDEX IF NOT EXISTS idx_encounter_actions_order ON encounter_actions(encounter_id, round_number, turn_index, created_at);
    CREATE INDEX IF NOT EXISTS idx_reward_grants_conversation_status ON reward_grants(conversation_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_economy_accounts_conversation ON economy_accounts(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_economy_accounts_user ON economy_accounts(user_id);
    CREATE INDEX IF NOT EXISTS idx_economy_transactions_account ON economy_transactions(account_id);
    CREATE INDEX IF NOT EXISTS idx_economy_transactions_account_created ON economy_transactions(account_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_world_events_conversation_cursor ON world_events(conversation_id, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_world_events_conversation_type_created ON world_events(conversation_id, event_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_world_events_entity ON world_events(conversation_id, entity_type, entity_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_quests_conversation_status_updated ON quests(conversation_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_quest_objectives_quest_order ON quest_objectives(quest_id, order_index, created_at);
    CREATE INDEX IF NOT EXISTS idx_skill_checks_conversation_created ON skill_checks(conversation_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_world_advances_conversation_created ON world_advances(conversation_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_character_images_character ON character_images(character_id);
    CREATE INDEX IF NOT EXISTS idx_character_images_character_order ON character_images(character_id, order_index, created_at);

    CREATE INDEX IF NOT EXISTS idx_talent_pools_name ON talent_pools(name);
    CREATE INDEX IF NOT EXISTS idx_character_talents_character ON character_talents(character_id);
    CREATE INDEX IF NOT EXISTS idx_character_talents_pool ON character_talents(pool_id);
    CREATE INDEX IF NOT EXISTS idx_character_talents_character_rolled ON character_talents(character_id, rolled_at);

    CREATE INDEX IF NOT EXISTS idx_town_worlds_user_updated ON town_worlds(user_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_town_residents_town_name ON town_residents(town_id, name);
    CREATE INDEX IF NOT EXISTS idx_town_events_town_tick ON town_events(town_id, occurred_tick, created_at);
    CREATE INDEX IF NOT EXISTS idx_town_events_resident_tick ON town_events(resident_id, occurred_tick, created_at);
    CREATE INDEX IF NOT EXISTS idx_town_events_unhandled ON town_events(town_id, handled_at, source, occurred_tick);
    CREATE INDEX IF NOT EXISTS idx_town_memories_resident_tick ON town_memories(resident_id, occurred_tick DESC, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_town_memories_reflection_queue ON town_memories(resident_id, reflected_at, occurred_tick);
    CREATE INDEX IF NOT EXISTS idx_town_reflections_resident_created ON town_reflections(resident_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_town_schedules_town_day ON town_schedules(town_id, day, resident_id);
    CREATE INDEX IF NOT EXISTS idx_town_schedule_items_schedule_order ON town_schedule_items(schedule_id, order_index);

    CREATE INDEX IF NOT EXISTS idx_conversation_memories_layer ON conversation_memories(conversation_id, layer, importance DESC);

  `);
}
