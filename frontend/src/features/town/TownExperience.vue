<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  ArrowLeft,
  Brain,
  CalendarClock,
  ChevronRight,
  CirclePause,
  CirclePlay,
  Crosshair,
  Eye,
  Globe,
  History,
  Lightbulb,
  MapPinned,
  MessageSquareText,
  Minus,
  Plus,
  PlusCircle,
  Radio,
  Send,
  Sparkles,
  Users,
  X
} from '@lucide/vue';
import {
  advanceTownWithAi,
  createTownEvent,
  fetchTownSnapshot,
  fetchTownResidentCognition,
  fetchTowns,
  generateTown,
  planTownResidentCognitionWithAi,
  recallTownMemories,
  updateTownClock
} from '../../api.js';
import TownGeneratedMap from './TownGeneratedMap.vue';

const emit = defineEmits(['navigate']);

const FALLBACK_MAP = Object.freeze({
  width: 1600,
  height: 900,
  locations: []
});
const EMPTY_AGENT = Object.freeze({
  id: '',
  name: '尚无居民',
  role: '等待 AI 生成',
  summary: 'AI 完成世界蓝图后，居民会在这里开始各自的生活。',
  mood: '平静',
  goal: '等待世界开始',
  activities: ['观察周围'],
  dialogue: ['世界安静地等待着。'],
  memories: [],
  sprite: { column: 1, row: 2 },
  mapX: FALLBACK_MAP.width / 2,
  mapY: FALLBACK_MAP.height / 2
});
const EMPTY_COGNITION = Object.freeze({
  residentId: '',
  day: 1,
  reflectionStatus: Object.freeze({
    memoryCount: 0,
    importanceTotal: 0,
    threshold: 15,
    shouldReflect: false
  }),
  reflections: Object.freeze([]),
  schedule: null
});
const EXAMPLE_WORLD_IDEA = '我想要一个常年被海雾笼罩的贸易港。港口最近不断有人失踪，灯塔守望者怀疑海上出现了异常，但酒馆老板似乎隐瞒着与失踪商船有关的秘密。希望世界里有灯塔、码头、酒馆和几位拥有互相冲突目标的居民。';

const mapViewport = ref(null);
const towns = ref([]);
const world = ref(null);
const townId = ref('');
const agents = ref([]);
const events = ref([]);
const selectedAgentId = ref('');
const followingAgentId = ref('');
const detailTab = ref('timeline');
const memoriesByResident = ref({});
const cognitionByResident = ref({});
const day = ref(1);
const minute = ref(480);
const isRunning = ref(false);
const zoom = ref(1);
const mapDisplay = ref({ width: 0, height: 0 });
const isLoading = ref(true);
const snapshotRequestActive = ref(false);
const simulationBusy = ref(false);
const aiStepBusy = ref(false);
const memoryLoading = ref(false);
const cognitionLoading = ref(false);
const cognitionBusy = ref(false);
const eventSubmitting = ref(false);
const worldSubmitting = ref(false);
const eventComposerOpen = ref(false);
const worldCreatorOpen = ref(false);
const timelineOpen = ref(false);
const eventDraft = ref('');
const worldPrompt = ref('');
const worldCreationError = ref('');
const syncNotice = ref('正在连接世界档案…');
let simulationTimer = null;
let syncNoticeTimer = null;
let mapResizeObserver = null;

const selectedAgent = computed(() => (
  agents.value.find((agent) => agent.id === selectedAgentId.value) || agents.value[0] || EMPTY_AGENT
));
const worldMap = computed(() => ({ ...FALLBACK_MAP, ...(world.value?.mapConfig || {}) }));
const usesProceduralMap = computed(() => worldMap.value.renderMode === 'procedural-v1');
const formattedTime = computed(() => formatMinute(minute.value));
const worldStatusLabel = computed(() => (isRunning.value ? '运行中' : '已暂停'));
const tickMinutes = computed(() => Number(world.value?.settings?.tickMinutes) || 15);
const recentEvents = computed(() => [...events.value].reverse());
const selectedMemories = computed(() => (
  memoriesByResident.value[selectedAgent.value.id] || selectedAgent.value.memories || []
));
const selectedAgentEvents = computed(() => recentEvents.value.filter((event) => (
  event.residentId === selectedAgent.value.id || event.participantIds.includes(selectedAgent.value.id)
)).slice(0, 8));
const selectedCognition = computed(() => (
  cognitionByResident.value[selectedAgent.value.id]
  || { ...EMPTY_COGNITION, residentId: selectedAgent.value.id, day: day.value }
));
const reflectionProgress = computed(() => {
  const status = selectedCognition.value.reflectionStatus || EMPTY_COGNITION.reflectionStatus;
  const threshold = Math.max(1, Number(status.threshold) || 15);
  return Math.min(100, Math.round((Number(status.importanceTotal) || 0) / threshold * 100));
});
const stageStyle = computed(() => ({
  '--town-zoom': zoom.value,
  width: mapDisplay.value.width ? `${mapDisplay.value.width}px` : '100%',
  aspectRatio: `${worldMap.value.width} / ${worldMap.value.height}`
}));
const mapViewportStyle = computed(() => ({
  '--town-map-ratio': `${worldMap.value.width} / ${worldMap.value.height}`
}));
const activeConversation = computed(() => {
  const event = recentEvents.value.find((item) => item.type === 'dialogue');
  return event
    ? { names: event.title || '居民交谈', text: event.text }
    : { names: '世界动态', text: recentEvents.value[0]?.text || '世界正在等待第一件事发生。' };
});

