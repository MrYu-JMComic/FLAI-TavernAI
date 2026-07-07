<script setup>
import { ref, watch } from 'vue';
import {
  CheckSquare,
  MessageSquarePlus,
  PanelLeftClose,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  UserRound
} from '@lucide/vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  user: { type: Object, default: null },
  conversation: { type: Object, default: null },
  historySearch: { type: String, default: '' },
  filteredConversations: { type: Array, default: () => [] },
  selectedConversationIds: { type: Object, default: () => new Set() },
  allVisibleConversationsSelected: { type: Boolean, default: false },
  selectedConversationCount: { type: Number, default: 0 },
  conversationActionBusy: { type: Boolean, default: false },
  startConversationBusy: { type: Boolean, default: false },
  conversationBranches: { type: Array, default: () => [] },
  sidebarLoadError: { type: String, default: '' },
  sidebarLoading: { type: Boolean, default: false },
  route: { type: Object, default: () => ({ params: {} }) },
  formatConversationUsage: { type: Function, default: () => '' }
});

const emit = defineEmits([
  'close',
  'navigate',
  'start-new',
  'open-conversation',
  'update:historySearch',
  'toggle-all',
  'toggle-selection',
  'delete-one',
  'delete-selected',
  'reload-sidebar',
  'open-settings'
]);

const backdropRef = ref(null);
const sidebarRef = ref(null);

watch(() => props.open, (open) => {
  if (!open) {
    releaseSidebarFocus();
  }
}, { flush: 'sync' });

function releaseSidebarFocus() {
  if (typeof document === 'undefined') {
    return;
  }
  const active = document.activeElement;
  if (!active) {
    return;
  }
  const focusInsideSidebar = sidebarRef.value?.contains?.(active);
  if (active === backdropRef.value || focusInsideSidebar) {
    active.blur?.();
  }
}

function onHistorySearchInput(event) {
  const target = event?.target;
  if (!target || target.value === undefined) {
    return;
  }
  emit('update:historySearch', target.value);
}

function branchMeta(branch = {}) {
  const createdAt = String(branch.createdAt || '').trim();
  if (!createdAt) {
    return '分支对话';
  }
  return createdAt.slice(0, 16).replace('T', ' ');
}
</script>

<template>
  <button
    ref="backdropRef"
    class="sidebar-backdrop"
    :class="{ visible: open }"
    type="button"
    aria-label="关闭对话历史"
    :inert="!open"
    :tabindex="open ? 0 : -1"
    @click="emit('close')"
  ></button>
  <aside ref="sidebarRef" class="deep-sidebar" :class="{ collapsed: !open }" aria-label="对话历史" :inert="!open">
    <div class="deep-sidebar-top">
      <button class="deep-brand" type="button" @click="emit('navigate', 'home')">
        <span class="deep-logo">F</span>
        <strong>FLAI Tavern</strong>
      </button>
      <button class="deep-icon-button" type="button" aria-label="收起侧边栏" title="收起侧边栏" @click="emit('close')">
        <PanelLeftClose :size="18" />
      </button>
    </div>

    <button
      class="new-chat-button"
      type="button"
      :disabled="startConversationBusy || conversationActionBusy"
      :aria-busy="startConversationBusy || conversationActionBusy"
      @click="emit('start-new')"
    >
      <MessageSquarePlus :size="18" />
      <span>开启新对话</span>
    </button>

    <label class="history-search">
      <Search :size="17" />
      <input
        :value="historySearch"
        placeholder="搜索当前角色的对话"
        aria-label="搜索当前角色的对话"
        @input="onHistorySearchInput"
      />
    </label>

    <div v-if="sidebarLoadError" class="sidebar-load-status" role="alert">
      <span>{{ sidebarLoadError }}</span>
      <button
        class="history-tool-button"
        type="button"
        :disabled="sidebarLoading || conversationActionBusy || startConversationBusy"
        :aria-busy="sidebarLoading"
        @click="emit('reload-sidebar')"
      >
        <RefreshCw :size="15" :class="{ spinning: sidebarLoading }" />
        <span>{{ sidebarLoading ? '加载中' : '重试' }}</span>
      </button>
    </div>

    <div v-if="filteredConversations.length" class="history-tools">
      <button
        class="history-tool-button"
        type="button"
        :disabled="conversationActionBusy"
        @click="emit('toggle-all')"
      >
        <CheckSquare :size="15" />
        <span>{{ allVisibleConversationsSelected ? '取消' : '全选' }}</span>
      </button>
      <button
        class="history-tool-button danger"
        type="button"
        :disabled="!selectedConversationCount || conversationActionBusy"
        @click="emit('delete-selected')"
      >
        <Trash2 :size="15" />
        <span>批删</span>
        <small v-if="selectedConversationCount">{{ selectedConversationCount }}</small>
      </button>
    </div>

    <div class="history-list">
      <p class="history-group">{{ conversation?.character?.name || '当前角色' }}</p>
      <div
        v-for="item in filteredConversations"
        :key="item.id"
        class="history-row"
        :class="{ active: item.id === route.params.id }"
      >
        <label class="history-check" title="选择会话" @click.stop>
          <input
            type="checkbox"
            :checked="selectedConversationIds.has(item.id)"
            :disabled="conversationActionBusy"
            :aria-label="`选择对话：${item.title || '未命名对话'}`"
            @change="emit('toggle-selection', item.id)"
          />
          <span aria-hidden="true"></span>
        </label>
        <button
          class="history-item"
          type="button"
          :disabled="conversationActionBusy"
          :aria-busy="conversationActionBusy"
          @click="emit('open-conversation', item.id)"
        >
          <strong>{{ item.title }}</strong>
          <span>{{ item.character?.name || 'AI' }}</span>
          <small class="history-usage" :title="formatConversationUsage(item)">
            {{ formatConversationUsage(item) }}
          </small>
        </button>
        <button
          class="history-delete-button"
          type="button"
          aria-label="删除会话"
          title="删除会话"
          :disabled="conversationActionBusy"
          @click.stop="emit('delete-one', item)"
        >
          <Trash2 :size="15" />
        </button>
      </div>
      <template v-if="conversationBranches.length">
        <p class="history-group">分支</p>
        <div
          v-for="branch in conversationBranches"
          :key="branch.id"
          class="history-row branch-row"
          :class="{ active: branch.id === route.params.id }"
        >
          <button
            class="history-item"
            type="button"
            :disabled="conversationActionBusy"
            :aria-busy="conversationActionBusy"
            @click="emit('open-conversation', branch.id)"
          >
            <strong>{{ branch.title }}</strong>
            <span>{{ branch.characterName || conversation?.character?.name || 'AI' }}</span>
            <small>{{ branchMeta(branch) }}</small>
          </button>
        </div>
      </template>
      <p v-if="!filteredConversations.length" class="history-empty">暂无会话</p>
    </div>

    <div class="sidebar-footer">
      <button class="sidebar-user" type="button" @click="emit('navigate', 'settings')">
        <span v-if="user?.avatarUrl" class="sidebar-user-avatar">
          <img :src="user.avatarUrl" :alt="user?.username || '用户头像'" />
        </span>
        <UserRound v-else :size="18" />
        <span>{{ user?.displayName || user?.accountName || user?.username || '用户' }}</span>
      </button>
      <button class="deep-icon-button" type="button" aria-label="打开高阶设置" title="高阶设置" @click="emit('open-settings')">
        <Settings :size="18" />
      </button>
    </div>
  </aside>
</template>
