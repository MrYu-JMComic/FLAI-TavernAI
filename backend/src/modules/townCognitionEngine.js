import { normalizeTownResidentCognitionPlan } from '../services/townCognitionAssistant.js';
import { activeTownConditions, normalizeTownLifeProfile, normalizeTownLifeState } from '../../../shared/townLife.js';
import { townVenue } from '../../../shared/townAssets.js';
import {
  createTownReflection,
  evaluateTownReflectionNeed,
  getTown,
  getTownSchedule,
  getTownSnapshot,
  listTownEvents,
  listTownReflections,
  listTownResidents,
  listTownUnreflectedMemories,
  recordTownEvent,
  recordTownMemory,
  retrieveTownMemories,
  saveTownSchedule,
  updateTownResidentState
} from './townSimulation.js';

export function buildTownResidentCognitionContext(database, userId, townId, residentId) {
  const town = getTown(database, userId, townId);
  if (!town) return null;
  const resident = (listTownResidents(database, userId, townId) || [])
    .find((item) => item.id === residentId);
  if (!resident) return null;
  const locations = normalizeLocations(town.mapConfig?.locations);
  const recentEvents = (listTownEvents(database, userId, townId, { limit: 50 }) || []).filter((event) => (
    event.residentId === residentId
    || Array.isArray(event.payload?.participantIds) && event.payload.participantIds.includes(residentId)
    || event.eventType === 'world.opening'
    || event.source === 'player' && !event.payload?.locationId
  )).slice(-12);
  const eventQuery = recentEvents.slice(-6).map((event) => `${event.title} ${event.detail}`).join(' ');
  const query = [
    resident.profile?.goal,
    resident.state?.currentIntention,
    resident.state?.currentActivity,
    eventQuery
  ].filter(Boolean).join(' ');
  const unreflectedMemories = listTownUnreflectedMemories(
    database,
    userId,
    townId,
    residentId,
    { limit: 24 }
  ) || [];
  const retrievedMemories = retrieveTownMemories(database, userId, townId, residentId, query, {
    limit: 10,
    trackAccess: false
  }) || [];
  const recentReflections = listTownReflections(database, userId, townId, residentId, { limit: 6 }) || [];
  const existingSchedule = getTownSchedule(database, userId, townId, residentId, town.currentDay);
  return {
    version: {
      tick: townTick(town),
      townUpdatedAt: town.updatedAt,
      residentUpdatedAt: resident.updatedAt,
      scheduleUpdatedAt: existingSchedule?.updatedAt || '',
      lastReflectionAt: resident.lastReflectionAt || '',
      unreflectedMemoryIds: unreflectedMemories.map((memory) => memory.id)
    },
    world: {
      id: town.id,
      name: town.name,
      description: town.settings.publicDescription || town.settings.environment?.atmosphere || '',
      rules: Array.isArray(town.settings?.worldRules) ? town.settings.worldRules : [],
      environment: town.settings?.environment || {},
      conditions: activeTownConditions(town)
    },
    time: {
      currentDay: town.currentDay,
      minuteOfDay: town.minuteOfDay,
      targetDay: town.currentDay,
      tick: townTick(town),
      simulationStatus: town.simulationStatus
    },
    locations,
    resident: {
      id: resident.id,
      name: resident.name,
      role: resident.role,
      summary: resident.profile?.summary || '',
      goal: resident.profile?.goal || '',
      mood: resident.state?.mood || '',
      currentLocation: resident.currentLocation,
      currentActivity: resident.state?.currentActivity || '',
      currentIntention: resident.state?.currentIntention || '',
      reflectionThreshold: resident.reflectionThreshold,
      simulation: normalizeTownLifeProfile(resident.profile, locations, resident.currentLocation),
      life: normalizeTownLifeState(resident.state, normalizeTownLifeProfile(resident.profile, locations, resident.currentLocation))
    },
    reflectionStatus: evaluateTownReflectionNeed(database, userId, townId, residentId),
    unreflectedMemories: unreflectedMemories.map(toContextMemory),
    retrievedMemories: retrievedMemories.map((memory) => ({
      ...toContextMemory(memory),
      score: memory.score,
      scoreParts: memory.scoreParts
    })),
    recentReflections: recentReflections.map((reflection) => ({
      id: reflection.id,
      content: reflection.content,
      evidenceMemoryIds: reflection.evidenceMemoryIds,
      importance: reflection.importance,
      createdAt: reflection.createdAt
    })),
    recentEvents: recentEvents.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      source: event.source,
      title: event.title,
      detail: event.detail,
      participantIds: Array.isArray(event.payload?.participantIds) ? event.payload.participantIds : [],
      occurredTick: event.occurredTick
    })),
    existingSchedule
  };
}

