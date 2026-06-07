<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { measureElement, useVirtualizer } from '@tanstack/vue-virtual';
import {
  AlertTriangle,
  BookOpen,
  Bot,
  Clock3,
  Compass,
  Download,
  Eye,
  Heart,
  MessageSquareText,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Star,
  Upload,
  WandSparkles
} from '@lucide/vue';
import {
  createConversation,
  fetchCharacters,
  fetchConversations,
  fetchTags,
  importCharacter,
  setCharacterFavorite,
  setCharacterLike
} from '../api';
import { useNotify } from '../composables/useNotify';

const props = defineProps({
  provider: {
    type: Object,
    default: null
  }
});
const emit = defineEmits(['navigate']);
const notify = useNotify();

const characters = ref([]);
const search = ref('');
const sort = ref('created');
const sortOptions = [
  { value: 'created', label: '按创建时间' },
  { value: 'used', label: '按最近使用' },
  { value: 'name', label: '按名称' }
];
const selectedTag = ref('');
const tags = ref([]);
const tagLoadError = ref('');
const loading = ref(false);
const loadError = ref('');
const reactionPending = ref({});
const importPreview = ref(null);
const importLoading = ref(false);
const scrollContainerRef = ref(null);
const containerWidth = ref(0);
const isMobileListLayout = ref(false);
const CARD_MIN_WIDTH = 320;
const CARD_ESTIMATED_HEIGHT = 372;
const MOBILE_CARD_ESTIMATED_HEIGHT = 436;
const GRID_GAP = 18;
const HOT_TAG_RANDOM_POOL_LIMIT = 24;
const hotTagSeed = ref('');

const columnsPerRow = computed(() => {
  const width = containerWidth.value || (typeof window !== 'undefined' ? Math.max(320, window.innerWidth - 28) : 1200);
  return Math.max(1, Math.floor((width + GRID_GAP) / (CARD_MIN_WIDTH + GRID_GAP)));
});

const characterRows = computed(() => {
  const cols = columnsPerRow.value;
  const rows = [];
  for (let index = 0; index < characters.value.length; index += cols) {
    rows.push(characters.value.slice(index, index + cols));
  }
  return rows;
});

const virtualizerOptions = computed(() => ({
  count: characterRows.value.length,
  getScrollElement: () => scrollContainerRef.value,
  estimateSize: () => (containerWidth.value && containerWidth.value < 620 ? MOBILE_CARD_ESTIMATED_HEIGHT : CARD_ESTIMATED_HEIGHT) + GRID_GAP,
  measureElement,
  overscan: 3
}));

const rowVirtualizer = useVirtualizer(virtualizerOptions);

const homeStats = computed(() => {
  const total = characters.value.length;
  const publicCount = characters.value.filter((item) => item.visibility === 'public').length;
  const favoriteCount = characters.value.filter((item) => item.favoritedByMe).length;
  return [
    { label: '全部角色', value: total },
    { label: '公开角色', value: publicCount },
    { label: '我的收藏', value: favoriteCount },
    { label: '标签数量', value: tags.value.length }
  ];
});

const activeFilterLabel = computed(() => {
  const parts = [];
  if (search.value) parts.push(`搜索：${search.value}`);
  if (selectedTag.value) parts.push(`标签：${selectedTag.value}`);
  return parts.join(' / ') || '全部角色';
});

const hasActiveFilters = computed(() => Boolean(search.value || selectedTag.value));

const currentSortOption = computed(() => (
  sortOptions.find((option) => option.value === sort.value) || sortOptions[0]
));

const providerLabel = computed(() => {
  if (!props.provider?.model && !props.provider?.gatewayName) {
    return '未配置模型';
  }
  return [props.provider.gatewayName, props.provider.model].filter(Boolean).join(' · ');
});

const providerReady = computed(() => Boolean(props.provider?.model || props.provider?.gatewayName));

const hotTagDisplayLimit = computed(() => {
  const width = containerWidth.value || (typeof window !== 'undefined' ? window.innerWidth : 1200);
  if (width < 420) return 3;
  if (width < 560) return 4;
  if (width < 760) return 6;
  if (width < 1040) return 8;
  return 12;
});

