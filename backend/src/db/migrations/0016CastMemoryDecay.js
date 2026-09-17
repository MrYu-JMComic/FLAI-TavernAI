export function migrateCastMemoryDecay(database) {
  const columns = database.prepare('PRAGMA table_info(cast_memories)').all();
  if (!columns.some((entry) => entry.name === 'last_decayed_at')) {
    database.exec('ALTER TABLE cast_memories ADD COLUMN last_decayed_at TEXT');
  }
}
