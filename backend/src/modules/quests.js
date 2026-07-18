import { newId, nowIso } from '../security.js';
import { clampInteger } from '../utils/number.js';
import { withSavepoint } from './savepoint.js';
import { recordWorldEvent } from './worldEvents.js';

const QUEST_STATUSES = new Set(['active', 'completed', 'failed', 'archived']);
const OBJECTIVE_STATUSES = new Set(['pending', 'completed', 'failed']);

export function listQuests(database, userId, conversationId, options = {}) {
  if (!hasConversationAccess(database, userId, conversationId)) return null;
  const status = normalizeQuestStatus(options.status, '');
  const rows = status
    ? database.prepare('SELECT * FROM quests WHERE conversation_id = ? AND status = ? ORDER BY priority DESC, updated_at DESC, rowid DESC').all(conversationId, status)
    : database.prepare('SELECT * FROM quests WHERE conversation_id = ? ORDER BY CASE status WHEN \'active\' THEN 0 ELSE 1 END, priority DESC, updated_at DESC, rowid DESC').all(conversationId);
  const objectives = database.prepare(
    `SELECT quest_objectives.* FROM quest_objectives
     JOIN quests ON quests.id = quest_objectives.quest_id
     WHERE quests.conversation_id = ?
     ORDER BY quest_objectives.order_index, quest_objectives.created_at, quest_objectives.rowid`
  ).all(conversationId);
  const objectivesByQuest = new Map();
  for (const row of objectives) {
    if (!objectivesByQuest.has(row.quest_id)) objectivesByQuest.set(row.quest_id, []);
    objectivesByQuest.get(row.quest_id).push(toObjective(row));
  }
  return rows.map(row => ({ ...toQuest(row), objectives: objectivesByQuest.get(row.id) || [] }));
}

export function createQuest(database, userId, conversationId, payload = {}) {
  if (!hasConversationAccess(database, userId, conversationId)) return null;
  const title = normalizeText(payload.title, 200);
  if (!title) return null;
  return withSavepoint(database, 'sp_create_quest', () => {
    const id = newId();
    const timestamp = nowIso();
    database.prepare(
      `INSERT INTO quests (id, conversation_id, title, description, status, priority, source, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, NULL)`
    ).run(id, conversationId, title, normalizeText(payload.description, 5000), clampInteger(payload.priority, -100, 100, 0), normalizeText(payload.source, 40) || 'manual', timestamp, timestamp);
    const objectives = Array.isArray(payload.objectives) ? payload.objectives.slice(0, 30) : [];
    for (let index = 0; index < objectives.length; index += 1) {
      createObjectiveInternal(database, id, objectives[index], index);
    }
    const quest = getQuest(database, userId, conversationId, id);
    recordWorldEvent(database, userId, conversationId, {
      eventType: 'quest.created', source: payload.source || 'manual', title: `新任务：${quest.title}`,
      entityType: 'quest', entityId: quest.id, payload: { objectiveCount: quest.objectives.length }
    });
    return quest;
  });
}

export function updateQuest(database, userId, conversationId, questId, payload = {}) {
  const current = getQuest(database, userId, conversationId, questId);
  if (!current) return null;
  const title = payload.title === undefined ? current.title : normalizeText(payload.title, 200);
  if (!title) return null;
  const status = payload.status === undefined ? current.status : normalizeQuestStatus(payload.status, current.status);
  const timestamp = nowIso();
  const completedAt = status === 'completed' ? current.completedAt || timestamp : null;
  database.prepare(
    `UPDATE quests SET title = ?, description = ?, status = ?, priority = ?, source = ?, updated_at = ?, completed_at = ?
     WHERE id = ? AND conversation_id = ?`
  ).run(
    title,
    payload.description === undefined ? current.description : normalizeText(payload.description, 5000),
    status,
    payload.priority === undefined ? current.priority : clampInteger(payload.priority, -100, 100, current.priority),
    payload.source === undefined ? current.source : normalizeText(payload.source, 40) || current.source,
    timestamp, completedAt, questId, conversationId
  );
  const quest = getQuest(database, userId, conversationId, questId);
  recordWorldEvent(database, userId, conversationId, {
    eventType: status !== current.status ? `quest.${status}` : 'quest.updated',
    source: payload.source || 'manual', title: status === 'completed' ? `任务完成：${quest.title}` : `任务更新：${quest.title}`,
    entityType: 'quest', entityId: quest.id, severity: status === 'completed' ? 'success' : status === 'failed' ? 'danger' : 'info'
  });
  return quest;
}

export function deleteQuest(database, userId, conversationId, questId) {
  const current = getQuest(database, userId, conversationId, questId);
  if (!current) return false;
  const deleted = database.prepare('DELETE FROM quests WHERE id = ? AND conversation_id = ?').run(questId, conversationId).changes > 0;
  if (deleted) recordWorldEvent(database, userId, conversationId, {
    eventType: 'quest.deleted', source: 'manual', title: `任务移除：${current.title}`,
    entityType: 'quest', entityId: current.id, severity: 'warning'
  });
  return deleted;
}

