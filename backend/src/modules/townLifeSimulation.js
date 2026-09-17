import { townVenue } from '../../../shared/townAssets.js';
import { activeTownConditions, bounded, isTownLocationAvailable, normalizeTownLifeProfile, normalizeTownLifeState, TOWN_ACTIONS, TOWN_NEEDS, townNeedMood } from '../../../shared/townLife.js';
import { townPathPoint } from '../../../shared/townGeometry.js';
import { findTownJourney } from './townNavigation.js';

const DURATIONS = Object.freeze({ sleep: 60, eat: 20, wash: 20, work: 60, social: 30, relax: 45, explore: 45, learn: 60, care: 30, personal: 45 });
const DECAY = Object.freeze({ energy: 4, hunger: 6, hygiene: 3, social: 2, fun: 3 });

export function simulateTownLife(town, sourceResidents, minutes, options = {}) {
  const locations = (town.mapConfig?.locations || []).map(townVenue);
  const residents = sourceResidents.map((source) => {
    const resident = structuredClone(source);
    resident.simulation = normalizeTownLifeProfile(resident.profile, locations, resident.currentLocation);
    resident.state = { ...resident.state, life: normalizeTownLifeState(resident.state, resident.simulation) };
    const allowedIds = new Set(sourceResidents.filter((row) => row.id !== resident.id).map((row) => row.id));
    resident.state.life.relationships = Object.fromEntries(Object.entries(resident.state.life.relationships).filter(([id]) => allowedIds.has(id)));
    return resident;
  });
  const transitions = [];
  const interactions = [];
  const startTick = (town.currentDay - 1) * 1440 + town.minuteOfDay;
  const duration = Math.max(0, Math.min(240, Number(minutes) || 0));
  for (let elapsed = 0; elapsed < duration; elapsed += 5) {
    const step = Math.min(5, duration - elapsed);
    const tick = startTick + elapsed;
    for (const resident of residents) {
      const life = resident.state.life;
      const forced = options.actions?.get(resident.id);
      const scheduled = options.scheduleAt?.(resident.id, tick) || null;
      if (scheduled?.autonomous) life.routineSchedule = { id: scheduled.scheduleId, updatedAt: scheduled.scheduleUpdatedAt };
      if (forced && elapsed === 0) {
        const destination = locations.find((location) => location.id === forced.locationId);
        const route = destination ? findTownJourney(town, resident, destination) : null;
        life.action = chooseAction(town, resident, residents, locations, tick, null, forced);
        life.decision = { reason: 'ai-plan', kind: life.action.kind, locationId: forced.locationId, tick };
        life.journey = route?.minutes > 0 ? { ...route, locationId: destination.id, locationName: destination.name, elapsedMinutes: 0 } : null;
      }
      const previousKind = life.action.kind;
      const previousTarget = life.action.locationId;
      if (!life.journey && (!TOWN_ACTIONS.includes(life.action.kind) || life.action.remainingMinutes <= 0 || mustInterrupt(life, tick, resident.simulation))) {
        life.action = chooseAction(town, resident, residents, locations, tick, scheduled, forced);
        life.decision = { reason: life.action.reason, kind: life.action.kind, locationId: life.action.locationId, tick };
        const destination = locations.find((location) => location.id === life.action.locationId);
        if (destination && resident.currentLocation !== destination.name) {
          const route = findTownJourney(town, resident, destination);
          if (route && route.minutes > 0) {
            life.journey = { ...route, locationId: destination.id, locationName: destination.name, elapsedMinutes: 0 };
          } else if (!route) {
            life.action = localAction('relax', locations, resident, 'unreachable');
          }
        }
        if (life.action.kind !== previousKind || life.action.locationId !== previousTarget) {
          transitions.push({ residentId: resident.id, kind: life.action.kind, reason: life.action.reason, locationId: life.action.locationId, tick });
        }
      }

      let actionMinutes = step;
      if (life.journey) {
        const journey = life.journey;
        const travelMinutes = Math.min(step, Math.max(0, journey.minutes - journey.elapsedMinutes));
        journey.elapsedMinutes += travelMinutes;
        const progress = journey.minutes > 0 ? Math.min(1, journey.elapsedMinutes / journey.minutes) : 1;
        const point = townPathPoint(journey.points, journey.distance * progress);
        resident.state.mapX = point.x;
        resident.state.mapY = point.y;
        actionMinutes -= travelMinutes;
        if (progress >= 1) {
          resident.currentLocation = journey.locationName;
          life.journey = null;
        }
      }

      decayNeeds(life, resident.simulation, step);
      const location = locations.find((item) => item.name === resident.currentLocation);
      if (actionMinutes > 0 && !life.journey) {
        const action = life.action;
        if (location && !venueAvailable(town, location, resident, residents, tick) && !['personal', 'relax', 'explore'].includes(action.kind)) {
          action.remainingMinutes = 0;
          life.decision.reason = 'closed';
        } else {
          const usedMinutes = Math.min(actionMinutes, Math.max(0, action.remainingMinutes));
          if (usedMinutes > 0) applyActivity(life, resident.simulation, action, usedMinutes, tick + step - actionMinutes, location);
          action.remainingMinutes = Math.max(0, action.remainingMinutes - usedMinutes);
        }
      }
      life.lastTick = tick + step;
      resident.state.simulatedMood = townNeedMood(life.needs);
    }
    socialize(residents, tick + step, interactions);
  }
  return { residents: residents.map(({ simulation, ...resident }) => resident), transitions, interactions };
}

