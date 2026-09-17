<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Archive, Check, ChevronDown, GitMerge, Pencil, Pin, PinOff, Plus, RefreshCw, RotateCcw, Trash2, X } from '@lucide/vue';
import { apiRequest } from '../../api/core.js';
import { useNotify } from '../../composables/useNotify';
import CastConfirmDialog from '../cast/CastConfirmDialog.vue';

const props = defineProps({
  conversationId: { type: String, required: true },
  open: { type: Boolean, default: true },
  refreshKey: { type: [String, Number], default: 0 }
});
const emit = defineEmits(['changed']);
const notify = useNotify();
const memories = ref([]);
const conflicts = ref([]);
const selected = ref(new Set());
const loading = ref(false);
const busy = ref(false);
const includeArchived = ref(false);
const editor = ref(null);
const mergeCandidate = ref(null);
const lastMergeOperationId = ref('');
const error = ref('');
const deleteCandidate = ref(null);
let loadToken = 0;
let mutationToken = 0;
let disposed = false;

const selectedMemories = computed(() => memories.value.filter((memory) => selected.value.has(memory.id)));
const visibleMemories = computed(() => memories.value.filter((memory) => includeArchived.value || !memory.archived));
const canMerge = computed(() => selectedMemories.value.filter((memory) => !memory.archived).length >= 2);

async function load() {
  const conversationId = props.conversationId;
  if (!props.open || !conversationId) return;
  const token = ++loadToken;
  loading.value = true;
  error.value = '';
  try {
    const query = includeArchived.value ? '?includeArchived=1' : '';
    const [memoryResult, conflictResult] = await Promise.all([
      apiRequest(`/api/conversations/${encodeURIComponent(conversationId)}/memories${query}`),
      apiRequest(`/api/conversations/${encodeURIComponent(conversationId)}/memories/conflicts`)
    ]);
    if (disposed || token !== loadToken || conversationId !== props.conversationId) return;
    memories.value = Array.isArray(memoryResult?.memories) ? memoryResult.memories : [];
    conflicts.value = Array.isArray(conflictResult?.candidates) ? conflictResult.candidates : [];
    selected.value = new Set([...selected.value].filter((id) => memories.value.some((memory) => memory.id === id)));
  } catch (failure) {
    if (disposed || token !== loadToken) return;
    error.value = failure?.message || '记忆加载失败';
  } finally {
    if (!disposed && token === loadToken) loading.value = false;
  }
}

function openCreate() {
  editor.value = { id: '', revision: 0, memoryType: 'event', subject: '', content: '', confidence: 1, enabled: true };
}
function openEdit(memory) { editor.value = { ...memory }; }
function toggle(memory) {
  const next = new Set(selected.value);
  next.has(memory.id) ? next.delete(memory.id) : next.add(memory.id);
  selected.value = next;
}

async function request(path, options, success, refreshContext = true) {
  if (busy.value) return null;
  const conversationId = props.conversationId;
  const token = ++mutationToken;
  busy.value = true;
  error.value = '';
  try {
    const result = await apiRequest(`/api/conversations/${encodeURIComponent(conversationId)}/memories${path}`, options);
    if (!isCurrentMutation(conversationId, token)) return null;
    notify.success(success);
    if (refreshContext) emit('changed', result);
    await load();
    return isCurrentMutation(conversationId, token) ? result : null;
  } catch (failure) {
    if (!isCurrentMutation(conversationId, token)) return null;
    error.value = failure?.message || '记忆操作失败';
    notify.error(error.value);
    return null;
  } finally {
    if (isCurrentMutation(conversationId, token)) busy.value = false;
  }
}

function isCurrentMutation(conversationId, token) {
  return !disposed && conversationId === props.conversationId && token === mutationToken;
}

async function saveEditor() {
  const form = editor.value;
  if (!form?.content?.trim()) { error.value = '记忆内容不能为空'; return; }
  const path = form.id ? `/${encodeURIComponent(form.id)}` : '';
  const result = await request(path, {
    method: form.id ? 'PUT' : 'POST',
    body: JSON.stringify({ memoryType: form.memoryType, subject: form.subject, content: form.content, confidence: Number(form.confidence), enabled: form.enabled, revision: form.revision })
  }, form.id ? '记忆已更新' : '记忆已创建');
  if (result) editor.value = null;
}