onMounted(async () => {
  await loadWorlds();
  startPollingIfRunning();
});

onBeforeUnmount(() => {
  stopPolling();
  if (syncNoticeTimer) window.clearTimeout(syncNoticeTimer);
  mapResizeObserver?.disconnect();
});

function startPollingIfRunning() {
  stopPolling();
  if (isRunning.value) {
    simulationTimer = window.setInterval(() => void refreshSnapshot(), 1800);
  }
}

function stopPolling() {
  if (simulationTimer) {
    window.clearInterval(simulationTimer);
    simulationTimer = null;
  }
}

async function loadWorlds(preferredTownId = '') {
  isLoading.value = true;
  try {
    towns.value = await fetchTowns();
    if (!towns.value.length) {
      clearWorld();
      return;
    }
    const rememberedId = window.localStorage.getItem('flai-town-active-id') || '';
    const nextTown = towns.value.find((item) => item.id === preferredTownId)
      || towns.value.find((item) => item.id === rememberedId)
      || towns.value[0];
    await selectWorld(nextTown.id);
    showSyncNotice('世界档案已连接', 1600);
  } catch (error) {
    clearWorld();
    showSyncNotice(`世界档案读取失败：${error.message}`, 0);
  } finally {
    isLoading.value = false;
  }
}

async function selectWorld(nextTownId) {
  if (!nextTownId || aiStepBusy.value || cognitionBusy.value) return;
  const snapshot = await fetchTownSnapshot(nextTownId, { eventLimit: 200 });
  townId.value = nextTownId;
  window.localStorage.setItem('flai-town-active-id', nextTownId);
  memoriesByResident.value = {};
  cognitionByResident.value = {};
  followingAgentId.value = '';
  applyTownSnapshot(snapshot);
  await bindMapResizeObserver();
}

function clearWorld() {
  world.value = null;
  townId.value = '';
  agents.value = [];
  events.value = [];
  selectedAgentId.value = '';
  memoriesByResident.value = {};
  cognitionByResident.value = {};
  isRunning.value = false;
  startPollingIfRunning();
}

async function refreshSnapshot() {
  if (
    !townId.value
    || snapshotRequestActive.value
    || aiStepBusy.value
    || cognitionBusy.value
    || worldCreatorOpen.value
  ) return;
  snapshotRequestActive.value = true;
  try {
    applyTownSnapshot(await fetchTownSnapshot(townId.value, { eventLimit: 200 }));
  } catch (error) {
    showSyncNotice(`共享状态读取失败：${error.message}`);
  } finally {
    snapshotRequestActive.value = false;
  }
}

function applyTownSnapshot(snapshot) {
  if (!snapshot?.town) return;
  world.value = snapshot.town;
  day.value = Number(snapshot.town.currentDay) || 1;
  minute.value = Number(snapshot.town.minuteOfDay) || 0;
  isRunning.value = snapshot.town.simulationStatus === 'running';
  startPollingIfRunning();
  const residents = Array.isArray(snapshot.residents) ? snapshot.residents : [];
  agents.value = residents.map(toViewAgent);
  events.value = Array.isArray(snapshot.events) ? snapshot.events.map(toViewEvent) : [];
  if (!agents.value.some((agent) => agent.id === selectedAgentId.value)) {
    selectedAgentId.value = agents.value[0]?.id || '';
  }
  void nextTick().then(bindMapResizeObserver);
}

function toViewAgent(row, index) {
  const profile = row.profile || {};
  const state = row.state || {};
  const width = Number(worldMap.value.width) || FALLBACK_MAP.width;
  const height = Number(worldMap.value.height) || FALLBACK_MAP.height;
  const legacyX = Number(profile.x);
  const legacyY = Number(profile.y);
  return {
    id: row.id,
    name: row.name,
    role: row.role || '小镇居民',
    summary: profile.summary || `${row.name}正在这个世界中生活。`,
    mood: state.mood || profile.mood || '平静',
    goal: profile.goal || state.currentIntention || '继续今天的生活',
    activities: normalizeTextList(profile.activities, ['观察周围']),
    dialogue: normalizeTextList(profile.dialogue, ['这里今天有些不一样。']),
    memories: [],
    sprite: profile.sprite || { column: (index % 6) * 2 + 1, row: index % 2 === 0 ? 2 : 6 },
    mapX: finiteCoordinate(state.mapX, profile.mapX, Number.isFinite(legacyX) ? legacyX * width / 100 : width / 2),
    mapY: finiteCoordinate(state.mapY, profile.mapY, Number.isFinite(legacyY) ? legacyY * height / 100 : height / 2),
    currentActivity: state.currentActivity || '',
    currentIntention: state.currentIntention || '',
    currentLocation: row.currentLocation || ''
  };
}

