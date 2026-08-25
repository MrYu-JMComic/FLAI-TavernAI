<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import {
  Brain,
  EyeOff,
  ListChecks,
  MapPin,
  Package,
  Plus,
  Search,
  Shield,
  UserPlus,
  Users,
} from '@lucide/vue';
import { useCastManagerContext } from './castManagerContext.js';

const emit = defineEmits(['select', 'cleanup']);
const manager = useCastManagerContext();
const creating = ref(false);
const name = ref('');
const aliases = ref('');
const nameInputRef = ref(null);
const listRef = ref(null);

const visibleLabel = computed(() => ({
  visible: '显示在册',
  hidden: '显示隐藏',
  all: '显示全部',
}[manager.visibilityFilter.value] || '显示在册'));

async function showCreateForm() {
  creating.value = true;
  manager.setDirty('create-member', true);
  await nextTick();
  nameInputRef.value?.focus({ preventScroll: true });
}

async function submitMember() {
  const canonicalName = name.value.trim();
  if (!canonicalName || manager.busy.mutation) return;
  const result = await manager.addMember({
    canonicalName,
    aliases: aliases.value.split(/[,，\n]/).map((value) => value.trim()).filter(Boolean),
  });
  if (!result) return;
  name.value = '';
  aliases.value = '';
  creating.value = false;
  manager.setDirty('create-member', false);
}

function cancelCreate() {
  name.value = '';
  aliases.value = '';
  creating.value = false;
  manager.setDirty('create-member', false);
}

watch([name, aliases], () => {
  if (creating.value) manager.setDirty('create-member', true);
});

onBeforeUnmount(() => manager.setDirty('create-member', false));

function handleListKeydown(event) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const entries = [...(listRef.value?.querySelectorAll?.('[role="option"]:not(:disabled)') || [])];
  if (!entries.length) return;
  const currentIndex = entries.indexOf(document.activeElement);
  let nextIndex = currentIndex;
  if (event.key === 'Home') nextIndex = 0;
  if (event.key === 'End') nextIndex = entries.length - 1;
  if (event.key === 'ArrowDown') nextIndex = Math.min(entries.length - 1, Math.max(0, currentIndex + 1));
  if (event.key === 'ArrowUp') nextIndex = Math.max(0, currentIndex < 0 ? 0 : currentIndex - 1);
  event.preventDefault();
  entries[nextIndex]?.focus({ preventScroll: true });
}
</script>

