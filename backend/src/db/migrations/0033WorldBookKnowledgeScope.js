/** Existing lore remains author knowledge until the owner explicitly grants actor visibility. */
export function migrateWorldBookKnowledgeScope(database) {
  const columns = new Set(database.prepare('PRAGMA table_info(world_book_entries)').all().map((column) => column.name));
  if (!columns.has('knowledge_visibility')) database.exec("ALTER TABLE world_book_entries ADD COLUMN knowledge_visibility TEXT NOT NULL DEFAULT 'author' CHECK (knowledge_visibility IN ('author', 'public', 'restricted'))");
  if (!columns.has('audience_cast_keys')) database.exec("ALTER TABLE world_book_entries ADD COLUMN audience_cast_keys TEXT NOT NULL DEFAULT '[]'");
}
