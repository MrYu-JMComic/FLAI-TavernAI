import { newId, nowIso } from '../security.js';
import { parseJson } from '../utils/json.js';
import { createConversationTransaction } from './economy.js';
import { listQuests, updateQuestObjective } from './quests.js';
import { recordWorldEvent } from './worldEvents.js';
import { withSavepoint } from './savepoint.js';

export function listRewardGrants(database, userId, conversationId, options = {}) {
  if (!hasAccess(database, userId, conversationId)) return null;
  const status = ['pending', 'claimed'].includes(options.status) ? options.status : '';
  const rows = status
    ? database.prepare('SELECT * FROM reward_grants WHERE conversation_id = ? AND status = ? ORDER BY created_at DESC, rowid DESC').all(conversationId, status)
    : database.prepare('SELECT * FROM reward_grants WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC').all(conversationId);
  return rows.map(toGrant);
}

export function proposeRewardGrant(database, userId, conversationId, payload = {}) {
  const conversation = getConversation(database, userId, conversationId);
  if (!conversation) return { ok: false, error: '对话不存在' };
  const sourceType = payload.sourceType === 'quest' ? 'quest' : '';
  if (payload.rewards?.items?.length) return { ok: false, error: '物品奖励已停用' };
  const sourceId = text(payload.sourceId, 160);
  if (!sourceType || !sourceId) return { ok: false, error: '奖励必须绑定已完成任务' };
  const source = validateSource(database, conversationId, sourceType, sourceId);
  if (!source.ok) return source;
  const existing = database.prepare('SELECT * FROM reward_grants WHERE conversation_id = ? AND source_type = ? AND source_id = ?').get(conversationId, sourceType, sourceId);
  if (existing) return { ok: true, grant: toGrant(existing), duplicate: true };
  const rewards = normalizeRewards(payload.rewards);
  if (!rewards.currency.length && !rewards.questProgress.length && rewards.growthPoints === 0) return { ok: false, error: '奖励内容为空' };
  const id = newId();
  const timestamp = nowIso();
  database.prepare(`INSERT INTO reward_grants (id, conversation_id, character_id, source_type, source_id, title, rewards_json, status, claimed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`)
    .run(id, conversationId, conversation.character_id, sourceType, sourceId, text(payload.title, 200) || source.title, JSON.stringify(rewards), timestamp, timestamp);
  const grant = readGrant(database, id);
  recordWorldEvent(database, userId, conversationId, { eventType: 'reward.proposed', source: payload.source || 'system', title: `奖励待领取：${grant.title}`, entityType: 'reward_grant', entityId: id });
  return { ok: true, grant, duplicate: false };
}

export function claimRewardGrant(database, userId, conversationId, grantId, options = {}) {
  if (!hasAccess(database, userId, conversationId)) return { ok: false, error: '对话不存在' };
  const grant = readGrant(database, grantId);
  if (!grant || grant.conversationId !== conversationId) return { ok: false, error: '奖励不存在' };
  if (grant.status === 'claimed') return { ok: true, grant, duplicate: true };
  if (grant.rewards.items?.length) return { ok: false, error: '该历史奖励包含已停用的物品奖励，无法领取' };
  const source = validateSource(database, conversationId, grant.sourceType, grant.sourceId);
  if (!source.ok) return source;
  return withSavepoint(database, 'sp_claim_reward', () => {
    const claimed = database.prepare("UPDATE reward_grants SET status = 'claimed', claimed_at = ?, updated_at = ? WHERE id = ? AND conversation_id = ? AND status = 'pending'")
      .run(nowIso(), nowIso(), grantId, conversationId);
    if (claimed.changes === 0) return { ok: true, grant: readGrant(database, grantId), duplicate: true };
    const results = { currency: [], questProgress: [], growthPoints: grant.rewards.growthPoints };
    for (const reward of grant.rewards.currency) results.currency.push(createConversationTransaction(database, userId, conversationId, { amount: reward.amount, type: 'reward', currencyType: reward.currencyType, description: grant.title, source: options.source || 'reward' }));
    for (const reward of grant.rewards.questProgress) {
      const quests = listQuests(database, userId, conversationId) || [];
      const quest = quests.find(item => item.id === reward.questId);
      const objective = quest?.objectives.find(item => item.id === reward.objectiveId);
      if (!objective || quest.status !== 'active') throw new Error('奖励关联的活动任务目标不存在');
      results.questProgress.push(updateQuestObjective(database, userId, conversationId, quest.id, objective.id, { currentValue: objective.currentValue + reward.delta, source: options.source || 'reward' }));
    }
    if (grant.rewards.growthPoints) database.prepare(`INSERT INTO character_growth (character_id, growth_points, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(character_id) DO UPDATE SET growth_points = growth_points + excluded.growth_points, updated_at = excluded.updated_at`)
      .run(grant.characterId, grant.rewards.growthPoints, nowIso());
    const updated = readGrant(database, grantId);
    recordWorldEvent(database, userId, conversationId, { eventType: 'reward.claimed', source: options.source || 'player', title: `奖励已领取：${grant.title}`, entityType: 'reward_grant', entityId: grantId, severity: 'success', payload: { currencyCount: results.currency.length, growthPoints: results.growthPoints } });
    return { ok: true, grant: updated, results, duplicate: false };
  });
}

