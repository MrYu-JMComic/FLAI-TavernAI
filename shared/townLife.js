import { isTownVenueOpen, townVenue } from './townAssets.js';

export const TOWN_NEEDS = Object.freeze(['energy', 'hunger', 'hygiene', 'social', 'fun']);
export const TOWN_TRAITS = Object.freeze(['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'sensitivity']);
export const TOWN_ACTIONS = Object.freeze(['sleep', 'eat', 'wash', 'work', 'social', 'relax', 'explore', 'learn', 'care', 'personal']);
export const TOWN_CONDITIONS = Object.freeze(['rain', 'festival', 'closure']);

export function activeTownConditions(town, tick = (town.currentDay - 1) * 1440 + town.minuteOfDay) {
  const conditions = Array.isArray(town.settings?.conditions) ? town.settings.conditions : [];
  return conditions.filter((condition) => condition && TOWN_CONDITIONS.includes(condition.kind) && condition.startsAt <= tick && condition.endsAt > tick);
}

export function isTownLocationAvailable(town, location, tick) {
  return isTownVenueOpen(location, tick) && !activeTownConditions(town, tick).some((condition) => condition.kind === 'closure' && condition.locationId === location.id);
}

export function normalizeTownLifeProfile(profile = {}, locations = [], currentLocation = '') {
  const source = objectValue(profile.simulation);
  const personality = Object.fromEntries(TOWN_TRAITS.map((key) => [key, bounded(source.personality?.[key], 0, 100, 50)]));
  const home = locations.find((location) => location.id === source.homeLocationId)
    || locations.find((location) => location.name === currentLocation && townVenue(location).services.includes('sleep'))
    || locations.find((location) => townVenue(location).services.includes('sleep'));
  const workplace = Object.hasOwn(source, 'workLocationId')
    ? locations.find((location) => location.id === source.workLocationId)
    : locations.find((location) => location.name === currentLocation && townVenue(location).services.includes('work'))
      || locations.find((location) => townVenue(location).services.includes('work'));
  return {
    personality,
    homeLocationId: home?.id || '',
    workLocationId: workplace?.id || '',
    wakeMinute: bounded(source.wakeMinute, 0, 1439, 420),
    sleepMinute: bounded(source.sleepMinute, 0, 1439, 1380),
    workStartMinute: bounded(source.workStartMinute, 0, 1439, 540),
    workEndMinute: bounded(source.workEndMinute, 0, 1439, 1020),
    hourlyWage: bounded(source.hourlyWage, 0, 100, 12),
    startingMoney: bounded(source.startingMoney, 0, 100000, 120),
    interests: Array.isArray(source.interests) ? source.interests.filter((value) => typeof value === 'string').slice(0, 6).map((value) => value.slice(0, 60)) : []
  };
}

export function normalizeTownLifeState(state = {}, profile = {}) {
  const source = objectValue(state.life);
  const needs = Object.fromEntries(TOWN_NEEDS.map((key) => [key, bounded(source.needs?.[key], 0, 100, key === 'energy' ? 80 : 70)]));
  return {
    version: 1,
    needs,
    money: bounded(source.money, 0, 1000000, profile.startingMoney ?? 120),
    earned: bounded(source.earned, 0, 1000000, 0),
    workAccrual: bounded(source.workAccrual, 0, 0.01, 0),
    spent: bounded(source.spent, 0, 1000000, 0),
    skills: { work: bounded(source.skills?.work, 0, 100, 0), learning: bounded(source.skills?.learning, 0, 100, 0) },
    relationships: objectValue(source.relationships),
    action: objectValue(source.action),
    journey: source.journey && typeof source.journey === 'object' ? source.journey : null,
    decision: objectValue(source.decision),
    routineSchedule: objectValue(source.routineSchedule),
    lastTick: Number.isFinite(source.lastTick) ? source.lastTick : null,
    lastSocialTick: Number.isFinite(source.lastSocialTick) ? source.lastSocialTick : -10000
  };
}

export function townNeedMood(needs) {
  if (needs.energy < 20) return 'exhausted';
  if (needs.hunger < 25) return 'hungry';
  if (needs.hygiene < 25) return 'uncomfortable';
  if (needs.social < 25) return 'lonely';
  if (needs.fun < 25) return 'tense';
  return TOWN_NEEDS.every((key) => needs[key] >= 55) ? 'content' : 'steady';
}

export function bounded(value, minimum, maximum, fallback = minimum) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
