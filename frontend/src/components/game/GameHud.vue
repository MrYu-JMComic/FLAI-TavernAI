<script setup>
import { computed, ref, watch } from 'vue';
import PixelIcon from '../PixelIcon.vue';
import { advanceGameplayTime, claimGameplayReward, fetchGameplayDashboard, fetchGameplayEvents, performGameplayCheck, travelGameplayToNode, updateGameplayWeather } from '../../api/chat.js';

const props = defineProps({
  conversationId: { type: String, default: '' },
  refreshKey: { type: [String, Number], default: '' },
  enabled: { type: Boolean, default: true },
  rewardEnabled: { type: Boolean, default: false },
  directorResult: { type: Object, default: null }
});

const emit = defineEmits(['choose-action', 'open-scene']);
const loading = ref(false);
const loadError = ref('');
const dashboard = ref({ location: null, counts: {}, wallet: [], time: '', weather: '', coreStatus: [], worldEvents: [], quickActions: [] });
const unreadEventCount = ref(0);
const eventCursor = ref(0);
const eventsExpanded = ref(false);
const pendingCheck = ref(null);
const checkBusy = ref(false);
const checkResult = ref(null);
const worldBusy = ref(false);
const mapExpanded = ref(false);
const travelBusy = ref(false);
const rewardsExpanded = ref(false);
const rewardBusyId = ref('');
let activeConversationId = '';
let loadToken = 0;

const location = computed(() => {
  return dashboard.value?.location || null;
});

const counts = computed(() => dashboard.value?.counts || {});
const coreStatus = computed(() => Array.isArray(dashboard.value?.coreStatus) ? dashboard.value.coreStatus : []);
const latestEvent = computed(() => Array.isArray(dashboard.value?.worldEvents) ? dashboard.value.worldEvents[0] : null);
const worldEvents = computed(() => Array.isArray(dashboard.value?.worldEvents) ? dashboard.value.worldEvents : []);
const latestEventLabel = computed(() => latestEvent.value?.title || latestEvent.value?.label || '世界发生了变化');
const timeIcon = computed(() => /夜|night|凌晨/i.test(dashboard.value?.time || '') ? 'time.night' : 'time.day');
const weatherIcon = computed(() => /雨|rain/i.test(dashboard.value?.weather || '') ? 'weather.rain' : 'weather.clear');

const locationIcon = computed(() => {
  if (location.value?.nodeType === 'room') return 'room.door';
  if (location.value?.nodeType === 'building') return 'building.house';
  if (location.value?.nodeType === 'map') return 'map.world';
  return 'map.district';
});

const quickActions = computed(() => Array.isArray(dashboard.value?.quickActions) ? dashboard.value.quickActions : []);
const checkActions = computed(() => Array.isArray(dashboard.value?.checkActions) ? dashboard.value.checkActions : []);
const activeQuest = computed(() => dashboard.value?.activeQuest || null);
const travelMap = computed(() => dashboard.value?.travelMap || { currentNode: null, discoveredNodes: [], availableRoutes: [] });
const availableRoutes = computed(() => Array.isArray(travelMap.value.availableRoutes) ? travelMap.value.availableRoutes : []);
const pendingRewards = computed(() => props.rewardEnabled && Array.isArray(dashboard.value?.rewards) ? dashboard.value.rewards : []);
const directorExecutions = computed(() => Array.isArray(props.directorResult?.result?.executions) ? props.directorResult.result.executions : []);
const directorRejected = computed(() => directorExecutions.value.filter(item => !item.ok));

watch(
  () => [props.conversationId, props.refreshKey, props.enabled],
  () => void loadSnapshot(),
  { immediate: true }
);

