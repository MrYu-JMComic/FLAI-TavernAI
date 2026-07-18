import { newId, nowIso } from '../security.js';
import { clampInteger } from '../utils/number.js';
import { parseJson } from '../utils/json.js';
import { updateConversationNpc } from './npcs.js';
import { withSavepoint } from './savepoint.js';
import { recordWorldEvent } from './worldEvents.js';

const MINUTES_PER_DAY = 1440;
const TERMINAL_NPC_STATUSES = new Set(['permanently_left', 'dead']);
const ACTIVITY_STATUSES = new Set(['scheduled', 'active', 'completed', 'cancelled', 'blocked']);

export function getWorldClock(database, userId, conversationId, options = {}) {
  if (!hasConversationAccess(database, userId, conversationId)) return null;
  let row = database.prepare('SELECT * FROM world_clocks WHERE conversation_id = ?').get(conversationId);
  if (!row && options.ensure !== false) {
    database.prepare('INSERT INTO world_clocks (conversation_id, current_day, minute_of_day, weather, updated_at) VALUES (?, 1, 480, ?, ?)')
      .run(conversationId, '晴朗', nowIso());
    row = database.prepare('SELECT * FROM world_clocks WHERE conversation_id = ?').get(conversationId);
  }
  return row ? toWorldClock(row) : null;
}

export function setWorldWeather(database, userId, conversationId, weather, source = 'manual') {
  const clock = getWorldClock(database, userId, conversationId);
  if (!clock) return null;
  const normalizedWeather = normalizeText(weather, 80);
  if (!normalizedWeather) return null;
  database.prepare('UPDATE world_clocks SET weather = ?, updated_at = ? WHERE conversation_id = ?').run(normalizedWeather, nowIso(), conversationId);
  const updated = getWorldClock(database, userId, conversationId, { ensure: false });
  if (updated.weather !== clock.weather) recordWorldEvent(database, userId, conversationId, {
    eventType: 'world.weather.changed', source, title: `天气变化：${clock.weather} → ${updated.weather}`,
    entityType: 'world_clock', entityId: conversationId, payload: { before: clock.weather, after: updated.weather }
  });
  return updated;
}

export function listNpcActivities(database, userId, conversationId, options = {}) {
  if (!hasConversationAccess(database, userId, conversationId)) return null;
  const npcName = normalizeText(options.npcName, 120);
  const status = normalizeActivityStatus(options.status, '');
  const conditions = ['npc_activities.conversation_id = ?'];
  const params = [conversationId];
  if (npcName) { conditions.push('npc_activities.npc_name = ?'); params.push(npcName); }
  if (status) { conditions.push('npc_activities.status = ?'); params.push(status); }
  return database.prepare(
    `SELECT npc_activities.*, scene_nodes.name AS location_name
     FROM npc_activities LEFT JOIN scene_nodes ON scene_nodes.id = npc_activities.location_node_id
     WHERE ${conditions.join(' AND ')} ORDER BY start_tick, end_tick, npc_activities.rowid`
  ).all(...params).map(toNpcActivity);
}

export function scheduleNpcActivity(database, userId, conversationId, payload = {}) {
  const clock = getWorldClock(database, userId, conversationId);
  if (!clock) return { ok: false, error: '对话不存在' };
  const npcName = normalizeText(payload.npcName, 120);
  const title = normalizeText(payload.title, 300);
  if (!npcName || !title) return { ok: false, error: 'NPC 和活动标题不能为空' };
  const npc = getNpcRegistry(database, conversationId, npcName);
  if (!npc) return { ok: false, error: 'NPC 不存在' };
  if (TERMINAL_NPC_STATUSES.has(npc.status)) return { ok: false, error: '终止状态 NPC 不能安排活动' };
  const currentTick = clock.tick;
  const startTick = normalizeTick(payload.startTick, currentTick);
  const durationMinutes = clampInteger(payload.durationMinutes, 1, 10080, 60);
  const endTick = startTick + durationMinutes;
  const locationNodeId = normalizeText(payload.locationNodeId, 160);
  const targetNode = locationNodeId ? database.prepare('SELECT * FROM scene_nodes WHERE id = ? AND conversation_id = ?').get(locationNodeId, conversationId) : null;
  if (locationNodeId && !targetNode) return { ok: false, error: '目标地点不存在' };
  if (targetNode && !canNpcReachNode(database, conversationId, npc.currentLocation, targetNode.id)) return { ok: false, error: 'NPC 当前地点与目标地点之间没有可用路线' };
  const conflict = database.prepare(
    `SELECT id FROM npc_activities WHERE conversation_id = ? AND npc_name = ?
     AND status NOT IN ('completed', 'cancelled', 'blocked') AND start_tick < ? AND end_tick > ? LIMIT 1`
  ).get(conversationId, npcName, endTick, startTick);
  if (conflict) return { ok: false, error: 'NPC 在该时段已有活动' };
  const id = newId();
  const timestamp = nowIso();
  database.prepare(
    `INSERT INTO npc_activities (id, conversation_id, npc_name, title, location_node_id, status, start_tick, end_tick, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?)`
  ).run(id, conversationId, npcName, title, targetNode?.id || null, startTick, endTick, normalizeText(payload.source, 40) || 'manual', timestamp, timestamp);
  const activity = readActivity(database, id);
  recordWorldEvent(database, userId, conversationId, {
    eventType: 'npc.activity.scheduled', source: activity.source, title: `NPC 日程：${npcName} · ${title}`,
    entityType: 'npc_activity', entityId: id, payload: { startTick, endTick, location: activity.locationName }
  });
  return { ok: true, activity };
}

