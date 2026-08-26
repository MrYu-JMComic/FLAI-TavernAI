import { nowIso } from '../../security.js';
import { clampInteger } from '../../utils/number.js';

const SIMULATION_STATUSES = new Set(['paused', 'running']);

export function updateTownClockRecord(database, userId, town, payload = {}) {
  const currentDay = clampInteger(payload.currentDay, 1, 1_000_000, town.currentDay);
  const minuteOfDay = clampInteger(payload.minuteOfDay, 0, 1439, town.minuteOfDay);
  const simulationStatus = payload.simulationStatus == null
    ? town.simulationStatus
    : normalizeTownSimulationStatus(payload.simulationStatus);
  const timestamp = nowIso();
  database.prepare(
    `UPDATE town_worlds
     SET current_day = ?, minute_of_day = ?, simulation_status = ?, engine_checkpoint_at = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`
  ).run(currentDay, minuteOfDay, simulationStatus, timestamp, timestamp, town.id, userId);
}

export function calculateTownTick(town) {
  return ((town.currentDay - 1) * 1440) + town.minuteOfDay;
}

export function normalizeTownSimulationStatus(value) {
  const normalized = String(value || '').trim();
  return SIMULATION_STATUSES.has(normalized) ? normalized : 'paused';
}
