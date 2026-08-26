import { newId, nowIso } from '../../security.js';
import { recordAutomationAudit } from '../automationAudit.js';

export function buildTownSimulationSnapshot(town, residents, events) {
  return { town, residents, events };
}

export function recordTownSimulationEvent(database, userId, town, payload, dependencies) {
  const residentId = dependencies.normalizeResidentId(payload.residentId);
  const id = newId();
  database.prepare(
    `INSERT INTO town_events (
       id, town_id, resident_id, event_type, source, title, detail,
       payload_json, occurred_tick, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    town.id,
    residentId || null,
    text(payload.eventType, 80) || 'world.changed',
    text(payload.source, 40) || 'simulation',
    text(payload.title, 200),
    text(payload.detail, 4000),
    JSON.stringify(object(payload.payload)),
    dependencies.normalizeTick(payload.occurredTick, dependencies.townTick(town)),
    nowIso()
  );
  const created = dependencies.readEvent(id);
  if (isAutomatedSource(created.source)) {
    recordAutomationAudit(database, userId, {
      domain: 'town',
      operation: created.eventType,
      subjectType: created.residentId ? 'town-resident' : 'town',
      subjectId: created.residentId || town.id,
      sourceMessageId: created.payload.sourceMessageId,
      jobId: created.payload.jobId,
      providerType: created.payload.providerType,
      model: created.payload.model,
      planSummary: created.title || created.detail,
      before: created.payload.before,
      after: created.payload.after ?? created.payload,
      rollbackOfId: created.payload.rollbackOfId
    });
  }
  return created;
}

function isAutomatedSource(value) {
  const source = String(value || '').trim().toLowerCase();
  return source && source !== 'manual' && source !== 'player' && !source.startsWith('user:');
}

function text(value, max) {
  return String(value || '').trim().slice(0, max);
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