const popularTags = computed(() => (
  tags.value
    .filter((tag) => Number(tag?.usageCount || 0) > 0)
    .slice()
    .sort(compareTagPopularity)
));

const selectedHotTag = computed(() => {
  if (!selectedTag.value) {
    return null;
  }
  return tags.value.find((tag) => tag?.name === selectedTag.value) || null;
});

const topTags = computed(() => {
  const limit = hotTagDisplayLimit.value;
  const source = popularTags.value;
  if (source.length <= limit) {
    return pinSelectedHotTag(source, selectedHotTag.value, limit);
  }
  const pool = source.slice(0, Math.max(limit, HOT_TAG_RANDOM_POOL_LIMIT));
  const randomizedTags = pool
    .map((tag, index) => ({
      tag,
      score: hashHotTag(`${hotTagSeed.value}:${tag.id || tag.name}:${index}`)
    }))
    .sort((left, right) => left.score - right.score)
    .slice(0, limit)
    .map((item) => item.tag)
    .sort(compareTagPopularity);
  return pinSelectedHotTag(randomizedTags, selectedHotTag.value, limit);
});

const hotTagTotalCount = computed(() => {
  const selected = selectedHotTag.value;
  const selectedOutsidePopular = selected && !popularTags.value.some((tag) => isSameTag(tag, selected));
  return popularTags.value.length + (selectedOutsidePopular ? 1 : 0);
});

const hotTagRailSummary = computed(() => (
  `显示 ${topTags.value.length}/${hotTagTotalCount.value}，最多 ${hotTagDisplayLimit.value} 个`
));

const hotTagRailLabel = computed(() => `热门标签，${hotTagRailSummary.value}`);

const quickActions = computed(() => [
  { label: '新角色', icon: Plus, view: 'characterNew', tone: 'primary' },
  { label: '世界书', icon: BookOpen, view: 'worldBooks', tone: 'quiet' },
  { label: '模型设置', icon: Settings, view: 'settings', tone: providerReady.value ? 'quiet' : 'warning' }
]);

const emptyTitle = computed(() => (hasActiveFilters.value ? '没有匹配的角色' : '还没有角色'));
const emptyCopy = computed(() => (
  hasActiveFilters.value
    ? '换一个关键词或标签，角色可能就在旁边。'
    : '创建第一个角色，补齐头像、人设、世界观和开场白。'
));

function measureVirtualRow(element) {
  rowVirtualizer.value?.measureElement(element);
}

function refreshHotTagSeed() {
  hotTagSeed.value = `${Date.now()}:${Math.random()}`;
}

function compareTagPopularity(left, right) {
  const usageDelta = Number(right?.usageCount || 0) - Number(left?.usageCount || 0);
  if (usageDelta) {
    return usageDelta;
  }
  return String(left?.name || '').localeCompare(String(right?.name || ''), 'zh-Hans');
}

function pinSelectedHotTag(list, selected, limit) {
  if (!selected || list.some((tag) => isSameTag(tag, selected))) {
    return list;
  }
  const next = list.slice(0, Math.max(0, limit));
  if (next.length >= limit && next.length > 0) {
    next.pop();
  }
  next.push(selected);
  return next.sort(compareTagPopularity);
}

function isSameTag(left, right) {
  return Boolean(left?.id && right?.id && left.id === right.id) || left?.name === right?.name;
}

function hashHotTag(value = '') {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function measureContainerWidth() {
  if (scrollContainerRef.value) {
    containerWidth.value = scrollContainerRef.value.clientWidth;
  }
}

let resizeObserver = null;
let mobileLayoutQuery = null;
let characterLoadToken = 0;
let tagLoadToken = 0;
let homeActive = true;

function syncMobileListLayout() {
  isMobileListLayout.value = Boolean(mobileLayoutQuery?.matches);
}

function addMobileLayoutListener() {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return;
  }
  mobileLayoutQuery = window.matchMedia('(max-width: 920px)');
  syncMobileListLayout();
  if (mobileLayoutQuery.addEventListener) {
    mobileLayoutQuery.addEventListener('change', syncMobileListLayout);
  } else if (mobileLayoutQuery.addListener) {
    mobileLayoutQuery.addListener(syncMobileListLayout);
  }
}

