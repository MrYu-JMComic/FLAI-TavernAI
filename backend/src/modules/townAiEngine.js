import { nowIso } from '../security.js';
import { createHash } from 'node:crypto';
import { townVenue } from '../../../shared/townAssets.js';
import { activeTownConditions, isTownLocationAvailable, normalizeTownLifeProfile, normalizeTownLifeState } from '../../../shared/townLife.js';
import { simulateTownLife, townReachableLocations } from './townLifeSimulation.js';
import { findTownJourney } from './townNavigation.js';
import { eligibleTownIntervention, townWithIntervention } from './townWorldConditions.js';
import { normalizeTownTurnPlan } from '../services/townTurnAssistant.js';
import { clampInteger } from '../utils/number.js';
import {
  getPendingTownIntervention,
  getTown,
  getTownSchedule,
  getTownSnapshot,
  listTownEvents,
  listTownResidents,
  recordTownEvent,
  recordTownMemory,
  retrieveTownMemories,
  updateTownClock,
  updateTownResidentState
} from './townSimulation.js';

const DEFAULT_TICK_MINUTES = 15;
const AMBIENT_SOURCE_KINDS = Object.freeze(['engine-ambient']);

export function buildTownTurnContext(database, userId, townId) {
  let town = getTown(database, userId, townId);
  if (!town) return null;
  const pending = eligibleTownIntervention(town, getPendingTownIntervention(database, userId, townId));
  town = townWithIntervention(town, pending);
  const residents = listTownResidents(database, userId, townId) || [];
  const recentEvents = listTownEvents(database, userId, townId, { limit: 12 }) || [];
  const locations = normalizeLocations(town.mapConfig?.locations);
  const eventQuery = recentEvents.slice(-4).map((event) => `${event.title} ${event.detail}`).join(' ');
  return {
    version: {
      currentDay: town.currentDay,
      minuteOfDay: town.minuteOfDay,
      tick: townTick(town),
      updatedAt: town.updatedAt,
      residents: residentVersion(residents)
    },
    world: {
      id: town.id,
      name: town.name,
      description: town.description,
      creationPrompt: town.creationPrompt,
      rules: Array.isArray(town.settings?.worldRules) ? town.settings.worldRules : [],
      environment: town.settings?.environment || {},
      conditions: activeTownConditions(town)
    },
    time: {
      currentDay: town.currentDay,
      minuteOfDay: town.minuteOfDay,
      tick: townTick(town),
      tickMinutes: clampInteger(town.settings?.tickMinutes, 1, 240, DEFAULT_TICK_MINUTES),
      simulationStatus: town.simulationStatus
    },
    locations,
    residents: residents.map((resident) => buildResidentContext(
      database,
      userId,
      town,
      resident,
      eventQuery
    )),
    recentEvents: recentEvents.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      source: event.source,
      title: event.title,
      detail: event.detail,
      residentId: event.residentId,
      participantIds: Array.isArray(event.payload?.participantIds) ? event.payload.participantIds : [],
      occurredTick: event.occurredTick
    })),
    pendingIntervention: normalizePendingIntervention(
      pending
    )
  };
}