function toViewEvent(event) {
  return {
    id: event.id,
    title: event.title || '',
    text: event.detail || event.title || '世界发生了变化。',
    type: event.payload?.uiType || eventTypeFromName(event.eventType),
    eventType: event.eventType,
    source: event.source,
    residentId: event.residentId || '',
    participantIds: Array.isArray(event.payload?.participantIds) ? event.payload.participantIds : [],
    occurredTick: Number(event.occurredTick) || 0
  };
}

async function submitNewWorld() {
  const prompt = worldPrompt.value.trim();
  if (!prompt || worldSubmitting.value || cognitionBusy.value) return;
  worldCreationError.value = '';
  worldSubmitting.value = true;
  try {
    const snapshot = await generateTown({ prompt, simulationStatus: 'paused' });
    towns.value = await fetchTowns();
    townId.value = snapshot.town.id;
    window.localStorage.setItem('flai-town-active-id', townId.value);
    memoriesByResident.value = {};
    cognitionByResident.value = {};
    applyTownSnapshot(snapshot);
    worldPrompt.value = '';
    worldCreationError.value = '';
    worldCreatorOpen.value = false;
    const model = [snapshot.generation?.provider, snapshot.generation?.model].filter(Boolean).join(' · ');
    showSyncNotice(model ? `AI 已通过 ${model} 生成全新世界与地图` : 'AI 已生成全新世界与地图', 3200);
  } catch (error) {
    worldCreationError.value = `创建世界失败：${error.message}`;
    showSyncNotice(worldCreationError.value, 0);
  } finally {
    worldSubmitting.value = false;
  }
}

function openWorldCreator() {
  if (aiStepBusy.value || cognitionBusy.value) return;
  worldCreationError.value = '';
  worldCreatorOpen.value = true;
  window.requestAnimationFrame(() => document.querySelector('[data-world-prompt-input]')?.focus());
}

function closeWorldCreator() {
  if (worldSubmitting.value) return;
  worldCreationError.value = '';
  worldCreatorOpen.value = false;
}

function useExampleWorldIdea() {
  worldCreationError.value = '';
  worldPrompt.value = EXAMPLE_WORLD_IDEA;
}

async function toggleSimulation() {
  if (!townId.value || simulationBusy.value || aiStepBusy.value || cognitionBusy.value) return;
  simulationBusy.value = true;
  try {
    const updated = await updateTownClock(townId.value, {
      simulationStatus: isRunning.value ? 'paused' : 'running'
    });
    isRunning.value = updated.simulationStatus === 'running';
    startPollingIfRunning();
    showSyncNotice(isRunning.value ? '世界模拟已继续' : '世界模拟已暂停', 1500);
  } catch (error) {
    showSyncNotice(`运行状态更新失败：${error.message}`);
  } finally {
    simulationBusy.value = false;
  }
}

async function advanceWithAi() {
  if (!townId.value || aiStepBusy.value || cognitionBusy.value) return;
  if (isRunning.value) {
    showSyncNotice('请先暂停世界，再让 AI 推演下一步。');
    return;
  }
  const activeTownId = townId.value;
  aiStepBusy.value = true;
  try {
    const result = await advanceTownWithAi(activeTownId);
    if (townId.value !== activeTownId) return;
    memoriesByResident.value = {};
    cognitionByResident.value = {};
    applyTownSnapshot(result.snapshot);
    const model = [result.generation?.provider, result.generation?.model].filter(Boolean).join(' · ');
    const duration = Number(result.tickMinutes) || tickMinutes.value;
    showSyncNotice(
      model ? `AI 已通过 ${model} 推演世界 ${duration} 分钟` : `AI 已推演世界 ${duration} 分钟`,
      3200
    );
  } catch (error) {
    showSyncNotice(`AI 推演失败：${error.message}`, 0);
  } finally {
    aiStepBusy.value = false;
  }
}

async function submitWorldEvent() {
  const text = eventDraft.value.trim();
  if (!text || !townId.value || eventSubmitting.value || aiStepBusy.value || cognitionBusy.value) return;
  eventSubmitting.value = true;
  try {
    await createTownEvent(townId.value, {
      eventType: 'world.intervention',
      source: 'player',
      title: text,
      detail: text,
      payload: { uiType: 'intervention' },
      occurredTick: currentTownTick()
    });
    eventDraft.value = '';
    eventComposerOpen.value = false;
    await refreshSnapshot();
    showSyncNotice('事件已写入世界时间线', 1800);
  } catch (error) {
    showSyncNotice(`事件写入失败：${error.message}`);
  } finally {
    eventSubmitting.value = false;
  }
}

function openEventComposer() {
  if (aiStepBusy.value || cognitionBusy.value) return;
  eventComposerOpen.value = true;
  window.requestAnimationFrame(() => document.querySelector('[data-town-event-input]')?.focus());
}

function closeEventComposer() {
  eventComposerOpen.value = false;
  eventDraft.value = '';
}

