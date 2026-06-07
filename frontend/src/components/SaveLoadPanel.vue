<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  FolderOpen,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
  X
} from '@lucide/vue';
import {
  createSave,
  deleteSave,
  fetchSaves,
  loadSave,
  renameSave
} from '../api';
import { useNotify } from '../composables/useNotify';

const props = defineProps({
  conversationId: {
    type: String,
    required: true
  },
  open: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['close', 'loaded']);

const notify = useNotify();
const saves = ref([]);
const loading = ref(false);
const loadError = ref('');
const saving = ref(false);
const saveName = ref('');
const renamingId = ref('');
const renameValue = ref('');
const busyId = ref('');
let savesLoadToken = 0;
let savesMutationToken = 0;
let savePanelDisposed = false;

const sortedSaves = computed(() => [...saves.value]);

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    loadSaves();
  }
});

watch(() => props.conversationId, () => {
  resetSavePanelState();
  if (props.open) {
    loadSaves();
  }
});

onMounted(() => {
  if (props.open) {
    loadSaves();
  }
});

onBeforeUnmount(() => {
  savePanelDisposed = true;
  savesLoadToken += 1;
  savesMutationToken += 1;
});

function resetSavePanelState() {
  savesLoadToken += 1;
  savesMutationToken += 1;
  saves.value = [];
  saveName.value = '';
  loadError.value = '';
  renamingId.value = '';
  renameValue.value = '';
  busyId.value = '';
  loading.value = false;
  saving.value = false;
}

async function loadSaves() {
  if (savePanelDisposed) return;
  const conversationId = props.conversationId;
  if (!conversationId) {
    resetSavePanelState();
    return;
  }
  const requestToken = ++savesLoadToken;
  loading.value = true;
  loadError.value = '';
  try {
    const nextSaves = await fetchSaves(conversationId);
    if (!isCurrentSaveLoad(requestToken, conversationId)) return;
    saves.value = nextSaves;
  } catch (err) {
    if (!isCurrentSaveLoad(requestToken, conversationId)) return;
    loadError.value = err.message || '加载存档列表失败';
    saves.value = [];
    notify.error(loadError.value);
  } finally {
    if (isCurrentSaveLoad(requestToken, conversationId)) {
      loading.value = false;
    }
  }
}

function isCurrentSaveLoad(requestToken, conversationId) {
  return !savePanelDisposed && requestToken === savesLoadToken && conversationId === props.conversationId;
}

function isCurrentSaveMutation(mutationToken, conversationId) {
  return !savePanelDisposed && mutationToken === savesMutationToken && conversationId === props.conversationId;
}

async function doCreateSave() {
  if (saving.value) return;
  const conversationId = props.conversationId;
  if (!conversationId) return;
  const mutationToken = savesMutationToken;
  saving.value = true;
  try {
    const created = await createSave(conversationId, { name: saveName.value.trim() });
    if (!isCurrentSaveMutation(mutationToken, conversationId)) return;
    saves.value = [created, ...saves.value];
    saveName.value = '';
    notify.success('存档已创建');
  } catch (err) {
    if (!isCurrentSaveMutation(mutationToken, conversationId)) return;
    notify.error(err.message || '存档失败');
  } finally {
    if (isCurrentSaveMutation(mutationToken, conversationId)) {
      saving.value = false;
    }
  }
}

async function doLoadSave(item) {
  if (busyId.value) return;
  if (!window.confirm(`读取存档「${item.name}」？当前会话消息将被替换。`)) return;
  const conversationId = props.conversationId;
  if (!conversationId) return;
  const mutationToken = savesMutationToken;
  busyId.value = item.id;
  try {
    const result = await loadSave(item.id);
    if (!isCurrentSaveMutation(mutationToken, conversationId)) return;
    notify.success(`已恢复 ${result.messageCount} 条消息`);
    emit('loaded', result);
  } catch (err) {
    if (!isCurrentSaveMutation(mutationToken, conversationId)) return;
    notify.error(err.message || '读档失败');
  } finally {
    if (isCurrentSaveMutation(mutationToken, conversationId)) {
      busyId.value = '';
    }
  }
}

async function doDeleteSave(item) {
  if (busyId.value) return;
  if (!window.confirm(`删除存档「${item.name}」？此操作不可撤销。`)) return;
  const conversationId = props.conversationId;
  if (!conversationId) return;
  const mutationToken = savesMutationToken;
  busyId.value = item.id;
  try {
    await deleteSave(item.id);
    if (!isCurrentSaveMutation(mutationToken, conversationId)) return;
    saves.value = saves.value.filter((s) => s.id !== item.id);
    notify.success('存档已删除');
  } catch (err) {
    if (!isCurrentSaveMutation(mutationToken, conversationId)) return;
    notify.error(err.message || '删除失败');
  } finally {
    if (isCurrentSaveMutation(mutationToken, conversationId)) {
      busyId.value = '';
    }
  }
}

