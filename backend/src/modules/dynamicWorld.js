import { newId, nowIso } from '../security.js';
import { clampInteger } from '../utils/number.js';
import { parseJson } from '../utils/json.js';
import { withSavepoint } from './savepoint.js';
import { recordWorldEvent } from './worldEvents.js';
import { CastDomainError } from '../domain/cast/errors.js';
import {
  createCastActivity,
  resolveCastMember,
  updateCastActivity,
  updateCastMemberProfile,
} from '../services/cast/castCommandService.js';
import {
  getCastActivities,
  getCastMemberDetail,
} from '../services/cast/castQueryService.js';

const MINUTES_PER_DAY = 1440;
const TERMINAL_MEMBER_STATUSES = new Set(['permanently_left', 'dead']);

export function getWorldClock(database, userId, conversationId, options = {}) {
  if (!hasConversationAccess(database, userId, conversationId)) return null;
  let row = database.prepare('SELECT * FROM world_clocks WHERE conversation_id = ?').get(conversationId);
  if (!row && options.ensure !== false) {
    database.prepare(
      'INSERT INTO world_clocks (conversation_id, current_day, minute_of_day, weather, updated_at) VALUES (?, 1, 480, ?, ?)'
    ).run(conversationId, '晴朗', nowIso());
    row = database.prepare('SELECT * FROM world_clocks WHERE conversation_id = ?').get(conversationId);
  }
  return row ? toWorldClock(row) : null;
}

export function setWorldWeather(database, userId, conversationId, weather, source = 'manual') {
  const clock = getWorldClock(database, userId, conversationId);
  if (!clock) return null;
  const normalizedWeather = normalizeText(weather, 80);
  if (!normalizedWeather) return null;
  database.prepare(
    'UPDATE world_clocks SET weather = ?, updated_at = ? WHERE conversation_id = ?'
  ).run(normalizedWeather, nowIso(), conversationId);
  const updated = getWorldClock(database, userId, conversationId, { ensure: false });
  if (updated.weather !== clock.weather) {
    recordWorldEvent(database, userId, conversationId, {
      eventType: 'world.weather.changed',
      source,
      title: `天气变化：${clock.weather} → ${updated.weather}`,
      entityType: 'world_clock',
      entityId: conversationId,
      payload: { before: clock.weather, after: updated.weather },
    });
  }
  return updated;
}

export function listWorldActivities(database, userId, conversationId, options = {}) {
  const memberId = normalizeText(options.memberId, 160);
  const member = !memberId && options.memberName
    ? resolveCastMember(database, userId, conversationId, { name: options.memberName })
    : null;
  return getCastActivities(database, userId, conversationId, {
    memberId: memberId || member?.id || '',
    status: normalizeActivityStatus(options.status, ''),
  }).map((activity) => toWorldActivity(database, activity));
}

export function scheduleCastActivity(database, userId, conversationId, payload = {}) {
  const clock = getWorldClock(database, userId, conversationId);
  if (!clock) return { ok: false, error: '对话不存在' };
  try {
    const member = resolveCastMember(database, userId, conversationId, {
      memberId: payload.memberId,
      name: payload.memberName,
    });
    const title = normalizeText(payload.title, 500);
    if (member.memberType !== 'npc') return { ok: false, error: '只能为 NPC 安排世界活动' };
    if (!title) return { ok: false, error: '活动标题不能为空' };
    if (TERMINAL_MEMBER_STATUSES.has(member.status)) {
      return { ok: false, error: '终止状态人物不能安排活动' };
    }
    const startTick = normalizeTick(payload.startTick, clock.tick);
    const durationMinutes = clampInteger(payload.durationMinutes, 1, 10_080, 60);
    const endTick = startTick + durationMinutes;
    const locationNodeId = normalizeText(payload.locationNodeId, 160);
    if (locationNodeId && !canMemberReachNode(database, conversationId, member, locationNodeId)) {
      return { ok: false, error: '人物当前地点与目标地点之间没有可用路线' };
    }
    const conflict = getCastActivities(database, userId, conversationId, { memberId: member.id })
      .find((activity) => (
        !['completed', 'cancelled', 'blocked'].includes(activity.status)
        && activity.startTick < endTick
        && activity.endTick > startTick
      ));
    if (conflict) return { ok: false, error: '人物在该时段已有活动' };
    const activity = createCastActivity(database, userId, conversationId, member.id, {
      title,
      locationNodeId,
      startTick,
      endTick,
      status: 'scheduled',
      metadata: { requestedBy: normalizeText(payload.source, 80) || 'manual' },
    }, {
      actor: normalizeText(payload.source, 80) || `user:${userId}`,
    });
    const result = toWorldActivity(database, activity);
    recordWorldEvent(database, userId, conversationId, {
      eventType: 'cast.activity.scheduled',
      source: payload.source || 'manual',
      title: `人物日程：${member.canonicalName} · ${title}`,
      entityType: 'cast_activity',
      entityId: activity.id,
      payload: { memberId: member.id, startTick, endTick, location: result.locationName },
    });
    return { ok: true, activity: result };
  } catch (error) {
    if (error instanceof CastDomainError) return { ok: false, error: error.message };
    throw error;
  }
}

