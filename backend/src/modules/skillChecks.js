import crypto from 'node:crypto';
import { newId, nowIso } from '../security.js';
import { clampInteger } from '../utils/number.js';
import { recordWorldEvent } from './worldEvents.js';

export function performSkillCheck(database, userId, conversationId, payload = {}, options = {}) {
  if (!hasConversationAccess(database, userId, conversationId)) return null;
  const skill = normalizeText(payload.skill, 100);
  if (!skill) return null;
  const difficulty = clampInteger(payload.difficulty, 2, 40, 10);
  const modifier = clampInteger(payload.modifier, -20, 20, 0);
  const roll = options.roll === undefined ? crypto.randomInt(1, 21) : clampInteger(options.roll, 1, 20, 10);
  const total = roll + modifier;
  const outcome = roll === 20 ? 'critical_success' : roll === 1 ? 'critical_failure' : total >= difficulty ? 'success' : 'failure';
  const id = newId();
  const timestamp = nowIso();
  database.prepare(
    `INSERT INTO skill_checks (id, conversation_id, actor_name, skill, difficulty, modifier, roll, total, outcome, context, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, conversationId, normalizeText(payload.actorName, 120), skill, difficulty, modifier, roll, total, outcome, normalizeText(payload.context, 2000), timestamp);
  const check = toSkillCheck(database.prepare('SELECT * FROM skill_checks WHERE id = ?').get(id));
  recordWorldEvent(database, userId, conversationId, {
    eventType: `skill_check.${outcome}`, source: payload.source || 'player',
    title: `${skill}检定：${outcomeLabel(outcome)}（${total} / ${difficulty}）`, detail: check.context,
    entityType: 'skill_check', entityId: check.id,
    severity: outcome.includes('success') ? 'success' : outcome === 'critical_failure' ? 'danger' : 'warning',
    payload: { skill, difficulty, modifier, roll, total, outcome }
  });
  return check;
}

export function listSkillChecks(database, userId, conversationId, options = {}) {
  if (!hasConversationAccess(database, userId, conversationId)) return null;
  const limit = clampInteger(options.limit, 1, 100, 30);
  return database.prepare('SELECT * FROM skill_checks WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?').all(conversationId, limit).map(toSkillCheck);
}

function hasConversationAccess(database, userId, conversationId) { return Boolean(database.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').get(conversationId, userId)); }
function normalizeText(value, maxLength) { return String(value || '').trim().slice(0, maxLength); }
function outcomeLabel(value) { return ({ critical_success: '大成功', success: '成功', failure: '失败', critical_failure: '大失败' })[value] || value; }
function toSkillCheck(row) { return { id: row.id, conversationId: row.conversation_id, actorName: row.actor_name, skill: row.skill, difficulty: row.difficulty, modifier: row.modifier, roll: row.roll, total: row.total, outcome: row.outcome, context: row.context, createdAt: row.created_at }; }
