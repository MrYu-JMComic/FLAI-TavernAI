<script setup>
import { computed, reactive, ref, watch } from 'vue';
import {
  Brain,
  Plus,
  RefreshCw,
  Trash2,
  Users,
  X,
  Zap
} from '@lucide/vue';
import {
  addNpcBehavior,
  addNpcMemory,
  deleteNpcBehavior,
  deleteNpcMemory,
  fetchConversationNpcs,
  fetchNpcBehaviors,
  fetchNpcMemories,
  hideConversationNpc,
  hideEmptyConversationNpcs,
  updateNpcBehavior
} from '../api';
import { useNotify } from '../composables/useNotify';

const props = defineProps({
  conversationId: { type: String, required: true },
  open: { type: Boolean, default: false },
  refreshKey: { type: Number, default: 0 }
});
const emit = defineEmits(['close', 'update:open']);

const notify = useNotify();
const loading = ref(false);
const npcs = ref([]);
const selectedNpc = ref('');
const memories = ref([]);
const behaviors = ref([]);
const detailTab = ref('memories');
const detailLoading = ref(false);
const addMemoryOpen = ref(false);
const addBehaviorOpen = ref(false);
let npcLoadToken = 0;
let npcDetailToken = 0;
const memoryForm = reactive({ memoryType: 'event', content: '' });
const behaviorForm = reactive({
  behaviorType: 'reaction',
  triggerCondition: '',
  action: '',
  priority: 0,
  enabled: true
});

const selectedNpcData = computed(() => npcs.value.find((n) => n.name === selectedNpc.value) || null);
const npcPanelStats = computed(() => ({
  npcCount: npcs.value.length,
  memoryCount: npcs.value.reduce((sum, npc) => sum + Number(npc.memoryCount || 0), 0),
  behaviorCount: npcs.value.reduce((sum, npc) => sum + Number(npc.behaviorCount || 0), 0)
}));

const selectedNpcStats = computed(() => ({
  memoryCount: memories.value.length,
  behaviorCount: behaviors.value.length
}));
const emptyNpcNames = computed(() => npcs.value
  .filter((npc) => Number(npc.memoryCount || 0) === 0 && Number(npc.behaviorCount || 0) === 0)
  .map((npc) => npc.name));

const memoryTypeOptions = [
  { value: 'event', label: '事件' },
  { value: 'relationship', label: '关系' },
  { value: 'opinion', label: '看法' },
  { value: 'knowledge', label: '知识' },
  { value: 'emotion', label: '情感' }
];

const behaviorTypeOptions = [
  { value: 'reaction', label: '反应' },
  { value: 'dialogue', label: '对话' },
  { value: 'action', label: '行动' },
  { value: 'emotion', label: '情绪' },
  { value: 'movement', label: '移动' }
];

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    loadNpcs();
  }
}, { immediate: true });

watch(() => props.refreshKey, () => {
  if (props.open) {
    loadNpcs();
  }
});

watch(() => props.conversationId, () => {
  resetNpcState();
  if (props.open) {
    loadNpcs();
  }
});

function requestClose() {
  emit('update:open', false);
  emit('close');
}

function resetNpcState() {
  npcLoadToken += 1;
  npcDetailToken += 1;
  npcs.value = [];
  selectedNpc.value = '';
  memories.value = [];
  behaviors.value = [];
  addMemoryOpen.value = false;
  addBehaviorOpen.value = false;
  loading.value = false;
  detailLoading.value = false;
}

async function loadNpcs() {
  const conversationId = props.conversationId;
  if (!conversationId) {
    resetNpcState();
    return;
  }
  const requestToken = ++npcLoadToken;
  loading.value = true;
  try {
    const nextNpcs = await fetchConversationNpcs(conversationId);
    if (requestToken !== npcLoadToken || conversationId !== props.conversationId) return;
    npcs.value = nextNpcs;
    if (selectedNpc.value && !npcs.value.find((n) => n.name === selectedNpc.value)) {
      selectedNpc.value = '';
    }
    if (!selectedNpc.value && npcs.value.length > 0) {
      selectedNpc.value = npcs.value[0].name;
    }
    if (selectedNpc.value) {
      await loadNpcDetail();
    } else {
      memories.value = [];
      behaviors.value = [];
    }
  } catch (err) {
    if (requestToken !== npcLoadToken || conversationId !== props.conversationId) return;
    notify.error(err.message || '加载 NPC 列表失败');
  } finally {
    if (requestToken === npcLoadToken && conversationId === props.conversationId) {
      loading.value = false;
    }
  }
}