function selectAgent(agentId) {
  selectedAgentId.value = agentId;
  detailTab.value = 'timeline';
}

async function setDetailTab(tab) {
  detailTab.value = tab;
  const agentId = selectedAgent.value.id;
  if (!townId.value || !agentId) return;
  if (tab === 'memory' && !memoriesByResident.value[agentId]) {
    memoryLoading.value = true;
    try {
      const rows = await recallTownMemories(townId.value, agentId, {
        query: `${selectedAgent.value.goal} ${currentActivity(selectedAgent.value)}`,
        limit: 8
      });
      memoriesByResident.value = { ...memoriesByResident.value, [agentId]: rows.map((item) => item.content) };
    } catch (error) {
      showSyncNotice(`记忆读取失败：${error.message}`);
    } finally {
      memoryLoading.value = false;
    }
  }
  if (tab === 'cognition') await loadTownResidentCognition(agentId);
}

async function loadTownResidentCognition(agentId, force = false) {
  if (!townId.value || !agentId || cognitionLoading.value) return;
  if (!force && cognitionByResident.value[agentId]) return;
  const activeTownId = townId.value;
  cognitionLoading.value = true;
  try {
    const cognition = await fetchTownResidentCognition(activeTownId, agentId);
    if (townId.value !== activeTownId) return;
    cognitionByResident.value = { ...cognitionByResident.value, [agentId]: cognition };
  } catch (error) {
    showSyncNotice(`居民认知读取失败：${error.message}`);
  } finally {
    cognitionLoading.value = false;
  }
}

async function planResidentCognition() {
  const residentId = selectedAgent.value.id;
  if (!townId.value || !residentId || cognitionBusy.value || aiStepBusy.value) return;
  if (isRunning.value) {
    showSyncNotice('请先暂停世界，再让居民进行 AI 反思与规划。');
    return;
  }
  const activeTownId = townId.value;
  cognitionBusy.value = true;
  try {
    const result = await planTownResidentCognitionWithAi(activeTownId, residentId);
    if (townId.value !== activeTownId) return;
    const nextMemories = { ...memoriesByResident.value };
    delete nextMemories[residentId];
    memoriesByResident.value = nextMemories;
    applyTownSnapshot(result.snapshot);
    cognitionByResident.value = { ...cognitionByResident.value, [residentId]: result.cognition };
    const model = [result.generation?.provider, result.generation?.model].filter(Boolean).join(' · ');
    const action = result.generated?.reflection ? '形成反思并规划了当天日程' : '规划了当天日程';
    showSyncNotice(model ? `AI 已通过 ${model} 为${selectedAgent.value.name}${action}` : `AI 已为${selectedAgent.value.name}${action}`, 3600);
  } catch (error) {
    showSyncNotice(`AI 反思与规划失败：${error.message}`, 0);
  } finally {
    cognitionBusy.value = false;
  }
}

function toggleFollowing() {
  if (!selectedAgent.value.id) return;
  followingAgentId.value = followingAgentId.value === selectedAgent.value.id ? '' : selectedAgent.value.id;
}

function currentActivity(agent) {
  return agent.currentActivity || agent.activities?.[0] || '观察周围';
}

function currentDialogue(agent) {
  const dialogue = agent.dialogue || EMPTY_AGENT.dialogue;
  const index = Math.floor(currentTownTick() / Math.max(1, tickMinutes.value)) % dialogue.length;
  return dialogue[index] || EMPTY_AGENT.dialogue[0];
}

function showDialogueBubble(agent) {
  if (!agents.value.length) return false;
  const index = agents.value.indexOf(agent);
  const phase = Math.floor(currentTownTick() / Math.max(1, tickMinutes.value));
  return index === phase % agents.value.length || selectedAgentId.value === agent.id;
}

function agentStyle(agent) {
  const width = Number(worldMap.value.width) || FALLBACK_MAP.width;
  const height = Number(worldMap.value.height) || FALLBACK_MAP.height;
  return {
    left: `${Math.max(0, Math.min(100, agent.mapX / width * 100))}%`,
    top: `${Math.max(0, Math.min(100, agent.mapY / height * 100))}%`
  };
}

function locationStyle(location) {
  return {
    left: `${Number(location.x) / worldMap.value.width * 100}%`,
    top: `${Number(location.y) / worldMap.value.height * 100}%`
  };
}

function spriteStyle(agent) {
  return { backgroundPosition: `${Number(agent.sprite?.column || 0) * -48}px ${Number(agent.sprite?.row || 0) * -48}px` };
}

function zoomBy(delta) {
  zoom.value = Math.min(1.45, Math.max(0.8, Number((zoom.value + delta).toFixed(2))));
}

function resetView() {
  zoom.value = 1;
}

async function bindMapResizeObserver() {
  await nextTick();
  mapResizeObserver?.disconnect();
  if (!mapViewport.value) return;
  if (typeof window.ResizeObserver !== 'function') {
    updateMapDisplay();
    return;
  }
  mapResizeObserver = new window.ResizeObserver(updateMapDisplay);
  mapResizeObserver.observe(mapViewport.value);
  updateMapDisplay();
}