async function loadSnapshot() {
  const conversationId = String(props.conversationId || '').trim();
  if (!conversationId || !props.enabled) {
    dashboard.value = { location: null, counts: {}, wallet: [], time: '', weather: '', coreStatus: [], worldEvents: [], quickActions: [] };
    eventCursor.value = 0;
    unreadEventCount.value = 0;
    activeConversationId = '';
    loadError.value = '';
    return;
  }
  const token = ++loadToken;
  const conversationChanged = activeConversationId !== conversationId;
  const previousCursor = conversationChanged ? 0 : eventCursor.value;
  activeConversationId = conversationId;
  loading.value = true;
  loadError.value = '';
  try {
    const [result, incremental] = await Promise.all([
      fetchGameplayDashboard(conversationId),
      previousCursor > 0 ? fetchGameplayEvents(conversationId, { afterCursor: previousCursor, limit: 100 }) : Promise.resolve(null)
    ]);
    if (token !== loadToken) return;
    dashboard.value = result || { location: null, counts: {}, wallet: [], time: '', weather: '', coreStatus: [], worldEvents: [], quickActions: [] };
    const newEvents = Array.isArray(incremental?.events) ? incremental.events : [];
    if (!conversationChanged && newEvents.length) unreadEventCount.value += newEvents.length;
    eventCursor.value = Math.max(Number(result?.eventCursor || 0), Number(incremental?.latestCursor || 0), previousCursor);
  } catch (error) {
    if (token !== loadToken) return;
    loadError.value = error?.message || '游戏状态加载失败';
  } finally {
    if (token === loadToken) loading.value = false;
  }
}

function markEventsRead() {
  unreadEventCount.value = 0;
  eventsExpanded.value = !eventsExpanded.value;
}

function eventLabel(event) {
  return event?.title || event?.label || '世界发生了变化';
}

function eventTime(event) {
  const timestamp = Date.parse(event?.createdAt || event?.at || '');
  if (!Number.isFinite(timestamp)) return '';
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(timestamp);
}

async function confirmCheck() {
  if (!pendingCheck.value || checkBusy.value) return;
  checkBusy.value = true;
  checkResult.value = null;
  try {
    checkResult.value = await performGameplayCheck(props.conversationId, pendingCheck.value);
    pendingCheck.value = null;
    await loadSnapshot();
  } catch (error) {
    loadError.value = error?.message || '检定失败';
  } finally {
    checkBusy.value = false;
  }
}

function checkOutcomeLabel(outcome) {
  return ({ critical_success: '大成功', success: '成功', failure: '失败', critical_failure: '大失败' })[outcome] || outcome;
}

async function advanceTime(minutes) {
  if (worldBusy.value) return;
  worldBusy.value = true;
  try {
    await advanceGameplayTime(props.conversationId, minutes);
    await loadSnapshot();
  } catch (error) {
    loadError.value = error?.message || '时间推进失败';
  } finally {
    worldBusy.value = false;
  }
}

async function cycleWeather() {
  if (worldBusy.value) return;
  const weatherOptions = ['晴朗', '多云', '小雨', '暴雨', '雾'];
  const currentIndex = weatherOptions.indexOf(dashboard.value?.weather || '');
  worldBusy.value = true;
  try {
    await updateGameplayWeather(props.conversationId, weatherOptions[(currentIndex + 1) % weatherOptions.length]);
    await loadSnapshot();
  } catch (error) {
    loadError.value = error?.message || '天气更新失败';
  } finally {
    worldBusy.value = false;
  }
}

async function travelTo(destinationNodeId) {
  if (travelBusy.value) return;
  travelBusy.value = true;
  try {
    await travelGameplayToNode(props.conversationId, destinationNodeId);
    await loadSnapshot();
  } catch (error) {
    loadError.value = error?.message || '旅行失败';
  } finally {
    travelBusy.value = false;
  }
}

async function claimReward(grantId) {
  if (!grantId || rewardBusyId.value) return;
  rewardBusyId.value = grantId;
  try {
    await claimGameplayReward(props.conversationId, grantId);
    await loadSnapshot();
  } catch (error) {
    loadError.value = error?.message || '奖励领取失败';
  } finally {
    rewardBusyId.value = '';
  }
}
</script>

