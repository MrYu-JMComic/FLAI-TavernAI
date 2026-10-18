import { newId, nowIso } from '../security.js';
import { clampInteger } from '../utils/number.js';
import { parseJson } from '../utils/json.js';
import { withSavepoint } from './savepoint.js';
import { recordWorldEvent } from './worldEvents.js';

const MINUTES_PER_DAY = 1440;

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

export function advanceWorldTime(database, userId, conversationId, payload = {}) {
  const clock = getWorldClock(database, userId, conversationId);
  if (!clock) return null;
  const minutes = clampInteger(payload.minutes, 1, 10_080, 60);
  const fromTick = clock.tick;
  const toTick = fromTick + minutes;
  return withSavepoint(database, 'sp_advance_world_time', () => {
    const summary = {};
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

function hasConversationAccess(database, userId, conversationId) {
  return Boolean(database.prepare(
    'SELECT id FROM conversations WHERE id = ? AND user_id = ?'
  ).get(conversationId, userId));
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
