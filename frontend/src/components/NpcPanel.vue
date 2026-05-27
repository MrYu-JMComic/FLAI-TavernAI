<script setup>
import { computed, reactive, ref, watch } from 'vue';
import {
  Brain,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Plus,
  Settings2,
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
  updateNpcBehavior
} from '../api';
import { useNotify } from '../composables/useNotify';

const props = defineProps({
  conversationId: { type: String, required: true },
  open: { type: Boolean, default: false }
});
const emit = defineEmits(['close']);

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
const memoryForm = reactive({ memoryType: 'event', content: '' });
const behaviorForm = reactive({
  behaviorType: 'reaction',
  triggerCondition: '',
  action: '',
  priority: 0,
  enabled: true
});

const selectedNpcData = computed(() => npcs.value.find((n) => n.name === selectedNpc.value) || null);

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

watch(() => props.open, async (isOpen) => {
  if (isOpen) await loadNpcs();
});

async function loadNpcs() {
  if (!props.conversationId) return;
  loading.value = true;
  try {
    npcs.value = await fetchConversationNpcs(props.conversationId);
    if (selectedNpc.value && !npcs.value.find((n) => n.name === selectedNpc.value)) {
      selectedNpc.value = '';
    }
    if (!selectedNpc.value && npcs.value.length > 0) {
      selectedNpc.value = npcs.value[0].name;
    }
  } catch (err) {
    notify.error(err.message || '加载 NPC 列表失败');
  } finally {
    loading.value = false;
  }
}

async function selectNpc(name) {
  selectedNpc.value = name;
  addMemoryOpen.value = false;
  addBehaviorOpen.value = false;
  await loadNpcDetail();
}

async function loadNpcDetail() {
  if (!selectedNpc.value) return;
  detailLoading.value = true;
  try {
    const [mem, beh] = await Promise.all([
      fetchNpcMemories(props.conversationId, selectedNpc.value),
      fetchNpcBehaviors(props.conversationId, selectedNpc.value)
    ]);
    memories.value = mem;
    behaviors.value = beh;
  } catch (err) {
    notify.error(err.message || '加载 NPC 详情失败');
  } finally {
    detailLoading.value = false;
  }
}

async function submitMemory() {
  if (!memoryForm.content.trim()) {
    notify.warning('请输入记忆内容');
    return;
  }
  try {
    const mem = await addNpcMemory(props.conversationId, selectedNpc.value, {
      memoryType: memoryForm.memoryType,
      content: memoryForm.content.trim()
    });
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
  try {
    await deleteNpcMemory(props.conversationId, selectedNpc.value, memoryId);
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
  try {
    const beh = await addNpcBehavior(props.conversationId, selectedNpc.value, {
      behaviorType: behaviorForm.behaviorType,
      triggerCondition: behaviorForm.triggerCondition.trim(),
      action: behaviorForm.action.trim(),
      priority: behaviorForm.priority,
      enabled: behaviorForm.enabled
    });
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
  try {
    const updated = await updateNpcBehavior(props.conversationId, selectedNpc.value, behavior.id, {
      enabled: !behavior.enabled
    });
    Object.assign(behavior, updated);
  } catch (err) {
    notify.error(err.message || '更新失败');
  }
}

async function removeBehavior(behaviorId) {
  try {
    await deleteNpcBehavior(props.conversationId, selectedNpc.value, behaviorId);
    behaviors.value = behaviors.value.filter((b) => b.id !== behaviorId);
    await loadNpcs();
    notify.success('行为规则已删除');
  } catch (err) {
    notify.error(err.message || '删除行为规则失败');
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
    <Transition name="npc-panel">
      <div v-if="open" class="npc-panel-overlay" @click.self="emit('close')">
        <aside class="npc-panel" role="dialog" aria-label="NPC 管理面板">
          <header class="npc-panel-header">
            <div class="npc-panel-title">
              <Users :size="20" />
              <h2>NPC 管理</h2>
            </div>
            <button class="npc-close" type="button" @click="emit('close')">
              <X :size="18" />
            </button>
          </header>

          <div class="npc-panel-body">
            <!-- NPC List -->
            <div class="npc-list-section">
              <div class="npc-list-header">
                <span>NPC 列表</span>
                <button class="npc-refresh" type="button" title="刷新" @click="loadNpcs">↻</button>
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
    </Transition>
  </Teleport>
</template>

<style scoped>
.npc-panel-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  justify-content: flex-end;
}

.npc-panel {
  width: min(440px, 92vw);
  height: 100%;
  background: var(--surface, #1a1a2e);
  color: var(--text, #e8e6e3);
  display: flex;
  flex-direction: column;
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.3);
}

.npc-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border, #2a2a3e);
}

.npc-panel-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.npc-panel-title h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
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
}

.npc-list-section {
  border-bottom: 1px solid var(--border, #2a2a3e);
  max-height: 200px;
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

.npc-refresh {
  background: none;
  border: none;
  color: var(--text-muted, #888);
  cursor: pointer;
  font-size: 16px;
  padding: 2px 6px;
  border-radius: 4px;
}
.npc-refresh:hover {
  background: var(--hover, rgba(255,255,255,0.08));
}

.npc-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 12px 8px;
}

.npc-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: none;
  border: none;
  border-radius: 8px;
  color: var(--text, #e8e6e3);
  cursor: pointer;
  text-align: left;
  font-size: 14px;
  transition: background 0.15s;
}
.npc-item:hover {
  background: var(--hover, rgba(255,255,255,0.06));
}
.npc-item.active {
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
  padding: 14px 20px 0;
}

.npc-detail-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.npc-tabs {
  display: flex;
  gap: 4px;
  padding: 10px 20px;
  border-bottom: 1px solid var(--border, #2a2a3e);
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
  border: 1px dashed var(--accent, #818cf8);
  border-radius: 8px;
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
  background: var(--surface-raised, #22223a);
  border-radius: 10px;
  border: 1px solid var(--border, #2a2a3e);
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
  padding: 10px 14px;
  background: var(--surface-raised, #22223a);
  border-radius: 8px;
  border: 1px solid var(--border, #2a2a3e);
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
  transition: transform 0.25s ease;
}
.npc-panel-enter-from {
  opacity: 0;
}
.npc-panel-enter-from .npc-panel {
  transform: translateX(100%);
}
.npc-panel-leave-to {
  opacity: 0;
}
.npc-panel-leave-to .npc-panel {
  transform: translateX(100%);
}
</style>
