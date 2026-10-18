import { newId, nowIso } from '../security.js';
import { AppError } from '../errors.js';
import { parseJson } from '../utils/json.js';

export function listSceneItems(database, conversationId, nodeId = '') {
  const rows = nodeId
    ? database.prepare('SELECT * FROM scene_objects WHERE conversation_id = ? AND node_id = ? ORDER BY created_at, id').all(conversationId, nodeId)
    : database.prepare('SELECT * FROM scene_objects WHERE conversation_id = ? ORDER BY created_at, id').all(conversationId);
  return rows.map(toItem);
}

export function saveSceneItem(database, conversationId, payload) {
  const suppliedId = text(payload.id, 160);
  let current = suppliedId ? database.prepare('SELECT * FROM scene_objects WHERE id = ? AND conversation_id = ?').get(suppliedId, conversationId) : null;
  if (suppliedId && !current) throw new AppError(404, 'SCENE_ITEM_NOT_FOUND', '场景物品不存在');
  const code = text(payload.itemCode, 120);
  if (!current && code) current = database.prepare('SELECT * FROM scene_objects WHERE item_code = ? AND conversation_id = ?').get(code, conversationId);
  assertRevision(current, payload.revision);
  const id = current?.id || newId();
  const nodeId = text(payload.nodeId ?? current?.node_id, 160);
  if (!database.prepare('SELECT id FROM scene_nodes WHERE id = ? AND conversation_id = ?').get(nodeId, conversationId)) {
    throw new AppError(400, 'SCENE_NODE_INVALID', '场景节点不存在');
  }
  const name = text(payload.name ?? current?.name, 500);
  if (!name) throw new AppError(400, 'SCENE_ITEM_INVALID', '物品名称不能为空');
  const itemCode = code || current?.item_code || `ITEM-${id}`;
  const duplicate = database.prepare('SELECT id FROM scene_objects WHERE conversation_id = ? AND item_code = ? AND id != ?').get(conversationId, itemCode, id);
  if (duplicate) throw new AppError(409, 'SCENE_ITEM_CODE_CONFLICT', '物品编号已被使用');
  const quantity = Number(payload.quantity ?? current?.quantity ?? 1);
  if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 1_000_000) {
    throw new AppError(400, 'SCENE_ITEM_INVALID', '物品数量无效');
  }
  const timestamp = nowIso();
  database.prepare(`INSERT INTO scene_objects
    (id, conversation_id, node_id, item_code, name, description, state_json, position_json,
     movable, quantity, icon_key, revision, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET node_id = excluded.node_id, item_code = excluded.item_code,
      name = excluded.name, description = excluded.description, state_json = excluded.state_json,
      position_json = excluded.position_json, movable = excluded.movable, quantity = excluded.quantity,
      icon_key = excluded.icon_key, revision = excluded.revision, updated_at = excluded.updated_at`)
    .run(id, conversationId, nodeId, itemCode, name, text(payload.description ?? current?.description, 8000),
      JSON.stringify(object(payload.state ?? parseJson(current?.state_json, {}))),
      JSON.stringify(object(payload.position ?? parseJson(current?.position_json, {}))),
      payload.movable === undefined ? current?.movable ?? 1 : payload.movable ? 1 : 0,
      quantity, text(payload.iconKey ?? current?.icon_key, 120), (current?.revision || 0) + 1,
      current?.created_at || timestamp, timestamp);
  return toItem(database.prepare('SELECT * FROM scene_objects WHERE id = ?').get(id));
}

export function removeSceneItem(database, conversationId, id, revision) {
  const current = database.prepare('SELECT * FROM scene_objects WHERE id = ? AND conversation_id = ?').get(id, conversationId);
  if (!current) return false;
  assertRevision(current, revision);
  return database.prepare('DELETE FROM scene_objects WHERE id = ? AND conversation_id = ?').run(id, conversationId).changes > 0;
}

function assertRevision(current, revision) {
  if (current && revision !== undefined && revision !== current.revision) {
    throw new AppError(409, 'SCENE_ITEM_REVISION_CONFLICT', '场景物品已更新，请重新读取');
  }
}

function toItem(row) {
  return { id: row.id, conversationId: row.conversation_id, nodeId: row.node_id,
    itemCode: row.item_code, name: row.name, description: row.description,
    state: parseJson(row.state_json, {}), position: parseJson(row.position_json, {}),
    movable: Boolean(row.movable), quantity: row.quantity, iconKey: row.icon_key,
    revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at };
}

function text(value, limit) { return String(value ?? '').trim().slice(0, limit); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
