<script setup>
import { computed, nextTick, provide, reactive, ref, watch } from 'vue';
import {
  ArrowLeft,
  Eraser,
  MoreHorizontal,
  RefreshCw,
  Sparkles,
  Users,
  X,
} from '@lucide/vue';
import { useNotify } from '../../composables/useNotify.js';
import { useCastManager, CAST_MANAGER_TABS } from '../../composables/cast/useCastManager.js';
import { CAST_MANAGER_CONTEXT } from './castManagerContext.js';
import CastAuditTab from './CastAuditTab.vue';
import CastBehaviorTab from './CastBehaviorTab.vue';
import CastConfirmDialog from './CastConfirmDialog.vue';
import CastItemsTab from './CastItemsTab.vue';
import CastMemoryTab from './CastMemoryTab.vue';
import CastOrganizerBar from './CastOrganizerBar.vue';
import CastProfileTab from './CastProfileTab.vue';
import CastRoster from './CastRoster.vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  conversationId: { type: String, default: '' },
  trackingEnabled: { type: Boolean, default: false },
  trackingSaving: { type: Boolean, default: false },
});
const emit = defineEmits(['close', 'update-tracking']);
const notify = useNotify();
const manager = useCastManager({
  conversationId: computed(() => props.conversationId),
  open: computed(() => props.open),
  notify,
});
provide(CAST_MANAGER_CONTEXT, manager);

const drawerRef = ref(null);
const titleRef = ref(null);
const organizerRef = ref(null);
const mobileActionsRef = ref(null);
const mobilePage = ref('roster');
const confirmation = reactive({
  open: false,
  title: '',
  message: '',
  confirmLabel: '确认',
  danger: false,
  busy: false,
  resolve: null,
});

const tabs = Object.freeze([
  { id: 'profile', label: '资料' },
  { id: 'memories', label: '记忆', count: () => manager.detail.value?.counts?.memories || 0 },
  { id: 'behaviors', label: '行为', count: () => manager.detail.value?.counts?.behaviors || 0 },
  { id: 'items', label: '物品', count: () => manager.detail.value?.counts?.items || 0 },
  { id: 'audit', label: '审计' },
]);

const syncLabel = computed(() => {
  const status = manager.syncStatus.value?.status || 'idle';
  return {
    idle: '等待同步',
    queued: '等待同步',
    running: '正在同步',
    applied: '已同步',
    skipped: '无需更新',
    error: '同步失败',
    failed: '同步失败',
  }[status] || '等待同步';
});

watch(() => props.open, async (open) => {
  if (!open) return;
  mobilePage.value = 'roster';
  await nextTick();
  titleRef.value?.focus({ preventScroll: true });
});

async function requestClose() {
  if (manager.organizer.running) {
    const proceed = await askConfirm({
      title: '取消人物整理？',
      message: '关闭面板会停止当前整理任务。',
      confirmLabel: '停止并关闭',
      danger: true,
    });
    if (!proceed) return;
    manager.cancelOrganization();
  } else if (manager.hasUnsavedChanges.value) {
    const proceed = await confirmDiscard();
    if (!proceed) return;
  }
  manager.clearDirty();
  manager.closeEditor();
  emit('close');
}

async function requestMember(memberId) {
  if (memberId === manager.selectedMemberId.value) {
    mobilePage.value = 'detail';
    return;
  }
  if (manager.hasUnsavedChanges.value && !await confirmDiscard()) return;
  await manager.selectMember(memberId);
  mobilePage.value = 'detail';
}

async function requestTab(tab, options = {}) {
  if (!CAST_MANAGER_TABS.includes(tab) || tab === manager.activeTab.value) return;
  if (manager.hasUnsavedChanges.value && !await confirmDiscard()) return;
  await manager.setActiveTab(tab);
  if (options.focusPanel === false) return;
  await nextTick();
  drawerRef.value?.querySelector?.(`[data-cast-panel="${tab}"] h3`)?.focus?.({ preventScroll: true });
}