function removeMobileLayoutListener() {
  if (!mobileLayoutQuery) {
    return;
  }
  if (mobileLayoutQuery.removeEventListener) {
    mobileLayoutQuery.removeEventListener('change', syncMobileListLayout);
  } else if (mobileLayoutQuery.removeListener) {
    mobileLayoutQuery.removeListener(syncMobileListLayout);
  }
  mobileLayoutQuery = null;
}

function refreshScrollMeasurements() {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }

  measureContainerWidth();
  if (scrollContainerRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => measureContainerWidth());
    resizeObserver.observe(scrollContainerRef.value);
  }
}

onMounted(async () => {
  refreshHotTagSeed();
  addMobileLayoutListener();
  await Promise.all([loadCharacters(), loadTags()]);
  if (!isHomeActive()) return;
  await nextTick();
  refreshScrollMeasurements();
});

onUnmounted(() => {
  homeActive = false;
  resetHomeAsyncScope();
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  removeMobileLayoutListener();
});

watch([search, sort, selectedTag], loadCharacters);
watch(isMobileListLayout, async () => {
  await nextTick();
  refreshScrollMeasurements();
});

function resetHomeAsyncScope() {
  characterLoadToken += 1;
  tagLoadToken += 1;
  loading.value = false;
}

function isHomeActive() {
  return homeActive;
}

async function loadTags() {
  const requestToken = ++tagLoadToken;
  tagLoadError.value = '';
  try {
    const nextTags = await fetchTags();
    if (!isCurrentTagLoad(requestToken)) return;
    tags.value = nextTags;
  } catch (err) {
    if (!isCurrentTagLoad(requestToken)) return;
    tagLoadError.value = err.message || '标签加载失败';
    tags.value = [];
  }
}

function isCurrentTagLoad(requestToken) {
  return isHomeActive() && requestToken === tagLoadToken;
}

function selectTag(name) {
  selectedTag.value = selectedTag.value === name ? '' : name;
}

function clearFilters() {
  search.value = '';
  selectedTag.value = '';
}

function cycleSort() {
  const currentIndex = sortOptions.findIndex((option) => option.value === sort.value);
  const nextIndex = (currentIndex + 1) % sortOptions.length;
  sort.value = sortOptions[nextIndex].value;
}

async function loadCharacters() {
  const requestToken = ++characterLoadToken;
  const filters = { search: search.value, sort: sort.value, tag: selectedTag.value };
  loading.value = true;
  loadError.value = '';
  try {
    const nextCharacters = await fetchCharacters(filters);
    if (!isCurrentCharacterLoad(requestToken)) return;
    characters.value = nextCharacters;
  } catch (err) {
    if (!isCurrentCharacterLoad(requestToken)) return;
    loadError.value = err.message || '加载角色失败';
    notify.error(err.message);
  } finally {
    if (isCurrentCharacterLoad(requestToken)) {
      loading.value = false;
    }
  }
}

function isCurrentCharacterLoad(requestToken) {
  return isHomeActive() && requestToken === characterLoadToken;
}

async function openChat(character) {
  try {
    const existing = await fetchConversations({ characterId: character.id });
    if (!isHomeActive()) return;
    const conversation = existing[0] || (await createConversation(character.id));
    if (!isHomeActive()) return;
    emit('navigate', 'chat', { id: conversation.id });
  } catch (err) {
    if (!isHomeActive()) return;
    notify.error(err.message);
  }
}

async function toggleFavorite(character) {
  await toggleReaction({
    character,
    type: 'favorite',
    nextActive: !character.favoritedByMe,
    save: setCharacterFavorite
  });
}

async function toggleLike(character) {
  await toggleReaction({
    character,
    type: 'like',
    nextActive: !character.likedByMe,
    save: setCharacterLike
  });
}

async function toggleReaction({ character, type, nextActive, save }) {
  const key = `${type}:${character.id}`;
  if (reactionPending.value[key]) {
    return;
  }

  reactionPending.value = { ...reactionPending.value, [key]: true };
  try {
    const nextCharacter = await save(character.id, nextActive);
    if (!isHomeActive()) return;
    mergeCharacter(nextCharacter);
  } catch (err) {
    if (!isHomeActive()) return;
    notify.error(err.message);
  } finally {
    if (!isHomeActive()) return;
    const { [key]: _done, ...rest } = reactionPending.value;
    reactionPending.value = rest;
  }
}

