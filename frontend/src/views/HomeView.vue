<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { measureElement, useVirtualizer } from '@tanstack/vue-virtual';
import { Bot, Clock3, Download, Eye, Heart, MessageSquareText, Pencil, Plus, Search, Star, Upload } from '@lucide/vue';
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

defineProps({
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
const selectedTag = ref('');
const tags = ref([]);
const loading = ref(false);
const reactionPending = ref({});
const importPreview = ref(null);
const importLoading = ref(false);
const scrollContainerRef = ref(null);
const containerWidth = ref(0);
const CARD_MIN_WIDTH = 280;
const CARD_ESTIMATED_HEIGHT = 320;
const MOBILE_CARD_ESTIMATED_HEIGHT = 380;
const GRID_GAP = 14;

const columnsPerRow = computed(() => {
  const w = containerWidth.value || (typeof window !== 'undefined' ? Math.max(320, window.innerWidth - 28) : 1200);
  return Math.max(1, Math.floor((w + GRID_GAP) / (CARD_MIN_WIDTH + GRID_GAP)));
});

const characterRows = computed(() => {
  const cols = columnsPerRow.value;
  const rows = [];
  for (let i = 0; i < characters.value.length; i += cols) {
    rows.push(characters.value.slice(i, i + cols));
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

function measureVirtualRow(element) {
  rowVirtualizer.value?.measureElement(element);
}

function measureContainerWidth() {
  if (scrollContainerRef.value) {
    containerWidth.value = scrollContainerRef.value.clientWidth;
  }
}

let resizeObserver = null;

onMounted(async () => {
  await Promise.all([loadCharacters(), loadTags()]);
  await nextTick();
  measureContainerWidth();
  if (scrollContainerRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => measureContainerWidth());
    resizeObserver.observe(scrollContainerRef.value);
  }
});

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
});
watch([search, sort, selectedTag], loadCharacters);

async function loadTags() {
  try {
    tags.value = await fetchTags();
  } catch {
    // ignore
  }
}

function selectTag(name) {
  selectedTag.value = selectedTag.value === name ? '' : name;
}

async function loadCharacters() {
  loading.value = true;
  try {
    characters.value = await fetchCharacters({ search: search.value, sort: sort.value, tag: selectedTag.value });
  } catch (err) {
    notify.error(err.message);
  } finally {
    loading.value = false;
  }
}

async function openChat(character) {
  try {
    const existing = await fetchConversations({ characterId: character.id });
    const conversation = existing[0] || (await createConversation(character.id));
    emit('navigate', 'chat', { id: conversation.id });
  } catch (err) {
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
    mergeCharacter(await save(character.id, nextActive));
  } catch (err) {
    notify.error(err.message);
  } finally {
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
    const data = JSON.parse(text);
    if (!data.character?.name) {
      notify.error('无效的角色卡文件：缺少角色名');
      return;
    }
    importPreview.value = data;
  } catch {
    notify.error('无法解析角色卡文件，请确认是有效的 JSON 文件');
  }
}

async function confirmImport() {
  if (!importPreview.value) return;
  importLoading.value = true;
  try {
    await importCharacter(importPreview.value);
    notify.success('角色卡导入成功');
    importPreview.value = null;
    await loadCharacters();
  } catch (err) {
    notify.error(err.message);
  } finally {
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
</script>

<template>
  <section class="page-stack">
    <section class="toolbar home-toolbar">
      <label class="search-box">
        <Search :size="18" />
        <input v-model.trim="search" placeholder="搜索名称、标签或人设" />
      </label>
      <label class="select-field">
        <Clock3 :size="18" />
        <select v-model="sort">
          <option value="created">按创建时间</option>
          <option value="used">按最近使用</option>
          <option value="name">按名称</option>
        </select>
      </label>
      <label class="ghost-button file-import-button">
        <Upload :size="17" />
        <span>导入角色卡</span>
        <input type="file" accept=".json" @change="handleImportFile" />
      </label>
    </section>

    <section v-if="tags.length" class="tag-cloud-bar">
      <button
        v-for="tag in tags.slice(0, 20)"
        :key="tag.id"
        class="tag-chip"
        :class="{ active: selectedTag === tag.name }"
        :style="tag.color ? { '--tag-color': tag.color } : {}"
        type="button"
        @click="selectTag(tag.name)"
      >
        {{ tag.name }}
        <span v-if="tag.usageCount" class="tag-count">{{ tag.usageCount }}</span>
      </button>
    </section>

    <p v-if="loading" class="muted-text">正在加载角色...</p>

    <section v-else-if="characters.length" ref="scrollContainerRef" class="character-virtual-scroll">
      <div
        class="character-virtual-spacer"
        :style="{ height: rowVirtualizer.getTotalSize() + 'px', position: 'relative', width: '100%' }"
      >
      <div
        v-for="virtualRow in rowVirtualizer.getVirtualItems()"
        :key="virtualRow.key"
        :ref="measureVirtualRow"
        :data-index="virtualRow.index"
        class="character-virtual-row"
        :style="{
          position: 'absolute',
          top: virtualRow.start + 'px',
          left: 0,
          width: '100%',
          paddingBottom: GRID_GAP + 'px'
        }"
      >
      <article v-for="character in characterRows[virtualRow.index]" :key="character.id" class="character-card">
        <div class="character-reactions">
          <button
            class="reaction-button favorite"
            :class="{ active: character.favoritedByMe }"
            type="button"
            :title="character.favoritedByMe ? `取消收藏（${character.favoriteCount || 0}）` : `收藏（${character.favoriteCount || 0}）`"
            :aria-label="character.favoritedByMe ? '取消收藏' : '收藏'"
            :disabled="isReactionPending(character, 'favorite')"
            @click.stop="toggleFavorite(character)"
          >
            <Star :size="17" :fill="character.favoritedByMe ? 'currentColor' : 'none'" />
          </button>
          <button
            class="reaction-button like"
            :class="{ active: character.likedByMe }"
            type="button"
            :title="character.likedByMe ? `取消点赞（${character.likeCount || 0}）` : `点赞（${character.likeCount || 0}）`"
            :aria-label="character.likedByMe ? '取消点赞' : '点赞'"
            :disabled="isReactionPending(character, 'like')"
            @click.stop="toggleLike(character)"
          >
            <Heart :size="17" :fill="character.likedByMe ? 'currentColor' : 'none'" />
          </button>
        </div>
        <div class="character-body">
          <div class="character-avatar">
            <img v-if="character.avatarUrl" :src="character.avatarUrl" :alt="character.name" />
            <span v-else>{{ character.name.slice(0, 1) }}</span>
          </div>
          <div class="character-title">
            <h2>{{ character.name }}</h2>
            <small>{{ character.gender || '未设置' }} · {{ character.age || '年龄未知' }}</small>
          </div>
          <div class="permission-badges">
            <span class="visibility-badge" :class="character.visibility">{{ visibilityLabel(character) }}</span>
          </div>
          <p>{{ character.persona || character.background || '还没有填写人设。' }}</p>
          <div class="tag-row">
            <span
              v-for="tag in (character.characterTags || []).length ? character.characterTags : (character.tags || []).map((t) => ({ name: t }))"
              :key="tag.id || tag.name"
              class="tag-badge"
              :style="tag.color ? { '--tag-color': tag.color } : {}"
            >{{ tag.name }}</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="ghost-button" type="button" @click="emit('navigate', 'characterEdit', { id: character.id })">
            <Pencil v-if="character.canEdit" :size="17" />
            <Eye v-else :size="17" />
            <span>{{ character.canEdit ? '编辑' : '查看' }}</span>
          </button>
          <button class="primary-button" type="button" @click="openChat(character)">
            <MessageSquareText :size="17" />
            <span>对话</span>
          </button>
        </div>
      </article>
      </div>
      </div>
    </section>

    <section v-else class="empty-state">
      <Bot :size="34" />
      <h2>还没有角色</h2>
      <p>创建第一个角色，设置头像、世界观、人设和开场白。</p>
      <div class="empty-state-actions">
        <button class="primary-button" type="button" @click="emit('navigate', 'characterNew')">
          <Plus :size="18" />
          <span>创建角色</span>
        </button>
        <label class="ghost-button file-import-button">
          <Upload :size="18" />
          <span>导入角色卡</span>
          <input type="file" accept=".json" @change="handleImportFile" />
        </label>
      </div>
    </section>

    <!-- Import Preview Dialog -->
    <Teleport to="body">
      <div v-if="importPreview" class="import-overlay" @click.self="cancelImport">
        <div class="import-dialog">
          <h2>导入角色卡预览</h2>
          <div class="import-preview-content">
            <div class="import-preview-avatar">
              <span>{{ (importPreview.character?.name || '?').slice(0, 1) }}</span>
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
