import { nowIso } from '../security.js';
import { parseJson } from '../utils/json.js';
import { clampInteger } from '../utils/number.js';
import { withSavepoint } from './savepoint.js';
import { simulateTownLife } from './townLifeSimulation.js';
import { normalizeTownLifeProfile } from '../../../shared/townLife.js';
import { eligibleTownIntervention, townWithIntervention } from './townWorldConditions.js';
import {
  createTownReflection, evaluateTownReflectionNeed, getPendingTownIntervention,
  getTown, getTownSchedule, getTownSnapshot, listTownResidents, recordTownEvent,
  recordTownMemory, retrieveTownMemories, saveTownSchedule, updateTownClock,
  updateTownResidentState
} from './townSimulation.js';

const ACTION_LABELS = Object.freeze({
  sleep: '睡眠恢复', eat: '用餐', wash: '洗漱', work: '工作',
  social: '寻找交谈机会', relax: '休息放松', explore: '散步探索',
  learn: '学习', care: '休养', personal: '处理个人事务'
});
const MOOD_LABELS = Object.freeze({
  exhausted: '疲惫', hungry: '饥饿', uncomfortable: '不适', lonely: '孤独',
  tense: '烦闷', content: '满足', steady: '平静'
});
const MAX_CATCHUP_STEPS = 6;

export function runTownSimulationStep(database, userId, townId, options = {}) {
  let town = getTown(database, userId, townId);
  if (!town) return null;
  if (town.simulationStatus !== 'running' && options.force !== true) {
    return { advanced: false, reason: 'paused', snapshot: getTownSnapshot(database, userId, townId) };
  }
  return withSavepoint(database, 'sp_town_life_tick', () => {
    const residents = listTownResidents(database, userId, townId) || [];
    const tickMinutes = clampInteger(town.settings.tickMinutes, 1, 240, 15);
    const tick = townTick(town) + tickMinutes;
    const pending = getPendingTownIntervention(database, userId, townId);
    const intervention = eligibleTownIntervention(town, pending);
    const effectiveTown = townWithIntervention(town, intervention);
    if (effectiveTown !== town) {
      town = effectiveTown;
      database.prepare('UPDATE town_worlds SET settings_json = ? WHERE id = ? AND user_id = ?').run(JSON.stringify(town.settings), townId, userId);
    }
    const scheduleCache = new Map();
    const life = simulateTownLife(town, residents, tickMinutes, {
      scheduleAt: (residentId, currentTick) => {
        const day = Math.floor(currentTick / 1440) + 1;
        const key = `${residentId}:${day}`;
        if (!scheduleCache.has(key)) {
          const resident = residents.find((item) => item.id === residentId);
          scheduleCache.set(key, ensureDailySchedule(database, userId, town, resident, day));
        }
        const minute = currentTick % 1440;
        const schedule = scheduleCache.get(key);
        const item = schedule?.items.find((item) => minute >= item.startMinute && minute < item.endMinute);
        return item ? { ...item, autonomous: schedule.autonomous, scheduleId: schedule.id, scheduleUpdatedAt: schedule.updatedAt } : null;
      }
    });
    for (const resident of life.residents) {
      const state = resident.state;
      if (tick % 1440 === 0) {
        const schedule = ensureDailySchedule(database, userId, town, resident, Math.floor(tick / 1440) + 1);
        if (schedule.autonomous) state.life.routineSchedule = { id: schedule.id, updatedAt: schedule.updatedAt };
      }
      updateTownResidentState(database, userId, townId, resident.id, {
        currentLocation: resident.currentLocation,
        state: {
          ...state,
          mood: MOOD_LABELS[state.simulatedMood] || state.mood,
          currentActivity: state.life.journey
            ? `前往${state.life.journey.locationName}`
            : state.life.action.activity || ACTION_LABELS[state.life.action.kind] || '观察周围',
          currentIntention: state.life.action.intention || resident.profile.goal || '',
          lastActionTick: tick
        }
      });
    }
    let generated = recordLifeEvents(database, userId, town, life, residents, tick);
    if (intervention) {
      const reaction = reactToIntervention(database, userId, town, life.residents, intervention, tick);
      generated = { ...reaction, events: [...(generated?.events || []), reaction.event], residentIds: [...new Set([...(generated?.residentIds || []), ...reaction.residentIds])] };
    }
    updateTownClock(database, userId, townId, {
      currentDay: Math.floor(tick / 1440) + 1,
      minuteOfDay: tick % 1440,
      simulationStatus: town.simulationStatus
    });
    maybeReflect(database, userId, town, generated?.residentIds || []);
    return { advanced: true, tickMinutes, generated, snapshot: getTownSnapshot(database, userId, townId) };
  });
}