function updateMapDisplay() {
  const viewport = mapViewport.value;
  if (!viewport) return;
  const availableWidth = viewport.clientWidth;
  const availableHeight = viewport.clientHeight;
  const ratio = worldMap.value.width / worldMap.value.height;
  let width = availableWidth;
  let height = width / ratio;
  if (height > availableHeight) {
    height = availableHeight;
    width = height * ratio;
  }
  mapDisplay.value = { width: Math.max(1, width), height: Math.max(1, height) };
}

function currentTownTick() {
  return ((day.value - 1) * 1440) + minute.value;
}

function formatMinute(value) {
  const normalized = ((Number(value) % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function formatScheduleMinute(value) {
  return Number(value) === 1440 ? '24:00' : formatMinute(value);
}

function formatEventTime(event) {
  return `第 ${Math.floor(event.occurredTick / 1440) + 1} 天 · ${formatMinute(event.occurredTick)}`;
}

function eventTypeFromName(value) {
  const name = String(value || '');
  if (name.includes('social') || name.includes('dialogue')) return 'dialogue';
  if (name.includes('reaction') || name.includes('clue')) return 'clue';
  if (name.includes('intervention')) return 'intervention';
  if (name.includes('reflection')) return 'reflection';
  if (name.includes('schedule') || name.includes('plan')) return 'plan';
  if (name.includes('opening')) return 'opening';
  if (name.includes('action')) return 'action';
  return 'world';
}

function eventTypeLabel(type) {
  return ({
    dialogue: '社交',
    clue: '反应',
    intervention: '玩家注入',
    reflection: '反思',
    plan: '规划',
    opening: '开场',
    action: '行动',
    world: '世界'
  })[type] || '世界';
}

function eventSourceLabel(source) {
  if (source === 'player') return '上帝模式';
  if (source === 'ai-world-generation') return 'AI 世界生成';
  if (source === 'ai-town-engine') return 'AI 推演';
  if (source === 'ai-town-cognition') return 'AI 认知';
  if (source === 'world-initialization') return '旧版世界初始化';
  if (source === 'town-engine') return '模拟引擎';
  return source || '世界';
}

function normalizeTextList(value, fallback) {
  const rows = Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : [];
  return rows.length ? rows : fallback;
}

function finiteCoordinate(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function showSyncNotice(message, duration = 3200) {
  syncNotice.value = message;
  if (syncNoticeTimer) window.clearTimeout(syncNoticeTimer);
  if (duration > 0) {
    syncNoticeTimer = window.setTimeout(() => {
      syncNotice.value = '';
      syncNoticeTimer = null;
    }, duration);
  }
}
</script>

<template>
  <section class="town-play-shell">
    <header class="town-command-bar">
      <div class="town-command-primary">
        <button class="town-icon-button" type="button" aria-label="返回角色库" title="返回角色库" @click="emit('navigate', 'home')">
          <ArrowLeft :size="20" />
        </button>
        <div v-if="townId" class="town-world-title">
          <MapPinned :size="22" aria-hidden="true" />
          <div>
            <select :value="townId" aria-label="切换世界" :disabled="aiStepBusy || cognitionBusy" @change="selectWorld($event.target.value)">
              <option v-for="item in towns" :key="item.id" :value="item.id">{{ item.name }}</option>
            </select>
            <p><span :class="{ running: isRunning }">{{ worldStatusLabel }}</span> · 第 {{ day }} 天 · {{ formattedTime }}</p>
          </div>
        </div>
        <div v-else class="town-world-title">
          <Globe :size="22" aria-hidden="true" />
          <div><h1>世界模拟</h1><p>描述构想，由 AI 创建世界</p></div>
        </div>
      </div>

      <div class="town-command-actions">
        <button v-if="townId" class="town-control-button" type="button" aria-label="打开时间线" title="打开时间线" @click="timelineOpen = true">
          <History :size="18" /><span>时间线</span>
        </button>
        <button class="town-control-button" type="button" aria-label="新建世界" title="新建世界" :disabled="aiStepBusy || cognitionBusy" @click="openWorldCreator">
          <PlusCircle :size="18" /><span>新建世界</span>
        </button>
        <button
          v-if="townId"
          class="town-control-button"
          :class="{ active: isRunning }"
          type="button"
          :disabled="simulationBusy || aiStepBusy || cognitionBusy"
          :aria-label="isRunning ? '暂停运行' : '继续运行'"
          :title="isRunning ? '暂停运行' : '继续运行'"
          @click="toggleSimulation"
        >
          <CirclePause v-if="isRunning" :size="18" />
          <CirclePlay v-else :size="18" />
          <span>{{ isRunning ? '暂停运行' : '继续运行' }}</span>
        </button>
        <button
          v-if="townId"
          class="town-control-button ai-step"
          type="button"
          :disabled="isRunning || aiStepBusy || cognitionBusy || simulationBusy"
          :aria-label="isRunning ? '暂停世界后使用 AI 推演' : '让 AI 推演世界下一步'"
          :title="isRunning ? '请先暂停世界' : 'AI 将依据当前世界、目标、日程、事件和记忆推演一步'"
          @click="advanceWithAi"
        >
          <Sparkles :size="18" /><span>{{ aiStepBusy ? 'AI 推演中…' : 'AI 推演' }}</span>
        </button>
        <button v-if="townId" class="town-control-button intervention" type="button" aria-label="投放世界事件" title="投放世界事件" :disabled="aiStepBusy || cognitionBusy" @click="openEventComposer">
          <Radio :size="18" /><span>投放事件</span>
        </button>
      </div>
    </header>

    <p v-if="syncNotice" class="town-sync-notice" aria-live="polite">{{ syncNotice }}</p>

    <div v-if="isLoading" class="town-empty-state">
      <Globe :size="38" /><h2>正在读取世界档案</h2><p>居民、地图与时间线正在同步。</p>
    </div>

    <main v-else-if="!townId" class="town-world-onboarding">
      <section class="town-world-onboarding-copy">
        <span>独立玩法 · 持续世界</span>
        <h2>描述你想看见的世界，<br />AI 会让它真正开始运转。</h2>
        <p>无需填写字段或编写脚本。当前配置的 AI 会生成完整世界蓝图、地点、居民与开场状态，系统再据此创建一张独立地图。</p>
        <div class="town-onboarding-features">
          <article><MapPinned :size="19" /><strong>全新地图</strong><small>按世界环境生成地形与聚落</small></article>
          <article><Users :size="19" /><strong>自主居民</strong><small>目标、日程、记忆与反思</small></article>
          <article><History :size="19" /><strong>完整时间线</strong><small>记录世界的每一次变化</small></article>
        </div>
      </section>
      <form class="town-world-creator-card" @submit.prevent="submitNewWorld">
        <div><p>自然语言世界构想</p><h2>创建全新世界</h2></div>
        <textarea v-model="worldPrompt" data-world-prompt-input rows="14" maxlength="20000" aria-label="世界构想" :placeholder="EXAMPLE_WORLD_IDEA"></textarea>
        <small class="town-world-prompt-help">直接描述时代、环境、冲突或你希望出现的人物。AI 会补全缺失细节，不会按固定字段解析。</small>
        <p v-if="worldCreationError" class="town-world-error" role="alert">{{ worldCreationError }}</p>
        <div class="town-script-actions">
          <button type="button" @click="useExampleWorldIdea">填入示例构想</button>
          <button class="primary" type="submit" :disabled="!worldPrompt.trim() || worldSubmitting">
            <Plus :size="17" /><span>{{ worldSubmitting ? 'AI 正在生成世界与地图…' : '生成并进入世界' }}</span>
          </button>
        </div>
      </form>
    </main>

    <template v-else>
      <div class="town-simulation-grid">
        <section ref="mapViewport" class="town-map-viewport" :style="mapViewportStyle" :aria-label="`${world.name}地图`">
          <div class="town-map-stage" :style="stageStyle">
            <TownGeneratedMap v-if="usesProceduralMap" :map-config="worldMap" :label="`${world.name}的 AI 生成地图`" />
            <img v-else-if="worldMap.imageUrl" :src="worldMap.imageUrl" :alt="`${world.name}旧版地图`" />
            <div v-else class="town-map-unavailable">这个旧世界没有可显示的地图数据</div>
            <span v-for="location in worldMap.locations" :key="location.id" class="town-location-marker" :style="locationStyle(location)">{{ location.name }}</span>
            <button v-for="agent in agents" :key="agent.id" class="town-agent" :class="{ selected: selectedAgentId === agent.id, following: followingAgentId === agent.id }" :style="agentStyle(agent)" type="button" @click.stop="selectAgent(agent.id)">
              <span v-if="showDialogueBubble(agent)" class="town-dialogue-bubble">{{ currentDialogue(agent) }}</span>
              <span class="town-agent-name">{{ agent.name }}</span>
              <span class="town-agent-sprite" :style="spriteStyle(agent)" aria-hidden="true"></span>
              <span class="town-agent-activity">{{ agent.currentLocation || currentActivity(agent) }}</span>
            </button>
          </div>
          <div class="town-map-tools" aria-label="地图缩放">
            <button type="button" aria-label="缩小地图" @click="zoomBy(-0.1)"><Minus :size="17" /></button>
            <strong>{{ Math.round(zoom * 100) }}%</strong>
            <button type="button" aria-label="放大地图" @click="zoomBy(0.1)"><Plus :size="17" /></button>
            <button type="button" aria-label="重置地图视角" @click="resetView"><Crosshair :size="17" /></button>
          </div>
          <div class="town-map-summary"><Users :size="16" /><span>{{ agents.length }} 位居民正在活动</span></div>
        </section>

        <aside class="town-agent-panel" aria-label="居民面板">
          <div class="town-panel-heading"><div><p>居民面板</p><h2>正在发生的生活</h2></div><Users :size="20" /></div>
          <div class="town-agent-list" role="list">
            <button v-for="agent in agents" :key="agent.id" class="town-agent-row" :class="{ active: selectedAgentId === agent.id }" type="button" @click="selectAgent(agent.id)">
              <span><strong>{{ agent.name }}</strong><small>{{ agent.role }}</small></span>
              <span class="town-agent-row-state">{{ currentActivity(agent) }}</span>
              <ChevronRight :size="16" />
            </button>
            <p v-if="!agents.length" class="town-agent-list-empty">这个世界还没有居民。</p>
          </div>
          <section class="town-agent-detail">
            <div class="town-agent-detail-head">
              <div><p>{{ selectedAgent.role }} · 心情 {{ selectedAgent.mood }}</p><h2>{{ selectedAgent.name }}</h2></div>
              <button class="town-follow-button" :class="{ active: followingAgentId === selectedAgent.id }" type="button" :disabled="!selectedAgent.id" @click="toggleFollowing"><Eye :size="16" /><span>{{ followingAgentId === selectedAgent.id ? '跟随中' : '跟随' }}</span></button>
            </div>
            <p class="town-agent-summary">{{ selectedAgent.summary }}</p>
            <div class="town-agent-facts"><p><span>当前行动</span><strong>{{ currentActivity(selectedAgent) }}</strong></p><p><span>个人目标</span><strong>{{ selectedAgent.goal }}</strong></p></div>
            <div class="town-detail-tabs" role="tablist">
              <button role="tab" :aria-selected="detailTab === 'timeline'" :class="{ active: detailTab === 'timeline' }" type="button" @click="setDetailTab('timeline')">
                <History :size="15" />
                <span>动态</span>
              </button>
              <button role="tab" :aria-selected="detailTab === 'memory'" :class="{ active: detailTab === 'memory' }" type="button" @click="setDetailTab('memory')">
                <Brain :size="15" />
                <span>记忆</span>
              </button>
              <button role="tab" :aria-selected="detailTab === 'cognition'" :class="{ active: detailTab === 'cognition' }" type="button" @click="setDetailTab('cognition')">
                <Lightbulb :size="15" />
                <span>认知</span>
              </button>
            </div>
            <div v-if="detailTab === 'timeline'" class="town-detail-content">
              <article v-for="event in selectedAgentEvents" :key="event.id"><small>{{ formatEventTime(event) }} · {{ eventTypeLabel(event.type) }}</small><p>{{ event.text }}</p></article>
              <p v-if="!selectedAgentEvents.length" class="town-detail-empty">这位居民还没有个人动态。</p>
            </div>
            <div v-else-if="detailTab === 'memory'" class="town-memory-list">
              <p v-if="memoryLoading">正在检索长期记忆…</p>
              <p v-for="memory in selectedMemories" v-else :key="memory">
                <Brain :size="14" />
                <span>{{ memory }}</span>
              </p>
              <p v-if="!memoryLoading && !selectedMemories.length">尚未形成可检索的记忆。</p>
            </div>
            <div v-else class="town-cognition-content">
              <p v-if="cognitionLoading" class="town-cognition-loading">正在读取反思与日程…</p>
              <template v-else>
                <section class="town-cognition-status">
                  <div><span>反思积累</span><strong :class="{ ready: selectedCognition.reflectionStatus.shouldReflect }">{{ selectedCognition.reflectionStatus.importanceTotal }} / {{ selectedCognition.reflectionStatus.threshold }}</strong></div>
                  <span class="town-cognition-meter" aria-hidden="true"><i :style="{ width: `${reflectionProgress}%` }"></i></span>
                  <small>{{ selectedCognition.reflectionStatus.shouldReflect ? `已达到阈值，AI 将基于 ${selectedCognition.reflectionStatus.memoryCount} 条未处理记忆形成反思。` : `尚未达到反思阈值，本次 AI 会先规划日程并继续积累记忆。` }}</small>
                </section>
                <button
                  class="town-cognition-action"
                  type="button"
                  :disabled="isRunning || cognitionBusy || aiStepBusy || simulationBusy"
                  :aria-label="isRunning ? '暂停世界后让居民进行 AI 反思与规划' : `让 ${selectedAgent.name} 进行 AI 反思与规划`"
                  @click="planResidentCognition"
                >
                  <Sparkles :size="16" />
                  <span>{{ cognitionBusy ? 'AI 正在整理思绪…' : 'AI 反思与规划' }}</span>
                </button>
                <section class="town-cognition-section">
                  <header><span><Lightbulb :size="15" />历史反思</span><small>{{ selectedCognition.reflections.length }} 条</small></header>
                  <article v-for="reflection in selectedCognition.reflections" :key="reflection.id" class="town-reflection-card">
                    <p>{{ reflection.content }}</p>
                    <span>重要度 {{ reflection.importance }} · 依据 {{ reflection.evidenceMemoryIds.length }} 条记忆</span>
                  </article>
                  <p v-if="!selectedCognition.reflections.length" class="town-cognition-empty">尚未形成反思。</p>
                </section>
                <section class="town-cognition-section">
                  <header><span><CalendarClock :size="15" />第 {{ selectedCognition.day }} 天日程</span><small>{{ selectedCognition.schedule?.items?.length || 0 }} 项</small></header>
                  <p v-if="selectedCognition.schedule?.goal" class="town-schedule-goal">目标：{{ selectedCognition.schedule.goal }}</p>
                  <div v-if="selectedCognition.schedule?.items?.length" class="town-schedule-list">
                    <article v-for="item in selectedCognition.schedule.items" :key="item.id" class="town-schedule-item">
                      <time>{{ formatScheduleMinute(item.startMinute) }}–{{ formatScheduleMinute(item.endMinute) }}</time>
                      <div><strong>{{ item.activity }}</strong><span>{{ item.location }} · {{ item.intention }}</span></div>
                    </article>
                  </div>
                  <p v-else class="town-cognition-empty">当天还没有日程，点击上方按钮让 AI 根据世界现状规划。</p>
                </section>
              </template>
            </div>
          </section>
        </aside>
      </div>

      <footer class="town-story-rail">
        <div class="town-live-conversation"><MessageSquareText :size="19" /><div><p>近期动态 · {{ activeConversation.names }}</p><strong>{{ activeConversation.text }}</strong></div></div>
        <button class="town-event-strip town-event-strip-button" type="button" aria-label="打开完整时间线" @click="timelineOpen = true">
          <article v-for="event in recentEvents.slice(0, 3)" :key="event.id" :class="`type-${event.type}`"><span>{{ eventTypeLabel(event.type) }} · {{ formatEventTime(event) }}</span><p>{{ event.text }}</p></article>
          <span v-if="!recentEvents.length" class="town-event-empty">时间线还没有事件</span>
        </button>
      </footer>
    </template>

    <div v-if="worldCreatorOpen" class="town-event-backdrop" @click.self="closeWorldCreator">
      <form class="town-event-dialog town-world-dialog" @submit.prevent="submitNewWorld">
        <div class="town-event-dialog-head"><div><p>新世界</p><h2>把世界构想交给 AI</h2></div><button type="button" aria-label="关闭" @click="closeWorldCreator"><X :size="19" /></button></div>
        <p>这会创建一个新的独立世界，不会覆盖当前世界。AI 将生成世界蓝图和初始化内容，系统会根据蓝图创建全新地图。</p>
        <textarea v-model="worldPrompt" data-world-prompt-input rows="13" maxlength="20000" aria-label="世界构想" :placeholder="EXAMPLE_WORLD_IDEA"></textarea>
        <small class="town-world-prompt-help">需要先在用户页配置真实可用的模型；生成失败时不会回退到本地模板。</small>
        <p v-if="worldCreationError" class="town-world-error" role="alert">{{ worldCreationError }}</p>
        <div class="town-event-dialog-actions"><button type="button" @click="useExampleWorldIdea">填入示例构想</button><button type="button" @click="closeWorldCreator">取消</button><button class="primary" type="submit" :disabled="!worldPrompt.trim() || worldSubmitting"><Plus :size="16" /><span>{{ worldSubmitting ? 'AI 正在生成世界与地图…' : '创建世界' }}</span></button></div>
      </form>
    </div>

    <div v-if="timelineOpen" class="town-timeline-backdrop" @click.self="timelineOpen = false">
      <aside class="town-timeline-drawer" aria-label="完整世界时间线">
        <header><div><p>世界档案</p><h2>{{ world.name }} · 完整时间线</h2><span>{{ events.length }} 条事件，按世界时间倒序</span></div><button type="button" aria-label="关闭时间线" @click="timelineOpen = false"><X :size="20" /></button></header>
        <div class="town-timeline-list">
          <article v-for="event in recentEvents" :key="event.id" :class="`type-${event.type}`"><div><strong>{{ eventTypeLabel(event.type) }}</strong><time>{{ formatEventTime(event) }}</time></div><h3>{{ event.title || event.text }}</h3><p v-if="event.text !== event.title">{{ event.text }}</p><small>{{ eventSourceLabel(event.source) }}</small></article>
          <div v-if="!events.length" class="town-timeline-empty"><History :size="28" /><p>时间线还没有事件。</p></div>
        </div>
      </aside>
    </div>

    <div v-if="eventComposerOpen" class="town-event-backdrop" @click.self="closeEventComposer">
      <form class="town-event-dialog" @submit.prevent="submitWorldEvent">
        <div class="town-event-dialog-head"><div><p>上帝视角</p><h2>向世界投放一个事件</h2></div><button type="button" aria-label="关闭" @click="closeEventComposer"><X :size="19" /></button></div>
        <p>事件会进入完整时间线，并由居民在后续模拟阶段理解和响应。</p>
        <textarea v-model="eventDraft" data-town-event-input rows="4" maxlength="180" aria-label="世界事件描述" placeholder="例如：港口的钟楼在午夜敲响了十三次。"></textarea>
        <div class="town-event-dialog-actions"><span>{{ eventDraft.length }}/180</span><button type="button" @click="closeEventComposer">取消</button><button class="primary" type="submit" :disabled="!eventDraft.trim() || eventSubmitting"><Send :size="16" /><span>{{ eventSubmitting ? '写入世界…' : '投放事件' }}</span></button></div>
      </form>
    </div>
  </section>
</template>