export function townReachableLocations(town, resident, minutes) {
  return (town.mapConfig?.locations || []).flatMap((location) => {
    const journey = findTownJourney(town, resident, location);
    return journey && journey.minutes <= minutes ? [{ id: location.id, travelMinutes: Math.round(journey.minutes * 10) / 10 }] : [];
  });
}

function chooseAction(town, resident, residents, locations, tick, scheduled, forced) {
  const life = resident.state.life;
  const profile = resident.simulation;
  const traits = profile.personality;
  const needs = life.needs;
  const minute = tick % 1440;
  const choices = [];
  const add = (kind, score, reason, preferredId = '', activity = '', intention = resident.profile.goal || '') => {
    const venues = locations.filter((location) => {
      if (!location.services.includes(kind) && !['personal', 'explore'].includes(kind)) return false;
      if (preferredId && location.id !== preferredId) return false;
      if (['sleep', 'eat', 'wash'].includes(kind) && ['house', 'apartment'].includes(location.assetId) && location.id !== profile.homeLocationId) return false;
      if (!venueAvailable(town, location, resident, residents, tick)) return false;
      if (kind === 'eat' && life.money < mealCost(location, profile)) return false;
      if (kind === 'work' && location.id !== profile.workLocationId) return false;
      if (kind === 'social' && !residents.some((peer) => peer.id !== resident.id && peer.currentLocation === location.name && socialAvailable(peer, tick))) return false;
      return true;
    });
    let target = null;
    let shortest = Infinity;
    for (const venue of venues) {
      const journey = findTownJourney(town, resident, venue);
      if (journey && journey.minutes < shortest) { target = venue; shortest = journey.minutes; }
    }
    if (!target && !['sleep', 'relax', 'personal'].includes(kind)) return;
    if (!target && preferredId) return;
    const festival = kind === 'social' && target && activeTownConditions(town, tick).some((condition) => condition.kind === 'festival' && (!condition.locationId || condition.locationId === target.id));
    choices.push({ kind, score: score + (festival ? 65 : 0) - (Number.isFinite(shortest) ? shortest * 0.4 : 0), reason: festival ? 'festival' : reason, locationId: target?.id || '', remainingMinutes: DURATIONS[kind], activity, intention, startedTick: tick, paid: false });
  };

  if (forced) {
    const kind = TOWN_ACTIONS.includes(forced.actionKind) ? forced.actionKind : 'personal';
    return { kind, locationId: forced.locationId, remainingMinutes: DURATIONS[kind], reason: 'ai-plan', activity: forced.activity, intention: forced.intention, startedTick: tick, paid: false };
  }

  const sleepingHours = inTimeWindow(minute, profile.sleepMinute, profile.wakeMinute);
  const workingHours = inTimeWindow(minute, profile.workStartMinute, profile.workEndMinute);
  add('sleep', sleepingHours ? 210 : needs.energy < 25 ? 300 - needs.energy : (100 - needs.energy) * 0.6, needs.energy < 25 ? 'energy' : 'sleep-time', profile.homeLocationId);
  if (needs.hunger < 65) add('eat', (100 - needs.hunger) * 1.15 + (needs.hunger < 25 ? 180 : 0), 'hunger');
  if (needs.hygiene < 55) add('wash', (100 - needs.hygiene) * 0.9 + (needs.hygiene < 25 ? 130 : 0), 'hygiene');
  if (workingHours && profile.workLocationId) add('work', 65 + traits.conscientiousness * 0.6 + (life.money < 30 ? 35 : 0), 'work-time', profile.workLocationId);
  if (tick - life.lastSocialTick >= 30) add('social', (100 - needs.social) * (0.5 + traits.extraversion / 100), 'social');
  add('relax', (100 - needs.fun) * 0.8 + (100 - needs.energy) * 0.25, 'fun');
  add('learn', 18 + traits.openness * 0.35, 'curiosity');
  add('explore', 16 + traits.openness * 0.25, 'curiosity');
  add('personal', 22 + traits.openness * 0.2, 'personal-goal', '', chooseProfileActivity(resident, tick));
  if (scheduled && !scheduled.autonomous) {
    const destination = locations.find((location) => location.name === scheduled.location);
    add('personal', 120 + traits.conscientiousness * 0.3, 'schedule', destination?.id || '', scheduled.activity, scheduled.intention);
  }
  choices.sort((a, b) => b.score - a.score || a.kind.localeCompare(b.kind));
  return choices[0] || localAction('relax', locations, resident, 'no-venue');
}