function isReactionPending(character, type) {
  return Boolean(reactionPending.value[`${type}:${character.id}`]);
}

function mergeCharacter(nextCharacter) {
  characters.value = characters.value.map((character) => (
    character.id === nextCharacter.id ? { ...character, ...nextCharacter } : character
  ));
}

async function handleImportFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  event.target.value = '';

  try {
    const text = await file.text();
    if (!isHomeActive()) return;
    const data = JSON.parse(text);
    if (!data.character?.name) {
      notify.error('无效的角色卡文件：缺少角色名');
      return;
    }
    importPreview.value = data;
  } catch {
    if (!isHomeActive()) return;
    notify.error('无法解析角色卡文件，请确认是有效的 JSON 文件');
  }
}

async function confirmImport() {
  if (!importPreview.value || !isHomeActive()) return;
  const nextImport = importPreview.value;
  importLoading.value = true;
  try {
    await importCharacter(nextImport);
    if (!isHomeActive()) return;
    notify.success('角色卡导入成功');
    importPreview.value = null;
    await loadCharacters();
  } catch (err) {
    if (!isHomeActive()) return;
    notify.error(err.message);
  } finally {
    if (!isHomeActive()) return;
    importLoading.value = false;
  }
}

function cancelImport() {
  importPreview.value = null;
}

function visibilityLabel(character) {
  if (character.visibility === 'public') {
    return character.canEdit ? '公开 · 拥有者' : '公开 · 可使用';
  }
  return '私人 · 拥有者';
}

function getCharacterTags(character) {
  const source = (character.characterTags || []).length
    ? character.characterTags
    : (character.tags || []).map((name) => ({ name }));
  return source.slice(0, 5);
}

function getExtraTagCount(character) {
  const count = (character.characterTags || character.tags || []).length;
  return Math.max(0, count - 5);
}

function getInitial(name) {
  return (name || '?').trim().slice(0, 1).toUpperCase();
}

function characterSummary(character) {
  return character.persona || character.background || '还没有填写人设。';
}

