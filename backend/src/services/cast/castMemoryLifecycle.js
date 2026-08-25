import {
  getCastMemories,
  getCastMemoryEntry,
  getCastRoster,
} from './castQueryService.js';
import { updateCastMemoryEntry } from './castCommandService.js';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;

export function decayCastMemories(database, userId, conversationId, options = {}) {
  const now = normalizeNow(options.now);
  const threshold = clampUnit(options.forgetThreshold, 0.05);
  const roster = getCastRoster(database, userId, conversationId, { includeHidden: true });
  const members = [roster.protagonist, ...roster.npcs].filter(Boolean);
  const result = { scanned: 0, updated: 0, forgotten: 0, memberIds: [] };

  for (const member of members) {
    if (member.memorySealed) continue;
    let memberChanged = false;
    const memoryIds = listMemoryIds(database, userId, conversationId, member.id);
    for (const memoryId of memoryIds) {
      const memory = getCastMemoryEntry(database, userId, conversationId, member.id, memoryId);
      result.scanned += 1;
      const update = calculateDecayUpdate(memory, now, threshold);
      if (!update) continue;
      updateCastMemoryEntry(database, userId, conversationId, member.id, memory.id, {
        ...update,
        revision: memory.revision,
      }, {
        sourceKind: 'manual',
        actor: 'memory-decay',
      });
      result.updated += 1;
      if (update.forgottenAt && !memory.forgottenAt) result.forgotten += 1;
      memberChanged = true;
    }
    if (memberChanged) result.memberIds.push(member.id);
  }

  return result;
}

function listMemoryIds(database, userId, conversationId, memberId) {
  const ids = [];
  let offset = 0;
  while (true) {
    const page = getCastMemories(database, userId, conversationId, memberId, {
      includeForgotten: true,
      limit: 200,
      offset,
    });
    ids.push(...page.items.map((memory) => memory.id));
    offset += page.items.length;
    if (!page.items.length || offset >= page.total) return ids;
  }
}

export function calculateDecayUpdate(memory, now = new Date(), forgetThreshold = 0.05) {
  if (!memory || memory.forgottenAt || Number(memory.decayRate) <= 0) return null;
  const referenceTime = Date.parse(memory.lastReinforcedAt || memory.updatedAt || memory.createdAt || '');
  if (!Number.isFinite(referenceTime)) return null;
  const elapsedDays = Math.floor((now.getTime() - referenceTime) / MILLISECONDS_PER_DAY);
  if (elapsedDays < 1) return null;
  const currentImportance = clampUnit(memory.importance, 0.5);
  const decayRate = clampUnit(memory.decayRate, 0);
  const importance = roundUnit(currentImportance * Math.pow(1 - decayRate, elapsedDays));
  const threshold = clampUnit(forgetThreshold, 0.05);
  return {
    importance,
    layer: importance >= 0.8 ? 'core' : importance >= 0.3 ? 'long_term' : 'short_term',
    forgottenAt: importance <= threshold ? now.toISOString() : null,
  };
}

function normalizeNow(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  const parsed = new Date(value || Date.now());
  return Number.isFinite(parsed.getTime()) ? parsed : new Date();
}

function clampUnit(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(1, Math.max(0, numeric)) : fallback;
}

function roundUnit(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