export function updateWorldActivity(database, userId, conversationId, activityId, payload = {}) {
  const current = getCastActivities(database, userId, conversationId)
    .find((activity) => activity.id === activityId);
  if (!current) return null;
  const requestedStatus = payload.status === undefined
    ? current.status
    : normalizeActivityStatus(payload.status, current.status);
  if (requestedStatus !== current.status && requestedStatus !== 'cancelled') return null;
  const updated = updateCastActivity(database, userId, conversationId, activityId, {
    status: requestedStatus,
  }, { actor: payload.source || `user:${userId}` });
  if (requestedStatus === 'cancelled' && current.status !== 'cancelled') {
    recordWorldEvent(database, userId, conversationId, {
      eventType: 'cast.activity.cancelled',
      source: payload.source || 'manual',
      title: `活动取消：${updated.memberName} · ${updated.title}`,
      entityType: 'cast_activity',
      entityId: updated.id,
      severity: 'warning',
    });
  }
  return toWorldActivity(database, updated);
}

export function advanceWorldTime(database, userId, conversationId, payload = {}) {
  const clock = getWorldClock(database, userId, conversationId);
  if (!clock) return null;
  const minutes = clampInteger(payload.minutes, 1, 10_080, 60);
  const fromTick = clock.tick;
  const toTick = fromTick + minutes;
  return withSavepoint(database, 'sp_advance_world_time', () => {
    const summary = { started: [], completed: [], blocked: [] };
    const candidates = getCastActivities(database, userId, conversationId)
      .filter((activity) => (
        ['scheduled', 'active'].includes(activity.status)
        && activity.startTick <= toTick
      ));
    for (const activity of candidates) {
      processActivityAdvance(database, userId, conversationId, toTick, activity, summary);
    }
    const day = Math.floor(toTick / MINUTES_PER_DAY) + 1;
    const minuteOfDay = toTick % MINUTES_PER_DAY;
    database.prepare(
      'UPDATE world_clocks SET current_day = ?, minute_of_day = ?, updated_at = ? WHERE conversation_id = ?'
    ).run(day, minuteOfDay, nowIso(), conversationId);
    const advanceId = newId();
    database.prepare(
      `INSERT INTO world_advances (
         id, conversation_id, from_tick, to_tick, minutes,
         weather_before, weather_after, summary_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      advanceId,
      conversationId,
      fromTick,
      toTick,
      minutes,
      clock.weather,
      clock.weather,
      JSON.stringify(summary),
      nowIso()
    );
    recordWorldEvent(database, userId, conversationId, {
      eventType: 'world.time.advanced',
      source: payload.source || 'player',
      title: `时间推进 ${minutes} 分钟`,
      detail: `第 ${day} 天 ${formatMinute(minuteOfDay)}`,
      entityType: 'world_advance',
      entityId: advanceId,
      payload: { fromTick, toTick, minutes, summary },
    });
    return {
      clock: getWorldClock(database, userId, conversationId, { ensure: false }),
      summary,
      advanceId,
    };
  });
}

export function listWorldAdvances(database, userId, conversationId, limit = 30) {
  if (!hasConversationAccess(database, userId, conversationId)) return null;
  return database.prepare(
    'SELECT * FROM world_advances WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?'
  ).all(conversationId, clampInteger(limit, 1, 100, 30)).map((row) => ({
    id: row.id,
    fromTick: row.from_tick,
    toTick: row.to_tick,
    minutes: row.minutes,
    weatherBefore: row.weather_before,
    weatherAfter: row.weather_after,
    summary: parseJson(row.summary_json, {}),
    createdAt: row.created_at,
  }));
}

function processActivityAdvance(database, userId, conversationId, toTick, activity, summary) {
  const detail = getCastMemberDetail(database, userId, conversationId, activity.memberId);
  const member = detail.member;
  if (TERMINAL_MEMBER_STATUSES.has(member.status)) {
    blockActivity(database, userId, conversationId, activity, '人物已处于终止状态', summary);
    return;
  }
  if (activity.status === 'scheduled' && activity.startTick <= toTick) {
    if (activity.locationNodeId && !canMemberReachNode(database, conversationId, member, activity.locationNodeId)) {
      blockActivity(database, userId, conversationId, activity, '活动开始时已无可用路线', summary);
      return;
    }
    if (activity.locationNodeId) {
      const node = getSceneNode(database, conversationId, activity.locationNodeId);
      updateCastMemberProfile(database, userId, conversationId, member.id, {
        currentLocationLabel: node?.name || member.currentLocationLabel,
        currentSceneNodeId: activity.locationNodeId,
        revision: member.revision,
      }, { actor: 'world-clock' });
    }
    updateCastActivity(database, userId, conversationId, activity.id, { status: 'active' }, {
      actor: 'world-clock',
    });
    summary.started.push(activity.id);
    recordWorldEvent(database, userId, conversationId, {
      eventType: 'cast.activity.started',
      source: 'world-clock',
      title: `活动开始：${member.canonicalName} · ${activity.title}`,
      entityType: 'cast_activity',
      entityId: activity.id,
    });
  }
  if (activity.endTick <= toTick) {
    updateCastActivity(database, userId, conversationId, activity.id, { status: 'completed' }, {
      actor: 'world-clock',
    });
    summary.completed.push(activity.id);
    recordWorldEvent(database, userId, conversationId, {
      eventType: 'cast.activity.completed',
      source: 'world-clock',
      title: `活动完成：${member.canonicalName} · ${activity.title}`,
      entityType: 'cast_activity',
      entityId: activity.id,
      severity: 'success',
    });
  }
}

function blockActivity(database, userId, conversationId, activity, reason, summary) {
  updateCastActivity(database, userId, conversationId, activity.id, { status: 'blocked' }, {
    actor: 'world-clock',
  });
  summary.blocked.push(activity.id);
  recordWorldEvent(database, userId, conversationId, {
    eventType: 'cast.activity.blocked',
    source: 'world-clock',
    title: `活动阻止：${activity.memberName} · ${activity.title}`,
    detail: reason,
    entityType: 'cast_activity',
    entityId: activity.id,
    severity: 'warning',
  });
}

function canMemberReachNode(database, conversationId, member, targetNodeId) {
  const target = getSceneNode(database, conversationId, targetNodeId);
  if (!target) return false;
  if (member.currentSceneNodeId === target.id) return true;
  const startId = member.currentSceneNodeId || database.prepare(
    'SELECT id FROM scene_nodes WHERE conversation_id = ? AND lower(trim(name)) = lower(trim(?)) LIMIT 1'
  ).get(conversationId, member.currentLocationLabel)?.id;
  if (!startId) return false;
  const routes = database.prepare(
    'SELECT from_node_id, to_node_id, bidirectional FROM scene_routes WHERE conversation_id = ?'
  ).all(conversationId);
  const adjacency = new Map();
  for (const route of routes) {
    addEdge(adjacency, route.from_node_id, route.to_node_id);
    if (route.bidirectional) addEdge(adjacency, route.to_node_id, route.from_node_id);
  }
  const queue = [startId];
  const visited = new Set(queue);
  for (let index = 0; index < queue.length; index += 1) {
    for (const nextId of adjacency.get(queue[index]) || []) {
      if (nextId === target.id) return true;
      if (!visited.has(nextId)) {
        visited.add(nextId);
        queue.push(nextId);
      }
    }
  }
  return false;
}

function toWorldActivity(database, activity) {
  const node = activity.locationNodeId
    ? getSceneNode(database, activity.conversationId, activity.locationNodeId)
    : null;
  return {
    ...activity,
    npcName: activity.memberName,
    locationName: node?.name || '',
    source: activity.sourceKind,
  };
}

function getSceneNode(database, conversationId, nodeId) {
  return database.prepare(
    'SELECT id, name FROM scene_nodes WHERE conversation_id = ? AND id = ?'
  ).get(conversationId, nodeId);
}

function addEdge(adjacency, from, to) {
  if (!adjacency.has(from)) adjacency.set(from, []);
  adjacency.get(from).push(to);
}

function hasConversationAccess(database, userId, conversationId) {
  return Boolean(database.prepare(
    'SELECT id FROM conversations WHERE id = ? AND user_id = ?'
  ).get(conversationId, userId));
}

function normalizeTick(value, fallback) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : fallback;
}

function normalizeActivityStatus(value, fallback) {
  const status = String(value || '').trim();
  return ['scheduled', 'active', 'completed', 'cancelled', 'blocked'].includes(status)
    ? status
    : fallback;
}

function normalizeText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function formatMinute(value) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function toWorldClock(row) {
  const tick = (Number(row.current_day || 1) - 1) * MINUTES_PER_DAY + Number(row.minute_of_day || 0);
  return {
    conversationId: row.conversation_id,
    currentDay: row.current_day,
    minuteOfDay: row.minute_of_day,
    timeLabel: formatMinute(row.minute_of_day),
    weather: row.weather,
    tick,
    updatedAt: row.updated_at,
  };
}