export function addQuestObjective(database, userId, conversationId, questId, payload = {}) {
  const quest = getQuest(database, userId, conversationId, questId);
  if (!quest) return null;
  const objective = createObjectiveInternal(database, questId, payload, quest.objectives.length);
  if (!objective) return null;
  touchQuest(database, questId);
  recordWorldEvent(database, userId, conversationId, {
    eventType: 'quest.objective.created', source: payload.source || 'manual', title: `新增目标：${objective.description}`,
    entityType: 'quest_objective', entityId: objective.id, payload: { questId }
  });
  return objective;
}

export function updateQuestObjective(database, userId, conversationId, questId, objectiveId, payload = {}) {
  const quest = getQuest(database, userId, conversationId, questId);
  if (!quest) return null;
  const current = quest.objectives.find(item => item.id === objectiveId);
  if (!current) return null;
  const targetValue = payload.targetValue === undefined ? current.targetValue : clampInteger(payload.targetValue, 1, 1000000, current.targetValue);
  const currentValue = payload.currentValue === undefined ? current.currentValue : clampInteger(payload.currentValue, 0, targetValue, current.currentValue);
  let status = payload.status === undefined ? current.status : normalizeObjectiveStatus(payload.status, current.status);
  if (currentValue >= targetValue && status === 'pending') status = 'completed';
  const description = payload.description === undefined ? current.description : normalizeText(payload.description, 1000);
  if (!description) return null;
  database.prepare(
    `UPDATE quest_objectives SET description = ?, status = ?, current_value = ?, target_value = ?, order_index = ?, updated_at = ?
     WHERE id = ? AND quest_id = ?`
  ).run(description, status, currentValue, targetValue, payload.orderIndex === undefined ? current.orderIndex : clampInteger(payload.orderIndex, 0, 10000, current.orderIndex), nowIso(), objectiveId, questId);
  touchQuest(database, questId);
  const updated = getQuest(database, userId, conversationId, questId).objectives.find(item => item.id === objectiveId);
  recordWorldEvent(database, userId, conversationId, {
    eventType: status === 'completed' && current.status !== 'completed' ? 'quest.objective.completed' : 'quest.objective.updated',
    source: payload.source || 'manual', title: status === 'completed' ? `目标完成：${updated.description}` : `目标推进：${updated.description}`,
    entityType: 'quest_objective', entityId: updated.id, severity: status === 'completed' ? 'success' : 'info',
    payload: { questId, currentValue: updated.currentValue, targetValue: updated.targetValue }
  });
  maybeCompleteQuest(database, userId, conversationId, questId, payload.source);
  return updated;
}

function getQuest(database, userId, conversationId, questId) {
  const quests = listQuests(database, userId, conversationId);
  return quests?.find(quest => quest.id === questId) || null;
}

function createObjectiveInternal(database, questId, payload = {}, fallbackOrder = 0) {
  const description = normalizeText(payload?.description ?? payload, 1000);
  if (!description) return null;
  const timestamp = nowIso();
  const targetValue = clampInteger(payload?.targetValue, 1, 1000000, 1);
  const currentValue = clampInteger(payload?.currentValue, 0, targetValue, 0);
  const status = currentValue >= targetValue ? 'completed' : normalizeObjectiveStatus(payload?.status, 'pending');
  const id = newId();
  database.prepare(
    `INSERT INTO quest_objectives (id, quest_id, description, status, current_value, target_value, order_index, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, questId, description, status, currentValue, targetValue, clampInteger(payload?.orderIndex, 0, 10000, fallbackOrder), timestamp, timestamp);
  return toObjective(database.prepare('SELECT * FROM quest_objectives WHERE id = ?').get(id));
}

function maybeCompleteQuest(database, userId, conversationId, questId, source = '') {
  const quest = getQuest(database, userId, conversationId, questId);
  if (!quest || quest.status !== 'active' || !quest.objectives.length) return;
  if (quest.objectives.every(item => item.status === 'completed')) updateQuest(database, userId, conversationId, questId, { status: 'completed', source: source || 'system' });
}

function touchQuest(database, questId) { database.prepare('UPDATE quests SET updated_at = ? WHERE id = ?').run(nowIso(), questId); }
function hasConversationAccess(database, userId, conversationId) { return Boolean(database.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').get(conversationId, userId)); }
function normalizeQuestStatus(value, fallback) { const status = String(value || '').trim(); return QUEST_STATUSES.has(status) ? status : fallback; }
function normalizeObjectiveStatus(value, fallback) { const status = String(value || '').trim(); return OBJECTIVE_STATUSES.has(status) ? status : fallback; }
function normalizeText(value, maxLength) { return String(value || '').trim().slice(0, maxLength); }
function toQuest(row) { return { id: row.id, conversationId: row.conversation_id, title: row.title, description: row.description, status: row.status, priority: row.priority, source: row.source, createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at || '' }; }
function toObjective(row) { return { id: row.id, questId: row.quest_id, description: row.description, status: row.status, currentValue: row.current_value, targetValue: row.target_value, orderIndex: row.order_index, createdAt: row.created_at, updatedAt: row.updated_at }; }