export function getTownResidentCognition(database, userId, townId, residentId) {
  const context = buildTownResidentCognitionContext(database, userId, townId, residentId);
  if (!context) return null;
  return cognitionSummary(context);
}

export function applyTownResidentCognitionPlan(database, userId, townId, residentId, plan, options = {}) {
  const context = buildTownResidentCognitionContext(database, userId, townId, residentId);
  if (!context) return null;
  if (context.time.simulationStatus !== 'paused') {
    throw townCognitionConflict('请先暂停世界，再让居民进行 AI 反思与规划。');
  }
  assertExpectedVersion(options.expectedVersion, context.version);
  const normalizedPlan = normalizeTownResidentCognitionPlan(plan, context);
  if (!normalizedPlan) throw new Error('AI 居民认知计划包含无效内容');

  const locationMap = new Map(context.locations.map((location) => [location.id, location]));
  const scheduleItems = normalizedPlan.schedule.items.map((item) => ({
    startMinute: item.startMinute,
    endMinute: item.endMinute,
    activity: item.activity,
    location: locationMap.get(item.locationId).name,
    intention: item.intention,
    status: 'planned'
  }));
  const activeItem = normalizedPlan.schedule.items.find((item) => (
    context.time.minuteOfDay >= item.startMinute && context.time.minuteOfDay < item.endMinute
  ));

  database.exec('BEGIN');
  try {
    const reflection = normalizedPlan.reflection.create
      ? createTownReflection(database, userId, townId, residentId, {
        content: normalizedPlan.reflection.content,
        memoryIds: normalizedPlan.reflection.evidenceMemoryIds,
        importance: normalizedPlan.reflection.importance
      })
      : null;
    const schedule = saveTownSchedule(database, userId, townId, residentId, {
      day: context.time.targetDay,
      goal: normalizedPlan.schedule.goal,
      status: 'planned',
      items: scheduleItems
    });

    if (activeItem) {
      updateTownResidentState(database, userId, townId, residentId, {
        state: {
          currentIntention: activeItem.intention,
          plannedActivity: activeItem.activity,
          life: { ...context.resident.life, action: { ...context.resident.life.action, remainingMinutes: 0 } },
          lastAiCognitionTick: context.time.tick
        }
      });
    }

    const event = recordTownEvent(database, userId, townId, {
      residentId,
      eventType: 'resident.schedule.planned',
      source: 'ai-town-cognition',
      title: `${context.resident.name}完成了新的日程规划`,
      detail: normalizedPlan.schedule.goal,
      payload: {
        uiType: 'plan',
        participantIds: [residentId],
        scheduleId: schedule.id,
        reflectionId: reflection?.id || '',
        generationMode: 'ai'
      },
      occurredTick: context.time.tick
    });
    recordTownMemory(database, userId, townId, residentId, {
      memoryType: 'plan',
      content: `我为第 ${context.time.targetDay} 天制定了计划：${normalizedPlan.schedule.goal}`,
      importance: 5,
      sourceEventId: event.id,
      sourceKind: 'ai-town-cognition',
      occurredTick: context.time.tick
    });
    database.exec('COMMIT');
    return {
      updated: true,
      mode: 'ai-cognition',
      generated: { reflection, schedule, event },
      cognition: getTownResidentCognition(database, userId, townId, residentId),
      snapshot: getTownSnapshot(database, userId, townId, { eventLimit: 200 })
    };
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function cognitionSummary(context) {
  return {
    residentId: context.resident.id,
    day: context.time.targetDay,
    reflectionStatus: context.reflectionStatus,
    reflections: context.recentReflections,
    schedule: context.existingSchedule
  };
}

function assertExpectedVersion(expected, current) {
  if (!expected || typeof expected !== 'object') return;
  if (
    Number(expected.tick) !== Number(current.tick)
    || String(expected.residentUpdatedAt || '') !== String(current.residentUpdatedAt || '')
    || String(expected.scheduleUpdatedAt || '') !== String(current.scheduleUpdatedAt || '')
    || String(expected.lastReflectionAt || '') !== String(current.lastReflectionAt || '')
    || !sameIds(expected.unreflectedMemoryIds, current.unreflectedMemoryIds)
  ) {
    throw townCognitionConflict('居民认知状态已发生变化，请重新进行 AI 反思与规划。');
  }
}

function sameIds(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
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

function toContextMemory(memory) {
  return {
    id: memory.id,
    memoryType: memory.memoryType,
    content: memory.content,
    importance: memory.importance,
    occurredTick: memory.occurredTick
  };
}

function townCognitionConflict(message) {
  const error = new Error(message);
  error.code = 'TOWN_AI_COGNITION_CONFLICT';
  return error;
}

function townTick(town) {
  return ((town.currentDay - 1) * 1440) + town.minuteOfDay;
}