export function runDueTownSimulationSteps(database, options = {}) {
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const worlds = database.prepare(
    "SELECT id, user_id, settings_json, engine_checkpoint_at FROM town_worlds WHERE simulation_status = 'running' ORDER BY engine_checkpoint_at ASC LIMIT 48"
  ).all();
  const results = [];
  for (const row of worlds) {
    const settings = parseJson(row.settings_json, {});
    const intervalMs = clampInteger(Number(settings.realSecondsPerTick) * 1000, 1000, 300000, 4000);
    const checkpointMs = Date.parse(row.engine_checkpoint_at || '');
    if (!Number.isFinite(checkpointMs)) { writeEngineCheckpoint(database, row.id, nowMs); continue; }
    const elapsedSteps = Math.max(0, Math.floor((nowMs - checkpointMs) / intervalMs));
    const dueSteps = Math.min(MAX_CATCHUP_STEPS, elapsedSteps);
    if (!dueSteps) continue;
    let latest = null;
    let steps = 0;
    let failed = false;
    try {
      for (; steps < dueSteps; steps += 1) {
        latest = runTownSimulationStep(database, row.user_id, row.id);
        if (!latest?.advanced) break;
      }
    } catch (error) {
      failed = true;
      database.prepare("UPDATE town_worlds SET simulation_status = 'paused', updated_at = ? WHERE id = ?").run(nowIso(), row.id);
      options.onError?.(error, { townId: row.id });
      try {
        recordTownEvent(database, row.user_id, row.id, { eventType: 'world.simulation.error', source: 'town-engine', title: '世界模拟已暂停', detail: '本时段未能完成，未完成的状态修改已回滚。', payload: { uiType: 'world' } });
      } catch (reportingError) {
        options.onError?.(reportingError, { townId: row.id });
      }
    }
    if (!failed && elapsedSteps > MAX_CATCHUP_STEPS) {
      recordTownEvent(database, row.user_id, row.id, {
        eventType: 'world.catchup.limited', source: 'town-engine',
        title: '世界恢复运行', detail: `已补算 ${steps} 个时段；离线期间其余时间未模拟。`,
        payload: { uiType: 'world', processedSteps: steps, skippedSteps: elapsedSteps - steps }
      });
    }
    writeEngineCheckpoint(database, row.id, elapsedSteps > MAX_CATCHUP_STEPS ? nowMs : checkpointMs + steps * intervalMs);
    results.push({ townId: row.id, steps, latest, ...(failed ? { error: 'TOWN_SIMULATION_FAILED' } : {}) });
  }
  return results;
}

export function startTownSimulationEngine(database, options = {}) {
  const run = () => {
    try { runDueTownSimulationSteps(database, { onError: options.onError }); }
    catch (error) { options.onError?.(error); }
  };
  run();
  const timer = setInterval(run, clampInteger(options.intervalMs, 250, 60000, 1000));
  timer.unref?.();
  return () => clearInterval(timer);
}

