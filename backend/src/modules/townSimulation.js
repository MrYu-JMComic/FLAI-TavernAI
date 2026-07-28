import { newId, nowIso } from '../security.js';
import { parseJson } from '../utils/json.js';
import { clampInteger, clampNumber } from '../utils/number.js';
import { withSavepoint } from './savepoint.js';

const MEMORY_TYPES = new Set(['observation', 'event', 'relationship', 'plan', 'reflection']);
const SCHEDULE_STATUSES = new Set(['planned', 'active', 'completed', 'cancelled']);
const ITEM_STATUSES = new Set(['planned', 'active', 'completed', 'skipped']);
const SIMULATION_STATUSES = new Set(['paused', 'running']);
const DEFAULT_RECALL_WEIGHTS = Object.freeze({ recency: 0.35, importance: 0.25, relevance: 0.4 });

export function createTown(database, userId, payload = {}) {
  if (!userExists(database, userId)) return null;
  const id = newId();
  const timestamp = nowIso();
  const name = normalizeText(payload.name, 120) || '未命名小镇';
  database.prepare(
    `INSERT INTO town_worlds (
       id, user_id, name, description, creation_prompt, map_config_json,
       simulation_status, current_day, minute_of_day, settings_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    userId,
    name,
    normalizeText(payload.description, 2000),
    normalizeText(payload.creationPrompt, 20000),
    JSON.stringify(normalizeObject(payload.mapConfig)),
    normalizeSimulationStatus(payload.simulationStatus),
    clampInteger(payload.currentDay, 1, 1000000, 1),
    clampInteger(payload.minuteOfDay, 0, 1439, 480),
    JSON.stringify(normalizeObject(payload.settings)),
    timestamp,
    timestamp
  );
  return getTown(database, userId, id);
}

export function getTown(database, userId, townId) {
  const row = database.prepare('SELECT * FROM town_worlds WHERE id = ? AND user_id = ?').get(townId, userId);
  return row ? toTown(row) : null;
}

export function listTowns(database, userId) {
  return database.prepare(
    'SELECT * FROM town_worlds WHERE user_id = ? ORDER BY updated_at DESC, rowid DESC'
  ).all(userId).map(toTown);
}

export function deleteTown(database, userId, townId) {
  const town = getTown(database, userId, townId);
  if (!town) return null;
  withSavepoint(database, 'sp_delete_town', () => {
    // Pause first so the continuous engine, which selects on simulation_status,
    // cannot pick this world up while the cascade is in flight.
    database.prepare(
      "UPDATE town_worlds SET simulation_status = 'paused', updated_at = ? WHERE id = ? AND user_id = ?"
    ).run(nowIso(), townId, userId);
    database.prepare('DELETE FROM town_worlds WHERE id = ? AND user_id = ?').run(townId, userId);
  });
  return { id: townId, deleted: true };
}

export function deleteTownResident(database, userId, townId, residentId) {
  if (!getResidentContext(database, userId, townId, residentId)) return null;
  withSavepoint(database, 'sp_delete_town_resident', () => {
    database.prepare('DELETE FROM town_residents WHERE id = ? AND town_id = ?').run(residentId, townId);
    database.prepare('UPDATE town_worlds SET updated_at = ? WHERE id = ? AND user_id = ?')
      .run(nowIso(), townId, userId);
  });
  return { id: residentId, deleted: true };
}

export function updateTownClock(database, userId, townId, payload = {}) {
  const town = getTown(database, userId, townId);
  if (!town) return null;
  const currentDay = clampInteger(payload.currentDay, 1, 1000000, town.currentDay);
  const minuteOfDay = clampInteger(payload.minuteOfDay, 0, 1439, town.minuteOfDay);
  const simulationStatus = payload.simulationStatus == null
    ? town.simulationStatus
    : normalizeSimulationStatus(payload.simulationStatus);
  database.prepare(
    `UPDATE town_worlds
     SET current_day = ?, minute_of_day = ?, simulation_status = ?, engine_checkpoint_at = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`
  ).run(currentDay, minuteOfDay, simulationStatus, nowIso(), nowIso(), townId, userId);
  return getTown(database, userId, townId);
}

export function createTownResident(database, userId, townId, payload = {}) {
  const town = getTown(database, userId, townId);
  if (!town) return null;
  const name = normalizeText(payload.name, 120);
  if (!name) throw new Error('居民姓名不能为空');
  const id = newId();
  const timestamp = nowIso();
  database.prepare(
    `INSERT INTO town_residents (
       id, town_id, name, role, profile_json, state_json, current_location,
       reflection_threshold, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    townId,
    name,
    normalizeText(payload.role, 160),
    JSON.stringify(normalizeObject(payload.profile)),
    JSON.stringify(normalizeObject(payload.state)),
    normalizeText(payload.currentLocation, 200),
    clampNumber(payload.reflectionThreshold, 1, 100, 15),
    timestamp,
    timestamp
  );
  return readTownResident(database, townId, id);
}

export function listTownResidents(database, userId, townId) {
  if (!getTown(database, userId, townId)) return null;
  return database.prepare(
    'SELECT * FROM town_residents WHERE town_id = ? ORDER BY name ASC, rowid ASC'
  ).all(townId).map(toTownResident);
}

export function updateTownResidentState(database, userId, townId, residentId, payload = {}) {
  const context = getResidentContext(database, userId, townId, residentId);
  if (!context) return null;
  const nextState = payload.state && typeof payload.state === 'object' && !Array.isArray(payload.state)
    ? { ...context.resident.state, ...payload.state }
    : context.resident.state;
  const currentLocation = payload.currentLocation == null
    ? context.resident.currentLocation
    : normalizeText(payload.currentLocation, 200);
  database.prepare(
    `UPDATE town_residents
     SET state_json = ?, current_location = ?, updated_at = ?
     WHERE id = ? AND town_id = ?`
  ).run(JSON.stringify(nextState), currentLocation, nowIso(), residentId, townId);
  return readTownResident(database, townId, residentId);
}

export function getTownSnapshot(database, userId, townId, options = {}) {
  const town = getTown(database, userId, townId);
  if (!town) return null;
  return {
    town,
    residents: listTownResidents(database, userId, townId),
    events: listTownEvents(database, userId, townId, { limit: options.eventLimit })
  };
}

export function recordTownEvent(database, userId, townId, payload = {}) {
  const town = getTown(database, userId, townId);
  if (!town) return null;
  const residentId = normalizeResidentId(database, townId, payload.residentId);
  const id = newId();
  database.prepare(
    `INSERT INTO town_events (
       id, town_id, resident_id, event_type, source, title, detail,
       payload_json, occurred_tick, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    townId,
    residentId || null,
    normalizeText(payload.eventType, 80) || 'world.changed',
    normalizeText(payload.source, 40) || 'simulation',
    normalizeText(payload.title, 200),
    normalizeText(payload.detail, 4000),
    JSON.stringify(normalizeObject(payload.payload)),
    normalizeTick(payload.occurredTick, townTick(town)),
    nowIso()
  );
  return readTownEvent(database, townId, id);
}

export function listTownEvents(database, userId, townId, options = {}) {
  if (!getTown(database, userId, townId)) return null;
  const limit = clampInteger(options.limit, 1, 200, 50);
  const rows = database.prepare(
    `SELECT * FROM town_events
     WHERE town_id = ?
     ORDER BY occurred_tick DESC, rowid DESC
     LIMIT ?`
  ).all(townId, limit);
  rows.reverse();
  return rows.map(toTownEvent);
}

export function getPendingTownIntervention(database, userId, townId) {
  if (!getTown(database, userId, townId)) return null;
  const row = database.prepare(
    `SELECT * FROM town_events
     WHERE town_id = ? AND handled_at IS NULL
       AND (source = 'player' OR event_type = 'world.intervention')
     ORDER BY occurred_tick ASC, rowid ASC
     LIMIT 1`
  ).get(townId);
  return row ? toTownEvent(row) : null;
}

export function recordTownMemory(database, userId, townId, residentId, payload = {}) {
  const context = getResidentContext(database, userId, townId, residentId);
  if (!context) return null;
  const content = normalizeText(payload.content, 8000);
  if (!content) throw new Error('记忆内容不能为空');
  const id = newId();
  const keywords = normalizeKeywords(payload.keywords, content);
  database.prepare(
    `INSERT INTO town_memories (
       id, town_id, resident_id, memory_type, content, importance, keywords_json,
       source_event_id, source_kind, occurred_tick, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    townId,
    residentId,
    normalizeMemoryType(payload.memoryType),
    content,
    clampNumber(payload.importance, 1, 10, 5),
    JSON.stringify(keywords),
    normalizeEventId(database, townId, payload.sourceEventId) || null,
    normalizeText(payload.sourceKind, 40) || 'simulation',
    normalizeTick(payload.occurredTick, townTick(context.town)),
    nowIso()
  );
  return readTownMemory(database, townId, residentId, id);
}

export function retrieveTownMemories(database, userId, townId, residentId, query = '', options = {}) {
  const context = getResidentContext(database, userId, townId, residentId);
  if (!context) return null;
  const limit = clampInteger(options.limit, 1, 50, 8);
  const candidateLimit = clampInteger(options.candidateLimit, limit, 500, Math.max(100, limit));
  const referenceTick = normalizeTick(options.referenceTick, townTick(context.town));
  const weights = normalizeRecallWeights(options.weights);
  const recencyDecay = clampNumber(options.recencyDecay, 0.5, 1, 0.99);
  const rows = selectRecallCandidates(database, townId, residentId, candidateLimit, options);
  const memories = rows
    .map((row) => scoreTownMemory(toTownMemory(row), query, { referenceTick, weights, recencyDecay }))
    .sort((left, right) => right.score - left.score || right.occurredTick - left.occurredTick)
    .slice(0, limit);
  if (options.trackAccess !== false && memories.length) {
    const timestamp = nowIso();
    const statement = database.prepare(
      'UPDATE town_memories SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?'
    );
    for (const memory of memories) statement.run(timestamp, memory.id);
  }
  return memories;
}

export function listTownUnreflectedMemories(database, userId, townId, residentId, options = {}) {
  if (!getResidentContext(database, userId, townId, residentId)) return null;
  const limit = clampInteger(options.limit, 1, 100, 24);
  return database.prepare(
    `SELECT * FROM town_memories
     WHERE town_id = ? AND resident_id = ? AND reflected_at IS NULL
     ORDER BY occurred_tick DESC, rowid DESC
     LIMIT ?`
  ).all(townId, residentId, limit).map(toTownMemory);
}

export function scoreTownMemory(memory, query = '', options = {}) {
  const weights = normalizeRecallWeights(options.weights);
  const referenceTick = normalizeTick(options.referenceTick, memory.occurredTick);
  const ageHours = Math.max(0, referenceTick - memory.occurredTick) / 60;
  const recency = Math.pow(clampNumber(options.recencyDecay, 0.5, 1, 0.99), ageHours);
  const importance = clampNumber(memory.importance, 1, 10, 5) / 10;
  const relevance = calculateTokenRelevance(query, [memory.content, ...(memory.keywords || [])].join(' '));
  const score = (recency * weights.recency) + (importance * weights.importance) + (relevance * weights.relevance);
  return {
    ...memory,
    score: roundScore(score),
    scoreParts: {
      recency: roundScore(recency),
      importance: roundScore(importance),
      relevance: roundScore(relevance)
    }
  };
}

export function evaluateTownReflectionNeed(database, userId, townId, residentId) {
  const context = getResidentContext(database, userId, townId, residentId);
  if (!context) return null;
  const row = database.prepare(
    `SELECT COUNT(*) AS memory_count, COALESCE(SUM(importance), 0) AS importance_total
     FROM town_memories
     WHERE town_id = ? AND resident_id = ? AND reflected_at IS NULL`
  ).get(townId, residentId);
  const importanceTotal = Number(row.importance_total || 0);
  return {
    residentId,
    memoryCount: Number(row.memory_count || 0),
    importanceTotal,
    threshold: context.resident.reflectionThreshold,
    shouldReflect: importanceTotal >= context.resident.reflectionThreshold
  };
}

export function createTownReflection(database, userId, townId, residentId, payload = {}) {
  const context = getResidentContext(database, userId, townId, residentId);
  if (!context) return null;
  const content = normalizeText(payload.content, 8000);
  if (!content) throw new Error('反思内容不能为空');
  const memoryIds = selectReflectionMemoryIds(database, townId, residentId, payload.memoryIds);
  if (!memoryIds.length) throw new Error('反思至少需要一条未处理记忆');
  const id = newId();
  const timestamp = nowIso();
  withSavepoint(database, 'sp_create_town_reflection', () => {
    database.prepare(
      `INSERT INTO town_reflections (
         id, town_id, resident_id, content, evidence_memory_ids_json, importance, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      townId,
      residentId,
      content,
      JSON.stringify(memoryIds),
      clampNumber(payload.importance, 1, 10, 5),
      timestamp
    );
    database.prepare(
      `INSERT INTO town_memories (
         id, town_id, resident_id, memory_type, content, importance, keywords_json,
         source_kind, occurred_tick, reflected_at, created_at
       ) VALUES (?, ?, ?, 'reflection', ?, ?, ?, 'reflection', ?, ?, ?)`
    ).run(
      id,
      townId,
      residentId,
      content,
      clampNumber(payload.importance, 1, 10, 5),
      JSON.stringify(normalizeKeywords(payload.keywords, content)),
      townTick(context.town),
      timestamp,
      timestamp
    );
    const markMemory = database.prepare(
      'UPDATE town_memories SET reflected_at = ? WHERE id = ? AND town_id = ? AND resident_id = ?'
    );
    for (const memoryId of memoryIds) markMemory.run(timestamp, memoryId, townId, residentId);
    database.prepare(
      'UPDATE town_residents SET last_reflection_at = ?, updated_at = ? WHERE id = ? AND town_id = ?'
    ).run(timestamp, timestamp, residentId, townId);
    recordTownEvent(database, userId, townId, {
      residentId,
      eventType: 'resident.reflection',
      source: 'reflection',
      title: `${context.resident.name}形成了新的反思`,
      detail: content,
      payload: { uiType: 'reflection', evidenceMemoryIds: memoryIds },
      occurredTick: townTick(context.town)
    });
  });
  return readTownReflection(database, townId, residentId, id);
}

export function listTownReflections(database, userId, townId, residentId, options = {}) {
  if (!getResidentContext(database, userId, townId, residentId)) return null;
  const limit = clampInteger(options.limit, 1, 100, 20);
  return database.prepare(
    `SELECT * FROM town_reflections
     WHERE town_id = ? AND resident_id = ?
     ORDER BY created_at DESC, rowid DESC
     LIMIT ?`
  ).all(townId, residentId, limit).map(toTownReflection);
}

export function saveTownSchedule(database, userId, townId, residentId, payload = {}) {
  const context = getResidentContext(database, userId, townId, residentId);
  if (!context) return null;
  const day = clampInteger(payload.day, 1, 1000000, context.town.currentDay);
  const items = normalizeScheduleItems(payload.items);
  const existing = database.prepare(
    'SELECT id, created_at FROM town_schedules WHERE town_id = ? AND resident_id = ? AND day = ?'
  ).get(townId, residentId, day);
  const scheduleId = existing?.id || newId();
  const timestamp = nowIso();
  withSavepoint(database, 'sp_save_town_schedule', () => {
    if (existing) {
      database.prepare(
        'UPDATE town_schedules SET goal = ?, status = ?, updated_at = ? WHERE id = ?'
      ).run(normalizeText(payload.goal, 1000), normalizeScheduleStatus(payload.status), timestamp, scheduleId);
      database.prepare('DELETE FROM town_schedule_items WHERE schedule_id = ?').run(scheduleId);
    } else {
      database.prepare(
        `INSERT INTO town_schedules (
           id, town_id, resident_id, day, goal, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        scheduleId,
        townId,
        residentId,
        day,
        normalizeText(payload.goal, 1000),
        normalizeScheduleStatus(payload.status),
        timestamp,
        timestamp
      );
    }
    const insertItem = database.prepare(
      `INSERT INTO town_schedule_items (
         id, schedule_id, start_minute, end_minute, activity,
         location, intention, status, order_index
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    items.forEach((item, index) => {
      insertItem.run(
        newId(),
        scheduleId,
        item.startMinute,
        item.endMinute,
        item.activity,
        item.location,
        item.intention,
        item.status,
        index
      );
    });
  });
  return getTownSchedule(database, userId, townId, residentId, day);
}

export function getTownSchedule(database, userId, townId, residentId, day) {
  const context = getResidentContext(database, userId, townId, residentId);
  if (!context) return null;
  const normalizedDay = clampInteger(day, 1, 1000000, context.town.currentDay);
  const row = database.prepare(
    'SELECT * FROM town_schedules WHERE town_id = ? AND resident_id = ? AND day = ?'
  ).get(townId, residentId, normalizedDay);
  if (!row) return null;
  const items = database.prepare(
    'SELECT * FROM town_schedule_items WHERE schedule_id = ? ORDER BY order_index ASC, rowid ASC'
  ).all(row.id).map(toScheduleItem);
  return toTownSchedule(row, items);
}

export function tokenizeMemoryText(value) {
  const normalized = String(value || '').normalize('NFKC').toLowerCase();
  const tokens = normalized.match(/[a-z0-9]+|[\u3400-\u9fff]+/gu) || [];
  const output = new Set();
  for (const token of tokens) {
    if (/^[\u3400-\u9fff]+$/u.test(token)) {
      for (const character of token) output.add(character);
      for (let index = 0; index < token.length - 1; index += 1) {
        output.add(token.slice(index, index + 2));
      }
    } else if (token.length > 1) {
      output.add(token);
    }
  }
  return [...output];
}

function calculateTokenRelevance(query, text) {
  const queryTokens = new Set(tokenizeMemoryText(query));
  if (!queryTokens.size) return 0;
  const textTokens = new Set(tokenizeMemoryText(text));
  let overlap = 0;
  for (const token of queryTokens) {
    if (textTokens.has(token)) overlap += 1;
  }
  return overlap / Math.sqrt(queryTokens.size * Math.max(1, textTokens.size));
}

function normalizeRecallWeights(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const raw = {
    recency: clampNumber(source.recency, 0, 1, DEFAULT_RECALL_WEIGHTS.recency),
    importance: clampNumber(source.importance, 0, 1, DEFAULT_RECALL_WEIGHTS.importance),
    relevance: clampNumber(source.relevance, 0, 1, DEFAULT_RECALL_WEIGHTS.relevance)
  };
  const total = raw.recency + raw.importance + raw.relevance;
  if (total <= 0) return { ...DEFAULT_RECALL_WEIGHTS };
  return {
    recency: raw.recency / total,
    importance: raw.importance / total,
    relevance: raw.relevance / total
  };
}

function normalizeScheduleItems(value) {
  if (!Array.isArray(value)) throw new Error('日程项目必须是数组');
  const items = value.map((item = {}) => ({
    startMinute: clampInteger(item.startMinute, 0, 1439, 0),
    endMinute: clampInteger(item.endMinute, 1, 1440, 1),
    activity: normalizeText(item.activity, 300),
    location: normalizeText(item.location, 200),
    intention: normalizeText(item.intention, 1000),
    status: ITEM_STATUSES.has(item.status) ? item.status : 'planned'
  })).sort((left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute);
  let previousEnd = -1;
  for (const item of items) {
    if (!item.activity) throw new Error('日程活动不能为空');
    if (item.endMinute <= item.startMinute) throw new Error('日程结束时间必须晚于开始时间');
    if (item.startMinute < previousEnd) throw new Error('日程项目不能互相重叠');
    previousEnd = item.endMinute;
  }
  return items;
}

function selectReflectionMemoryIds(database, townId, residentId, requestedIds) {
  const available = database.prepare(
    `SELECT id FROM town_memories
     WHERE town_id = ? AND resident_id = ? AND reflected_at IS NULL
     ORDER BY occurred_tick ASC, rowid ASC`
  ).all(townId, residentId).map((row) => row.id);
  if (!Array.isArray(requestedIds) || !requestedIds.length) return available;
  const requested = new Set(requestedIds.map((value) => String(value || '').trim()).filter(Boolean));
  return available.filter((id) => requested.has(id));
}

function selectRecallCandidates(database, townId, residentId, candidateLimit, options = {}) {
  const excludeSourceKinds = Array.isArray(options.excludeSourceKinds)
    ? options.excludeSourceKinds.filter((kind) => kind && typeof kind === 'string')
    : [];
  const minImportance = options.minImportance != null
    ? clampNumber(options.minImportance, 1, 10, 1)
    : null;

  if (!excludeSourceKinds.length && minImportance == null) {
    return database.prepare(
      `SELECT * FROM town_memories
       WHERE town_id = ? AND resident_id = ?
       ORDER BY occurred_tick DESC, rowid DESC
       LIMIT ?`
    ).all(townId, residentId, candidateLimit);
  }

  const whereClauses = ['town_id = ?', 'resident_id = ?'];
  const params = [townId, residentId];
  if (excludeSourceKinds.length) {
    whereClauses.push(`source_kind NOT IN (${excludeSourceKinds.map(() => '?').join(', ')})`);
    params.push(...excludeSourceKinds);
  }
  if (minImportance != null) {
    const highValueLimit = Math.ceil(candidateLimit / 2);
    const recentLimit = candidateLimit - highValueLimit;
    const highValueRows = database.prepare(
      `SELECT * FROM town_memories
       WHERE ${whereClauses.join(' AND ')} AND importance >= ?
       ORDER BY importance DESC, occurred_tick DESC, rowid DESC
       LIMIT ?`
    ).all(...params, minImportance, highValueLimit);
    const recentRows = database.prepare(
      `SELECT * FROM town_memories
       WHERE ${whereClauses.join(' AND ')}
       ORDER BY occurred_tick DESC, rowid DESC
       LIMIT ?`
    ).all(...params, recentLimit);
    const seen = new Set(highValueRows.map((row) => row.id));
    const combined = [...highValueRows];
    for (const row of recentRows) {
      if (!seen.has(row.id)) combined.push(row);
    }
    return combined;
  }

  return database.prepare(
    `SELECT * FROM town_memories
     WHERE ${whereClauses.join(' AND ')}
     ORDER BY occurred_tick DESC, rowid DESC
     LIMIT ?`
  ).all(...params, candidateLimit);
}

function getResidentContext(database, userId, townId, residentId) {
  const town = getTown(database, userId, townId);
  if (!town) return null;
  const resident = readTownResident(database, townId, residentId);
  return resident ? { town, resident } : null;
}

function readTownResident(database, townId, residentId) {
  const row = database.prepare('SELECT * FROM town_residents WHERE id = ? AND town_id = ?').get(residentId, townId);
  return row ? toTownResident(row) : null;
}

function readTownEvent(database, townId, eventId) {
  const row = database.prepare('SELECT * FROM town_events WHERE id = ? AND town_id = ?').get(eventId, townId);
  return row ? toTownEvent(row) : null;
}

function readTownMemory(database, townId, residentId, memoryId) {
  const row = database.prepare(
    'SELECT * FROM town_memories WHERE id = ? AND town_id = ? AND resident_id = ?'
  ).get(memoryId, townId, residentId);
  return row ? toTownMemory(row) : null;
}

function readTownReflection(database, townId, residentId, reflectionId) {
  const row = database.prepare(
    'SELECT * FROM town_reflections WHERE id = ? AND town_id = ? AND resident_id = ?'
  ).get(reflectionId, townId, residentId);
  return row ? toTownReflection(row) : null;
}

function normalizeResidentId(database, townId, residentId) {
  const normalized = String(residentId || '').trim();
  return normalized && readTownResident(database, townId, normalized) ? normalized : '';
}

function normalizeEventId(database, townId, eventId) {
  const normalized = String(eventId || '').trim();
  return normalized && readTownEvent(database, townId, normalized) ? normalized : '';
}

function userExists(database, userId) {
  return Boolean(database.prepare('SELECT id FROM users WHERE id = ?').get(userId));
}

function townTick(town) {
  return ((town.currentDay - 1) * 1440) + town.minuteOfDay;
}

function normalizeTick(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function normalizeMemoryType(value) {
  const normalized = String(value || '').trim();
  return MEMORY_TYPES.has(normalized) ? normalized : 'observation';
}

function normalizeSimulationStatus(value) {
  const normalized = String(value || '').trim();
  return SIMULATION_STATUSES.has(normalized) ? normalized : 'paused';
}

function normalizeScheduleStatus(value) {
  const normalized = String(value || '').trim();
  return SCHEDULE_STATUSES.has(normalized) ? normalized : 'planned';
}

function normalizeKeywords(value, content) {
  const source = Array.isArray(value) ? value : tokenizeMemoryText(content);
  return [...new Set(source.map((item) => normalizeText(item, 80)).filter(Boolean))].slice(0, 80);
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function roundScore(value) {
  return Math.round(value * 1000000) / 1000000;
}

function toTown(row) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    creationPrompt: row.creation_prompt || row.initialization_script || '',
    mapConfig: parseJson(row.map_config_json, {}),
    simulationStatus: row.simulation_status,
    currentDay: Number(row.current_day),
    minuteOfDay: Number(row.minute_of_day),
    settings: parseJson(row.settings_json, {}),
    engineCheckpointAt: row.engine_checkpoint_at || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toTownResident(row) {
  return {
    id: row.id,
    townId: row.town_id,
    name: row.name,
    role: row.role,
    profile: parseJson(row.profile_json, {}),
    state: parseJson(row.state_json, {}),
    currentLocation: row.current_location,
    reflectionThreshold: Number(row.reflection_threshold),
    lastReflectionAt: row.last_reflection_at || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toTownEvent(row) {
  return {
    id: row.id,
    townId: row.town_id,
    residentId: row.resident_id || '',
    eventType: row.event_type,
    source: row.source,
    title: row.title,
    detail: row.detail,
    payload: parseJson(row.payload_json, {}),
    occurredTick: Number(row.occurred_tick),
    handledAt: row.handled_at || '',
    createdAt: row.created_at
  };
}

function toTownMemory(row) {
  return {
    id: row.id,
    townId: row.town_id,
    residentId: row.resident_id,
    memoryType: row.memory_type,
    content: row.content,
    importance: Number(row.importance),
    keywords: parseJson(row.keywords_json, []),
    sourceEventId: row.source_event_id || '',
    sourceKind: row.source_kind,
    occurredTick: Number(row.occurred_tick),
    reflectedAt: row.reflected_at || '',
    lastAccessedAt: row.last_accessed_at || '',
    accessCount: Number(row.access_count),
    createdAt: row.created_at
  };
}

function toTownReflection(row) {
  return {
    id: row.id,
    townId: row.town_id,
    residentId: row.resident_id,
    content: row.content,
    evidenceMemoryIds: parseJson(row.evidence_memory_ids_json, []),
    importance: Number(row.importance),
    createdAt: row.created_at
  };
}

function toTownSchedule(row, items) {
  return {
    id: row.id,
    townId: row.town_id,
    residentId: row.resident_id,
    day: Number(row.day),
    goal: row.goal,
    status: row.status,
    items,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toScheduleItem(row) {
  return {
    id: row.id,
    startMinute: Number(row.start_minute),
    endMinute: Number(row.end_minute),
    activity: row.activity,
    location: row.location,
    intention: row.intention,
    status: row.status,
    orderIndex: Number(row.order_index)
  };
}
