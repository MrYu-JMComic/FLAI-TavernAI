export function readOwnedTownRow(database, userId, townId) {
  return database.prepare('SELECT * FROM town_worlds WHERE id = ? AND user_id = ?').get(townId, userId) || null;
}

export function listOwnedTownRows(database, userId) {
  return database.prepare(
    'SELECT * FROM town_worlds WHERE user_id = ? ORDER BY updated_at DESC, rowid DESC'
  ).all(userId);
}

export function readTownResidentRow(database, townId, residentId) {
  return database.prepare('SELECT * FROM town_residents WHERE id = ? AND town_id = ?')
    .get(residentId, townId) || null;
}

export function readTownEventRow(database, townId, eventId) {
  return database.prepare('SELECT * FROM town_events WHERE id = ? AND town_id = ?')
    .get(eventId, townId) || null;
}

export function readTownMemoryRow(database, townId, residentId, memoryId) {
  return database.prepare(
    'SELECT * FROM town_memories WHERE id = ? AND town_id = ? AND resident_id = ?'
  ).get(memoryId, townId, residentId) || null;
}

export function readTownReflectionRow(database, townId, residentId, reflectionId) {
  return database.prepare(
    'SELECT * FROM town_reflections WHERE id = ? AND town_id = ? AND resident_id = ?'
  ).get(reflectionId, townId, residentId) || null;
}

export function townUserExists(database, userId) {
  return Boolean(database.prepare('SELECT id FROM users WHERE id = ?').get(userId));
}