async function selectNpc(name) {
  selectedNpc.value = name;
  addMemoryOpen.value = false;
  addBehaviorOpen.value = false;
  await loadNpcDetail();
}

async function loadNpcDetail() {
  const conversationId = props.conversationId;
  const npcName = selectedNpc.value;
  if (!conversationId || !npcName) return;
  const requestToken = ++npcDetailToken;
  detailLoading.value = true;
  try {
    const [mem, beh] = await Promise.all([
      fetchNpcMemories(conversationId, npcName),
      fetchNpcBehaviors(conversationId, npcName)
    ]);
    if (requestToken !== npcDetailToken || conversationId !== props.conversationId || npcName !== selectedNpc.value) return;
    memories.value = mem;
    behaviors.value = beh;
  } catch (err) {
    if (requestToken !== npcDetailToken || conversationId !== props.conversationId || npcName !== selectedNpc.value) return;
    notify.error(err.message || '加载 NPC 详情失败');
  } finally {
    if (requestToken === npcDetailToken && conversationId === props.conversationId && npcName === selectedNpc.value) {
      detailLoading.value = false;
    }
  }
}

async function submitMemory() {
  if (!memoryForm.content.trim()) {
    notify.warning('请输入记忆内容');
    return;
  }
  const conversationId = props.conversationId;
  const npcName = selectedNpc.value;
  if (!conversationId || !npcName) return;
  try {
    const mem = await addNpcMemory(conversationId, npcName, {
      memoryType: memoryForm.memoryType,
      content: memoryForm.content.trim()
    });
    if (conversationId !== props.conversationId || npcName !== selectedNpc.value) return;
    memories.value.unshift(mem);
    memoryForm.content = '';
    addMemoryOpen.value = false;
    await loadNpcs();
    notify.success('记忆已添加');
  } catch (err) {
    notify.error(err.message || '添加记忆失败');
  }
}

async function removeMemory(memoryId) {
  const conversationId = props.conversationId;
  const npcName = selectedNpc.value;
  if (!conversationId || !npcName) return;
  try {
    await deleteNpcMemory(conversationId, npcName, memoryId);
    if (conversationId !== props.conversationId || npcName !== selectedNpc.value) return;
    memories.value = memories.value.filter((m) => m.id !== memoryId);
    await loadNpcs();
    notify.success('记忆已删除');
  } catch (err) {
    notify.error(err.message || '删除记忆失败');
  }
}

async function submitBehavior() {
  if (!behaviorForm.action.trim()) {
    notify.warning('请输入行为动作');
    return;
  }
  const conversationId = props.conversationId;
  const npcName = selectedNpc.value;
  if (!conversationId || !npcName) return;
  try {
    const beh = await addNpcBehavior(conversationId, npcName, {
      behaviorType: behaviorForm.behaviorType,
      triggerCondition: behaviorForm.triggerCondition.trim(),
      action: behaviorForm.action.trim(),
      priority: behaviorForm.priority,
      enabled: behaviorForm.enabled
    });
    if (conversationId !== props.conversationId || npcName !== selectedNpc.value) return;
    behaviors.value.push(beh);
    behaviorForm.triggerCondition = '';
    behaviorForm.action = '';
    behaviorForm.priority = 0;
    addBehaviorOpen.value = false;
    await loadNpcs();
    notify.success('行为规则已添加');
  } catch (err) {
    notify.error(err.message || '添加行为规则失败');
  }
}

async function toggleBehavior(behavior) {
  const conversationId = props.conversationId;
  const npcName = selectedNpc.value;
  if (!conversationId || !npcName) return;
  try {
    const updated = await updateNpcBehavior(conversationId, npcName, behavior.id, {
      enabled: !behavior.enabled
    });
    if (conversationId !== props.conversationId || npcName !== selectedNpc.value) return;
    Object.assign(behavior, updated);
  } catch (err) {
    notify.error(err.message || '更新失败');
  }
}