function beginRename(item) {
  renamingId.value = item.id;
  renameValue.value = item.name;
}

function cancelRename() {
  renamingId.value = '';
  renameValue.value = '';
}

async function doRename(item) {
  const name = renameValue.value.trim();
  if (!name || busyId.value) return;
  const conversationId = props.conversationId;
  if (!conversationId) return;
  const mutationToken = savesMutationToken;
  busyId.value = item.id;
  try {
    const updated = await renameSave(item.id, name);
    if (!isCurrentSaveMutation(mutationToken, conversationId)) return;
    const index = saves.value.findIndex((s) => s.id === item.id);
    if (index !== -1) {
      saves.value[index] = { ...saves.value[index], name: updated.name };
    }
    cancelRename();
    notify.success('存档名已更新');
  } catch (err) {
    if (!isCurrentSaveMutation(mutationToken, conversationId)) return;
    notify.error(err.message || '重命名失败');
  } finally {
    if (isCurrentSaveMutation(mutationToken, conversationId)) {
      busyId.value = '';
    }
  }
}

function formatTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return iso;
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="save-panel">
      <div v-if="open" class="save-panel-backdrop" @click.self="emit('close')">
        <div class="save-panel" role="dialog" aria-label="存档管理">
          <header class="save-panel-header">
            <div>
              <h2>存档管理</h2>
              <p>保存和恢复会话状态</p>
            </div>
            <button
              class="save-panel-close"
              type="button"
              title="关闭"
              aria-label="关闭存档管理"
              @click="emit('close')"
            >
              <X :size="18" />
            </button>
          </header>

          <div class="save-panel-create">
            <input
              v-model="saveName"
              class="save-name-input"
              type="text"
              placeholder="存档名称（可留空自动生成）"
              maxlength="80"
              aria-label="新存档名称"
              @keydown.enter.prevent="doCreateSave"
            />
            <button
              class="save-create-button"
              type="button"
              :disabled="saving"
              @click="doCreateSave"
            >
              <Save :size="15" />
              <span>{{ saving ? '保存中...' : '一键存档' }}</span>
            </button>
          </div>

          <div class="save-panel-list">
            <p v-if="loading" class="save-empty">正在加载存档...</p>
            <div v-else-if="loadError" class="save-empty save-error-state">
              <p>{{ loadError }}</p>
              <button class="save-retry-button" type="button" @click="loadSaves">
                <RefreshCw :size="14" />
                <span>重试</span>
              </button>
            </div>
            <p v-else-if="!sortedSaves.length" class="save-empty">暂无存档，点击上方按钮创建第一个存档</p>
            <div
              v-for="item in sortedSaves"
              :key="item.id"
              class="save-item"
              :class="{ busy: busyId === item.id }"
            >
              <div class="save-item-body">
                <div v-if="renamingId === item.id" class="save-rename-row">
                  <input
                    v-model="renameValue"
                    class="save-rename-input"
                    type="text"
                    maxlength="80"
                    aria-label="存档新名称"
                    @keydown.enter.prevent="doRename(item)"
                    @keydown.esc.prevent="cancelRename"
                  />
                  <button
                    class="save-mini-button"
                    type="button"
                    aria-label="保存存档名称"
                    @click="doRename(item)"
                  >
                    <Save :size="13" />
                  </button>
                  <button
                    class="save-mini-button"
                    type="button"
                    aria-label="取消重命名"
                    @click="cancelRename"
                  >
                    <X :size="13" />
                  </button>
                </div>
                <template v-else>
                  <strong class="save-item-name">{{ item.name }}</strong>
                  <small class="save-item-time">{{ formatTime(item.createdAt) }}</small>
                </template>
                <p class="save-item-preview" :title="item.preview">{{ item.preview || '无预览' }}</p>
              </div>
              <div class="save-item-actions">
                <button
                  class="save-action-button"
                  type="button"
                  title="读档"
                  aria-label="读取存档"
                  :disabled="busyId === item.id"
                  @click="doLoadSave(item)"
                >
                  <FolderOpen :size="14" />
                </button>
                <button
                  class="save-action-button"
                  type="button"
                  title="重命名"
                  aria-label="重命名存档"
                  :disabled="busyId === item.id"
                  @click="beginRename(item)"
                >
                  <Pencil :size="14" />
                </button>
                <button
                  class="save-action-button danger"
                  type="button"
                  title="删除"
                  aria-label="删除存档"
                  :disabled="busyId === item.id"
                  @click="doDeleteSave(item)"
                >
                  <Trash2 :size="14" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.save-panel-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  justify-content: flex-end;
  background: rgba(0, 0, 0, 0.28);
}

.save-panel {
  width: min(400px, 92vw);
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--surface, #fffaf2);
  box-shadow: var(--shadow, 0 18px 48px rgba(67, 45, 30, 0.14));
  overflow: hidden;
}

.save-panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 20px 20px 12px;
  border-bottom: 1px solid var(--line, rgba(62, 48, 38, 0.14));
}

