<script setup>
import { ref, watch } from 'vue';
import {
  CheckSquare,
  MessageSquarePlus,
  PanelLeftClose,
  Search,
  Settings,
  Trash2,
  UserRound
} from '@lucide/vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  user: { type: Object, default: null },
  conversation: { type: Object, default: null },
  filteredConversations: { type: Array, default: () => [] },
  selectedConversationIds: { type: Object, default: () => new Set() },
  allVisibleConversationsSelected: { type: Boolean, default: false },
  selectedConversationCount: { type: Number, default: 0 },
  conversationActionBusy: { type: Boolean, default: false },
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
      <button class="deep-icon-button" type="button" title="收起侧边栏" @click="emit('close')">
        <PanelLeftClose :size="18" />
      </button>
    </div>

    <button class="new-chat-button" type="button" @click="emit('start-new')">
      <MessageSquarePlus :size="18" />
      <span>开启新对话</span>
    </button>

    <label class="history-search">
      <Search :size="17" />
      <input
        placeholder="搜索当前角色的对话"
        @input="emit('update:historySearch', $event.target.value)"
      />
    </label>

    <div v-if="filteredConversations.length" class="history-tools">
      <button class="history-tool-button" type="button" @click="emit('toggle-all')">
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
            @change="emit('toggle-selection', item.id)"
          />
          <span aria-hidden="true"></span>
        </label>
        <button class="history-item" type="button" @click="emit('open-conversation', item.id)">
          <strong>{{ item.title }}</strong>
          <span>{{ item.character?.name || 'AI' }}</span>
          <small class="history-usage" :title="formatConversationUsage(item)">
            {{ formatConversationUsage(item) }}
          </small>
        </button>
        <button
          class="history-delete-button"
          type="button"
          title="删除会话"
          :disabled="conversationActionBusy"
          @click.stop="emit('delete-one', item)"
        >
          <Trash2 :size="15" />
        </button>
      </div>
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
      <button class="deep-icon-button" type="button" title="高阶设置" @click="emit('open-settings')">
        <Settings :size="18" />
      </button>
    </div>
  </aside>
</template>
