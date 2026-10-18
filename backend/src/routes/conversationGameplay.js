import { Router } from 'express';
import { getCharacter } from '../modules/characters.js';
import { getGameplayDashboard } from '../modules/gameplayDashboard.js';
import { listWorldEvents } from '../modules/worldEvents.js';
import { addQuestObjective, createQuest, deleteQuest, listQuests, updateQuest, updateQuestObjective } from '../modules/quests.js';
import { listSkillChecks, performSkillCheck } from '../modules/skillChecks.js';
import {
  advanceWorldTime,
  getWorldClock,
  listWorldAdvances,
  setWorldWeather,
} from '../modules/dynamicWorld.js';
import { getConversationForUser } from './helpers.js';
import { discoverTravelNode, getTravelMap, travelToNode } from '../modules/travel.js';
import { normalizeAdvancedSettings, isAccessorySkillActive } from '../modules/advancedSettings.js';
import { claimRewardGrant, listRewardGrants, proposeRewardGrant } from '../modules/rewards.js';

export function createConversationGameplayRouter(ctx) {
  const { db, requireAuth } = ctx;
  const router = Router({ mergeParams: true });

  router.get('/dashboard', requireAuth, (request, response) => {
    const conversation = getConversationForUser(db, request.auth.user.id, request.params.id);
    if (!conversation) return response.status(404).json({ error: '对话不存在' });
    const character = getCharacter(db, request.auth.user.id, conversation.characterId);
    response.json(getGameplayDashboard(db, request.auth.user.id, request.params.id, {
      mainCharacterName: character?.name || '',
      rewardEnabled: featureEnabled(conversation, 'rewardMode')
    }));
  });

  router.get('/events', requireAuth, (request, response) => {
    const result = listWorldEvents(db, request.auth.user.id, request.params.id, {
      limit: request.query.limit,
      afterCursor: request.query.afterCursor,
      eventType: request.query.eventType
    });
    if (!result) return response.status(404).json({ error: '对话不存在' });
    response.json(result);
  });

  router.get('/travel-map', requireAuth, (request, response) => {
    const map = getTravelMap(db, request.auth.user.id, request.params.id);
    if (!map) return response.status(404).json({ error: '对话不存在' });
    response.json(map);
  });

  router.post('/travel/discover', requireAuth, (request, response) => {
    const result = discoverTravelNode(db, request.auth.user.id, request.params.id, request.body?.nodeId, request.body?.source || 'player');
    if (!result.ok) return response.status(result.error === '对话不存在' ? 404 : 400).json({ error: result.error });
    response.status(result.added ? 201 : 200).json(result);
  });

  router.post('/travel', requireAuth, (request, response) => {
    const result = travelToNode(db, request.auth.user.id, request.params.id, request.body || {});
    if (!result.ok) return response.status(result.error === '对话不存在' ? 404 : 400).json({ error: result.error });
    response.json(result);
  });

  router.get('/quests', requireAuth, (request, response) => {
    const result = listQuests(db, request.auth.user.id, request.params.id, { status: request.query.status });
    if (!result) return response.status(404).json({ error: '对话不存在' });
    response.json(result);
  });

  router.post('/quests', requireAuth, (request, response) => {
    const quest = createQuest(db, request.auth.user.id, request.params.id, request.body || {});
    if (!quest) return response.status(400).json({ error: '任务标题不能为空或对话不存在' });
    response.status(201).json(quest);
  });

  router.put('/quests/:questId', requireAuth, (request, response) => {
    const quest = updateQuest(db, request.auth.user.id, request.params.id, request.params.questId, request.body || {});
    if (!quest) return response.status(404).json({ error: '任务不存在或数据无效' });
    response.json(quest);
  });

  router.delete('/quests/:questId', requireAuth, (request, response) => {
    if (!deleteQuest(db, request.auth.user.id, request.params.id, request.params.questId)) return response.status(404).json({ error: '任务不存在' });
    response.json({ ok: true });
  });

  router.post('/quests/:questId/objectives', requireAuth, (request, response) => {
    const objective = addQuestObjective(db, request.auth.user.id, request.params.id, request.params.questId, request.body || {});
    if (!objective) return response.status(400).json({ error: '任务不存在或目标描述为空' });
    response.status(201).json(objective);
  });

  router.put('/quests/:questId/objectives/:objectiveId', requireAuth, (request, response) => {
    const objective = updateQuestObjective(db, request.auth.user.id, request.params.id, request.params.questId, request.params.objectiveId, request.body || {});
    if (!objective) return response.status(404).json({ error: '任务目标不存在或数据无效' });
    response.json(objective);
  });

  router.get('/checks', requireAuth, (request, response) => {
    const checks = listSkillChecks(db, request.auth.user.id, request.params.id, { limit: request.query.limit });
    if (!checks) return response.status(404).json({ error: '对话不存在' });
    response.json(checks);
  });

  router.post('/checks', requireAuth, (request, response) => {
    const check = performSkillCheck(db, request.auth.user.id, request.params.id, request.body || {});
    if (!check) return response.status(400).json({ error: '检定技能不能为空或对话不存在' });
    response.status(201).json(check);
  });

  router.get('/clock', requireAuth, (request, response) => {
    const clock = getWorldClock(db, request.auth.user.id, request.params.id);
    if (!clock) return response.status(404).json({ error: '对话不存在' });
    response.json(clock);
  });

  router.post('/clock/advance', requireAuth, (request, response) => {
    const result = advanceWorldTime(db, request.auth.user.id, request.params.id, request.body || {});
    if (!result) return response.status(404).json({ error: '对话不存在' });
    response.json(result);
  });

  router.put('/clock/weather', requireAuth, (request, response) => {
    const clock = setWorldWeather(db, request.auth.user.id, request.params.id, request.body?.weather, request.body?.source || 'manual');
    if (!clock) return response.status(400).json({ error: '天气不能为空或对话不存在' });
    response.json(clock);
  });

  router.get('/advances', requireAuth, (request, response) => {
    const advances = listWorldAdvances(db, request.auth.user.id, request.params.id, request.query.limit);
    if (!advances) return response.status(404).json({ error: '对话不存在' });
    response.json(advances);
  });

  router.get('/rewards', requireAuth, (request, response) => {
    const conversation = getConversationForUser(db, request.auth.user.id, request.params.id);
    if (!conversation) return response.status(404).json({ error: '对话不存在' });
    if (!featureEnabled(conversation, 'rewardMode')) return response.json([]);
    response.json(listRewardGrants(db, request.auth.user.id, request.params.id, { status: request.query.status }));
  });

  router.post('/rewards', requireAuth, (request, response) => {
    const conversation = getConversationForUser(db, request.auth.user.id, request.params.id);
    if (!conversation) return response.status(404).json({ error: '对话不存在' });
    if (!featureEnabled(conversation, 'rewardMode')) return response.status(403).json({ error: '奖励功能已关闭' });
    const result = proposeRewardGrant(db, request.auth.user.id, request.params.id, { ...request.body, source: 'player' });
    if (!result.ok) return response.status(400).json({ error: result.error });
    response.status(result.duplicate ? 200 : 201).json(result.grant);
  });

  router.post('/rewards/:grantId/claim', requireAuth, (request, response) => {
    const conversation = getConversationForUser(db, request.auth.user.id, request.params.id);
    if (!conversation) return response.status(404).json({ error: '对话不存在' });
    if (!featureEnabled(conversation, 'rewardMode')) return response.status(403).json({ error: '奖励功能已关闭' });
    const result = claimRewardGrant(db, request.auth.user.id, request.params.id, request.params.grantId, { source: 'player' });
    if (!result.ok) return response.status(400).json({ error: result.error });
    response.json(result);
  });

  return router;
}

function featureEnabled(conversation, key) {
  const settings = normalizeAdvancedSettings(conversation?.settings || {});
  return isAccessorySkillActive(settings.accessorySkills, key);
}
