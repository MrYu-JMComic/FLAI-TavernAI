export function migrateFullTextSearch(database) {
  database.exec('SAVEPOINT migration_0007_full_text_search');
  try {
    database.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS fts_messages USING fts5(
        entity_id UNINDEXED,
        user_id UNINDEXED,
        conversation_id UNINDEXED,
        role UNINDEXED,
        content,
        tokenize = 'unicode61 remove_diacritics 2'
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS fts_memories USING fts5(
        entity_id UNINDEXED,
        user_id UNINDEXED,
        conversation_id UNINDEXED,
        subject,
        content,
        tokenize = 'unicode61 remove_diacritics 2'
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS fts_world_book_entries USING fts5(
        entity_id UNINDEXED,
        user_id UNINDEXED,
        world_book_id UNINDEXED,
        name,
        keywords,
        content,
        tokenize = 'unicode61 remove_diacritics 2'
      );

      DELETE FROM fts_messages;
      INSERT INTO fts_messages (entity_id, user_id, conversation_id, role, content)
        SELECT id, user_id, conversation_id, role, content FROM messages;
      DELETE FROM fts_memories;
      INSERT INTO fts_memories (entity_id, user_id, conversation_id, subject, content)
        SELECT id, user_id, conversation_id, subject, content FROM conversation_memories;
      DELETE FROM fts_world_book_entries;
      INSERT INTO fts_world_book_entries (entity_id, user_id, world_book_id, name, keywords, content)
        SELECT entries.id, books.user_id, entries.world_book_id, entries.name,
               entries.trigger_keys || ' ' || entries.keys_secondary, entries.content
        FROM world_book_entries entries
        JOIN world_books books ON books.id = entries.world_book_id;

      CREATE TRIGGER IF NOT EXISTS fts_messages_insert AFTER INSERT ON messages BEGIN
        INSERT INTO fts_messages (entity_id, user_id, conversation_id, role, content)
        VALUES (new.id, new.user_id, new.conversation_id, new.role, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS fts_messages_update AFTER UPDATE ON messages BEGIN
        DELETE FROM fts_messages WHERE entity_id = old.id;
        INSERT INTO fts_messages (entity_id, user_id, conversation_id, role, content)
        VALUES (new.id, new.user_id, new.conversation_id, new.role, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS fts_messages_delete AFTER DELETE ON messages BEGIN
        DELETE FROM fts_messages WHERE entity_id = old.id;
      END;

      CREATE TRIGGER IF NOT EXISTS fts_memories_insert AFTER INSERT ON conversation_memories BEGIN
        INSERT INTO fts_memories (entity_id, user_id, conversation_id, subject, content)
        VALUES (new.id, new.user_id, new.conversation_id, new.subject, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS fts_memories_update AFTER UPDATE ON conversation_memories BEGIN
        DELETE FROM fts_memories WHERE entity_id = old.id;
        INSERT INTO fts_memories (entity_id, user_id, conversation_id, subject, content)
        VALUES (new.id, new.user_id, new.conversation_id, new.subject, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS fts_memories_delete AFTER DELETE ON conversation_memories BEGIN
        DELETE FROM fts_memories WHERE entity_id = old.id;
      END;

      CREATE TRIGGER IF NOT EXISTS fts_world_entries_insert AFTER INSERT ON world_book_entries BEGIN
        INSERT INTO fts_world_book_entries (entity_id, user_id, world_book_id, name, keywords, content)
        SELECT new.id, books.user_id, new.world_book_id, new.name,
               new.trigger_keys || ' ' || new.keys_secondary, new.content
        FROM world_books books WHERE books.id = new.world_book_id;
      END;
      CREATE TRIGGER IF NOT EXISTS fts_world_entries_update AFTER UPDATE ON world_book_entries BEGIN
        DELETE FROM fts_world_book_entries WHERE entity_id = old.id;
        INSERT INTO fts_world_book_entries (entity_id, user_id, world_book_id, name, keywords, content)
        SELECT new.id, books.user_id, new.world_book_id, new.name,
               new.trigger_keys || ' ' || new.keys_secondary, new.content
        FROM world_books books WHERE books.id = new.world_book_id;
      END;
      CREATE TRIGGER IF NOT EXISTS fts_world_entries_delete AFTER DELETE ON world_book_entries BEGIN
        DELETE FROM fts_world_book_entries WHERE entity_id = old.id;
      END;
    `);
    database.exec('RELEASE SAVEPOINT migration_0007_full_text_search');
  } catch (error) {
    database.exec('ROLLBACK TO SAVEPOINT migration_0007_full_text_search');
    database.exec('RELEASE SAVEPOINT migration_0007_full_text_search');
    throw error;
  }
}
