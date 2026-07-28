import { nowIso } from '../security.js';
import { parseJson } from '../utils/json.js';
import { clampInteger } from '../utils/number.js';
import {
  createTownReflection,
  evaluateTownReflectionNeed,
  getPendingTownIntervention,
  getTown,
  getTownSchedule,
  getTownSnapshot,
  listTownResidents,
  recordTownEvent,
  recordTownMemory,
  retrieveTownMemories,
  saveTownSchedule,
  updateTownClock,
  updateTownResidentState
} from './townSimulation.js';

const DEFAULT_ENGINE_INTERVAL_MS = 1000;
const DEFAULT_REAL_SECONDS_PER_TICK = 4;
const DEFAULT_TICK_MINUTES = 15;
const MAX_CATCHUP_STEPS = 6;
const AMBIENT_SOURCE_KINDS = Object.freeze(['engine-ambient']);

export function runTownSimulationStep(database, userId, townId, options = {}) {
  const town = getTown(database, userId, townId);
  if (!town) return null;
  if (town.simulationStatus !== 'running' && options.force !== true) {
    return { advanced: false, reason: 'paused', snapshot: getTownSnapshot(database, userId, townId) };
  }

  const residents = listTownResidents(database, userId, townId) || [];
  const tickMinutes = clampInteger(town.settings.tickMinutes, 1, 240, DEFAULT_TICK_MINUTES);
  const nextClock = advanceClock(town, tickMinutes);
  const nextTick = townTick(nextClock);
  const stepIndex = Math.floor(nextTick / tickMinutes);

  ensureDailySchedules(database, userId, town, residents);
  const updatedResidents = residents.map((resident, index) => {
    const action = chooseResidentAction(database, userId, town, resident, stepIndex, index);
    return updateTownResidentState(database, userId, townId, resident.id, {
      currentLocation: action.location || resident.currentLocation,
      state: {
        currentActivity: action.activity,
        currentIntention: action.intention,
        mapX: action.mapX ?? resident.state.mapX,
        mapY: action.mapY ?? resident.state.mapY,
        lastActionTick: nextTick
      }
    });
  });

  const injectedEvent = getPendingTownIntervention(database, userId, townId);
  const generated = injectedEvent
    ? reactToIntervention(database, userId, town, updatedResidents, injectedEvent, nextTick, stepIndex)
    : generateAutonomousEvent(database, userId, town, updatedResidents, nextTick, stepIndex);

  updateTownClock(database, userId, townId, {
    currentDay: nextClock.currentDay,
    minuteOfDay: nextClock.minuteOfDay,
    simulationStatus: 'running'
  });
  maybeReflect(database, userId, town, generated?.residentIds || []);

  return {
    advanced: true,
    tickMinutes,
    generated,
    snapshot: getTownSnapshot(database, userId, townId)
  };
}

export function runDueTownSimulationSteps(database, options = {}) {
  const nowMs = normalizeNowMs(options.nowMs);
  const worlds = database.prepare(
    "SELECT id, user_id, settings_json, engine_checkpoint_at FROM town_worlds WHERE simulation_status = 'running'"
  ).all();
  const results = [];
  for (const row of worlds) {
    const settings = parseJson(row.settings_json, {});
    const intervalMs = clampInteger(
      Number(settings.realSecondsPerTick) * 1000,
      1000,
      300000,
      DEFAULT_REAL_SECONDS_PER_TICK * 1000
    );
    const checkpointMs = Date.parse(row.engine_checkpoint_at || '');
    if (!Number.isFinite(checkpointMs)) {
      writeEngineCheckpoint(database, row.id, nowMs);
      continue;
    }
    const dueSteps = Math.min(MAX_CATCHUP_STEPS, Math.max(0, Math.floor((nowMs - checkpointMs) / intervalMs)));
    if (!dueSteps) continue;
    let latest = null;
    for (let index = 0; index < dueSteps; index += 1) {
      latest = runTownSimulationStep(database, row.user_id, row.id);
      if (!latest?.advanced) break;
    }
    writeEngineCheckpoint(database, row.id, nowMs);
    results.push({ townId: row.id, steps: dueSteps, latest });
  }
  return results;
}

