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
  const location = route[(stepIndex + residentIndex) % Math.max(1, route.length)];
  return {
    activity: activities[(stepIndex + residentIndex) % Math.max(1, activities.length)] || '观察周围',
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
    const speaker = residents[stepIndex % residents.length];
    const listener = residents[(stepIndex + 2) % residents.length];
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
      memoryType: 'relationship', content: `我对${listener.name}说过：${dialogue}`, importance: 4, sourceEventId: event.id, occurredTick: tick
    });
    recordTownMemory(database, userId, town.id, listener.id, {
      memoryType: 'relationship', content: `${speaker.name}对我说：${dialogue}`, importance: 4, sourceEventId: event.id, occurredTick: tick
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
    memoryType: 'event', content: detail, importance: 3, sourceEventId: event.id, occurredTick: tick
  });
  return { kind: 'action', event, residentIds: [resident.id] };
}

function reactToIntervention(database, userId, town, residents, intervention, tick, stepIndex) {
  if (!residents.length) return null;
  const responder = residents[stepIndex % residents.length];
  const witness = residents[(stepIndex + 1) % residents.length];
  const activity = responder.state.currentActivity || '前去查看';
  const eventTitle = intervention.title || intervention.detail || '突发事件';
  const detail = `${responder.name}注意到“${eventTitle}”，决定先${activity}；${witness.name}也记住了这件事。`;
  const event = recordTownEvent(database, userId, town.id, {
    residentId: responder.id,
    eventType: 'resident.intervention.reaction',
    source: 'town-engine',
    title: `${responder.name}回应世界事件`,
    detail,
    payload: { uiType: 'clue', interventionId: intervention.id, participantIds: [responder.id, witness.id] },
    occurredTick: tick
  });
  for (const resident of [responder, witness]) {
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
  return { kind: 'intervention', event, residentIds: [responder.id, witness.id] };
}

function maybeReflect(database, userId, town, residentIds) {
  for (const residentId of new Set(residentIds)) {
    const status = evaluateTownReflectionNeed(database, userId, town.id, residentId);
    if (!status?.shouldReflect) continue;
    const resident = listTownResidents(database, userId, town.id).find((item) => item.id === residentId);
    const memories = retrieveTownMemories(database, userId, town.id, residentId, resident?.profile.goal || '', {
      limit: 5,
      trackAccess: false
    });
    const evidence = memories.filter((memory) => !memory.reflectedAt);
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
  return dialogue[stepIndex % Math.max(1, dialogue.length)] || `我正在${resident.state.currentActivity || '观察这里'}。`;
}

function normalizeTextList(value) {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : [];
}

function normalizeNowMs(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : Date.now();
}