export function updateNpcActivity(database, userId, conversationId, activityId, payload = {}) {
  if (!hasConversationAccess(database, userId, conversationId)) return null;
  const current = readActivity(database, activityId, conversationId);
  if (!current) return null;
  const status = payload.status === undefined ? current.status : normalizeActivityStatus(payload.status, current.status);
  if (status !== current.status && status !== 'cancelled') return null;
  database.prepare('UPDATE npc_activities SET status = ?, updated_at = ? WHERE id = ? AND conversation_id = ?').run(status, nowIso(), activityId, conversationId);
  const updated = readActivity(database, activityId, conversationId);
  if (status === 'cancelled' && current.status !== 'cancelled') recordWorldEvent(database, userId, conversationId, {
    eventType: 'npc.activity.cancelled', source: payload.source || 'manual', title: `活动取消：${updated.npcName} · ${updated.title}`,
    entityType: 'npc_activity', entityId: updated.id, severity: 'warning'
  });
  return updated;
}

export function advanceWorldTime(database, userId, conversationId, payload = {}) {
  const clock = getWorldClock(database, userId, conversationId);
  if (!clock) return null;
  const minutes = clampInteger(payload.minutes, 1, 10080, 60);
  const fromTick = clock.tick;
  const toTick = fromTick + minutes;
  return withSavepoint(database, 'sp_advance_world_time', () => {
    const summary = { started: [], completed: [], blocked: [] };
    const candidates = database.prepare(
      `SELECT npc_activities.*, scene_nodes.name AS location_name
       FROM npc_activities LEFT JOIN scene_nodes ON scene_nodes.id = npc_activities.location_node_id
       WHERE npc_activities.conversation_id = ? AND npc_activities.status IN ('scheduled', 'active')
       AND npc_activities.start_tick <= ? ORDER BY npc_activities.start_tick, npc_activities.rowid`
    ).all(conversationId, toTick);
    for (const row of candidates) processActivityAdvance(database, userId, conversationId, toTick, toNpcActivity(row), summary);
    const day = Math.floor(toTick / MINUTES_PER_DAY) + 1;
    const minuteOfDay = toTick % MINUTES_PER_DAY;
    database.prepare('UPDATE world_clocks SET current_day = ?, minute_of_day = ?, updated_at = ? WHERE conversation_id = ?')
      .run(day, minuteOfDay, nowIso(), conversationId);
    const id = newId();
    database.prepare(
      `INSERT INTO world_advances (id, conversation_id, from_tick, to_tick, minutes, weather_before, weather_after, summary_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, conversationId, fromTick, toTick, minutes, clock.weather, clock.weather, JSON.stringify(summary), nowIso());
    recordWorldEvent(database, userId, conversationId, {
      eventType: 'world.time.advanced', source: payload.source || 'player', title: `时间推进 ${minutes} 分钟`,
      detail: `第 ${day} 天 ${formatMinute(minuteOfDay)}`, entityType: 'world_advance', entityId: id,
      payload: { fromTick, toTick, minutes, summary }
    });
    return { clock: getWorldClock(database, userId, conversationId, { ensure: false }), summary, advanceId: id };
  });
}

export function listWorldAdvances(database, userId, conversationId, limit = 30) {
  if (!hasConversationAccess(database, userId, conversationId)) return null;
  return database.prepare('SELECT * FROM world_advances WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .all(conversationId, clampInteger(limit, 1, 100, 30)).map(row => ({ id: row.id, fromTick: row.from_tick, toTick: row.to_tick, minutes: row.minutes, weatherBefore: row.weather_before, weatherAfter: row.weather_after, summary: parseJson(row.summary_json, {}), createdAt: row.created_at }));
}

function processActivityAdvance(database, userId, conversationId, toTick, activity, summary) {
  const npc = getNpcRegistry(database, conversationId, activity.npcName);
  if (!npc || TERMINAL_NPC_STATUSES.has(npc.status)) return blockActivity(database, userId, conversationId, activity, 'NPC 已处于终止状态', summary);
  if (activity.status === 'scheduled' && activity.startTick <= toTick) {
    if (activity.locationNodeId && !canNpcReachNode(database, conversationId, npc.currentLocation, activity.locationNodeId)) return blockActivity(database, userId, conversationId, activity, '活动开始时已无可用路线', summary);
    if (activity.locationNodeId) updateConversationNpc(database, userId, conversationId, npc.name, { currentLocation: activity.locationName, source: 'world-clock', auditActor: 'world-clock' });
    database.prepare("UPDATE npc_activities SET status = 'active', updated_at = ? WHERE id = ?").run(nowIso(), activity.id);
    summary.started.push(activity.id);
    recordWorldEvent(database, userId, conversationId, { eventType: 'npc.activity.started', source: 'world-clock', title: `活动开始：${activity.npcName} · ${activity.title}`, entityType: 'npc_activity', entityId: activity.id });
  }
  if (activity.endTick <= toTick) {
    database.prepare("UPDATE npc_activities SET status = 'completed', updated_at = ? WHERE id = ?").run(nowIso(), activity.id);
    summary.completed.push(activity.id);
    recordWorldEvent(database, userId, conversationId, { eventType: 'npc.activity.completed', source: 'world-clock', title: `活动完成：${activity.npcName} · ${activity.title}`, entityType: 'npc_activity', entityId: activity.id, severity: 'success' });
  }
}

function blockActivity(database, userId, conversationId, activity, reason, summary) {
  database.prepare("UPDATE npc_activities SET status = 'blocked', updated_at = ? WHERE id = ?").run(nowIso(), activity.id);
  summary.blocked.push(activity.id);
  recordWorldEvent(database, userId, conversationId, { eventType: 'npc.activity.blocked', source: 'world-clock', title: `活动阻止：${activity.npcName} · ${activity.title}`, detail: reason, entityType: 'npc_activity', entityId: activity.id, severity: 'warning' });
}

function canNpcReachNode(database, conversationId, currentLocationName, targetNodeId) {
  const target = database.prepare('SELECT id, name FROM scene_nodes WHERE id = ? AND conversation_id = ?').get(targetNodeId, conversationId);
  if (!target) return false;
  if (normalizeIdentity(currentLocationName) === normalizeIdentity(target.name)) return true;
  const start = database.prepare('SELECT id FROM scene_nodes WHERE conversation_id = ? AND lower(trim(name)) = lower(trim(?)) LIMIT 1').get(conversationId, currentLocationName);
  if (!start) return false;
  const routes = database.prepare('SELECT from_node_id, to_node_id, bidirectional FROM scene_routes WHERE conversation_id = ?').all(conversationId);
  const adjacency = new Map();
  for (const route of routes) {
    addEdge(adjacency, route.from_node_id, route.to_node_id);
    if (route.bidirectional) addEdge(adjacency, route.to_node_id, route.from_node_id);
  }
  const queue = [start.id];
  const visited = new Set(queue);
  for (let index = 0; index < queue.length; index += 1) {
    const nodeId = queue[index];
    for (const nextId of adjacency.get(nodeId) || []) {
      if (nextId === target.id) return true;
      if (!visited.has(nextId)) { visited.add(nextId); queue.push(nextId); }
    }
  }
  return false;
}

function addEdge(adjacency, from, to) { if (!adjacency.has(from)) adjacency.set(from, []); adjacency.get(from).push(to); }
function readActivity(database, id, conversationId = '') { const row = database.prepare(`SELECT npc_activities.*, scene_nodes.name AS location_name FROM npc_activities LEFT JOIN scene_nodes ON scene_nodes.id = npc_activities.location_node_id WHERE npc_activities.id = ?${conversationId ? ' AND npc_activities.conversation_id = ?' : ''}`).get(...(conversationId ? [id, conversationId] : [id])); return row ? toNpcActivity(row) : null; }
function getNpcRegistry(database, conversationId, npcName) { const row = database.prepare('SELECT * FROM npc_registry WHERE conversation_id = ? AND npc_name = ?').get(conversationId, npcName); return row ? { name: row.npc_name, status: row.status || 'active', currentLocation: row.current_location || '' } : null; }
function hasConversationAccess(database, userId, conversationId) { return Boolean(database.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').get(conversationId, userId)); }
function normalizeTick(value, fallback) { const number = Number(value); return Number.isSafeInteger(number) && number >= 0 ? number : fallback; }
function normalizeActivityStatus(value, fallback) { const status = String(value || '').trim(); return ACTIVITY_STATUSES.has(status) ? status : fallback; }
function normalizeText(value, maxLength) { return String(value || '').trim().slice(0, maxLength); }
function normalizeIdentity(value) { return String(value || '').trim().toLowerCase(); }
function formatMinute(value) { return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`; }
function toWorldClock(row) { const tick = (Number(row.current_day || 1) - 1) * MINUTES_PER_DAY + Number(row.minute_of_day || 0); return { conversationId: row.conversation_id, currentDay: row.current_day, minuteOfDay: row.minute_of_day, timeLabel: formatMinute(row.minute_of_day), weather: row.weather, tick, updatedAt: row.updated_at }; }
function toNpcActivity(row) { return { id: row.id, conversationId: row.conversation_id, npcName: row.npc_name, title: row.title, locationNodeId: row.location_node_id || '', locationName: row.location_name || '', status: row.status, startTick: row.start_tick, endTick: row.end_tick, source: row.source, createdAt: row.created_at, updatedAt: row.updated_at }; }