<template>
  <section class="game-hud" aria-label="游戏驾驶舱">
    <button class="game-hud-location" type="button" title="打开场景" @click="emit('open-scene')">
      <span class="game-hud-icon"><PixelIcon :icon-key="locationIcon" :size="24" /></span>
      <span>
        <small>{{ loading ? '世界同步中' : '最近场景' }}</small>
        <strong>{{ location?.name || '等待场景建立' }}</strong>
      </span>
    </button>

    <div class="game-hud-world" :title="loadError || '当前世界规模'">
      <span><b>{{ counts.locations || 0 }}</b> 地点</span>
      <span><b>{{ counts.items || 0 }}</b> 物品</span>
    </div>

    <div class="game-hud-vitals" aria-label="时间天气与核心状态">
      <span v-if="dashboard.time" :title="`时间：${dashboard.time}`"><PixelIcon :icon-key="timeIcon" :size="16" />{{ dashboard.time }}</span>
      <button v-if="dashboard.weather" type="button" :title="`切换天气：${dashboard.weather}`" :disabled="worldBusy" @click="cycleWeather"><PixelIcon :icon-key="weatherIcon" :size="16" />{{ dashboard.weather }}</button>
      <span v-for="item in coreStatus.slice(0, 2)" :key="item.name" :title="item.name"><PixelIcon icon-key="status.heart" :size="16" />{{ item.value }}<template v-if="item.max">/{{ item.max }}</template></span>
    </div>

    <div class="game-hud-actions" aria-label="快捷行动">
      <button
        v-for="action in quickActions"
        :key="action.key"
        type="button"
        :title="action.prompt"
        @click="emit('choose-action', action.prompt)"
      >
        <PixelIcon :icon-key="action.iconKey" :size="18" />
        <span>{{ action.label }}</span>
      </button>
      <button v-for="action in checkActions" :key="action.key" type="button" :title="action.context" @click="pendingCheck = action">
        <PixelIcon icon-key="action.dice" :size="18" />
        <span>{{ action.label }}</span>
      </button>
    </div>
    <div class="game-hud-progress">
      <span class="game-hud-quest" :title="activeQuest?.description || '暂无活动任务'">
        <PixelIcon icon-key="quest.scroll" :size="16" />
        <b>{{ activeQuest?.title || '暂无活动任务' }}</b>
        <small v-if="activeQuest">{{ activeQuest.objectives.filter(item => item.status === 'completed').length }}/{{ activeQuest.objectives.length }}</small>
      </span>
    </div>
    <div class="game-hud-world-controls">
      <button type="button" :disabled="worldBusy" title="推进 15 分钟" @click="advanceTime(15)">+15m</button>
      <button type="button" :disabled="worldBusy" title="推进 1 小时" @click="advanceTime(60)">+1h</button>
    </div>
    <div class="game-hud-map">
      <button type="button" :aria-expanded="mapExpanded" title="展开地点地图" @click="mapExpanded = !mapExpanded">
        <PixelIcon icon-key="map.world" :size="16" />
        <b>{{ travelMap.currentNode?.name || '尚未定位' }}</b>
        <small>{{ availableRoutes.length }} 条可达路线</small>
      </button>
      <div v-if="mapExpanded" class="game-hud-map-routes" aria-label="可达地点">
        <span v-if="!availableRoutes.length">当前位置没有已建立的出口</span>
        <button v-for="route in availableRoutes" :key="route.id" type="button" :disabled="travelBusy" :title="route.description || route.label" @click="travelTo(route.destination.id)">
          <PixelIcon icon-key="room.door" :size="14" />
          {{ route.destination.name }}
          <small>{{ route.minutes }}m</small>
        </button>
      </div>
    </div>
    <div v-if="rewardEnabled && pendingRewards.length" class="game-hud-rewards">
      <button type="button" :aria-expanded="rewardsExpanded" @click="rewardsExpanded = !rewardsExpanded">
        <PixelIcon icon-key="item.chest" :size="16" />
        <b>待领取奖励</b>
        <small>{{ pendingRewards.length }} 份</small>
      </button>
      <div v-if="rewardsExpanded" class="game-hud-reward-list" aria-label="待领取奖励列表">
        <button v-for="grant in pendingRewards" :key="grant.id" type="button" :disabled="Boolean(rewardBusyId)" :title="grant.title" @click="claimReward(grant.id)">
          <PixelIcon icon-key="quest.scroll" :size="14" />
          <span>{{ grant.title }}</span>
          <small>{{ rewardBusyId === grant.id ? '结算中' : '领取' }}</small>
        </button>
      </div>
    </div>
    <div v-if="directorExecutions.length || (directorResult && !directorResult.ok)" class="game-hud-director" :class="{ 'has-error': directorRejected.length || !directorResult?.ok }" role="status">
      <PixelIcon icon-key="world.event" :size="16" />
      <b>世界导演</b>
      <span v-if="directorResult?.ok">执行 {{ directorExecutions.length - directorRejected.length }} 项<template v-if="directorRejected.length">，拒绝 {{ directorRejected.length }} 项</template></span>
      <span v-else>{{ directorResult?.error || '执行失败' }}</span>
      <small v-if="directorRejected[0]" :title="directorRejected.map(item => item.error).join('\n')">{{ directorRejected[0].error }}</small>
    </div>
    <div v-if="pendingCheck" class="game-hud-check-confirm" role="group" aria-label="确认检定">
      <span><PixelIcon icon-key="action.dice" :size="16" />{{ pendingCheck.skill }} · 难度 {{ pendingCheck.difficulty }}<template v-if="pendingCheck.modifier"> · 修正 {{ pendingCheck.modifier > 0 ? '+' : '' }}{{ pendingCheck.modifier }}</template></span>
      <button type="button" :disabled="checkBusy" @click="confirmCheck">{{ checkBusy ? '掷骰中' : '确认掷骰' }}</button>
      <button type="button" :disabled="checkBusy" @click="pendingCheck = null">取消</button>
    </div>
    <div v-if="checkResult" class="game-hud-check-result" :class="`is-${checkResult.outcome}`" role="status">
      <PixelIcon icon-key="action.dice" :size="16" />
      <b>{{ checkOutcomeLabel(checkResult.outcome) }}</b>
      <span>{{ checkResult.roll }}{{ checkResult.modifier ? `${checkResult.modifier > 0 ? '+' : ''}${checkResult.modifier}` : '' }} = {{ checkResult.total }} / {{ checkResult.difficulty }}</span>
    </div>
    <button v-if="latestEvent" class="game-hud-event" type="button" :title="latestEventLabel" @click="markEventsRead">
      <PixelIcon icon-key="world.event" :size="16" />
      <span>{{ latestEventLabel }}</span>
      <b v-if="unreadEventCount" aria-label="未读世界事件">+{{ unreadEventCount }}</b>
    </button>
    <ol v-if="eventsExpanded && worldEvents.length" class="game-hud-event-list" aria-label="最近世界事件">
      <li v-for="event in worldEvents" :key="event.id || `${event.type}-${event.at}`" :class="`is-${event.severity || 'info'}`">
        <PixelIcon icon-key="world.event" :size="14" />
        <span>{{ eventLabel(event) }}</span>
        <time v-if="eventTime(event)">{{ eventTime(event) }}</time>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.game-hud {
  display: grid;
  grid-template-columns: minmax(170px, 1.15fr) auto auto auto;
  align-items: stretch;
  gap: 8px;
  padding: 8px clamp(10px, 2vw, 18px);
  border-bottom: 1px solid color-mix(in srgb, var(--line) 78%, transparent);
  background: color-mix(in srgb, var(--surface) 91%, var(--green-soft));
}

