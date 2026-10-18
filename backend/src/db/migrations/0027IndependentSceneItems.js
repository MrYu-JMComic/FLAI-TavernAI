// Scene storage is independent of character inventories. Existing source rows
// stay untouched so upgrading never destroys user data.
export function migrateIndependentSceneItems(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS scene_objects (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    item_code TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    state_json TEXT NOT NULL DEFAULT '{}',
    position_json TEXT NOT NULL DEFAULT '{}',
    movable INTEGER NOT NULL DEFAULT 1,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
    icon_key TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(conversation_id, item_code),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (node_id) REFERENCES scene_nodes(id) ON DELETE CASCADE
  )`);
  const columns = new Set(database.prepare('PRAGMA table_info(scene_items)').all().map(row => row.name));
  if (!columns.has('node_id')) return;
  const fields = ['id', 'conversation_id', 'node_id', 'item_code', 'name', 'description',
    'state_json', 'position_json', 'movable', 'quantity', 'icon_key', 'revision', 'created_at', 'updated_at'];
  const defaults = { item_code: 'id', description: "''", state_json: "'{}'", position_json: "'{}'",
    movable: '1', quantity: '1', icon_key: "''", revision: '1' };
  database.exec(`INSERT OR IGNORE INTO scene_objects (${fields.join(', ')})
    SELECT ${fields.map(field => columns.has(field) ? `s.${field}` : defaults[field]).join(', ')}
    FROM scene_items s
    WHERE ${columns.has('owner_kind') ? "s.owner_kind = 'world' AND " : ''}
      EXISTS (SELECT 1 FROM scene_nodes n WHERE n.id = s.node_id AND n.conversation_id = s.conversation_id)`);
}
