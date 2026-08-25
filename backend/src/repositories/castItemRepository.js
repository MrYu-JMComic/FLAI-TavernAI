import { parseCastJson } from '../domain/cast/normalization.js';

export function listCastItems(database, conversationId, memberId, options = {}) {
  const limit = Math.max(1, Number(options.limit || 200));
  const offset = Math.max(0, Number(options.offset || 0));
  return database.prepare(
    `SELECT * FROM scene_items
     WHERE conversation_id = ? AND owner_kind = 'cast' AND owner_member_id = ?
     ORDER BY equipped DESC, item_kind ASC, clothing_slot ASC, name COLLATE NOCASE ASC, created_at ASC
     LIMIT ? OFFSET ?`
  ).all(conversationId, memberId, limit, offset).map(toCastItem);
}

export function listWorldItems(database, conversationId, nodeId = '') {
  return database.prepare(
    `SELECT * FROM scene_items
     WHERE conversation_id = ? AND owner_kind = 'world' AND (? = '' OR node_id = ?)
     ORDER BY name COLLATE NOCASE ASC, created_at ASC`
  ).all(conversationId, nodeId, nodeId).map(toCastItem);
}

export function getCastItem(database, conversationId, itemId) {
  const row = database.prepare(
    'SELECT * FROM scene_items WHERE conversation_id = ? AND id = ?'
  ).get(conversationId, itemId);
  return row ? toCastItem(row) : null;
}

export function findCastItemByCode(database, conversationId, itemCode) {
  const row = database.prepare(
    'SELECT * FROM scene_items WHERE conversation_id = ? AND item_code = ?'
  ).get(conversationId, itemCode);
  return row ? toCastItem(row) : null;
}

export function insertCastItem(database, item) {
  database.prepare(
    `INSERT INTO scene_items (
       id, conversation_id, node_id, owner_kind, owner_member_id, item_code,
       name, description, state_json, position_json, movable, item_kind,
       quantity, clothing_slot, equipped, coverage_json, icon_key, revision,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(...castItemValues(item));
  return getCastItem(database, item.conversationId, item.id);
}

export function updateCastItem(database, item, expectedRevision) {
  const result = database.prepare(
    `UPDATE scene_items SET
       node_id = ?, owner_kind = ?, owner_member_id = ?, item_code = ?, name = ?,
       description = ?, state_json = ?, position_json = ?, movable = ?,
       item_kind = ?, quantity = ?, clothing_slot = ?, equipped = ?,
       coverage_json = ?, icon_key = ?, revision = revision + 1, updated_at = ?
     WHERE conversation_id = ? AND id = ? AND revision = ?`
  ).run(
    item.nodeId || null,
    item.ownerKind,
    item.ownerMemberId || null,
    item.itemCode,
    item.name,
    item.description,
    JSON.stringify(item.state),
    JSON.stringify(item.position),
    item.movable ? 1 : 0,
    item.itemKind,
    item.quantity,
    item.clothingSlot,
    item.equipped ? 1 : 0,
    JSON.stringify(item.coverage),
    item.iconKey,
    item.updatedAt,
    item.conversationId,
    item.id,
    expectedRevision
  );
  return result.changes ? getCastItem(database, item.conversationId, item.id) : null;
}

export function deleteCastItem(database, conversationId, itemId, expectedRevision) {
  return database.prepare(
    'DELETE FROM scene_items WHERE conversation_id = ? AND id = ? AND revision = ?'
  ).run(conversationId, itemId, expectedRevision).changes > 0;
}

export function sceneNodeBelongsToConversation(database, conversationId, nodeId) {
  return Boolean(database.prepare(
    'SELECT 1 FROM scene_nodes WHERE conversation_id = ? AND id = ?'
  ).get(conversationId, nodeId));
}

function castItemValues(item) {
  return [
    item.id,
    item.conversationId,
    item.nodeId || null,
    item.ownerKind,
    item.ownerMemberId || null,
    item.itemCode,
    item.name,
    item.description,
    JSON.stringify(item.state),
    JSON.stringify(item.position),
    item.movable ? 1 : 0,
    item.itemKind,
    item.quantity,
    item.clothingSlot,
    item.equipped ? 1 : 0,
    JSON.stringify(item.coverage),
    item.iconKey,
    item.createdAt,
    item.updatedAt,
  ];
}

export function toCastItem(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    nodeId: row.node_id || '',
    ownerKind: row.owner_kind,
    ownerMemberId: row.owner_member_id || '',
    itemCode: row.item_code,
    name: row.name,
    description: row.description,
    state: parseCastJson(row.state_json, {}),
    position: parseCastJson(row.position_json, {}),
    movable: Boolean(row.movable),
    itemKind: row.item_kind,
    quantity: row.quantity,
    clothingSlot: row.clothing_slot,
    equipped: Boolean(row.equipped),
    coverage: parseCastJson(row.coverage_json, []),
    iconKey: row.icon_key,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