async function removeBehavior(behaviorId) {
  const conversationId = props.conversationId;
  const npcName = selectedNpc.value;
  if (!conversationId || !npcName) return;
  try {
    await deleteNpcBehavior(conversationId, npcName, behaviorId);
    if (conversationId !== props.conversationId || npcName !== selectedNpc.value) return;
    behaviors.value = behaviors.value.filter((b) => b.id !== behaviorId);
    await loadNpcs();
    notify.success('行为规则已删除');
  } catch (err) {
    notify.error(err.message || '删除行为规则失败');
  }
}

async function removeSelectedNpc() {
  if (!selectedNpc.value) return;
  const conversationId = props.conversationId;
  const npcName = selectedNpc.value;
  if (!conversationId) return;
  if (!window.confirm(`从 NPC 列表移除“${npcName}”？已有记忆和行为不会被删除。`)) {
    return;
  }
  try {
    await hideConversationNpc(conversationId, npcName);
    if (conversationId !== props.conversationId || npcName !== selectedNpc.value) return;
    selectedNpc.value = '';
    memories.value = [];
    behaviors.value = [];
    await loadNpcs();
    notify.success('NPC 已从列表移除');
  } catch (err) {
    notify.error(err.message || '移除 NPC 失败');
  }
}

async function removeEmptyNpcs() {
  const conversationId = props.conversationId;
  const names = emptyNpcNames.value;
  if (!conversationId || !names.length) return;
  const preview = names.slice(0, 5).join('、');
  const suffix = names.length > 5 ? `等 ${names.length} 个` : `${names.length} 个`;
  if (!window.confirm(`从 NPC 列表移除 ${suffix}没有记忆和行为的 NPC？\n${preview}\n已有记忆和行为不会被删除。`)) {
    return;
  }
  try {
    const result = await hideEmptyConversationNpcs(conversationId);
    if (conversationId !== props.conversationId) return;
    if (names.includes(selectedNpc.value)) {
      selectedNpc.value = '';
      memories.value = [];
      behaviors.value = [];
    }
    await loadNpcs();
    notify.success(`已移除 ${result?.count ?? names.length} 个空 NPC`);
  } catch (err) {
    notify.error(err.message || '批量移除空 NPC 失败');
  }
}

function memoryTypeLabel(type) {
  return memoryTypeOptions.find((o) => o.value === type)?.label || type;
}

function behaviorTypeLabel(type) {
  return behaviorTypeOptions.find((o) => o.value === type)?.label || type;
}

function formatTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return iso;
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="npc-panel-overlay" @click.self="requestClose" @pointerdown.self="requestClose">
      <aside class="npc-panel" role="dialog" aria-label="NPC 管理面板">
          <header class="npc-panel-header">
            <div class="npc-panel-title">
              <Users :size="20" />
              <h2>NPC 管理</h2>
            </div>
            <button class="npc-close" type="button" @pointerdown.stop @click.stop="requestClose">
              <X :size="18" />
            </button>
          </header>

          <section class="npc-panel-summary" aria-label="NPC 记忆概览">
            <div class="npc-summary-card">
              <span>NPC</span>
              <strong>{{ npcPanelStats.npcCount }}</strong>
            </div>
            <div class="npc-summary-card memory">
              <span>记忆</span>
              <strong>{{ npcPanelStats.memoryCount }}</strong>
            </div>
            <div class="npc-summary-card behavior">
              <span>行为</span>
              <strong>{{ npcPanelStats.behaviorCount }}</strong>
            </div>
          </section>

          <div class="npc-panel-body">
            <!-- NPC List -->
            <div class="npc-list-section">
              <div class="npc-list-header">
                <span>NPC 列表</span>
                <div class="npc-list-actions">
                  <button
                    class="npc-empty-remove"
                    type="button"
                    :disabled="!emptyNpcNames.length"
                    title="移除没有记忆和行为的 NPC"
                    @click="removeEmptyNpcs"
                  >
                    清理空项
                  </button>
                  <button class="npc-refresh" type="button" title="刷新" @click="loadNpcs">
                    <RefreshCw :size="15" />
                  </button>
                </div>
              </div>
              <div v-if="loading" class="npc-empty">加载中...</div>
              <div v-else-if="!npcs.length" class="npc-empty">
                暂无 NPC。AI 回复中出现的角色会自动识别。
              </div>
              <div v-else class="npc-list">
                <button
                  v-for="npc in npcs"
                  :key="npc.name"
                  class="npc-item"
                  :class="{ active: npc.name === selectedNpc }"
                  type="button"
                  @click="selectNpc(npc.name)"
                >
                  <span class="npc-item-name">{{ npc.name }}</span>
                  <span class="npc-item-counts">
                    <span title="记忆数" class="npc-badge">🧠 {{ npc.memoryCount }}</span>
                    <span title="行为规则数" class="npc-badge">⚡ {{ npc.behaviorCount }}</span>
                  </span>
                </button>
              </div>
            </div>

            <!-- NPC Detail -->
            <div v-if="selectedNpc" class="npc-detail-section">
              <div class="npc-detail-header">
                <h3>{{ selectedNpc }}</h3>
                <div class="npc-detail-metrics">
                  <span>{{ selectedNpcStats.memoryCount }} 记忆</span>
                  <span>{{ selectedNpcStats.behaviorCount }} 行为</span>
                  <button
                    class="npc-detail-remove"
                    type="button"
                    title="从列表移除"
                    @click="removeSelectedNpc"
                  >
                    <Trash2 :size="13" />
                    <span>移除</span>
                  </button>
                </div>
              </div>

              <div class="npc-tabs">
                <button
                  class="npc-tab"
                  :class="{ active: detailTab === 'memories' }"
                  type="button"
                  @click="detailTab = 'memories'"
                >
                  <Brain :size="15" />
                  <span>记忆 ({{ memories.length }})</span>
                </button>
                <button
                  class="npc-tab"
                  :class="{ active: detailTab === 'behaviors' }"
                  type="button"
                  @click="detailTab = 'behaviors'"
                >
                  <Zap :size="15" />
                  <span>行为 ({{ behaviors.length }})</span>
                </button>
              </div>

              <div v-if="detailLoading" class="npc-empty">加载中...</div>

              <!-- Memories Tab -->
              <template v-else-if="detailTab === 'memories'">
                <button
                  v-if="!addMemoryOpen"
                  class="npc-add-button"
                  type="button"
                  @click="addMemoryOpen = true"
                >
                  <Plus :size="15" />
                  <span>添加记忆</span>
                </button>
                <div v-if="addMemoryOpen" class="npc-form">
                  <select v-model="memoryForm.memoryType" class="npc-select">
                    <option v-for="opt in memoryTypeOptions" :key="opt.value" :value="opt.value">
                      {{ opt.label }}
                    </option>
                  </select>
                  <textarea
                    v-model="memoryForm.content"
                    class="npc-textarea"
                    rows="3"
                    placeholder="输入 NPC 记忆内容..."
                  />
                  <div class="npc-form-actions">
                    <button class="npc-save" type="button" @click="submitMemory">保存</button>
                    <button class="npc-cancel" type="button" @click="addMemoryOpen = false">取消</button>
                  </div>
                </div>
                <div v-if="!memories.length && !addMemoryOpen" class="npc-empty">
                  暂无记忆
                </div>
                <div v-else class="npc-list">
                  <div v-for="mem in memories" :key="mem.id" class="npc-card">
                    <div class="npc-card-header">
                      <span class="npc-card-type">{{ memoryTypeLabel(mem.memoryType) }}</span>
                      <span class="npc-card-time">{{ formatTime(mem.createdAt) }}</span>
                      <button
                        class="npc-card-delete"
                        type="button"
                        title="删除"
                        @click="removeMemory(mem.id)"
                      >
                        <Trash2 :size="14" />
                      </button>
                    </div>
                    <p class="npc-card-content">{{ mem.content }}</p>
                  </div>
                </div>
              </template>

              <!-- Behaviors Tab -->
              <template v-else-if="detailTab === 'behaviors'">
                <button
                  v-if="!addBehaviorOpen"
                  class="npc-add-button"
                  type="button"
                  @click="addBehaviorOpen = true"
                >
                  <Plus :size="15" />
                  <span>添加行为规则</span>
                </button>
                <div v-if="addBehaviorOpen" class="npc-form">
                  <select v-model="behaviorForm.behaviorType" class="npc-select">
                    <option v-for="opt in behaviorTypeOptions" :key="opt.value" :value="opt.value">
                      {{ opt.label }}
                    </option>
                  </select>
                  <input
                    v-model="behaviorForm.triggerCondition"
                    class="npc-input"
                    placeholder="触发条件（可选）"
                  />
                  <textarea
                    v-model="behaviorForm.action"
                    class="npc-textarea"
                    rows="3"
                    placeholder="行为动作描述..."
                  />
                  <label class="npc-priority-label">
                    优先级
                    <input
                      v-model.number="behaviorForm.priority"
                      type="range"
                      min="0"
                      max="100"
                      class="npc-range"
                    />
                    <span>{{ behaviorForm.priority }}</span>
                  </label>
                  <label class="npc-checkbox-label">
                    <input v-model="behaviorForm.enabled" type="checkbox" />
                    <span>启用</span>
                  </label>
                  <div class="npc-form-actions">
                    <button class="npc-save" type="button" @click="submitBehavior">保存</button>
                    <button class="npc-cancel" type="button" @click="addBehaviorOpen = false">取消</button>
                  </div>
                </div>
                <div v-if="!behaviors.length && !addBehaviorOpen" class="npc-empty">
                  暂无行为规则
                </div>
                <div v-else class="npc-list">
                  <div
                    v-for="beh in behaviors"
                    :key="beh.id"
                    class="npc-card"
                    :class="{ disabled: !beh.enabled }"
                  >
                    <div class="npc-card-header">
                      <span class="npc-card-type">{{ behaviorTypeLabel(beh.behaviorType) }}</span>
                      <span class="npc-card-priority" title="优先级">P{{ beh.priority }}</span>
                      <button
                        class="npc-card-toggle"
                        type="button"
                        :title="beh.enabled ? '点击禁用' : '点击启用'"
                        @click="toggleBehavior(beh)"
                      >
                        {{ beh.enabled ? '✓' : '✗' }}
                      </button>
                      <button
                        class="npc-card-delete"
                        type="button"
                        title="删除"
                        @click="removeBehavior(beh.id)"
                      >
                        <Trash2 :size="14" />
                      </button>
                    </div>
                    <p v-if="beh.triggerCondition" class="npc-card-trigger">
                      触发：{{ beh.triggerCondition }}
                    </p>
                    <p class="npc-card-content">{{ beh.action }}</p>
                  </div>
                </div>
              </template>
            </div>

            <div v-else-if="!loading && npcs.length" class="npc-empty npc-select-hint">
              ← 点击左侧 NPC 查看详情
            </div>
          </div>
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.npc-panel-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  justify-content: flex-end;
  background: color-mix(in srgb, #0c0b0a 46%, transparent);
  backdrop-filter: blur(3px);
}