async function handleTabKeydown(event, tabId) {
  const currentIndex = tabs.findIndex((tab) => tab.id === tabId);
  let targetIndex = currentIndex;
  if (event.key === 'ArrowRight') targetIndex = (currentIndex + 1) % tabs.length;
  else if (event.key === 'ArrowLeft') targetIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  else if (event.key === 'Home') targetIndex = 0;
  else if (event.key === 'End') targetIndex = tabs.length - 1;
  else return;

  event.preventDefault();
  const targetTab = tabs[targetIndex]?.id;
  await requestTab(targetTab, { focusPanel: false });
  await nextTick();
  drawerRef.value?.querySelector?.(`#cast-tab-${targetTab}`)?.focus?.({ preventScroll: true });
}

async function requestRoster() {
  if (manager.hasUnsavedChanges.value && !await confirmDiscard()) return;
  manager.clearDirty();
  manager.closeEditor();
  mobilePage.value = 'roster';
  await nextTick();
  drawerRef.value?.querySelector?.('.cast-roster-search input')?.focus?.({ preventScroll: true });
}

async function requestCleanup() {
  const proceed = await askConfirm({
    title: '整理空人物记录？',
    message: '没有资料、记忆、行为和物品的 NPC 将被隐藏，可在筛选器中重新显示。',
    confirmLabel: '隐藏空记录',
  });
  if (proceed) await manager.hideEmptyMembers();
}

async function requestDelete(kind, record) {
  const labels = {
    memory: ['删除这条记忆？', '删除后可从审计记录回滚。'],
    behavior: ['删除这条行为规则？', '该规则将不再参与人物行为约束。'],
    item: ['删除这个物品？', '物品将从当前人物名下移除。'],
  };
  const [title, message] = labels[kind] || ['确认删除？', '此操作将写入审计记录。'];
  const proceed = await askConfirm({ title, message, confirmLabel: '删除', danger: true });
  if (!proceed) return;
  if (kind === 'memory') await manager.removeMemory(record);
  if (kind === 'behavior') await manager.removeBehavior(record);
  if (kind === 'item') await manager.removeItem(record);
}

async function requestRollback(event) {
  const proceed = await askConfirm({
    title: '回滚这次变更？',
    message: '仅当数据之后没有被再次修改时才能回滚，回滚本身也会记录到审计时间线。',
    confirmLabel: '确认回滚',
    danger: true,
  });
  if (proceed) await manager.rollbackAuditEvent(event);
}

function openGlobalOrganizer() {
  closeMobileActions();
  manager.organizer.scope = 'conversation';
  mobilePage.value = 'detail';
  nextTick(() => organizerRef.value?.focusRequirement?.());
}

function closeMobileActions() {
  if (mobileActionsRef.value) mobileActionsRef.value.open = false;
}

function updateTracking(event) {
  emit('update-tracking', event.target.checked);
  closeMobileActions();
}

async function runMobileCleanup() {
  closeMobileActions();
  await requestCleanup();
}

async function runMobileRefresh() {
  closeMobileActions();
  await manager.loadRoster({ refreshDetail: true });
}

function askConfirm(config = {}) {
  if (confirmation.resolve) confirmation.resolve(false);
  Object.assign(confirmation, {
    open: true,
    title: config.title || '确认操作',
    message: config.message || '',
    confirmLabel: config.confirmLabel || '确认',
    danger: config.danger === true,
    busy: false,
  });
  return new Promise((resolve) => {
    confirmation.resolve = resolve;
  });
}

function confirmDiscard() {
  return askConfirm({
    title: '放弃未保存修改？',
    message: '当前编辑内容尚未保存。',
    confirmLabel: '放弃修改',
    danger: true,
  }).then((confirmed) => {
    if (confirmed) {
      manager.clearDirty();
      manager.closeEditor();
    }
    return confirmed;
  });
}

function resolveConfirmation(value) {
  const resolve = confirmation.resolve;
  confirmation.open = false;
  confirmation.resolve = null;
  resolve?.(value);
}