async function singleAction(memory, action) {
  if (action === 'delete') {
    deleteCandidate.value = memory;
    return;
  }
  const labels = { confirm: '记忆已确认', disable: '记忆已禁用', rollback: '记忆已归档' };
  await request(`/${encodeURIComponent(memory.id)}/${action}`, { method: 'POST' }, labels[action]);
}

async function confirmDelete() {
  const memory = deleteCandidate.value;
  if (!memory) return;
  const result = await request(`/${encodeURIComponent(memory.id)}`, { method: 'DELETE' }, '记忆已删除');
  if (result) deleteCandidate.value = null;
}

async function togglePin(memory) {
  await request(`/${encodeURIComponent(memory.id)}/pin`, {
    method: 'POST', body: JSON.stringify({ pinned: !memory.pinned, revision: memory.revision })
  }, memory.pinned ? '已取消置顶' : '记忆已置顶');
}

async function batch(action) {
  const items = selectedMemories.value.map(({ id, revision }) => ({ id, revision }));
  const labels = { confirm: '所选记忆已确认', disable: '所选记忆已禁用', invalidate: '所选记忆已标记失效' };
  const result = await request('/batch', { method: 'POST', body: JSON.stringify({ action, items }) }, labels[action]);
  if (result) selected.value = new Set();
}

function beginMerge(candidate = null) {
  const pool = candidate?.memories || selectedMemories.value.filter((memory) => !memory.archived);
  if (pool.length < 2) return;
  const target = pool.find((memory) => memory.pinned) || pool[0];
  mergeCandidate.value = { memories: pool, targetId: target.id, subject: target.subject, content: target.content };
}

async function merge() {
  const draft = mergeCandidate.value;
  const target = draft?.memories.find((memory) => memory.id === draft.targetId);
  if (!target || !draft.content.trim()) return;
  const result = await request('/merge', {
    method: 'POST', body: JSON.stringify({
      targetId: target.id, targetRevision: target.revision,
      sourceItems: draft.memories.filter((memory) => memory.id !== target.id).map(({ id, revision }) => ({ id, revision })),
      subject: draft.subject, content: draft.content
    })
  }, '记忆已合并');
  if (result) { lastMergeOperationId.value = result.operationId; mergeCandidate.value = null; selected.value = new Set(); }
}

async function undoMerge() {
  const operationId = lastMergeOperationId.value;
  const result = await request(`/merges/${encodeURIComponent(operationId)}/undo`, { method: 'POST' }, '合并已撤销');
  if (result) lastMergeOperationId.value = '';
}

watch(() => [props.conversationId, props.open], () => {
  loadToken += 1;
  mutationToken += 1;
  busy.value = false;
  memories.value = [];
  conflicts.value = [];
  selected.value = new Set();
  editor.value = null;
  mergeCandidate.value = null;
  deleteCandidate.value = null;
  lastMergeOperationId.value = '';
  error.value = '';
});
watch(() => [props.conversationId, props.open, props.refreshKey, includeArchived.value], () => void load(), { immediate: true });
onBeforeUnmount(() => { disposed = true; loadToken += 1; mutationToken += 1; });
</script>