.npc-panel {
  width: min(520px, 94vw);
  height: 100%;
  transform: none !important;
  border-left: 1px solid color-mix(in srgb, var(--line, #2a2a3e) 78%, transparent);
  background:
    linear-gradient(180deg,
      color-mix(in srgb, var(--surface, #1a1a2e) 96%, transparent),
      color-mix(in srgb, var(--bg, #11111f) 82%, transparent));
  color: var(--text, #e8e6e3);
  display: flex;
  flex-direction: column;
  box-shadow: -18px 0 52px rgba(0, 0, 0, 0.26);
}

.npc-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--line, #2a2a3e) 70%, transparent);
  background: color-mix(in srgb, var(--surface, #1a1a2e) 86%, transparent);
  backdrop-filter: blur(14px);
}

.npc-panel-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.npc-panel-title h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
}

.npc-close {
  background: none;
  border: none;
  color: var(--text-muted, #888);
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  display: flex;
  align-items: center;
}
.npc-close:hover {
  background: var(--hover, rgba(255,255,255,0.08));
  color: var(--text, #e8e6e3);
}

.npc-panel-body {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  scrollbar-gutter: stable;
}

.npc-panel-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--line, #2a2a3e) 64%, transparent);
  background: color-mix(in srgb, var(--surface, #1a1a2e) 78%, transparent);
}

.npc-summary-card {
  display: grid;
  gap: 3px;
  padding: 10px;
  border: 1px solid color-mix(in srgb, var(--line, #2a2a3e) 72%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--surface, #1a1a2e) 70%, transparent);
}

.npc-summary-card span {
  color: var(--text-muted, #888);
  font-size: 12px;
  font-weight: 700;
}

.npc-summary-card strong {
  color: var(--text, #e8e6e3);
  font-size: 20px;
  line-height: 1;
}

.npc-summary-card.memory strong {
  color: #8f6ee8;
}

.npc-summary-card.behavior strong {
  color: #2f9f7b;
}

.npc-list-section {
  border-bottom: 1px solid color-mix(in srgb, var(--line, #2a2a3e) 64%, transparent);
  max-height: 240px;
  overflow-y: auto;
}

.npc-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px 6px;
  font-size: 13px;
  color: var(--text-muted, #888);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.npc-list-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.npc-empty-remove {
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid color-mix(in srgb, #ef4444 28%, var(--line, #2a2a3e));
  border-radius: 8px;
  color: #ef4444;
  background: color-mix(in srgb, #ef4444 7%, transparent);
  font: inherit;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.npc-empty-remove:hover:not(:disabled) {
  background: color-mix(in srgb, #ef4444 13%, transparent);
}

.npc-empty-remove:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

.npc-refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid color-mix(in srgb, var(--line, #2a2a3e) 72%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface, #1a1a2e) 70%, transparent);
  color: var(--text-muted, #888);
  cursor: pointer;
}
.npc-refresh:hover {
  background: var(--hover, rgba(255,255,255,0.08));
  color: var(--accent, #818cf8);
}

.npc-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 12px 10px;
}

.npc-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: color-mix(in srgb, var(--surface, #1a1a2e) 50%, transparent);
  color: var(--text, #e8e6e3);
  cursor: pointer;
  text-align: left;
  font-size: 14px;
  transition: background 0.15s;
}
.npc-item:hover {
  border-color: color-mix(in srgb, var(--accent, #818cf8) 26%, transparent);
  background: var(--hover, rgba(255,255,255,0.06));
}
.npc-item.active {
  border-color: color-mix(in srgb, var(--accent, #818cf8) 38%, transparent);
  background: var(--accent-bg, rgba(99, 102, 241, 0.15));
  color: var(--accent, #818cf8);
}

.npc-item-name {
  font-weight: 500;
}

.npc-item-counts {
  display: flex;
  gap: 8px;
}

.npc-badge {
  font-size: 12px;
  opacity: 0.7;
}

.npc-detail-section {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

.npc-detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px 4px;
}

.npc-detail-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
}

.npc-detail-metrics {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.npc-detail-metrics span {
  padding: 2px 7px;
  border: 1px solid color-mix(in srgb, var(--line, #2a2a3e) 70%, transparent);
  border-radius: 999px;
  color: var(--text-muted, #888);
  background: color-mix(in srgb, var(--surface, #1a1a2e) 62%, transparent);
  font-size: 11px;
  font-weight: 700;
}

.npc-detail-remove {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 24px;
  padding: 2px 8px;
  border: 1px solid color-mix(in srgb, #ef4444 32%, var(--line, #2a2a3e));
  border-radius: 999px;
  color: #ef4444;
  background: color-mix(in srgb, #ef4444 8%, transparent);
  font: inherit;
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
}

.npc-detail-remove:hover {
  background: color-mix(in srgb, #ef4444 14%, transparent);
}

.npc-tabs {
  display: flex;
  gap: 8px;
  padding: 10px 20px;
  border-bottom: 1px solid color-mix(in srgb, var(--line, #2a2a3e) 64%, transparent);
}

.npc-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: none;
  border: none;
  border-radius: 8px;
  color: var(--text-muted, #888);
  cursor: pointer;
  font-size: 13px;
  transition: all 0.15s;
}
.npc-tab:hover {
  background: var(--hover, rgba(255,255,255,0.06));
}
.npc-tab.active {
  background: var(--accent-bg, rgba(99, 102, 241, 0.15));
  color: var(--accent, #818cf8);
}

.npc-add-button {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 12px 20px;
  padding: 8px 14px;
  background: var(--accent-bg, rgba(99, 102, 241, 0.12));
  border: 1px dashed color-mix(in srgb, var(--accent, #818cf8) 70%, transparent);
  border-radius: 10px;
  color: var(--accent, #818cf8);
  cursor: pointer;
  font-size: 13px;
  transition: background 0.15s;
}
.npc-add-button:hover {
  background: var(--accent-bg-hover, rgba(99, 102, 241, 0.2));
}

.npc-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 12px 20px;
  padding: 14px;
  background: color-mix(in srgb, var(--surface-raised, #22223a) 90%, transparent);
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--line, #2a2a3e) 70%, transparent);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.12);
}

.npc-select,
.npc-input,
.npc-textarea {
  width: 100%;
  padding: 8px 12px;
  background: var(--surface, #1a1a2e);
  border: 1px solid var(--border, #2a2a3e);
  border-radius: 6px;
  color: var(--text, #e8e6e3);
  font-size: 13px;
  font-family: inherit;
  box-sizing: border-box;
}
.npc-textarea {
  resize: vertical;
  min-height: 60px;
}
.npc-input:focus,
.npc-textarea:focus,
.npc-select:focus {
  outline: none;
  border-color: var(--accent, #818cf8);
}

.npc-priority-label {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--text-muted, #888);
}
.npc-range {
  flex: 1;
  accent-color: var(--accent, #818cf8);
}

.npc-checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-muted, #888);
  cursor: pointer;
}
.npc-checkbox-label input {
  accent-color: var(--accent, #818cf8);
}

.npc-form-actions {
  display: flex;
  gap: 8px;
}

.npc-save,
.npc-cancel {
  padding: 6px 16px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.15s;
}
.npc-save {
  background: var(--accent, #818cf8);
  color: #fff;
}
.npc-save:hover {
  opacity: 0.9;
}
.npc-cancel {
  background: var(--hover, rgba(255,255,255,0.08));
  color: var(--text-muted, #888);
}
.npc-cancel:hover {
  background: var(--hover-strong, rgba(255,255,255,0.12));
}

.npc-empty {
  padding: 20px;
  text-align: center;
  color: var(--text-muted, #666);
  font-size: 13px;
}

.npc-select-hint {
  padding-top: 40px;
}

.npc-card {
  padding: 12px 14px;
  background:
    linear-gradient(180deg,
      color-mix(in srgb, var(--surface-raised, #22223a) 92%, transparent),
      color-mix(in srgb, var(--surface, #1a1a2e) 70%, transparent));
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--line, #2a2a3e) 70%, transparent);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.10);
}
.npc-card.disabled {
  opacity: 0.5;
}

.npc-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.npc-card-type {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--accent-bg, rgba(99, 102, 241, 0.12));
  color: var(--accent, #818cf8);
  font-weight: 500;
}

.npc-card-time {
  font-size: 11px;
  color: var(--text-muted, #666);
  margin-left: auto;
}

.npc-card-priority {
  font-size: 11px;
  color: var(--text-muted, #888);
  margin-left: auto;
}

.npc-card-toggle,
.npc-card-delete {
  background: none;
  border: none;
  color: var(--text-muted, #666);
  cursor: pointer;
  padding: 2px;
  border-radius: 4px;
  display: flex;
  align-items: center;
}
.npc-card-toggle:hover {
  color: var(--accent, #818cf8);
}
.npc-card-delete:hover {
  color: #ef4444;
}

.npc-card-trigger {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--text-muted, #888);
}

.npc-card-content {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

/* Transition */
.npc-panel-enter-active,
.npc-panel-leave-active {
  transition: opacity 0.25s ease;
}
.npc-panel-enter-active .npc-panel,
.npc-panel-leave-active .npc-panel {
  transition: none;
}
.npc-panel-enter-from {
  opacity: 0;
}
.npc-panel-enter-from .npc-panel {
  transform: none !important;
}
.npc-panel-leave-to {
  opacity: 0;
}
.npc-panel-leave-to .npc-panel {
  transform: none !important;
}
</style>
