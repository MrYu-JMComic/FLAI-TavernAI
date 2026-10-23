<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Archive, Brain, Check, ChevronDown, GitMerge, Pencil, Pin, PinOff, Plus, RefreshCw, RotateCcw, Trash2, X } from '@lucide/vue';
import { apiRequest } from '../../api/core.js';
import { useNotify } from '../../composables/useNotify';
import ConfirmDialog from '../ConfirmDialog.vue';

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
const memoryTypeLabels = { event: '事件', relationship: '关系', location: '地点', preference: '偏好', fact: '事实', summary: '叙述', intent: '计划', hypothesis: '可能性' };

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
      <div class="review-heading">
        <div class="review-title"><h3>对话记忆</h3><span class="memory-count">{{ visibleMemories.length }} 条</span></div>
        <p>审阅与整理对话中保留的记忆</p>
      </div>
      <div class="header-actions">
        <label class="archive-toggle"><input v-model="includeArchived" type="checkbox">显示归档</label>
        <button class="icon-button" type="button" title="刷新" aria-label="刷新记忆" :disabled="loading || busy" @click="load"><RefreshCw :size="17" /></button>
        <button class="primary" type="button" :disabled="busy" @click="openCreate"><Plus :size="17" />新增</button>
      </div>
    </header>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div v-if="selected.size" class="batch-bar" role="toolbar" aria-label="批量记忆操作">
      <span>已选 {{ selected.size }} 条</span>
      <button type="button" :disabled="busy" @click="batch('confirm')"><Check :size="16" />确认</button>
      <button type="button" :disabled="busy" @click="batch('disable')"><X :size="16" />禁用</button>
      <button type="button" :disabled="busy" @click="batch('invalidate')"><Archive :size="16" />失效</button>
      <button type="button" :disabled="busy || !canMerge" @click="beginMerge()"><GitMerge :size="16" />合并</button>
      <button class="icon-button" type="button" title="取消选择" aria-label="取消选择记忆" @click="selected = new Set()"><X :size="16" /></button>
    </div>

    <details v-if="conflicts.length" class="conflicts">
      <summary><ChevronDown :size="16" />待审阅候选 {{ conflicts.length }} 组</summary>
      <div v-for="candidate in conflicts" :key="candidate.id" class="conflict-row">
        <span>{{ candidate.memories[0]?.subject }} · 同主体内容不同</span>
        <button type="button" :disabled="busy" @click="beginMerge(candidate)"><GitMerge :size="16" />审阅合并</button>
      </div>
    </details>

    <div v-if="loading" class="empty" role="status">加载中...</div>
    <div v-else-if="!visibleMemories.length" class="empty"><Brain :size="28" /><strong>暂无记忆</strong><span>新增一条记忆，保留对话中的重要信息</span></div>
    <ul v-else class="memory-list">
      <li v-for="memory in visibleMemories" :key="memory.id" :class="{ archived: memory.archived, selected: selected.has(memory.id), pinned: memory.pinned }">
        <div class="memory-card-head">
          <input type="checkbox" :checked="selected.has(memory.id)" :aria-label="`选择记忆：${memory.subject || memory.content}`" @change="toggle(memory)">
          <div class="memory-meta">
            <span class="memory-type">{{ memoryTypeLabels[memory.memoryType] || memory.memoryType }}</span>
            <span class="memory-status" :class="memory.enabled ? 'enabled' : memory.pending ? 'pending' : 'disabled'">{{ memory.enabled ? '已启用' : memory.pending ? '待确认' : '已禁用' }}</span>
            <span v-if="memory.archived">已归档</span>
            <span v-if="memory.pinned" class="pinned-label"><Pin :size="12" />已置顶</span>
          </div>
        </div>
        <div class="memory-copy">
          <h4 v-if="memory.subject">{{ memory.subject }}</h4>
          <p>{{ memory.content }}</p>
        </div>
        <details v-if="memory.sourceExcerpt" class="memory-source">
          <summary><ChevronDown :size="14" />查看来源</summary>
          <p>{{ memory.sourceExcerpt }}</p>
        </details>
        <div class="row-actions">
          <button class="icon-button" :class="{ 'is-pinned': memory.pinned }" type="button" :title="memory.pinned ? '取消置顶' : '置顶'" :aria-label="memory.pinned ? '取消置顶记忆' : '置顶记忆'" :aria-pressed="Boolean(memory.pinned)" :disabled="busy" @click="togglePin(memory)">
            <PinOff v-if="memory.pinned" :size="16" />
            <Pin v-else :size="16" />
          </button>
          <button type="button" title="编辑" aria-label="编辑记忆" :disabled="busy" @click="openEdit(memory)"><Pencil :size="16" />编辑</button>
          <button v-if="!memory.enabled && !memory.archived" type="button" :disabled="busy" @click="singleAction(memory, 'confirm')">确认</button>
          <button v-if="memory.enabled && !memory.archived" type="button" :disabled="busy" @click="singleAction(memory, 'disable')">禁用</button>
          <div class="row-secondary-actions">
            <button v-if="!memory.archived" class="icon-button" type="button" title="归档" aria-label="归档记忆" :disabled="busy" @click="singleAction(memory, 'rollback')"><Archive :size="16" /></button>
            <button class="icon-button danger" type="button" title="删除" aria-label="删除记忆" :disabled="busy" @click="singleAction(memory, 'delete')"><Trash2 :size="16" /></button>
          </div>
        </div>
      </li>
    </ul>

    <button v-if="lastMergeOperationId" class="undo" type="button" :disabled="busy" @click="undoMerge"><RotateCcw :size="16" />撤销上次合并</button>

    <div v-if="editor" class="dialog-backdrop" role="presentation" @click.self="editor = null">
      <form class="dialog" aria-label="记忆编辑" @submit.prevent="saveEditor">
        <header><h4>{{ editor.id ? '编辑记忆' : '新增记忆' }}</h4><button class="icon-button" type="button" aria-label="关闭" @click="editor = null"><X :size="18" /></button></header>
        <label>类型<select v-model="editor.memoryType"><option v-for="(label, type) in memoryTypeLabels" :key="type" :value="type">{{ label }}</option></select></label>
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

    <ConfirmDialog
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
.memory-review { display: grid; gap: 16px; min-width: 0; color: var(--text); }
.review-header, .review-title, .header-actions, .batch-bar, .memory-card-head, .memory-meta, .row-actions, .row-secondary-actions, .dialog header, .dialog footer, .conflict-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.review-header { flex-wrap: wrap; justify-content: space-between; gap: 14px; }
.review-heading { display: grid; gap: 6px; }
h3, h4, p { margin: 0; }
h3 { font-size: 16px; font-weight: 750; }
h4 { font-size: 15px; line-height: 1.5; }
.review-heading p { color: var(--muted); font-size: 12px; line-height: 1.5; }
.memory-count { padding: 3px 8px; border-radius: 6px; color: var(--muted); background: var(--surface-strong); font-size: 11px; font-weight: 650; }
.header-actions { flex-wrap: wrap; }
.archive-toggle { display: inline-flex; align-items: center; gap: 7px; min-height: 40px; margin-right: 4px; color: var(--muted); font-size: 12px; white-space: nowrap; cursor: pointer; }
.memory-review input[type='checkbox'] { width: 16px; height: 16px; min-height: 16px; padding: 0; flex: 0 0 16px; accent-color: var(--primary); cursor: pointer; }
button { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; gap: 6px; min-height: 40px; padding: 7px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: inherit; cursor: pointer; font: inherit; font-size: 12px; font-weight: 650; transition: background .15s, border-color .15s, color .15s; }
button:hover:not(:disabled) { border-color: color-mix(in srgb, var(--primary) 35%, var(--line)); background: var(--surface-hover); }
button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 3px; }
button:disabled { cursor: default; opacity: .5; }
.icon-button { width: 40px; padding: 7px; }
.danger { color: var(--danger); }
.danger:hover:not(:disabled) { background: var(--danger-soft); border-color: var(--danger); }
.primary { color: var(--surface); border-color: var(--primary); background: var(--primary); }
.primary:hover:not(:disabled) { color: var(--surface); border-color: var(--primary-strong); background: var(--primary-strong); }
.batch-bar { flex-wrap: wrap; gap: 6px; padding: 10px; border: 1px solid color-mix(in srgb, var(--primary) 30%, var(--line)); border-radius: 10px; background: var(--primary-soft); }
.batch-bar > span { flex: 1 0 100%; padding: 2px; color: var(--primary); font-size: 12px; font-weight: 700; }
.conflicts { min-width: 0; padding: 12px 14px; border: 1px solid color-mix(in srgb, var(--warning) 25%, var(--line)); border-radius: 10px; background: color-mix(in srgb, var(--warning-soft) 40%, var(--surface)); }
summary { display: flex; align-items: center; gap: 6px; min-height: 24px; cursor: pointer; list-style: none; font-size: 12px; }
summary::-webkit-details-marker { display: none; }
summary svg { flex-shrink: 0; transition: transform .15s; }
details[open] > summary svg { transform: rotate(180deg); }
.conflicts > summary { color: var(--warning); font-weight: 650; }
.conflict-row { flex-wrap: wrap; justify-content: space-between; gap: 8px; padding-top: 12px; font-size: 12px; }
.conflict-row > span { flex: 1 1 170px; overflow-wrap: anywhere; }
.memory-list { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
.memory-list li { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; min-width: 0; padding: 16px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); box-shadow: var(--shadow-xs); transition: border-color .15s, background .15s; }
.memory-list li.selected { border-color: var(--primary); background: color-mix(in srgb, var(--primary-soft) 25%, var(--surface)); }
.memory-list li.archived { border-style: dashed; }
.memory-card-head { align-items: center; gap: 10px; }
.memory-meta { flex: 1; flex-wrap: wrap; gap: 6px 10px; color: var(--muted); font-size: 11px; line-height: 1.5; }
.memory-type { padding: 3px 8px; border-radius: 5px; color: var(--primary); background: var(--primary-soft); font-weight: 650; }
.memory-status { display: inline-flex; align-items: center; gap: 5px; }
.memory-status::before { width: 5px; height: 5px; border-radius: 50%; background: currentColor; content: ''; }
.memory-status.enabled { color: var(--success); }
.memory-status.pending { color: var(--warning); }
.pinned-label { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; color: var(--primary); }
.memory-copy { display: grid; min-width: 0; gap: 7px; }
.memory-copy h4, .memory-copy p { overflow-wrap: anywhere; }
.memory-copy p { color: color-mix(in srgb, var(--text) 90%, var(--muted)); font-size: 13px; line-height: 1.85; white-space: pre-wrap; }
.memory-source { min-width: 0; padding: 7px 10px; border-radius: 7px; color: var(--muted); background: color-mix(in srgb, var(--surface-strong) 65%, transparent); }
.memory-source p { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--line); font-size: 12px; line-height: 1.75; white-space: pre-wrap; overflow-wrap: anywhere; }
.row-actions { flex-wrap: wrap; gap: 6px; padding-top: 10px; border-top: 1px solid color-mix(in srgb, var(--line) 65%, transparent); }
.row-actions > button, .row-secondary-actions button { color: var(--muted); border-color: transparent; background: transparent; }
.row-actions .is-pinned { color: var(--primary); background: var(--primary-soft); }
.row-secondary-actions { margin-left: auto; gap: 4px; }
.row-secondary-actions .danger { color: var(--danger); }
.empty { display: grid; justify-items: center; gap: 10px; padding: 48px 20px; border: 1px dashed var(--line); border-radius: 12px; text-align: center; color: var(--muted); font-size: 12px; }
.empty svg { margin-bottom: 4px; color: var(--primary); }
.empty strong { color: var(--text); font-size: 14px; }
.error { padding: 10px 12px; border-radius: 8px; color: var(--danger); background: var(--danger-soft); font-size: 13px; overflow-wrap: anywhere; }
.undo { justify-self: start; }
.dialog-backdrop { position: fixed; z-index: var(--z-modal); inset: 0; display: grid; place-items: center; padding: 16px; background: rgba(0, 0, 0, .52); }
.dialog { display: grid; width: min(520px, 100%); max-height: calc(100dvh - 32px); overflow: auto; gap: 14px; padding: 20px; border: 1px solid var(--line); border-radius: 16px; background: var(--surface-raised); box-shadow: var(--shadow-lg); }
.dialog header { justify-content: space-between; }
.dialog footer { justify-content: flex-end; padding-top: 8px; border-top: 1px solid var(--line); }
.dialog label { display: grid; gap: 7px; color: var(--muted); font-size: 12px; }
.dialog .check { display: flex; align-items: center; }
input, textarea, select { min-width: 0; min-height: 40px; padding: 9px 11px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--text); font: inherit; font-size: 13px; }
textarea { resize: vertical; line-height: 1.7; }
@media (max-width: 640px) {
  button, .archive-toggle { min-height: 44px; }
  .icon-button { width: 44px; }
  .header-actions { width: 100%; }
  .archive-toggle { margin-right: auto; }
  .memory-list li { padding: 14px; }
  .row-actions { gap: 4px; }
  .row-secondary-actions { gap: 0; }
  .memory-source summary { min-height: 32px; }
}
</style>