.game-hud-location {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  padding: 6px 9px;
  border: 1px solid transparent;
  border-radius: 10px;
  color: var(--text);
  background: transparent;
  text-align: left;
}

.game-hud-location:hover {
  border-color: color-mix(in srgb, var(--primary) 18%, var(--line));
  background: color-mix(in srgb, var(--surface) 76%, transparent);
}

.game-hud-location > span:last-child {
  min-width: 0;
}

.game-hud small,
.game-hud strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.game-hud small {
  color: var(--muted);
  font-size: 0.68rem;
}

.game-hud strong {
  margin-top: 1px;
  font-size: 0.8rem;
}

.game-hud-icon {
  display: grid;
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 9px;
  color: var(--primary);
  background: color-mix(in srgb, var(--primary-soft) 74%, transparent);
}

.game-hud-world,
.game-hud-vitals,
.game-hud-actions {
  display: flex;
  align-items: center;
  gap: 5px;
}

.game-hud-vitals span {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--muted);
  font-size: 0.7rem;
  white-space: nowrap;
}

.game-hud-event {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 2px 0;
  border: 0;
  color: var(--muted);
  background: transparent;
  font-size: 0.7rem;
  text-align: left;
}

.game-hud-event span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.game-hud-event b { margin-left: auto; color: var(--primary); font-size: 0.68rem; }

.game-hud-event-list {
  grid-column: 1 / -1;
  display: grid;
  gap: 4px;
  margin: -2px 0 0;
  padding: 6px 8px;
  border: 1px solid color-mix(in srgb, var(--line) 80%, transparent);
  border-radius: 9px;
  background: color-mix(in srgb, var(--surface) 76%, transparent);
  list-style: none;
}

.game-hud-event-list li {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: 0.7rem;
}

.game-hud-event-list li span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.game-hud-event-list time { font-size: 0.64rem; font-variant-numeric: tabular-nums; }
.game-hud-event-list .is-success { color: var(--success); }
.game-hud-event-list .is-warning { color: var(--warning); }
.game-hud-event-list .is-danger { color: var(--danger); }