function handleKeydown(event) {
  if (confirmation.open) return;
  if (event.key === 'Escape') {
    event.stopPropagation();
    void requestClose();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = drawerRef.value?.querySelectorAll?.(
    'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
  );
  if (!focusable?.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
</script>

<template>
  <div v-if="open" class="cast-manager-overlay">
    <button class="cast-manager-backdrop" type="button" aria-label="关闭 NPC 管理" @click="requestClose"></button>
    <aside
      ref="drawerRef"
      class="cast-manager-drawer"
      :data-mobile-page="mobilePage"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cast-manager-title"
      @keydown="handleKeydown"
    >
      <header class="cast-manager-header">
        <div class="cast-manager-heading">
          <span class="cast-heading-icon" aria-hidden="true"><Users :size="20" /></span>
          <div>
            <h2 id="cast-manager-title" ref="titleRef" tabindex="-1">NPC 管理</h2>
            <p aria-live="polite">
              <span class="cast-sync-dot" :data-status="manager.syncStatus.value?.status || 'idle'"></span>
              {{ syncLabel }} · {{ manager.roster.value.stats.visibleNpcs }} 位在册 NPC
            </p>
          </div>
        </div>
        <div class="cast-manager-actions">
          <label class="cast-tracking-switch cast-desktop-action" :class="{ saving: trackingSaving }">
            <input
              type="checkbox"
              aria-label="自动同步人物状态"
              :checked="trackingEnabled"
              :disabled="trackingSaving"
              @change="emit('update-tracking', $event.target.checked)"
            />
            <span aria-hidden="true"></span>
            <b>{{ trackingSaving ? '保存中' : '自动同步' }}</b>
          </label>
          <button type="button" class="cast-button secondary cast-header-command cast-desktop-action" title="全局整理" aria-label="全局整理" :disabled="manager.organizer.running || manager.hasUnsavedChanges.value" @click="openGlobalOrganizer">
            <Sparkles :size="17" aria-hidden="true" />
            <span>全局整理</span>
          </button>
          <button type="button" class="cast-icon-button cast-desktop-action" title="隐藏空人物记录" aria-label="隐藏空人物记录" :disabled="manager.busy.mutation || manager.hasUnsavedChanges.value" @click="requestCleanup">
            <Eraser :size="18" aria-hidden="true" />
          </button>
          <button type="button" class="cast-icon-button cast-desktop-action" title="刷新人物资料" aria-label="刷新人物资料" :disabled="manager.loading.roster" @click="manager.loadRoster({ refreshDetail: true })">
            <RefreshCw :size="18" aria-hidden="true" :class="{ 'cast-spin': manager.loading.roster }" />
          </button>
          <details ref="mobileActionsRef" class="cast-mobile-actions">
            <summary title="更多操作" aria-label="更多 NPC 管理操作">
              <MoreHorizontal :size="20" aria-hidden="true" />
            </summary>
            <div class="cast-mobile-actions-menu">
              <label class="cast-mobile-tracking" :class="{ saving: trackingSaving }">
                <span>自动同步</span>
                <input
                  type="checkbox"
                  aria-label="自动同步人物状态"
                  :checked="trackingEnabled"
                  :disabled="trackingSaving"
                  @change="updateTracking"
                />
              </label>
              <button type="button" :disabled="manager.organizer.running || manager.hasUnsavedChanges.value" @click="openGlobalOrganizer">
                <Sparkles :size="17" aria-hidden="true" />
                <span>全局整理</span>
              </button>
              <button type="button" :disabled="manager.busy.mutation || manager.hasUnsavedChanges.value" @click="runMobileCleanup">
                <Eraser :size="17" aria-hidden="true" />
                <span>隐藏空记录</span>
              </button>
              <button type="button" :disabled="manager.loading.roster" @click="runMobileRefresh">
                <RefreshCw :size="17" aria-hidden="true" :class="{ 'cast-spin': manager.loading.roster }" />
                <span>刷新资料</span>
              </button>
            </div>
          </details>
          <button type="button" class="cast-icon-button" title="关闭" aria-label="关闭 NPC 管理" @click="requestClose">
            <X :size="19" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div class="cast-manager-live" aria-live="polite" aria-atomic="true">
        <p v-if="manager.errors.sync">{{ manager.errors.sync }}</p>
        <p v-if="manager.errors.mutation" role="alert">{{ manager.errors.mutation }}</p>
      </div>

      <div class="cast-manager-workspace">
        <CastRoster @select="requestMember" @cleanup="requestCleanup" />

        <main class="cast-detail-pane">
          <header v-if="manager.selectedMember.value" class="cast-detail-header">
            <button type="button" class="cast-mobile-back" @click="requestRoster">
              <ArrowLeft :size="18" aria-hidden="true" />
              <span>人物列表</span>
            </button>
            <div class="cast-detail-identity">
              <span class="cast-detail-avatar" aria-hidden="true">{{ manager.selectedMember.value.canonicalName.slice(0, 1) }}</span>
              <div>
                <div class="cast-detail-title-row">
                  <h2>{{ manager.selectedMember.value.canonicalName }}</h2>
                  <span v-if="manager.selectedMember.value.memberType === 'protagonist'" class="cast-badge protagonist">主角</span>
                  <span v-else-if="manager.selectedMember.value.visibility === 'hidden'" class="cast-badge hidden">已隐藏</span>
                </div>
                <p>{{ manager.selectedMember.value.currentLocationLabel || '位置未记录' }}</p>
              </div>
            </div>
          </header>

          <nav v-if="manager.selectedMember.value" class="cast-tabs" role="tablist" aria-label="人物资料分类">
            <button
              v-for="tab in tabs"
              :id="`cast-tab-${tab.id}`"
              :key="tab.id"
              type="button"
              role="tab"
              :aria-selected="manager.activeTab.value === tab.id"
              :aria-controls="`cast-panel-${tab.id}`"
              :tabindex="manager.activeTab.value === tab.id ? 0 : -1"
              @click="requestTab(tab.id)"
              @keydown="handleTabKeydown($event, tab.id)"
            >
              <span>{{ tab.label }}</span>
              <small v-if="tab.count">{{ tab.count() }}</small>
            </button>
          </nav>

          <section v-if="manager.loading.detail && !manager.detail.value" class="cast-detail-loading" aria-label="正在加载人物详情">
            <span v-for="index in 5" :key="index"></span>
          </section>
          <section v-else-if="manager.errors.detail" class="cast-error-state" role="alert">
            <p>{{ manager.errors.detail }}</p>
            <button type="button" class="cast-button secondary" @click="manager.loadSelectedMember()">重试</button>
          </section>
          <section v-else-if="!manager.selectedMember.value" class="cast-empty-state">
            <Users :size="30" aria-hidden="true" />
            <h3>暂无人物</h3>
            <p>从左侧添加第一位 NPC。</p>
          </section>
          <div v-else class="cast-tab-content">
            <CastProfileTab v-if="manager.activeTab.value === 'profile'" id="cast-panel-profile" data-cast-panel="profile" />
            <CastMemoryTab v-if="manager.activeTab.value === 'memories'" id="cast-panel-memories" data-cast-panel="memories" @delete="requestDelete('memory', $event)" />
            <CastBehaviorTab v-if="manager.activeTab.value === 'behaviors'" id="cast-panel-behaviors" data-cast-panel="behaviors" @delete="requestDelete('behavior', $event)" />
            <CastItemsTab v-if="manager.activeTab.value === 'items'" id="cast-panel-items" data-cast-panel="items" @delete="requestDelete('item', $event)" />
            <CastAuditTab v-if="manager.activeTab.value === 'audit'" id="cast-panel-audit" data-cast-panel="audit" @rollback="requestRollback" />
          </div>

          <CastOrganizerBar v-if="manager.selectedMember.value" ref="organizerRef" />
        </main>
      </div>

      <CastConfirmDialog
        :open="confirmation.open"
        :title="confirmation.title"
        :message="confirmation.message"
        :confirm-label="confirmation.confirmLabel"
        :danger="confirmation.danger"
        :busy="confirmation.busy"
        @confirm="resolveConfirmation(true)"
        @cancel="resolveConfirmation(false)"
      />
    </aside>
  </div>
</template>