<template>
  <aside class="cast-roster-pane" aria-label="人物名册">
    <div class="cast-roster-toolbar">
      <label class="cast-roster-search">
        <Search :size="17" aria-hidden="true" />
        <span class="sr-only">搜索人物</span>
        <input v-model="manager.search.value" type="search" placeholder="搜索姓名、别名或位置" autocomplete="off" />
      </label>
      <button type="button" class="cast-icon-button" title="添加 NPC" aria-label="添加 NPC" :disabled="manager.busy.mutation || manager.hasUnsavedChanges.value" @click="showCreateForm">
        <UserPlus :size="18" aria-hidden="true" />
      </button>
    </div>

    <div class="cast-roster-filter-row">
      <label>
        <span class="sr-only">人物可见性筛选</span>
        <select v-model="manager.visibilityFilter.value" :aria-label="visibleLabel">
          <option value="visible">在册人物</option>
          <option value="hidden">已隐藏</option>
          <option value="all">全部人物</option>
        </select>
      </label>
      <span>{{ manager.filteredNpcs.value.length }} / {{ manager.roster.value.npcs.length }}</span>
    </div>

    <form v-if="creating" class="cast-create-member" @submit.prevent="submitMember">
      <label for="cast-new-member-name">姓名</label>
      <input id="cast-new-member-name" ref="nameInputRef" v-model="name" maxlength="120" required autocomplete="off" />
      <label for="cast-new-member-aliases">别名</label>
      <input id="cast-new-member-aliases" v-model="aliases" maxlength="500" placeholder="用逗号分隔" autocomplete="off" />
      <div>
        <button type="button" class="cast-button secondary" :disabled="manager.busy.mutation" @click="cancelCreate">取消</button>
        <button type="submit" class="cast-button primary" :disabled="!name.trim() || manager.busy.mutation">
          <Plus :size="16" aria-hidden="true" />
          {{ manager.busy.kind === 'member.create' ? '添加中' : '添加' }}
        </button>
      </div>
    </form>

    <div class="cast-roster-stats" aria-label="名册统计">
      <span><b>{{ manager.roster.value.stats.visibleNpcs }}</b> 在册</span>
      <span><b>{{ manager.roster.value.stats.hiddenNpcs }}</b> 隐藏</span>
      <span><b>{{ manager.roster.value.stats.sealed }}</b> 封存</span>
    </div>

    <div v-if="manager.loading.roster && !manager.members.value.length" class="cast-roster-skeleton" aria-label="正在加载人物名册">
      <span v-for="index in 6" :key="index"></span>
    </div>
    <div v-else-if="manager.errors.roster" class="cast-error-state compact" role="alert">
      <p>{{ manager.errors.roster }}</p>
      <button type="button" class="cast-button secondary" @click="manager.loadRoster({ refreshDetail: true })">重试</button>
    </div>
    <div v-else ref="listRef" class="cast-roster-list" role="listbox" aria-label="选择人物" @keydown="handleListKeydown">
      <p v-if="manager.roster.value.protagonist" class="cast-roster-group-label">主角</p>
      <button
        v-if="manager.roster.value.protagonist"
        type="button"
        class="cast-member-row protagonist"
        role="option"
        :aria-selected="manager.selectedMemberId.value === manager.roster.value.protagonist.id"
        :class="{ active: manager.selectedMemberId.value === manager.roster.value.protagonist.id }"
        @click="emit('select', manager.roster.value.protagonist.id)"
      >
        <span class="cast-member-avatar"><Shield :size="17" aria-hidden="true" /></span>
        <span class="cast-member-copy">
          <strong>{{ manager.roster.value.protagonist.canonicalName }}</strong>
          <small>{{ manager.roster.value.protagonist.currentLocationLabel || '位置未记录' }}</small>
        </span>
      </button>

      <p class="cast-roster-group-label">NPC</p>
      <button
        v-for="member in manager.filteredNpcs.value"
        :key="member.id"
        type="button"
        class="cast-member-row"
        role="option"
        :aria-selected="manager.selectedMemberId.value === member.id"
        :class="{ active: manager.selectedMemberId.value === member.id }"
        @click="emit('select', member.id)"
      >
        <span class="cast-member-avatar" aria-hidden="true">{{ member.canonicalName.slice(0, 1) }}</span>
        <span class="cast-member-copy">
          <span class="cast-member-name-line">
            <strong>{{ member.canonicalName }}</strong>
            <EyeOff v-if="member.visibility === 'hidden'" :size="14" aria-label="已隐藏" />
          </span>
          <small><MapPin :size="12" aria-hidden="true" />{{ member.currentLocationLabel || '位置未记录' }}</small>
          <span class="cast-member-counts" aria-label="人物资料数量">
            <i title="记忆"><Brain :size="12" aria-hidden="true" />{{ member.counts?.memories || 0 }}</i>
            <i title="行为"><ListChecks :size="12" aria-hidden="true" />{{ member.counts?.behaviors || 0 }}</i>
            <i title="物品"><Package :size="12" aria-hidden="true" />{{ member.counts?.items || 0 }}</i>
          </span>
        </span>
      </button>

      <div v-if="!manager.filteredNpcs.value.length" class="cast-empty-state compact">
        <Users :size="24" aria-hidden="true" />
        <p>{{ manager.search.value ? '没有匹配人物' : '此筛选下没有 NPC' }}</p>
      </div>
    </div>
  </aside>
</template>