export function startTownSimulationEngine(database, options = {}) {
  const intervalMs = clampInteger(options.intervalMs, 250, 60000, DEFAULT_ENGINE_INTERVAL_MS);
  const run = () => {
    try {
      runDueTownSimulationSteps(database);
    } catch (error) {
      options.onError?.(error);
    }
  };
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

function ensureDailySchedules(database, userId, town, residents) {
  for (const resident of residents) {
    if (getTownSchedule(database, userId, town.id, resident.id, town.currentDay)) continue;
    const activities = normalizeTextList(resident.profile.activities);
    if (!activities.length) continue;
    const route = residentRoute(town, resident);
    const itemMinutes = Math.floor(960 / activities.length);
    const items = activities.map((activity, index) => ({
      startMinute: 360 + (index * itemMinutes),
      endMinute: index === activities.length - 1 ? 1320 : 360 + ((index + 1) * itemMinutes),
      activity,
      location: route[index % Math.max(1, route.length)]?.name || resident.currentLocation,
      intention: resident.profile.goal || ''
    }));
    saveTownSchedule(database, userId, town.id, resident.id, {
      day: town.currentDay,
      goal: resident.profile.goal || '',
      items
    });
  }
}

function chooseResidentAction(database, userId, town, resident, stepIndex, residentIndex) {
  const schedule = getTownSchedule(database, userId, town.id, resident.id, town.currentDay);
  const scheduled = schedule?.items.find((item) => (
    town.minuteOfDay >= item.startMinute && town.minuteOfDay < item.endMinute
  ));
  if (scheduled) {
    const location = townLocation(town, scheduled.location);
    return {
      activity: scheduled.activity,
      location: scheduled.location,
      intention: scheduled.intention || schedule.goal,
      mapX: location?.x,
      mapY: location?.y
    };
  }
  const activities = normalizeTextList(resident.profile.activities);
  const route = residentRoute(town, resident);
  const location = route.length
    ? route[seededIndex(route.length, 'location', town.id, resident.id, stepIndex, residentIndex)]
    : null;
  const activity = seededPick(
    activities,
    resident.state?.currentActivity,
    'activity',
    town.id,
    resident.id,
    stepIndex,
    residentIndex
  );
  return {
    activity: activity || '观察周围',
    location: location?.name || resident.currentLocation,
    intention: resident.profile.goal || '',
    mapX: location?.x,
    mapY: location?.y
  };
}

function residentRoute(town, resident) {
  const locations = Array.isArray(town.mapConfig?.locations) ? town.mapConfig.locations : [];
  const routeIds = normalizeTextList(resident.profile.routeLocationIds);
  const route = routeIds.map((id) => locations.find((location) => location.id === id)).filter(Boolean);
  return route.length ? route : locations;
}

function townLocation(town, name) {
  const locations = Array.isArray(town.mapConfig?.locations) ? town.mapConfig.locations : [];
  return locations.find((location) => location.name === name);
}

function generateAutonomousEvent(database, userId, town, residents, tick, stepIndex) {
  if (!residents.length) return null;
  if (residents.length > 1 && stepIndex % 3 === 0) {
    const speaker = residents[seededIndex(residents.length, 'speaker', town.id, stepIndex)];
    const others = residents.filter((item) => item.id !== speaker.id);
    const listener = others[seededIndex(others.length, 'listener', town.id, stepIndex, speaker.id)];
    const dialogue = chooseDialogue(speaker, stepIndex);
    const detail = `${speaker.name} 对 ${listener.name} 说：“${dialogue}”`;
    const event = recordTownEvent(database, userId, town.id, {
      residentId: speaker.id,
      eventType: 'resident.social',
      source: 'town-engine',
      title: `${speaker.name} 与 ${listener.name} 交谈`,
      detail,
      payload: { uiType: 'dialogue', participantIds: [speaker.id, listener.id] },
      occurredTick: tick
    });
    recordTownMemory(database, userId, town.id, speaker.id, {
      memoryType: 'relationship', content: `我对${listener.name}说过：${dialogue}`, importance: 4, sourceEventId: event.id, sourceKind: 'engine-ambient', occurredTick: tick
    });
    recordTownMemory(database, userId, town.id, listener.id, {
      memoryType: 'relationship', content: `${speaker.name}对我说：${dialogue}`, importance: 4, sourceEventId: event.id, sourceKind: 'engine-ambient', occurredTick: tick
    });
    return { kind: 'social', event, residentIds: [speaker.id, listener.id] };
  }

  const resident = residents[stepIndex % residents.length];
  const activity = resident.state.currentActivity || '观察周围';
  const detail = `${resident.name}开始${activity}。`;
  const event = recordTownEvent(database, userId, town.id, {
    residentId: resident.id,
    eventType: 'resident.action',
    source: 'town-engine',
    title: detail,
    detail,
    payload: { uiType: 'world', activity },
    occurredTick: tick
  });
  recordTownMemory(database, userId, town.id, resident.id, {
    memoryType: 'event', content: detail, importance: 3, sourceEventId: event.id, sourceKind: 'engine-ambient', occurredTick: tick
  });
  return { kind: 'action', event, residentIds: [resident.id] };
}

function reactToIntervention(database, userId, town, residents, intervention, tick, stepIndex) {
  if (!residents.length) return null;
  const responder = residents[seededIndex(residents.length, 'responder', town.id, intervention.id, stepIndex)];
  const others = residents.filter((item) => item.id !== responder.id);
  const witness = others.length
    ? others[seededIndex(others.length, 'witness', town.id, intervention.id, stepIndex, responder.id)]
    : responder;
  const activity = responder.state.currentActivity || '前去查看';
  const eventTitle = intervention.title || intervention.detail || '突发事件';
  const detail = responder.id === witness.id
    ? `${responder.name}注意到”${eventTitle}”，决定先${activity}。`
    : `${responder.name}注意到”${eventTitle}”，决定先${activity}；${witness.name}也记住了这件事。`;
  const event = recordTownEvent(database, userId, town.id, {
    residentId: responder.id,
    eventType: 'resident.intervention.reaction',
    source: 'town-engine',
    title: `${responder.name}回应世界事件`,
    detail,
    payload: {
      uiType: 'clue',
      interventionId: intervention.id,
      participantIds: [...new Set([responder.id, witness.id])]
    },
    occurredTick: tick
  });
  for (const resident of dedupeById([responder, witness])) {
    recordTownMemory(database, userId, town.id, resident.id, {
      memoryType: 'event',
      content: `世界发生了“${eventTitle}”。${detail}`,
      importance: 7,
      sourceEventId: event.id,
      sourceKind: 'intervention',
      occurredTick: tick
    });
  }
  database.prepare('UPDATE town_events SET handled_at = ? WHERE id = ? AND town_id = ?')
    .run(nowIso(), intervention.id, town.id);
  return { kind: 'intervention', event, residentIds: [...new Set([responder.id, witness.id])] };
}

function dedupeById(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function maybeReflect(database, userId, town, residentIds) {
  for (const residentId of new Set(residentIds)) {
    const status = evaluateTownReflectionNeed(database, userId, town.id, residentId);
    if (!status?.shouldReflect) continue;
    const resident = listTownResidents(database, userId, town.id).find((item) => item.id === residentId);
    const goal = resident?.profile.goal || '';
    const meaningful = retrieveTownMemories(database, userId, town.id, residentId, goal, {
      limit: 5,
      trackAccess: false,
      excludeSourceKinds: AMBIENT_SOURCE_KINDS
    }) || [];
    let evidence = meaningful.filter((memory) => !memory.reflectedAt);
    if (!evidence.length) {
      // A purely engine-driven town has nothing but ambient memories. Reflecting on
      // those is still better than never reflecting, and it keeps the unreflected
      // importance total from growing without bound.
      const ambient = retrieveTownMemories(database, userId, town.id, residentId, goal, {
        limit: 5,
        trackAccess: false
      }) || [];
      evidence = ambient.filter((memory) => !memory.reflectedAt);
    }
    if (!evidence.length) continue;
    const summary = evidence.slice(0, 3).map((memory) => memory.content).join('；');
    createTownReflection(database, userId, town.id, residentId, {
      content: `我注意到：${summary}。接下来应围绕“${resident?.profile.goal || '当前生活'}”调整行动。`,
      memoryIds: evidence.map((memory) => memory.id),
      importance: Math.min(10, Math.max(5, Math.round(status.importanceTotal / evidence.length)))
    });
  }
}

function writeEngineCheckpoint(database, townId, nowMs) {
  database.prepare('UPDATE town_worlds SET engine_checkpoint_at = ? WHERE id = ?')
    .run(new Date(nowMs).toISOString(), townId);
}

function advanceClock(town, minutes) {
  const absolute = townTick(town) + minutes;
  return {
    currentDay: Math.floor(absolute / 1440) + 1,
    minuteOfDay: absolute % 1440
  };
}

function townTick(town) {
  return ((town.currentDay - 1) * 1440) + town.minuteOfDay;
}

function chooseDialogue(resident, stepIndex) {
  const dialogue = normalizeTextList(resident.profile.dialogue);
  const picked = seededPick(dialogue, null, 'dialogue', resident.id, stepIndex);
  return picked || `我正在${resident.state.currentActivity || '观察这里'}。`;
}

function normalizeTextList(value) {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : [];
}

// Deterministic 32-bit hash (FNV-1a style). Selection stays reproducible for a given
// (world, resident, tick) so tests and replays agree, but no longer cycles visibly the
// way `stepIndex % length` did.
function hashSeed(...parts) {
  let hash = 0x811c9dc5;
  const input = parts.join(' ');
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function seededIndex(length, ...seedParts) {
  if (length <= 1) return 0;
  return hashSeed(...seedParts) % length;
}

// Picks from `items`, biased away from `avoid` so a resident does not appear to repeat
// the same line or activity back to back when alternatives exist.
function seededPick(items, avoid, ...seedParts) {
  if (!items.length) return null;
  if (items.length === 1) return items[0];
  const candidates = avoid ? items.filter((item) => item !== avoid) : items;
  const pool = candidates.length ? candidates : items;
  return pool[seededIndex(pool.length, ...seedParts)];
}

function normalizeNowMs(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : Date.now();
}