export function getCharacterGrowth(database, userId, conversationId) {
  const conversation = getConversation(database, userId, conversationId);
  if (!conversation) return null;
  const row = database.prepare('SELECT growth_points, updated_at FROM character_growth WHERE character_id = ?').get(conversation.character_id);
  return { growthPoints: row?.growth_points || 0, updatedAt: row?.updated_at || '' };
}

function validateSource(database, conversationId, type, id) {
  if (type !== 'quest') return { ok: false, error: '该奖励来源已停用' };
  const row = database.prepare('SELECT title, status FROM quests WHERE id = ? AND conversation_id = ?').get(id, conversationId);
  if (!row || row.status !== 'completed') return { ok: false, error: '奖励任务必须已完成' };
  return { ok: true, title: row.title };
}

function normalizeRewards(value = {}) {
  const currency = [];
  for (const item of Array.isArray(value.currency) ? value.currency.slice(0, 5) : []) { const amount = positiveInteger(item?.amount, 1000000); if (amount > 0) currency.push({ currencyType: ['gold','silver','copper','gem','credit'].includes(item?.currencyType) ? item.currencyType : 'gold', amount }); }
  const questProgress = [];
  for (const item of Array.isArray(value.questProgress) ? value.questProgress.slice(0, 12) : []) { const questId = text(item?.questId, 160); const objectiveId = text(item?.objectiveId, 160); const delta = positiveInteger(item?.delta, 1000000); if (questId && objectiveId && delta) questProgress.push({ questId, objectiveId, delta }); }
  return { currency, questProgress, growthPoints: nonNegativeInteger(value.growthPoints, 1000000) };
}

function readGrant(database, id) { const row = database.prepare('SELECT * FROM reward_grants WHERE id = ?').get(id); return row ? toGrant(row) : null; }
function toGrant(row) { return { id: row.id, conversationId: row.conversation_id, characterId: row.character_id, sourceType: row.source_type, sourceId: row.source_id, title: row.title, rewards: parseJson(row.rewards_json, {}), status: row.status, claimedAt: row.claimed_at || '', createdAt: row.created_at, updatedAt: row.updated_at }; }
function getConversation(database, userId, conversationId) { return database.prepare('SELECT id, character_id FROM conversations WHERE id = ? AND user_id = ?').get(conversationId, userId) || null; }
function hasAccess(database, userId, conversationId) { return Boolean(getConversation(database, userId, conversationId)); }
function text(value, max) { return String(value || '').trim().slice(0, max); }
function positiveInteger(value, max) { const number = Number(value); return Number.isFinite(number) && number > 0 ? Math.min(max, Math.round(number)) : 0; }
function nonNegativeInteger(value, max) { const number = Number(value); return Number.isFinite(number) && number >= 0 ? Math.min(max, Math.round(number)) : 0; }