.save-panel-header h2 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
}

.save-panel-header p {
  margin: 4px 0 0;
  font-size: 0.82rem;
  color: var(--muted, #75685e);
}

.save-panel-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--muted, #75685e);
  transition: background 0.15s;
}

.save-panel-close:hover {
  background: var(--surface-strong, #fff4e3);
}

.save-panel-create {
  display: flex;
  gap: 8px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--line, rgba(62, 48, 38, 0.14));
}

.save-name-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--line, rgba(62, 48, 38, 0.14));
  border-radius: 8px;
  background: var(--bg, #f6efe4);
  color: var(--text, #241f1b);
  font-size: 0.88rem;
  outline: none;
  transition: border-color 0.15s;
}

.save-name-input:focus {
  border-color: var(--primary, #8f3f2f);
}

.save-create-button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: none;
  border-radius: 8px;
  background: var(--primary, #8f3f2f);
  color: #fff;
  font-size: 0.85rem;
  font-weight: 600;
  white-space: nowrap;
  transition: background 0.15s;
}

.save-create-button:hover:not(:disabled) {
  background: var(--primary-strong, #6f2f25);
}

.save-panel-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px 20px;
}

.save-empty {
  text-align: center;
  padding: 32px 0;
  color: var(--muted, #75685e);
  font-size: 0.88rem;
}

.save-empty p {
  margin: 0;
}

.save-error-state {
  display: grid;
  justify-items: center;
  gap: 10px;
}

.save-retry-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid var(--line, rgba(62, 48, 38, 0.14));
  border-radius: 8px;
  background: var(--surface, #fffaf2);
  color: var(--text, #241f1b);
  font-size: 0.82rem;
  font-weight: 700;
  transition: border-color 0.15s, background 0.15s;
}

.save-retry-button:hover {
  border-color: color-mix(in srgb, var(--primary, #8f3f2f) 35%, var(--line, rgba(62, 48, 38, 0.14)));
  background: var(--surface-strong, #fff4e3);
}

.save-item {
  display: flex;
  gap: 8px;
  padding: 12px;
  margin-bottom: 8px;
  border: 1px solid var(--line, rgba(62, 48, 38, 0.14));
  border-radius: 10px;
  background: var(--bg, #f6efe4);
  transition: opacity 0.15s;
}

.save-item.busy {
  opacity: 0.5;
  pointer-events: none;
}

.save-item-body {
  flex: 1;
  min-width: 0;
}

.save-item-name {
  display: block;
  font-size: 0.9rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.save-item-time {
  display: block;
  font-size: 0.75rem;
  color: var(--muted, #75685e);
  margin-top: 2px;
}

.save-item-preview {
  margin: 6px 0 0;
  font-size: 0.8rem;
  color: var(--muted, #75685e);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.save-item-actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
}

.save-action-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--muted, #75685e);
  transition: background 0.15s, color 0.15s;
}

.save-action-button:hover:not(:disabled) {
  background: var(--surface-strong, #fff4e3);
  color: var(--text, #241f1b);
}

.save-action-button.danger:hover:not(:disabled) {
  background: rgba(184, 50, 50, 0.1);
  color: var(--danger, #b83232);
}

.save-rename-row {
  display: flex;
  gap: 4px;
  align-items: center;
}

.save-rename-input {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid var(--primary, #8f3f2f);
  border-radius: 6px;
  background: var(--surface, #fffaf2);
  color: var(--text, #241f1b);
  font-size: 0.85rem;
  outline: none;
}

.save-mini-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--muted, #75685e);
  transition: background 0.15s;
}

.save-mini-button:hover {
  background: var(--surface-strong, #fff4e3);
}

/* Transition */
.save-panel-enter-active,
.save-panel-leave-active {
  transition: opacity 0.2s ease;
}

.save-panel-enter-active .save-panel,
.save-panel-leave-active .save-panel {
  transition: transform 0.25s ease;
}

.save-panel-enter-from,
.save-panel-leave-to {
  opacity: 0;
}

.save-panel-enter-from .save-panel,
.save-panel-leave-to .save-panel {
  transform: translateX(100%);
}

/* ── Mobile Responsive ── */

@media (max-width: 768px) {
  .save-panel {
    width: 100vw;
    max-width: none;
  }
}

@media (max-width: 480px) {
  .save-panel {
    width: 100vw;
    max-width: none;
  }

  .save-panel-create {
    flex-direction: column;
    gap: 6px;
    padding: 10px 14px;
  }

  .save-name-input {
    font-size: 16px; /* prevent iOS zoom */
  }

  .save-panel-header {
    padding: 14px 14px 10px;
  }

  .save-panel-list {
    padding: 10px 14px;
  }

  .save-item {
    padding: 10px;
  }

  .save-item-actions {
    flex-direction: row;
    gap: 4px;
  }

  .save-action-button {
    width: 36px;
    height: 36px;
  }
}
</style>