.game-hud-progress,
.game-hud-map,
.game-hud-rewards,
.game-hud-check-confirm,
.game-hud-check-result {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.game-hud-map > button,
.game-hud-map-routes,
.game-hud-map-routes button {
  display: flex;
  align-items: center;
  gap: 6px;
}

.game-hud-map > button {
  width: 100%;
  padding: 5px 8px;
  border: 1px solid color-mix(in srgb, var(--line) 78%, transparent);
  border-radius: 8px;
  color: var(--text);
  background: color-mix(in srgb, var(--surface) 76%, transparent);
}

.game-hud-map > button small { margin-left: auto; }
.game-hud-map-routes { flex-wrap: wrap; padding-top: 6px; }
.game-hud-map-routes button { padding: 4px 7px; border-radius: 7px; }
.game-hud-map-routes button small { color: var(--muted); }

.game-hud-rewards > button,
.game-hud-reward-list,
.game-hud-reward-list button { display: flex; align-items: center; gap: 6px; }
.game-hud-rewards > button { width: 100%; padding: 5px 8px; border-radius: 8px; }
.game-hud-rewards > button small { margin-left: auto; }
.game-hud-reward-list { flex-wrap: wrap; padding-top: 6px; }
.game-hud-reward-list button { padding: 4px 7px; border-radius: 7px; }
.game-hud-reward-list button span { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.game-hud-progress { justify-content: space-between; color: var(--muted); font-size: 0.7rem; }
.game-hud-quest { display: inline-flex; align-items: center; gap: 5px; min-width: 0; }
.game-hud-quest b { overflow: hidden; color: var(--text); text-overflow: ellipsis; white-space: nowrap; }
.game-hud-progress small { color: var(--muted); }

.game-hud-check-confirm,
.game-hud-check-result { padding: 6px 8px; border-radius: 9px; background: color-mix(in srgb, var(--surface) 82%, transparent); font-size: 0.72rem; }
.game-hud-check-confirm span { display: inline-flex; align-items: center; gap: 5px; margin-right: auto; }
.game-hud-check-confirm button { min-height: 28px; border: 1px solid var(--line); border-radius: 7px; color: var(--text); background: var(--surface); font-size: 0.7rem; }
.game-hud-check-result.is-success,
.game-hud-check-result.is-critical_success { color: var(--success); }
.game-hud-check-result.is-failure { color: var(--warning); }
.game-hud-check-result.is-critical_failure { color: var(--danger); }

.game-hud-world-controls {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.game-hud-world-controls button,
.game-hud-vitals button { display: inline-flex; align-items: center; gap: 3px; min-height: 26px; padding: 0 7px; border: 1px solid var(--line); border-radius: 7px; color: var(--muted); background: color-mix(in srgb, var(--surface) 80%, transparent); font-size: 0.68rem; }

.game-hud-director { grid-column: 1 / -1; display: flex; align-items: center; gap: 6px; min-width: 0; color: var(--success); font-size: 0.7rem; }
.game-hud-director.has-error { color: var(--warning); }
.game-hud-director span,
.game-hud-director small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.game-hud-director small { margin-left: auto; max-width: 42%; }

.game-hud-world span {
  color: var(--muted);
  font-size: 0.7rem;
  white-space: nowrap;
}

.game-hud-world b {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.game-hud-actions button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 34px;
  padding: 0 9px;
  border: 1px solid color-mix(in srgb, var(--line) 86%, transparent);
  border-radius: 9px;
  color: var(--text);
  background: color-mix(in srgb, var(--surface) 82%, transparent);
  font-size: 0.74rem;
  font-weight: 700;
}

.game-hud-actions button:hover {
  border-color: color-mix(in srgb, var(--primary) 32%, var(--line));
  color: var(--primary);
  background: var(--primary-soft);
}

@media (max-width: 980px) {
  .game-hud { grid-template-columns: minmax(0, 1fr) auto; }
  .game-hud-world,
  .game-hud-vitals { display: none; }
}

@media (max-width: 620px) {
  .game-hud { gap: 5px; padding: 6px 8px; }
  .game-hud-location { padding: 4px 5px; }
  .game-hud-icon { flex-basis: 28px; width: 28px; height: 28px; }
  .game-hud-actions button { min-width: 34px; padding: 0 7px; }
  .game-hud-actions button span { display: none; }
}
</style>