export function applyTownTurnPlan(database, userId, townId, plan, options = {}) {
  let town = getTown(database, userId, townId);
  if (!town) return null;
  if (town.simulationStatus !== 'paused') {
    throw townAiConflict('请先暂停世界，再进行 AI 推演。');
  }
  const expectedTick = Number(options.expectedTick);
  if (Number.isFinite(expectedTick) && expectedTick !== townTick(town)) {
    throw townAiConflict('世界状态已发生变化，请重新进行 AI 推演。');
  }
  const residents = listTownResidents(database, userId, townId) || [];
  if (options.expectedVersion && (options.expectedVersion.updatedAt !== town.updatedAt || options.expectedVersion.residents !== residentVersion(residents))) {
    throw townAiConflict('居民或世界状态已发生变化，请重新进行 AI 推演。');
  }
  const locations = normalizeLocations(town.mapConfig?.locations);
  const pendingIntervention = eligibleTownIntervention(town, getPendingTownIntervention(database, userId, townId));
  if ((pendingIntervention?.id || '') !== plan?.event?.respondsToEventId) {
    throw townAiConflict('待处理世界事件已发生变化，请重新进行 AI 推演。');
  }
  const normalizedPlan = normalizeTownTurnPlan(plan, { residents, locations, pendingIntervention });
  if (!normalizedPlan) throw new Error('AI 世界推演计划包含无效内容');
  const { actions, event: eventPlan } = normalizedPlan;
  const residentMap = new Map(residents.map((resident) => [resident.id, resident]));
  const locationMap = new Map(locations.map((location) => [location.id, location]));
  const respondsToEventId = eventPlan.respondsToEventId;
  town = townWithIntervention(town, pendingIntervention);

  const tickMinutes = clampInteger(town.settings?.tickMinutes, 1, 240, DEFAULT_TICK_MINUTES);
  const nextClock = advanceClock(town, tickMinutes);
  const nextTick = townTick(nextClock);
  for (const action of actions) {
    const resident = residentMap.get(action.residentId);
    const location = townVenue(locationMap.get(action.locationId));
    const route = findTownJourney(town, resident, location);
    const profile = normalizeTownLifeProfile(resident.profile, locations, resident.currentLocation);
    const life = normalizeTownLifeState(resident.state, profile);
    if (!route || route.minutes > tickMinutes || !isTownLocationAvailable(town, location, nextTick)) {
      throw new Error('AI 行动无法在本回合到达已开放的目标地点');
    }
    if (!['personal', 'explore', 'relax'].includes(action.actionKind) && !location.services.includes(action.actionKind)) throw new Error('AI 行动与地点提供的设施不符');
    if (action.actionKind === 'work' && profile.workLocationId !== location.id) throw new Error('AI 不能在未安排的工作地点领取工资');
    if (action.actionKind === 'eat' && life.money < (profile.homeLocationId === location.id ? 2 : 8)) throw new Error('居民余额不足以执行 AI 用餐计划');
    if ((life.needs.energy < 10 || life.needs.hunger < 10) && !['sleep', 'eat', 'care'].includes(action.actionKind)) throw new Error('居民需要先处理紧急生活需求');
  }
  const physical = simulateTownLife(town, residents, tickMinutes, { actions: new Map(actions.map((action) => [action.residentId, action])) });
  for (const action of actions) {
    const resident = physical.residents.find((item) => item.id === action.residentId);
    if (resident.state.life.journey || resident.currentLocation !== locationMap.get(action.locationId).name) throw new Error('AI 行动的通勤尚未完成，不能记录为已经发生');
  }
  database.exec('BEGIN');
  try {
    database.prepare('UPDATE town_worlds SET settings_json = ? WHERE id = ? AND user_id = ?').run(JSON.stringify(town.settings), townId, userId);
    for (const resident of physical.residents) {
      const action = actions.find((item) => item.residentId === resident.id);
      updateTownResidentState(database, userId, townId, resident.id, {
        currentLocation: resident.currentLocation,
        state: {
          ...resident.state,
          ...(action ? { mood: action.mood, currentActivity: action.activity, currentIntention: action.intention, lastAiActionTick: nextTick } : {}),
          lastActionTick: nextTick,
        }
      });
    }

    const event = recordTownEvent(database, userId, townId, {
      residentId: eventPlan.participantIds[0],
      eventType: eventPlan.eventType,
      source: 'ai-town-engine',
      title: eventPlan.title,
      detail: eventPlan.detail,
      payload: {
        uiType: eventPlan.uiType,
        participantIds: eventPlan.participantIds,
        actionResidentIds: actions.map((action) => action.residentId),
        respondsToEventId,
        generationMode: 'ai'
      },
      occurredTick: nextTick
    });

    for (const action of actions) {
      recordTownMemory(database, userId, townId, action.residentId, {
        memoryType: eventPlan.eventType === 'resident.social' ? 'relationship' : 'event',
        content: action.memory,
        importance: action.importance,
        sourceEventId: event.id,
        sourceKind: 'ai-town-engine',
        occurredTick: nextTick
      });
    }

    if (respondsToEventId) {
      const updated = database.prepare(
        'UPDATE town_events SET handled_at = ? WHERE id = ? AND town_id = ? AND handled_at IS NULL'
      ).run(nowIso(), respondsToEventId, townId);
      if (Number(updated.changes) !== 1) {
        throw townAiConflict('待处理世界事件已被其他推演处理，请重试。');
      }
    }

    updateTownClock(database, userId, townId, {
      currentDay: nextClock.currentDay,
      minuteOfDay: nextClock.minuteOfDay,
      simulationStatus: 'paused'
    });
    database.exec('COMMIT');
    return {
      advanced: true,
      mode: 'ai',
      tickMinutes,
      generated: {
        kind: 'ai',
        event,
        residentIds: actions.map((action) => action.residentId)
      },
      snapshot: getTownSnapshot(database, userId, townId, { eventLimit: 200 })
    };
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function buildResidentContext(database, userId, town, resident, eventQuery) {
  const simulation = normalizeTownLifeProfile(resident.profile, town.mapConfig?.locations || [], resident.currentLocation);
  const query = [
    resident.profile?.goal,
    resident.state?.currentIntention,
    resident.state?.currentActivity,
    eventQuery
  ].filter(Boolean).join(' ');
  const memories = retrieveTownMemories(database, userId, town.id, resident.id, query, {
    limit: 5,
    trackAccess: false,
    excludeSourceKinds: AMBIENT_SOURCE_KINDS,
    minImportance: 5
  }) || [];
  const schedule = getTownSchedule(database, userId, town.id, resident.id, town.currentDay);
  const scheduleItem = schedule?.items.find((item) => (
    town.minuteOfDay >= item.startMinute && town.minuteOfDay < item.endMinute
  ));
  return {
    id: resident.id,
    name: resident.name,
    role: resident.role,
    summary: resident.profile?.summary || '',
    goal: resident.profile?.goal || '',
    mood: resident.state?.mood || '',
    currentLocation: resident.currentLocation,
    currentActivity: resident.state?.currentActivity || '',
    currentIntention: resident.state?.currentIntention || '',
    simulation,
    life: normalizeTownLifeState(resident.state, simulation),
    reachableLocations: townReachableLocations(town, resident, clampInteger(town.settings?.tickMinutes, 1, 240, DEFAULT_TICK_MINUTES)),
    currentSchedule: scheduleItem ? {
      activity: scheduleItem.activity,
      location: scheduleItem.location,
      intention: scheduleItem.intention
    } : null,
    memories: memories.map((memory) => ({
      id: memory.id,
      memoryType: memory.memoryType,
      content: memory.content,
      importance: memory.importance,
      occurredTick: memory.occurredTick
    }))
  };
}

function normalizeLocations(value) {
  const rows = Array.isArray(value) ? value : [];
  return rows.map((location) => townVenue({
    ...location,
    id: String(location?.id || ''),
    name: String(location?.name || ''),
    kind: String(location?.kind || ''),
    description: String(location?.description || ''),
    x: Number(location?.x),
    y: Number(location?.y)
  })).filter((location) => location.id && location.name && Number.isFinite(location.x) && Number.isFinite(location.y));
}

function normalizePendingIntervention(event) {
  if (!event) return null;
  return {
    id: event.id,
    title: event.title,
    detail: event.detail,
    occurredTick: event.occurredTick,
    effect: event.payload?.effect || 'observation',
    locationId: event.payload?.locationId || '',
    durationMinutes: event.payload?.durationMinutes || 0
  };
}

function townAiConflict(message) {
  const error = new Error(message);
  error.code = 'TOWN_AI_STEP_CONFLICT';
  return error;
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

function residentVersion(residents) {
  return createHash('sha256').update(JSON.stringify(residents.map(({ id, state, profile, currentLocation, updatedAt }) => ({ id, state, profile, currentLocation, updatedAt })))).digest('hex');
}