function localAction(kind, locations, resident, reason) {
  return { kind, reason, locationId: locations.find((location) => location.name === resident.currentLocation)?.id || '', remainingMinutes: DURATIONS[kind], paid: false };
}

function mustInterrupt(life, tick, profile) {
  const kind = life.action.kind;
  if (life.needs.energy < 12 && kind !== 'sleep') return true;
  if (life.needs.hunger < 12 && kind !== 'eat') return true;
  if (kind === 'sleep' && !inTimeWindow(tick % 1440, profile.sleepMinute, profile.wakeMinute) && life.needs.energy >= 75) return true;
  return kind === 'work' && !inTimeWindow(tick % 1440, profile.workStartMinute, profile.workEndMinute);
}

function decayNeeds(life, profile, minutes) {
  for (const need of TOWN_NEEDS) {
    let rate = DECAY[need];
    if (life.action.kind === 'sleep' && ['hunger', 'hygiene'].includes(need)) rate *= 0.5;
    if (need === 'social') rate *= 0.5 + profile.personality.extraversion / 100;
    if (need === 'fun') rate *= 0.5 + profile.personality.sensitivity / 100;
    life.needs[need] = bounded(life.needs[need] - rate * minutes / 60, 0, 100);
  }
}

function applyActivity(life, profile, action, minutes, tick, location) {
  const hours = minutes / 60;
  const gain = (key, rate) => { life.needs[key] = bounded(life.needs[key] + rate * hours, 0, 100); };
  if (action.kind === 'sleep') {
    gain('energy', location?.services.includes('sleep') ? 20 : 12);
    gain('fun', 2);
  } else if (action.kind === 'eat' && location?.services.includes('eat')) {
    const cost = mealCost(location, profile);
    if (!action.paid && life.money >= cost) { life.money -= cost; life.spent += cost; action.paid = true; }
    if (action.paid) gain('hunger', 120);
    else action.remainingMinutes = 0;
  } else if (action.kind === 'wash' && location?.services.includes('wash')) {
    gain('hygiene', 165);
  } else if (action.kind === 'work' && location?.id === profile.workLocationId && location.services.includes('work') && inTimeWindow(tick % 1440, profile.workStartMinute, profile.workEndMinute)) {
    const workHours = minutesInShift(tick, minutes, profile) / 60;
    const accrued = profile.hourlyWage * workHours + life.workAccrual;
    const earned = Math.floor((accrued + 1e-9) * 100) / 100;
    life.workAccrual = Math.max(0, accrued - earned);
    life.money = bounded(life.money + earned, 0, 1000000);
    life.earned = bounded(life.earned + earned, 0, 1000000);
    life.skills.work = bounded(life.skills.work + 1.5 * workHours, 0, 100);
    life.needs.energy = bounded(life.needs.energy - 3 * workHours, 0, 100);
  } else if (action.kind === 'relax') {
    gain('fun', 35);
    gain('energy', 9);
  } else if (action.kind === 'learn' && location?.services.includes('learn')) {
    gain('fun', 12 + profile.personality.openness / 8);
    life.skills.learning = bounded(life.skills.learning + 2 * hours, 0, 100);
  } else if (action.kind === 'explore') {
    gain('fun', 15 + profile.personality.openness / 10);
  } else if (action.kind === 'care' && location?.services.includes('care')) {
    gain('energy', 12);
    gain('hygiene', 20);
  } else if (action.kind === 'personal') {
    gain('fun', 6);
  }
  life.money = Math.round(life.money * 100) / 100;
  life.earned = Math.round(life.earned * 100) / 100;
  life.spent = Math.round(life.spent * 100) / 100;
}