function formatCount(value) {
  const count = Number(value || 0);
  if (count >= 1000) {
    return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k`;
  }
  return String(count);
}
</script>

<template>
  <section class="page-stack home-workbench">
    <section class="home-hero">
      <div class="home-hero-main">
        <p class="home-eyebrow">
          <Sparkles :size="16" />
          <span>角色工作台</span>
        </p>
        <h1>角色库</h1>
        <p class="home-hero-copy">管理角色、整理标签，并快速回到正在发生的故事。</p>
        <div class="home-hero-actions">
          <button class="home-primary-action" type="button" @click="emit('navigate', 'characterNew')">
            <Plus :size="18" />
            <span>创建角色</span>
          </button>
          <label class="home-secondary-action home-file-action">
            <Upload :size="18" />
            <span>导入角色卡</span>
            <input type="file" accept=".json" @change="handleImportFile" />
          </label>
        </div>
      </div>

      <div class="home-hero-aside" aria-label="首页状态">
        <div class="home-provider-chip" :class="{ ready: providerReady }">
          <WandSparkles :size="18" />
          <div>
            <span>{{ providerReady ? '当前模型' : '模型状态' }}</span>
            <strong>{{ providerLabel }}</strong>
          </div>
        </div>
        <div class="home-stat-grid" aria-label="角色库概览">
          <div v-for="item in homeStats" :key="item.label" class="home-stat-tile">
            <strong>{{ item.value }}</strong>
            <span>{{ item.label }}</span>
          </div>
        </div>
      </div>
    </section>

    <section class="home-quick-row" aria-label="快捷入口">
      <button
        v-for="action in quickActions"
        :key="action.label"
        class="home-quick-action"
        :class="action.tone"
        type="button"
        @click="emit('navigate', action.view)"
      >
        <component :is="action.icon" :size="18" />
        <span>{{ action.label }}</span>
      </button>
    </section>

    <section class="home-control-panel" aria-label="角色筛选">
      <label class="home-search-field">
        <Search :size="18" />
        <input v-model.trim="search" placeholder="搜索名称、标签或人设" />
      </label>
      <label class="home-select-field">
        <Clock3 :size="18" />
        <select v-model="sort">
          <option v-for="option in sortOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </label>
      <button
        class="home-sort-button"
        :class="`sort-${sort}`"
        type="button"
        :title="`切换排序：${currentSortOption.label}`"
        :aria-label="`当前排序 ${currentSortOption.label}，点击切换`"
        @click="cycleSort"
      >
        <SlidersHorizontal :size="17" />
        <span>{{ currentSortOption.label.replace(/^按/, '') }}</span>
      </button>
      <button class="home-icon-button" type="button" title="重新加载" aria-label="重新加载" @click="loadCharacters">
        <RefreshCw :size="18" />
      </button>
    </section>

    <section v-if="topTags.length" class="home-tag-rail" :aria-label="hotTagRailLabel">
      <div class="home-tag-rail-head">
        <span>热门标签</span>
        <small>{{ hotTagRailSummary }}</small>
      </div>
      <div class="home-tag-chip-row">
        <button class="home-tag-chip" :class="{ active: !selectedTag }" type="button" @click="selectedTag = ''">
          <Compass :size="14" />
          <span>全部</span>
        </button>
        <button
          v-for="tag in topTags"
          :key="tag.id"
          class="home-tag-chip"
          :class="{ active: selectedTag === tag.name }"
          :style="tag.color ? { '--tag-color': tag.color } : {}"
          type="button"
          @click="selectTag(tag.name)"
        >
          <span>{{ tag.name }}</span>
          <small v-if="tag.usageCount">{{ tag.usageCount }}</small>
        </button>
      </div>
    </section>
    <section v-else-if="tagLoadError" class="section-load-status error-state" role="alert">
      <span>{{ tagLoadError }}</span>
      <button class="ghost-button compact-button" type="button" @click="loadTags">
        <RefreshCw :size="16" />
        <span>重试标签</span>
      </button>
    </section>

    <section class="home-section-head">
      <div>
        <p>
          <SlidersHorizontal :size="15" />
          <span>当前视图</span>
        </p>
        <h2>{{ activeFilterLabel }}</h2>
      </div>
      <button v-if="hasActiveFilters" class="home-text-button" type="button" @click="clearFilters">清除筛选</button>
    </section>

    <section v-if="loading" class="home-skeleton-grid redesigned">
      <article v-for="n in 6" :key="n" class="home-skeleton-card">
        <div class="home-skeleton-hero" />
        <div class="home-skeleton-line wide" />
        <div class="home-skeleton-line medium" />
        <div class="home-skeleton-tags">
          <div />
          <div />
          <div />
        </div>
        <div class="home-skeleton-actions">
          <div />
          <div />
        </div>
      </article>
    </section>

    <section v-else-if="loadError" class="home-empty-panel error-state">
      <AlertTriangle :size="36" />
      <h2>加载失败</h2>
      <p>{{ loadError }}</p>
      <button class="home-primary-action" type="button" @click="loadCharacters">
        <RefreshCw :size="18" />
        <span>重新加载</span>
      </button>
    </section>

    <section v-else-if="characters.length && isMobileListLayout" class="home-character-list">
      <article v-for="character in characters" :key="character.id" class="home-character-card">
        <div class="home-card-topline">
          <span class="home-visibility-badge" :class="character.visibility">{{ visibilityLabel(character) }}</span>
          <div class="home-reaction-group">
            <button
              class="home-reaction-button favorite"
              :class="{ active: character.favoritedByMe }"
              type="button"
              :title="character.favoritedByMe ? `取消收藏（${character.favoriteCount || 0}）` : `收藏（${character.favoriteCount || 0}）`"
              :aria-label="character.favoritedByMe ? '取消收藏' : '收藏'"
              :disabled="isReactionPending(character, 'favorite')"
              @click.stop="toggleFavorite(character)"
            >
              <Star :size="16" :fill="character.favoritedByMe ? 'currentColor' : 'none'" />
              <span>{{ formatCount(character.favoriteCount) }}</span>
            </button>
            <button
              class="home-reaction-button like"
              :class="{ active: character.likedByMe }"
              type="button"
              :title="character.likedByMe ? `取消点赞（${character.likeCount || 0}）` : `点赞（${character.likeCount || 0}）`"
              :aria-label="character.likedByMe ? '取消点赞' : '点赞'"
              :disabled="isReactionPending(character, 'like')"
              @click.stop="toggleLike(character)"
            >
              <Heart :size="16" :fill="character.likedByMe ? 'currentColor' : 'none'" />
              <span>{{ formatCount(character.likeCount) }}</span>
            </button>
          </div>
        </div>

        <div class="home-character-identity">
          <div class="home-character-avatar">
            <img v-if="character.avatarUrl" :src="character.avatarUrl" :alt="character.name" />
            <span v-else>{{ getInitial(character.name) }}</span>
          </div>
          <div class="home-character-title">
            <h2>{{ character.name }}</h2>
            <small>{{ character.gender || '未设置' }} · {{ character.age || '年龄未知' }}</small>
          </div>
        </div>

        <p class="home-character-summary">{{ characterSummary(character) }}</p>

        <div class="home-card-tags">
          <span
            v-for="tag in getCharacterTags(character)"
            :key="tag.id || tag.name"
            class="home-card-tag"
            :style="tag.color ? { '--tag-color': tag.color } : {}"
          >
            {{ tag.name }}
          </span>
          <span v-if="getExtraTagCount(character)" class="home-card-tag muted">+{{ getExtraTagCount(character) }}</span>
        </div>

        <div class="home-card-actions">
          <button class="home-secondary-action compact" type="button" @click="emit('navigate', 'characterEdit', { id: character.id })">
            <Pencil v-if="character.canEdit" :size="16" />
            <Eye v-else :size="16" />
            <span>{{ character.canEdit ? '编辑' : '查看' }}</span>
          </button>
          <button class="home-primary-action compact" type="button" @click="openChat(character)">
            <MessageSquareText :size="16" />
            <span>对话</span>
          </button>
        </div>
      </article>
    </section>

    <section v-else-if="characters.length" ref="scrollContainerRef" class="home-character-scroll">
      <div
        class="home-character-spacer"
        :style="{ height: rowVirtualizer.getTotalSize() + 'px', position: 'relative', width: '100%' }"
      >
        <div
          v-for="virtualRow in rowVirtualizer.getVirtualItems()"
          :key="virtualRow.key"
          :ref="measureVirtualRow"
          :data-index="virtualRow.index"
          class="home-character-row"
          :style="{
            position: 'absolute',
            top: virtualRow.start + 'px',
            left: 0,
            width: '100%',
            paddingBottom: GRID_GAP + 'px'
          }"
        >
          <article v-for="character in characterRows[virtualRow.index]" :key="character.id" class="home-character-card">
            <div class="home-card-topline">
              <span class="home-visibility-badge" :class="character.visibility">{{ visibilityLabel(character) }}</span>
              <div class="home-reaction-group">
                <button
                  class="home-reaction-button favorite"
                  :class="{ active: character.favoritedByMe }"
                  type="button"
                  :title="character.favoritedByMe ? `取消收藏（${character.favoriteCount || 0}）` : `收藏（${character.favoriteCount || 0}）`"
                  :aria-label="character.favoritedByMe ? '取消收藏' : '收藏'"
                  :disabled="isReactionPending(character, 'favorite')"
                  @click.stop="toggleFavorite(character)"
                >
                  <Star :size="16" :fill="character.favoritedByMe ? 'currentColor' : 'none'" />
                  <span>{{ formatCount(character.favoriteCount) }}</span>
                </button>
                <button
                  class="home-reaction-button like"
                  :class="{ active: character.likedByMe }"
                  type="button"
                  :title="character.likedByMe ? `取消点赞（${character.likeCount || 0}）` : `点赞（${character.likeCount || 0}）`"
                  :aria-label="character.likedByMe ? '取消点赞' : '点赞'"
                  :disabled="isReactionPending(character, 'like')"
                  @click.stop="toggleLike(character)"
                >
                  <Heart :size="16" :fill="character.likedByMe ? 'currentColor' : 'none'" />
                  <span>{{ formatCount(character.likeCount) }}</span>
                </button>
              </div>
            </div>

            <div class="home-character-identity">
              <div class="home-character-avatar">
                <img v-if="character.avatarUrl" :src="character.avatarUrl" :alt="character.name" />
                <span v-else>{{ getInitial(character.name) }}</span>
              </div>
              <div class="home-character-title">
                <h2>{{ character.name }}</h2>
                <small>{{ character.gender || '未设置' }} · {{ character.age || '年龄未知' }}</small>
              </div>
            </div>

            <p class="home-character-summary">{{ characterSummary(character) }}</p>

            <div class="home-card-tags">
              <span
                v-for="tag in getCharacterTags(character)"
                :key="tag.id || tag.name"
                class="home-card-tag"
                :style="tag.color ? { '--tag-color': tag.color } : {}"
              >
                {{ tag.name }}
              </span>
              <span v-if="getExtraTagCount(character)" class="home-card-tag muted">+{{ getExtraTagCount(character) }}</span>
            </div>

            <div class="home-card-actions">
              <button class="home-secondary-action compact" type="button" @click="emit('navigate', 'characterEdit', { id: character.id })">
                <Pencil v-if="character.canEdit" :size="16" />
                <Eye v-else :size="16" />
                <span>{{ character.canEdit ? '编辑' : '查看' }}</span>
              </button>
              <button class="home-primary-action compact" type="button" @click="openChat(character)">
                <MessageSquareText :size="16" />
                <span>对话</span>
              </button>
            </div>
          </article>
        </div>
      </div>
    </section>

    <section v-else class="home-empty-panel">
      <Bot :size="38" />
      <h2>{{ emptyTitle }}</h2>
      <p>{{ emptyCopy }}</p>
      <div class="home-empty-actions">
        <button v-if="hasActiveFilters" class="home-secondary-action" type="button" @click="clearFilters">清除筛选</button>
        <button class="home-primary-action" type="button" @click="emit('navigate', 'characterNew')">
          <Plus :size="18" />
          <span>创建角色</span>
        </button>
        <label v-if="!hasActiveFilters" class="home-secondary-action home-file-action">
          <Upload :size="18" />
          <span>导入角色卡</span>
          <input type="file" accept=".json" @change="handleImportFile" />
        </label>
      </div>
    </section>

    <Teleport to="body">
      <div v-if="importPreview" class="import-overlay" @click.self="cancelImport">
        <div class="import-dialog">
          <h2>导入角色卡预览</h2>
          <div class="import-preview-content">
            <div class="import-preview-avatar">
              <img v-if="importPreview.character?.avatarUrl" :src="importPreview.character.avatarUrl" :alt="importPreview.character?.name" />
              <span v-else>{{ getInitial(importPreview.character?.name) }}</span>
            </div>
            <div class="import-preview-info">
              <h3>{{ importPreview.character?.name }}</h3>
              <p v-if="importPreview.character?.gender || importPreview.character?.age">
                {{ importPreview.character?.gender || '未设置' }} · {{ importPreview.character?.age || '年龄未知' }}
              </p>
              <p v-if="importPreview.character?.persona" class="import-persona">{{ importPreview.character.persona }}</p>
            </div>
          </div>
          <div class="import-meta">
            <div v-if="importPreview.tags?.length" class="import-meta-item">
              <strong>标签</strong>
              <div class="tag-row">
                <span v-for="tag in importPreview.tags" :key="tag" class="tag-badge">{{ tag }}</span>
              </div>
            </div>
            <div v-if="importPreview.regex_rules?.length" class="import-meta-item">
              <strong>正则规则</strong>
              <span>{{ importPreview.regex_rules.length }} 条</span>
            </div>
            <div v-if="importPreview.world_book" class="import-meta-item">
              <strong>世界书</strong>
              <span>{{ importPreview.world_book.name }}（{{ importPreview.world_book.entries?.length || 0 }} 条目）</span>
            </div>
          </div>
          <div class="import-actions">
            <button class="ghost-button" type="button" @click="cancelImport">取消</button>
            <button class="primary-button" type="button" :disabled="importLoading" @click="confirmImport">
              <Download :size="18" />
              <span>{{ importLoading ? '导入中...' : '确认导入' }}</span>
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </section>
</template>
