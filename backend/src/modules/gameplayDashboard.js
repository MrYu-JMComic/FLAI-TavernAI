import { getConversationEconomyState } from './economy.js';
import { listSceneWorkspace } from './scenes.js';
import { getStatusBar } from './statusBars.js';
import { listWorldEvents } from './worldEvents.js';
import { listQuests } from './quests.js';
import { getWorldClock } from './dynamicWorld.js';
import { getTravelMap } from './travel.js';
import { getCharacterGrowth, listRewardGrants } from './rewards.js';
import { getActiveEncounter } from './encounters.js';
import {
  getCastActivities,
  getCastItems,
  getCastRoster,
} from '../services/cast/castQueryService.js';

export function getGameplayDashboard(database, userId, conversationId, options = {}) {
  const workspace = listSceneWorkspace(database, userId, conversationId);
  const economy = getConversationEconomyState(database, userId, conversationId, { ensureDefaultAccount: false });
  const statusBar = getStatusBar(database, userId, conversationId);
  const eventPage = listWorldEvents(database, userId, conversationId, { limit: 3 });
  const quests = listQuests(database, userId, conversationId, { status: 'active' }) || [];
  const roster = getCastRoster(database, userId, conversationId, { includeHidden: false });
  const backpackItems = roster.protagonist
    ? getCastItems(database, userId, conversationId, roster.protagonist.id, { limit: 200 })
    : [];
  const worldClock = getWorldClock(database, userId, conversationId);
  const travelMap = getTravelMap(database, userId, conversationId);
  const location = travelMap?.currentNode || selectRecentLocation(workspace.nodes);
  const presentNpcs = selectPresentNpcs(roster.npcs, location?.name || '');
  const activities = getCastActivities(database, userId, conversationId)
    .filter((activity) => ['scheduled', 'active'].includes(activity.status));

  return {
    location,
    presentNpcs: presentNpcs.map(toNpcSummary),
    counts: {
      locations: workspace.nodes.length,
      items: workspace.items.length,
      npcs: roster.npcs.length,
      routes: workspace.routes.length
    },
    wallet: Array.isArray(economy?.accounts)
      ? economy.accounts.map(account => ({ currencyType: account.currencyType, balance: account.balance }))
      : [],
    time: worldClock ? `第 ${worldClock.currentDay} 天 ${worldClock.timeLabel}` : findStatusValue(statusBar, ['时间', '时刻', 'time']) || '',
    weather: worldClock?.weather || findStatusValue(statusBar, ['天气', 'weather']) || '',
    worldClock,
    npcActivities: activities.map((activity) => ({
      ...activity,
      npcName: activity.memberName,
    })),
    travelMap,
    encounter: options.encounterEnabled
      ? getActiveEncounter(database, userId, conversationId)
      : null,
    rewards: options.rewardEnabled ? (listRewardGrants(database, userId, conversationId, { status: 'pending' }) || []).slice(0, 4) : [],
    growth: options.rewardEnabled ? getCharacterGrowth(database, userId, conversationId) : null,
    coreStatus: selectCoreStatus(statusBar),
    worldEvents: eventPage?.events?.length ? eventPage.events : buildWorldEvents(location, statusBar, presentNpcs),
    eventCursor: eventPage?.latestCursor || 0,
    activeQuest: quests[0] || null,
    backpack: summarizeBackpack(backpackItems),
    checkActions: buildCheckActions(location),
    quickActions: buildQuickActions(location, presentNpcs)
  };
}

function summarizeBackpack(items) {
  let totalQuantity = 0;
  for (const item of items) totalQuantity += Number(item?.quantity || 0);
  return { totalKinds: items.length, totalQuantity, items: items.slice(0, 4).map(item => ({ id: item.id, name: item.name, quantity: item.quantity, iconKey: item.iconKey || 'item.bag' })) };
}

function buildCheckActions(location) {
  return [
    { key: 'awareness', label: '观察检定', iconKey: 'item.key', skill: '观察', difficulty: 10, modifier: 0, context: location?.name ? `调查${location.name}中的异常与线索` : '调查当前场景中的异常与线索' }
  ];
}

function findStatusValue(statusBar, names) {
  const candidates = new Set(names.map(normalizeStatusName));
  const variables = Array.isArray(statusBar?.variables) ? statusBar.variables : [];
  const variable = variables.find(item => candidates.has(normalizeStatusName(item?.name)));
  return variable?.value === undefined || variable?.value === null ? '' : String(variable.value);
}

function selectCoreStatus(statusBar) {
  const variables = Array.isArray(statusBar?.variables) ? statusBar.variables : [];
  const excluded = new Set(['时间', '时刻', 'time', '天气', 'weather'].map(normalizeStatusName));
  return variables
    .filter(item => item?.name && !excluded.has(normalizeStatusName(item.name)))
    .slice(0, 4)
    .map(item => ({ name: item.name, value: item.value, max: item.max, color: item.color || '' }));
}

function buildWorldEvents(location, statusBar, presentNpcs) {
  const events = [];
  if (location?.name) events.push({ type: 'location', label: `场景聚焦：${location.name}`, at: location.updatedAt || '' });
  if (statusBar?.updatedAt) events.push({ type: 'status', label: '角色状态已同步', at: statusBar.updatedAt });
  for (const npc of presentNpcs.slice(0, 2)) {
    const detail = npc.relationship || npc.customStatus || npc.status;
    events.push({ type: 'npc', label: `${npc.name}${detail ? ` · ${detail}` : ''}`, at: npc.updatedAt || '' });
  }
  return events.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 3);
}

function normalizeStatusName(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_\-:：]/g, '');
}

function selectRecentLocation(nodes = []) {
  const candidates = nodes
    .filter(node => ['room', 'area', 'building', 'main_scene', 'map'].includes(node?.nodeType))
    .slice()
    .sort((a, b) => String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || '')));
  const node = candidates[0];
  return node ? { id: node.id, name: node.name, nodeType: node.nodeType, updatedAt: node.updatedAt } : null;
}

function selectPresentNpcs(npcs, locationName = '') {
  const normalizedLocation = String(locationName || '').trim();
  const matches = normalizedLocation
    ? npcs.filter(npc => String(npc?.currentLocationLabel || '').trim() === normalizedLocation)
    : [];
  return (matches.length ? matches : npcs).slice(0, 3);
}

function toNpcSummary(npc) {
  return {
    id: npc.id,
    memberId: npc.id,
    name: npc.canonicalName,
    status: npc.status,
    currentLocation: npc.currentLocationLabel || '',
    relationship: npc.relationship || ''
  };
}

function buildQuickActions(location, presentNpcs) {
  return [
    { key: 'observe', label: '观察', iconKey: 'map.district', prompt: `观察${location?.name ? `当前的${location.name}` : '周围环境'}，留意重要人物、出口、物品和异常迹象。` },
    { key: 'talk', label: '交谈', iconKey: 'item.book', prompt: presentNpcs[0]?.name ? `主动与${presentNpcs[0].name}交谈，了解对方现在的想法和这里发生的事情。` : '寻找一个可以交谈的人，并主动了解这里发生的事情。' },
    { key: 'investigate', label: '调查', iconKey: 'item.key', prompt: '仔细调查当前场景中最值得怀疑或最可能推动故事发展的线索。' },
    { key: 'move', label: '前往', iconKey: 'room.door', prompt: '查看从当前位置可以前往的地点，并说明每条路线可能遇到的机会或风险。' }
  ];
}