<template>
  <section v-if="open" class="memory-review" aria-label="对话记忆审阅">
    <header class="review-header">
      <div><h3>对话记忆</h3><span>{{ memories.length }} 条</span></div>
      <div class="header-actions">
        <label><input v-model="includeArchived" type="checkbox">显示归档</label>
        <button class="icon-button" type="button" title="刷新" aria-label="刷新记忆" :disabled="loading || busy" @click="load"><RefreshCw :size="17" /></button>
        <button type="button" :disabled="busy" @click="openCreate"><Plus :size="17" />新增</button>
      </div>
    </header>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div v-if="selected.size" class="batch-bar" role="toolbar" aria-label="批量记忆操作">
      <span>已选 {{ selected.size }} 条</span>
      <button type="button" :disabled="busy" @click="batch('confirm')"><Check :size="16" />确认</button>
      <button type="button" :disabled="busy" @click="batch('disable')"><X :size="16" />禁用</button>
      <button type="button" :disabled="busy" @click="batch('invalidate')"><Archive :size="16" />失效</button>
      <button type="button" :disabled="busy || !canMerge" @click="beginMerge()"><GitMerge :size="16" />合并</button>
    </div>

    <details v-if="conflicts.length" class="conflicts">
      <summary><ChevronDown :size="16" />待审阅候选 {{ conflicts.length }} 组</summary>
      <div v-for="candidate in conflicts" :key="candidate.id" class="conflict-row">
        <span>{{ candidate.memories[0]?.subject }} · 同主体内容不同</span>
        <button type="button" :disabled="busy" @click="beginMerge(candidate)"><GitMerge :size="16" />审阅合并</button>
      </div>
    </details>

    <div v-if="loading" class="empty" role="status">加载中...</div>
    <div v-else-if="!visibleMemories.length" class="empty">暂无记忆</div>
    <ul v-else class="memory-list">
      <li v-for="memory in visibleMemories" :key="memory.id" :class="{ archived: memory.archived }">
        <input type="checkbox" :checked="selected.has(memory.id)" :aria-label="`选择记忆：${memory.subject || memory.content}`" @change="toggle(memory)">
        <div class="memory-copy">
          <div class="memory-meta"><span>{{ memory.memoryType }}</span><span>{{ memory.enabled ? '已启用' : memory.pending ? '待确认' : '已禁用' }}</span><span v-if="memory.archived">已归档</span><span v-if="memory.pinned">已置顶</span></div>
          <strong v-if="memory.subject">{{ memory.subject }}</strong><p>{{ memory.content }}</p>
          <small v-if="memory.sourceExcerpt">来源：{{ memory.sourceExcerpt }}</small>
        </div>
        <div class="row-actions">
          <button class="icon-button" type="button" :title="memory.pinned ? '取消置顶' : '置顶'" :aria-label="memory.pinned ? '取消置顶记忆' : '置顶记忆'" :disabled="busy" @click="togglePin(memory)">
            <PinOff v-if="memory.pinned" :size="16" />
            <Pin v-else :size="16" />
          </button>
          <button class="icon-button" type="button" title="编辑" aria-label="编辑记忆" :disabled="busy" @click="openEdit(memory)"><Pencil :size="16" /></button>
          <button v-if="!memory.enabled && !memory.archived" type="button" :disabled="busy" @click="singleAction(memory, 'confirm')">确认</button>
          <button v-if="memory.enabled && !memory.archived" type="button" :disabled="busy" @click="singleAction(memory, 'disable')">禁用</button>
          <button v-if="!memory.archived" class="icon-button" type="button" title="归档" aria-label="归档记忆" :disabled="busy" @click="singleAction(memory, 'rollback')"><Archive :size="16" /></button>
          <button class="icon-button danger" type="button" title="删除" aria-label="删除记忆" :disabled="busy" @click="singleAction(memory, 'delete')"><Trash2 :size="16" /></button>
        </div>
      </li>
    </ul>

    <button v-if="lastMergeOperationId" class="undo" type="button" :disabled="busy" @click="undoMerge"><RotateCcw :size="16" />撤销上次合并</button>

    <div v-if="editor" class="dialog-backdrop" role="presentation" @click.self="editor = null">
      <form class="dialog" aria-label="记忆编辑" @submit.prevent="saveEditor">
        <header><h4>{{ editor.id ? '编辑记忆' : '新增记忆' }}</h4><button class="icon-button" type="button" aria-label="关闭" @click="editor = null"><X :size="18" /></button></header>
        <label>类型<select v-model="editor.memoryType"><option value="event">事件</option><option value="relationship">关系</option><option value="location">地点</option><option value="preference">偏好</option><option value="fact">事实</option><option value="summary">叙述</option><option value="intent">计划</option><option value="hypothesis">可能性</option></select></label>
        <label>主体<input v-model="editor.subject" maxlength="160"></label>
        <label>内容<textarea v-model="editor.content" rows="5" maxlength="5000" required></textarea></label>
        <label>置信度<input v-model.number="editor.confidence" type="number" min="0" max="1" step="0.05"></label>
        <label class="check"><input v-model="editor.enabled" type="checkbox">启用</label>
        <footer><button type="button" @click="editor = null">取消</button><button class="primary" type="submit" :disabled="busy">保存</button></footer>
      </form>
    </div>

    <div v-if="mergeCandidate" class="dialog-backdrop" role="presentation" @click.self="mergeCandidate = null">
      <form class="dialog" aria-label="合并记忆" @submit.prevent="merge">
        <header><h4>审阅合并</h4><button class="icon-button" type="button" aria-label="关闭" @click="mergeCandidate = null"><X :size="18" /></button></header>
        <label>保留记录<select v-model="mergeCandidate.targetId"><option v-for="memory in mergeCandidate.memories" :key="memory.id" :value="memory.id">{{ memory.subject || memory.content.slice(0, 30) }}</option></select></label>
        <label>主体<input v-model="mergeCandidate.subject" maxlength="160"></label>
        <label>合并内容<textarea v-model="mergeCandidate.content" rows="6" maxlength="5000" required></textarea></label>
        <footer><button type="button" @click="mergeCandidate = null">取消</button><button class="primary" type="submit" :disabled="busy"><GitMerge :size="16" />合并</button></footer>
      </form>
    </div>

    <CastConfirmDialog
      :open="Boolean(deleteCandidate)"
      title="删除记忆"
      message="确定永久删除这条记忆？此操作不可撤销。"
      confirm-label="删除"
      danger
      :busy="busy"
      @confirm="confirmDelete"
      @cancel="deleteCandidate = null"
    />
  </section>