function ensureDailySchedule(database, userId, town, resident, day) {
  const existing = getTownSchedule(database, userId, town.id, resident.id, day);
  if (existing) {
    const routine = resident.state.life?.routineSchedule;
    return { ...existing, autonomous: routine?.id === existing.id && routine?.updatedAt === existing.updatedAt };
  }
  const locations = town.mapConfig?.locations || [];
  const profile = normalizeTownLifeProfile(resident.profile, locations, resident.currentLocation);
  const home = locations.find((item) => item.id === profile.homeLocationId)?.name || resident.currentLocation;
  const work = locations.find((item) => item.id === profile.workLocationId)?.name;
  const boundaries = [...new Set([0, 1440, profile.wakeMinute, profile.sleepMinute, profile.workStartMinute, profile.workEndMinute])].sort((a, b) => a - b);
  const items = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const startMinute = boundaries[index];
    const sleeping = inWindow(startMinute, profile.sleepMinute, profile.wakeMinute);
    const working = !sleeping && work && inWindow(startMinute, profile.workStartMinute, profile.workEndMinute);
    items.push({
      startMinute, endMinute: boundaries[index + 1],
      activity: sleeping ? '睡眠与休息' : working ? '日常工作' : '自由安排',
      location: working ? work : home, intention: resident.profile.goal || ''
    });
  }
  const schedule = saveTownSchedule(database, userId, town.id, resident.id, {
    day, goal: resident.profile.goal || '', items
  });
  return { ...schedule, autonomous: true };
}

function recordLifeEvents(database, userId, town, life, previousResidents, tick) {
  const recorded = [];
  const participants = new Set();
  for (const interaction of life.interactions) {
    const speaker = life.residents.find((item) => item.id === interaction.residentId);
    const listener = life.residents.find((item) => item.id === interaction.listenerId);
    const lines = Array.isArray(speaker.profile.dialogue) ? speaker.profile.dialogue : [];
    const line = lines[Math.floor(interaction.tick / 30) % Math.max(1, lines.length)] || '今天过得怎么样？';
    const event = recordTownEvent(database, userId, town.id, {
      residentId: speaker.id, eventType: 'resident.social', source: 'town-engine',
      title: `${speaker.name}与${listener.name}${interaction.affinityChange < 0 ? '发生分歧' : '交谈'}`,
      detail: `在${interaction.location}，${speaker.name}对${listener.name}说：“${line}”`,
      payload: { uiType: 'dialogue', participantIds: [speaker.id, listener.id], location: interaction.location, speech: { residentId: speaker.id, text: line }, affinityChange: interaction.affinityChange },
      occurredTick: interaction.tick
    });
    for (const resident of [speaker, listener]) {
      participants.add(resident.id);
      recordTownMemory(database, userId, town.id, resident.id, {
        content: event.detail, memoryType: 'relationship', importance: interaction.affinityChange < 0 ? 6 : 5,
        sourceEventId: event.id, sourceKind: 'life-simulation', occurredTick: interaction.tick
      });
    }
    recorded.push({ kind: 'social', event });
  }
  const changed = new Map(life.transitions.map((transition) => [transition.residentId, transition]));
  for (const [residentId, transition] of changed) {
    const resident = life.residents.find((item) => item.id === residentId);
    const label = resident.state.life.journey ? `前往${resident.state.life.journey.locationName}` : resident.state.life.action.activity || ACTION_LABELS[transition.kind];
    const event = recordTownEvent(database, userId, town.id, {
      residentId, eventType: 'resident.action', source: 'town-engine',
      title: `${resident.name}开始${label}`, detail: `${resident.name}开始${label}。`,
      payload: { uiType: 'action', activity: label, reason: transition.reason, locationId: transition.locationId },
      occurredTick: tick
    });
    recorded.push({ kind: 'action', event });
  }
  for (const resident of life.residents) {
    const before = previousResidents.find((item) => item.id === resident.id)?.state.life?.earned || 0;
    const earned = resident.state.life.earned;
    if (Math.floor(earned / 24) <= Math.floor(before / 24)) continue;
    const event = recordTownEvent(database, userId, town.id, {
      residentId: resident.id, eventType: 'resident.work.income', source: 'town-engine',
      title: `${resident.name}获得劳动收入`, detail: `本时段收入 ${(earned - before).toFixed(2)}，当前余额 ${resident.state.life.money.toFixed(2)}。`,
      payload: { uiType: 'action', earned: earned - before, balance: resident.state.life.money }, occurredTick: tick
    });
    recordTownMemory(database, userId, town.id, resident.id, {
      content: event.detail, memoryType: 'event', importance: 5, sourceEventId: event.id, sourceKind: 'life-simulation', occurredTick: tick
    });
    participants.add(resident.id);
    recorded.push({ kind: 'income', event });
  }
  const main = recorded.find((row) => row.kind === 'social') || recorded[0];
  return main ? { ...main, residentIds: [...participants], events: recorded.map((row) => row.event) } : null;
}