function minutesInShift(tick, duration, profile) {
  let total = 0;
  const end = tick + duration;
  for (let time = tick; time < end;) {
    const next = Math.min(end, Math.floor(time) + 1);
    if (inTimeWindow(time % 1440, profile.workStartMinute, profile.workEndMinute)) total += next - time;
    time = next;
  }
  return total;
}

function socialize(residents, tick, interactions) {
  const matched = new Set();
  for (const resident of residents) {
    if (matched.has(resident.id) || !socialAvailable(resident, tick) || resident.state.life.action.kind !== 'social' || !resident.currentLocation) continue;
    const peers = residents.filter((peer) => peer.id !== resident.id && !matched.has(peer.id) && peer.currentLocation === resident.currentLocation && socialAvailable(peer, tick));
    const peer = peers.sort((a, b) => relationshipScore(resident, b) - relationshipScore(resident, a) || a.id.localeCompare(b.id))[0];
    if (!peer) continue;
    matched.add(resident.id);
    matched.add(peer.id);
    const compatibility = (resident.simulation.personality.agreeableness + peer.simulation.personality.agreeableness) / 2;
    const irritated = Math.min(resident.state.life.needs.energy, peer.state.life.needs.energy, resident.state.life.needs.hunger, peer.state.life.needs.hunger) < 25;
    const change = compatibility < 30 && irritated ? -3 : 2 + (sharedInterests(resident, peer) ? 2 : 0);
    for (const [speaker, listener] of [[resident, peer], [peer, resident]]) {
      const life = speaker.state.life;
      const previous = life.relationships[listener.id] || {};
      life.relationships[listener.id] = {
        affinity: bounded((Number(previous.affinity) || 0) + change, -100, 100),
        familiarity: bounded((Number(previous.familiarity) || 0) + 3, 0, 100),
        trust: bounded((Number(previous.trust) || 0) + (change > 0 ? 1 : -2), -100, 100),
        lastInteractionTick: tick
      };
      life.needs.social = bounded(life.needs.social + (change > 0 ? 20 : 8), 0, 100);
      life.needs.fun = bounded(life.needs.fun + (change > 0 ? 5 : -4), 0, 100);
      life.lastSocialTick = tick;
    }
    interactions.push({ residentId: resident.id, listenerId: peer.id, location: resident.currentLocation, affinityChange: change, tick });
  }
}

function socialAvailable(resident, tick) {
  const life = resident.state.life;
  return !life.journey && !['sleep', 'wash', 'work', 'care'].includes(life.action.kind) && tick - life.lastSocialTick >= 30;
}

function relationshipScore(resident, peer) {
  return (Number(resident.state.life.relationships[peer.id]?.affinity) || 0) + (sharedInterests(resident, peer) ? 15 : 0);
}

function sharedInterests(a, b) {
  return a.simulation.interests.some((interest) => b.simulation.interests.includes(interest));
}

function venueAvailable(town, location, resident, residents, tick) {
  if (!isTownLocationAvailable(town, location, tick)) return false;
  const reserved = residents.filter((other) => other.id !== resident.id && (
    other.currentLocation === location.name && !other.state.life.journey
    || other.state.life.journey?.locationId === location.id
  )).length;
  return reserved < location.capacity;
}

function mealCost(location, profile) {
  return location.id === profile.homeLocationId ? 2 : 8;
}

function inTimeWindow(minute, start, end) {
  if (start === end) return false;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

function chooseProfileActivity(resident, tick) {
  const activities = Array.isArray(resident.profile?.activities) ? resident.profile.activities : [];
  return activities[Math.floor(tick / 90) % Math.max(1, activities.length)] || '';
}
