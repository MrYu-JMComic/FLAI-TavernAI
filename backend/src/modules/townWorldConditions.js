import { activeTownConditions, TOWN_CONDITIONS } from '../../../shared/townLife.js';
import { clampInteger } from '../utils/number.js';

export function eligibleTownIntervention(town, event) {
  const tick = (town.currentDay - 1) * 1440 + town.minuteOfDay;
  return event && event.occurredTick <= tick ? event : null;
}

export function townWithIntervention(town, intervention) {
  if (!intervention || !TOWN_CONDITIONS.includes(intervention.payload?.effect)) return town;
  const locationId = intervention.payload.locationId || '';
  if (locationId && !(town.mapConfig?.locations || []).some((location) => location.id === locationId)) return town;
  if (intervention.payload.effect === 'closure' && !locationId) return town;
  const tick = (town.currentDay - 1) * 1440 + town.minuteOfDay;
  const conditions = activeTownConditions(town).filter((condition) => condition.sourceEventId !== intervention.id).slice(-7);
  conditions.push({ kind: intervention.payload.effect, locationId, sourceEventId: intervention.id, startsAt: tick, endsAt: tick + clampInteger(intervention.payload.durationMinutes, 30, 720, 180) });
  return { ...town, settings: { ...town.settings, conditions } };
}
