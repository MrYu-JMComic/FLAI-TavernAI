import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';

const { createAppDatabase } = await import('../db.js');
const { newId, nowIso } = await import('../security.js');
const {
  buildActorStateContext,
  buildSceneContext,
  consolidateSceneWorkspace,
  deleteSceneEntity,
  evaluateActorAppearance,
  listActorItems,
  listSceneItemAudit,
  listSceneWorkspace,
  rollbackSceneItemAudit,
  upsertSceneItem,
  upsertSceneNode,
  upsertSceneRoute
} = await import('../modules/scenes.js');
const { hideConversationNpc } = await import('../modules/npcs.js');

function createSceneFixture() {
  const db = createAppDatabase(':memory:');
  const userId = newId();
  const otherUserId = newId();
  const characterId = newId();
  const conversationId = newId();
  const otherConversationId = newId();
  const timestamp = nowIso();
  db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(userId, `scene-${newId().slice(0, 8)}`, 'test', timestamp);
  db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(otherUserId, `scene-other-${newId().slice(0, 8)}`, 'test', timestamp);
  db.prepare('INSERT INTO characters (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(characterId, userId, '场景测试角色', timestamp, timestamp);
  db.prepare('INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(conversationId, userId, characterId, '场景测试', timestamp, timestamp);
  db.prepare('INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(otherConversationId, otherUserId, characterId, '其他会话', timestamp, timestamp);
  return { db, userId, otherUserId, conversationId, otherConversationId };
}

test('scene workspace preserves hierarchy, routes, layouts, and immutable item codes', () => {
  const fixture = createSceneFixture();
  const mainScene = upsertSceneNode(fixture.db, fixture.userId, fixture.conversationId, {
    nodeType: 'main_scene',
    name: '边境城',
    description: '城内主要区域'
  });
  const building = upsertSceneNode(fixture.db, fixture.userId, fixture.conversationId, {
    nodeType: 'building',
    parentId: mainScene.id,
    name: '银月酒馆',
    layout: { floors: 2 }
  });
  const room = upsertSceneNode(fixture.db, fixture.userId, fixture.conversationId, {
    nodeType: 'room',
    parentId: building.id,
    name: '二层客房',
    layout: { exits: ['stairs'], size: { width: 8, height: 6 } }
  });
  const item = upsertSceneItem(fixture.db, fixture.userId, fixture.conversationId, {
    nodeId: room.id,
    itemCode: 'itm_lantern_01',
    name: '铜制提灯',
    movable: true,
    position: { x: 1, y: 2 }
  });
  const moved = upsertSceneItem(fixture.db, fixture.userId, fixture.conversationId, {
    nodeId: room.id,
    itemCode: item.itemCode,
    name: '铜制提灯（已移动）',
    movable: true,
    position: { x: 6, y: 4 }
  });
  const route = upsertSceneRoute(fixture.db, fixture.userId, fixture.conversationId, {
    fromNodeId: mainScene.id,
    toNodeId: building.id,
    label: '城南街道'
  });

  assert.equal(moved.id, item.id);
  assert.equal(moved.itemCode, 'itm_lantern_01');
  assert.deepEqual(moved.position, { x: 6, y: 4 });
  assert.equal(route.fromNodeId, mainScene.id);
  assert.equal(route.toNodeId, building.id);
  const workspace = listSceneWorkspace(fixture.db, fixture.userId, fixture.conversationId);
  assert.equal(workspace.nodes.length, 3);
  assert.equal(workspace.routes.length, 1);
  assert.equal(workspace.items.length, 1);
  const sceneContext = buildSceneContext(fixture.db, fixture.conversationId);
  assert.match(sceneContext, /itm_lantern_01/);
  assert.match(sceneContext, /银月酒馆 > 二层客房/);
  assert.match(sceneContext, /边境城 <-> 银月酒馆/);
  assert.doesNotMatch(sceneContext, new RegExp(fixture.conversationId));
  assert.doesNotMatch(sceneContext, /createdAt|updatedAt|conversationId/);
  assert.ok(sceneContext.length < JSON.stringify(workspace).length);
});

test('scene workspace enforces conversation ownership', () => {
  const fixture = createSceneFixture();
  assert.throws(
    () => listSceneWorkspace(fixture.db, fixture.otherUserId, fixture.conversationId),
    /Conversation not found/
  );
  assert.doesNotThrow(() => listSceneWorkspace(fixture.db, fixture.otherUserId, fixture.otherConversationId));
});

test('scene nodes merge equivalent room names and infer a building parent', () => {
  const fixture = createSceneFixture();
  const first = upsertSceneNode(fixture.db, fixture.userId, fixture.conversationId, {
    nodeType: 'room',
    parentName: '宿舍楼',
    name: '莉晓宁寝室（四人间）'
  });
  const second = upsertSceneNode(fixture.db, fixture.userId, fixture.conversationId, {
    nodeType: 'room',
    parentName: '宿舍楼',
    name: '莉晓宁四人寝室'
  });
  assert.equal(second.id, first.id);
  const cleanup = consolidateSceneWorkspace(fixture.db, fixture.userId, fixture.conversationId);
  assert.equal(cleanup.mergedNodes, 0);
  const workspace = listSceneWorkspace(fixture.db, fixture.userId, fixture.conversationId);
  assert.equal(workspace.nodes.filter(node => node.nodeType === 'room').length, 1);
  assert.equal(workspace.nodes.filter(node => node.nodeType === 'building').length, 1);
  assert.equal(workspace.nodes.find(node => node.nodeType === 'room').parentId, workspace.nodes.find(node => node.nodeType === 'building').id);
});

test('one stable item code transfers between owners without duplication', () => {
  const fixture = createSceneFixture();
  const item = upsertSceneItem(fixture.db, fixture.userId, fixture.conversationId, {
    itemCode: 'itm_unique_key',
    ownerType: 'protagonist',
    name: '黄铜钥匙',
    itemKind: 'item',
    iconKey: 'item.key',
    movable: true
  });
  const transferred = upsertSceneItem(fixture.db, fixture.userId, fixture.conversationId, {
    itemCode: 'itm_unique_key',
    ownerType: 'npc',
    ownerName: '米拉',
    name: '黄铜钥匙',
    itemKind: 'item',
    iconKey: 'item.key',
    movable: true
  });

  assert.equal(transferred.id, item.id);
  assert.equal(transferred.nodeId, '');
  assert.equal(listActorItems(fixture.db, fixture.userId, fixture.conversationId, 'protagonist').length, 0);
  assert.equal(listActorItems(fixture.db, fixture.userId, fixture.conversationId, 'npc', '米拉').length, 1);
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM scene_items WHERE conversation_id = ? AND item_code = ?').get(fixture.conversationId, 'itm_unique_key').count, 1);
});

test('scene hierarchy rejects descendant-parent cycles', () => {
  const fixture = createSceneFixture();
  const building = upsertSceneNode(fixture.db, fixture.userId, fixture.conversationId, {
    nodeType: 'building', name: '循环测试楼'
  });
  const room = upsertSceneNode(fixture.db, fixture.userId, fixture.conversationId, {
    nodeType: 'room', parentId: building.id, name: '循环测试房间'
  });
  const rejected = upsertSceneNode(fixture.db, fixture.userId, fixture.conversationId, {
    id: building.id, nodeType: 'building', parentId: room.id, name: building.name
  });
  assert.equal(rejected, null);
});

test('node deletion refuses to orphan world items and cleanup repairs legacy orphans', () => {
  const fixture = createSceneFixture();
  const room = upsertSceneNode(fixture.db, fixture.userId, fixture.conversationId, {
    nodeType: 'room', parentName: '审查建筑', name: '带物品房间'
  });
  const item = upsertSceneItem(fixture.db, fixture.userId, fixture.conversationId, {
    nodeId: room.id, itemCode: 'itm_guarded', name: '受保护物品', ownerType: 'world', itemKind: 'item'
  });
  assert.equal(deleteSceneEntity(fixture.db, fixture.userId, fixture.conversationId, 'node', room.id), false);
  fixture.db.prepare('UPDATE scene_items SET node_id = NULL WHERE id = ?').run(item.id);
  const cleanup = consolidateSceneWorkspace(fixture.db, fixture.userId, fixture.conversationId);
  const repaired = listSceneWorkspace(fixture.db, fixture.userId, fixture.conversationId).items.find(value => value.id === item.id);
  assert.equal(cleanup.repairedItems, 1);
  assert.ok(repaired.nodeId);
});

test('hidden NPC possessions are excluded from actor prompt context', () => {
  const fixture = createSceneFixture();
  upsertSceneItem(fixture.db, fixture.userId, fixture.conversationId, {
    itemCode: 'itm_hidden_owner', name: '不应注入的物品', ownerType: 'npc', ownerName: '误识别NPC', itemKind: 'item'
  });
  hideConversationNpc(fixture.db, fixture.userId, fixture.conversationId, '误识别NPC');
  assert.doesNotMatch(buildActorStateContext(fixture.db, fixture.conversationId), /不应注入的物品/);
});

test('scene item audit records destructive changes and can roll them back', () => {
  const fixture = createSceneFixture();
  const item = upsertSceneItem(fixture.db, fixture.userId, fixture.conversationId, {
    itemCode: 'itm_audited', name: '可回滚物品', ownerType: 'protagonist', itemKind: 'item'
  });
  upsertSceneItem(fixture.db, fixture.userId, fixture.conversationId, {
    id: item.id, name: '已修改物品', ownerType: 'protagonist', itemKind: 'item'
  });
  deleteSceneEntity(fixture.db, fixture.userId, fixture.conversationId, 'item', item.id, { actor: 'agent' });
  const audit = listSceneItemAudit(fixture.db, fixture.userId, fixture.conversationId, 'protagonist');
  assert.deepEqual(audit.slice(0, 3).map(record => record.action), ['delete', 'update', 'create']);
  const rollback = rollbackSceneItemAudit(fixture.db, fixture.userId, fixture.conversationId, audit[0].id);
  assert.equal(rollback.rolledBack, true);
  assert.equal(rollback.item.name, '已修改物品');
  assert.equal(listActorItems(fixture.db, fixture.userId, fixture.conversationId, 'protagonist').length, 1);
});

test('clothing visibility respects underwear, long tops, and one-piece outfits', () => {
  const lowerUnderwear = {
    itemCode: 'itm_underwear', itemKind: 'clothing', clothingSlot: 'lower_underwear',
    equipped: true, coverage: ['groin', 'buttocks']
  };
  const underwearOnly = evaluateActorAppearance([lowerUnderwear]);
  assert.deepEqual(underwearOnly.visibleUnderwear, ['itm_underwear']);
  assert.match(underwearOnly.summary, /内衣可见/);

  const longTop = {
    itemCode: 'itm_long_top', itemKind: 'clothing', clothingSlot: 'top',
    equipped: true, coverage: ['chest', 'abdomen', 'groin', 'buttocks']
  };
  const covered = evaluateActorAppearance([lowerUnderwear, longTop]);
  assert.deepEqual(covered.visibleUnderwear, []);
  assert.doesNotMatch(covered.summary, /内衣可见/);

  const swimsuit = {
    itemCode: 'itm_swimsuit', itemKind: 'clothing', clothingSlot: 'outfit',
    equipped: true, coverage: ['chest', 'groin', 'buttocks']
  };
  assert.equal(evaluateActorAppearance([swimsuit]).intimateExposure.length, 0);
});

test('actor state context exposes visual conclusions and independent clothing entries', () => {
  const fixture = createSceneFixture();
  upsertSceneItem(fixture.db, fixture.userId, fixture.conversationId, {
    itemCode: 'itm_lower', ownerType: 'protagonist', name: '黑色内裤', itemKind: 'clothing',
    clothingSlot: 'lower_underwear', equipped: true, coverage: ['groin', 'buttocks'], iconKey: 'clothing.underwear'
  });
  const context = buildActorStateContext(fixture.db, fixture.conversationId);
  assert.match(context, /itm_lower 黑色内裤/);
  assert.match(context, /衣物槽=lower_underwear/);
  assert.match(context, /内衣可见/);
});