function reactToIntervention(database, userId, town, residents, intervention, tick) {
  const targetLocationId = intervention.payload?.locationId;
  const target = (town.mapConfig?.locations || []).find((location) => location.id === targetLocationId);
  const witnesses = residents.filter((resident) => !resident.state.life.journey && resident.state.life.action.kind !== 'sleep' && (!target || resident.currentLocation === target.name));
  const participantIds = witnesses.map((resident) => resident.id);
  const event = recordTownEvent(database, userId, town.id, {
    residentId: participantIds[0] || '', eventType: 'resident.intervention.reaction', source: 'town-engine',
    title: witnesses.length ? '居民注意到世界事件' : '事件发生，暂无现场目击者',
    detail: `${intervention.title || intervention.detail}。${witnesses.length ? witnesses.map((resident) => resident.name).join('、') + '记住了这一变化。' : '事件已记入世界时间线。'}`,
    payload: { uiType: 'clue', interventionId: intervention.id, participantIds, locationId: targetLocationId || '' }, occurredTick: tick
  });
  for (const resident of witnesses) {
    recordTownMemory(database, userId, town.id, resident.id, {
      memoryType: 'event', content: event.detail, importance: 7, sourceEventId: event.id,
      sourceKind: 'intervention', occurredTick: tick
    });
  }
  database.prepare('UPDATE town_events SET handled_at = ? WHERE id = ? AND town_id = ?').run(nowIso(), intervention.id, town.id);
  return { kind: 'intervention', event, residentIds: participantIds };
}

function maybeReflect(database, userId, town, residentIds) {
  for (const residentId of new Set(residentIds)) {
    const status = evaluateTownReflectionNeed(database, userId, town.id, residentId);
    if (!status?.shouldReflect) continue;
    const resident = listTownResidents(database, userId, town.id).find((item) => item.id === residentId);
    const evidence = (retrieveTownMemories(database, userId, town.id, residentId, resident?.profile.goal || '', {
      limit: 5, trackAccess: false, excludeSourceKinds: ['engine-ambient']
    }) || []).filter((memory) => !memory.reflectedAt && memory.memoryType !== 'reflection');
    if (!evidence.length) continue;
    createTownReflection(database, userId, town.id, residentId, {
      content: `我记住了这些亲历的变化：${evidence.slice(0, 3).map((memory) => memory.content).join('；')}`,
      memoryIds: evidence.map((memory) => memory.id), importance: 5
    });
  }
}

function writeEngineCheckpoint(database, townId, nowMs) {
  database.prepare('UPDATE town_worlds SET engine_checkpoint_at = ? WHERE id = ?').run(new Date(nowMs).toISOString(), townId);
}

function townTick(town) { return (town.currentDay - 1) * 1440 + town.minuteOfDay; }
function inWindow(minute, start, end) { return start < end ? minute >= start && minute < end : minute >= start || minute < end; }