</template>

<style scoped>
.memory-review { display: grid; gap: 12px; color: var(--text); }
.review-header, .review-header > div, .header-actions, .batch-bar, .memory-meta, .row-actions, .dialog header, .dialog footer, .conflict-row { display: flex; align-items: center; gap: 8px; }
.review-header { justify-content: space-between; flex-wrap: wrap; }
.header-actions label { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.memory-review input[type='checkbox'] { width: 18px; height: 18px; min-height: 18px; padding: 0; flex: 0 0 18px; }
h3, h4, p { margin: 0; } h3 { font-size: 16px; } h4 { font-size: 15px; }
.review-header span, small, .memory-meta { color: var(--muted); font-size: 12px; }
button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 36px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: inherit; cursor: pointer; font: inherit; }
button:hover:not(:disabled) { background: var(--surface-hover); } button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
button:disabled { cursor: default; opacity: .5; } .icon-button { width: 36px; padding: 6px; } .danger { color: var(--danger); } .primary { color: white; border-color: var(--primary); background: var(--primary); }
.batch-bar { flex-wrap: wrap; padding: 8px; border: 1px solid var(--line); background: var(--surface-strong); }
.batch-bar span { margin-right: auto; font-size: 13px; }
.conflicts { border: 1px solid var(--line); padding: 8px; } summary { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.conflict-row { justify-content: space-between; padding-top: 8px; font-size: 13px; }
.memory-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.memory-list li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: start; gap: 10px; padding: 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
.memory-list li.archived { opacity: .66; } .memory-list input[type='checkbox'] { width: 18px; height: 18px; }
.memory-copy { display: grid; min-width: 0; gap: 4px; } .memory-copy p, .memory-copy small { overflow-wrap: anywhere; } .memory-meta { flex-wrap: wrap; }
.row-actions { flex-wrap: wrap; justify-content: flex-end; } .empty { padding: 24px; text-align: center; color: var(--muted); } .error { padding: 8px; color: var(--danger); background: var(--danger-soft); }
.undo { justify-self: start; }
.dialog-backdrop { position: fixed; z-index: var(--z-modal); inset: 0; display: grid; place-items: center; padding: 16px; background: rgba(0, 0, 0, .52); }
.dialog { display: grid; width: min(520px, 100%); max-height: calc(100vh - 32px); overflow: auto; gap: 12px; padding: 16px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-raised); box-shadow: var(--shadow-lg); }
.dialog header { justify-content: space-between; } .dialog footer { justify-content: flex-end; } .dialog label { display: grid; gap: 5px; font-size: 13px; } .dialog .check { display: flex; align-items: center; }
input, textarea, select { min-width: 0; padding: 8px; border: 1px solid var(--line); border-radius: 5px; background: var(--surface); color: inherit; font: inherit; } textarea { resize: vertical; }
@media (max-width: 680px) { button { min-height: 44px; } .icon-button { width: 44px; } .memory-list li { grid-template-columns: auto minmax(0, 1fr); } .row-actions { grid-column: 1 / -1; justify-content: flex-start; } .header-actions { width: 100%; flex-wrap: wrap; } }
</style>
