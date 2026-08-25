import { nowIso } from '../security.js';
import { advanceWorldTime } from './dynamicWorld.js';
import { recordWorldEvent } from './worldEvents.js';
import { withSavepoint } from './savepoint.js';

export function getTravelMap(database, userId, conversationId, options = {}) {
  if (!hasConversationAccess(database, userId, conversationId)) return null;
  const nodes = database.prepare('SELECT * FROM scene_nodes WHERE conversation_id = ? ORDER BY created_at, rowid').all(conversationId);
  const routes = database.prepare('SELECT * FROM scene_routes WHERE conversation_id = ? ORDER BY created_at, rowid').all(conversationId);
  const current = ensureTravelState(database, conversationId, nodes, options.ensure !== false);
  if (current?.current_node_id) discoverNode(database, conversationId, current.current_node_id, 'system');
  const discovered = new Set(database.prepare('SELECT node_id FROM discovered_scene_nodes WHERE conversation_id = ?').all(conversationId).map(row => row.node_id));
  const currentNode = nodes.find(node => node.id === current?.current_node_id) || null;
  const availableRoutes = [];
  for (const route of routes) {
    let destinationId = '';
    if (route.from_node_id === currentNode?.id) destinationId = route.to_node_id;
    else if (route.bidirectional && route.to_node_id === currentNode?.id) destinationId = route.from_node_id;
    if (!destinationId) continue;
    const destination = nodes.find(node => node.id === destinationId);
    if (!destination) continue;
    availableRoutes.push({
      id: route.id,
      label: route.label || `${currentNode.name} → ${destination.name}`,
      description: route.description || '',
      destination: toNode(destination, discovered.has(destination.id)),
      minutes: routeMinutes(currentNode, destination)
    });
  }
  return {
    currentNode: currentNode ? toNode(currentNode, true) : null,
    discoveredNodes: nodes.filter(node => discovered.has(node.id)).map(node => toNode(node, true)),
    availableRoutes
  };
}

export function discoverTravelNode(database, userId, conversationId, nodeId, source = 'player') {
  if (!hasConversationAccess(database, userId, conversationId)) return { ok: false, error: '对话不存在' };
  const node = database.prepare('SELECT * FROM scene_nodes WHERE id = ? AND conversation_id = ?').get(String(nodeId || '').trim(), conversationId);
  if (!node) return { ok: false, error: '地点不存在' };
  const added = discoverNode(database, conversationId, node.id, source);
  if (added) recordWorldEvent(database, userId, conversationId, {
    eventType: 'travel.location.discovered', source, title: `地图发现：${node.name}`,
    entityType: 'scene_node', entityId: node.id
  });
  return { ok: true, node: toNode(node, true), added };
}

export function travelToNode(database, userId, conversationId, payload = {}) {
  const map = getTravelMap(database, userId, conversationId);
  if (!map) return { ok: false, error: '对话不存在' };
  if (!map.currentNode) return { ok: false, error: '尚未建立当前位置' };
  const destinationId = String(payload.destinationNodeId || '').trim();
  const route = map.availableRoutes.find(item => item.destination.id === destinationId);
  if (!route) return { ok: false, error: '目标地点不可从当前位置直接到达' };
  return withSavepoint(database, 'sp_player_travel', () => {
    const timestamp = nowIso();
    database.prepare('UPDATE player_travel_states SET current_node_id = ?, updated_at = ? WHERE conversation_id = ?')
      .run(destinationId, timestamp, conversationId);
    discoverNode(database, conversationId, destinationId, payload.source || 'player');
    const advance = advanceWorldTime(database, userId, conversationId, { minutes: route.minutes, source: payload.source || 'travel' });
    recordWorldEvent(database, userId, conversationId, {
      eventType: 'travel.completed', source: payload.source || 'player',
      title: `旅行：${map.currentNode.name} → ${route.destination.name}`,
      detail: `耗时 ${route.minutes} 分钟`, entityType: 'scene_node', entityId: destinationId,
      payload: { fromNodeId: map.currentNode.id, toNodeId: destinationId, routeId: route.id, minutes: route.minutes }
    });
    return { ok: true, from: map.currentNode, destination: route.destination, route, advance, map: getTravelMap(database, userId, conversationId, { ensure: false }) };
  });
}

function ensureTravelState(database, conversationId, nodes, ensure) {
  let row = database.prepare('SELECT * FROM player_travel_states WHERE conversation_id = ?').get(conversationId);
  if (!row && ensure && nodes.length) {
    const initial = nodes[nodes.length - 1];
    database.prepare('INSERT INTO player_travel_states (conversation_id, current_node_id, updated_at) VALUES (?, ?, ?)').run(conversationId, initial.id, nowIso());
    row = database.prepare('SELECT * FROM player_travel_states WHERE conversation_id = ?').get(conversationId);
  }
  return row || null;
}

function discoverNode(database, conversationId, nodeId, source) {
  const result = database.prepare('INSERT OR IGNORE INTO discovered_scene_nodes (conversation_id, node_id, discovered_at, source) VALUES (?, ?, ?, ?)')
    .run(conversationId, nodeId, nowIso(), String(source || 'player').slice(0, 40));
  return result.changes > 0;
}

function routeMinutes(from, to) {
  const weight = { room: 10, building: 20, area: 30, main_scene: 45, map: 60 };
  return Math.max(weight[from?.node_type] || 30, weight[to?.node_type] || 30);
}

function toNode(row, discovered) {
  return { id: row.id, name: row.name, nodeType: row.node_type, parentId: row.parent_id || '', description: discovered ? row.description || '' : '', discovered };
}

function hasConversationAccess(database, userId, conversationId) {
  return Boolean(database.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').get(conversationId, userId));
}
