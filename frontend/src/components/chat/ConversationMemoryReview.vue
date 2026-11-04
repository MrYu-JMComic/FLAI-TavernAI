<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Archive, Brain, Check, ChevronDown, GitMerge, Pencil, Pin, PinOff, Plus, RefreshCw, RotateCcw, Trash2, X } from '@lucide/vue';
import {
  batchConversationMemories, confirmConversationMemory, createConversationMemory,
  deleteConversationMemory, disableConversationMemory, fetchConversationMemories,
  fetchConversationMemoryState, fetchMemoryConflicts, mergeConversationMemories,
  pinConversationMemory, reindexConversationMemory, rollbackConversationMemory,
  submitConversationMemoryPacket, undoMemoryMerge, updateConversationMemory
} from '../../api/memories.js';
import { useNotify } from '../../composables/useNotify';
import { createRequestId } from '../../utils/requestId.js';
import ConfirmDialog from '../ConfirmDialog.vue';
import ConversationActorDossier from './ConversationActorDossier.vue';
import ChatProcessingStatus from './ChatProcessingStatus.vue';

const props = defineProps({
  conversationId: { type: String, required: true },
  open: { type: Boolean, default: true },
  refreshKey: { type: [String, Number], default: 0 }
});
const emit = defineEmits(['changed', 'open-settings', 'processing-settled']);
const notify = useNotify();
const memories = ref([]);
const conflicts = ref([]);
const memoryState = ref(null);
const view = ref('records');
const workspace = ref('characters');
const dossierRefreshKey = ref(0);
const actorId = ref('');
const selected = ref(new Set());
const loading = ref(false);
const busy = ref(false);
const includeArchived = ref(false);
const editor = ref(null);
const packetEditor = ref(null);
const packetError = ref('');
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
const lifecycleLabels = { candidate: '待审核', active: '已接受', superseded: '已替代', rejected: '已拒绝' };
const knowledgeLabels = { experienced: '亲历', told: '听说', knows: '知晓', believes: '相信', suspects: '怀疑', false_belief: '错误信念', unknown: '未知' };
const actors = computed(() => (memoryState.value?.entities || []).filter((entity) => ['actor', 'character', 'person'].includes(entity.kind)));
const structuredRows = computed(() => {
  if (view.value === 'actors') return memoryState.value?.knowledge || [];
  return memoryState.value?.[view.value] || [];
});

async function load() {
  const conversationId = props.conversationId;
  if (!props.open || !conversationId) return;
  const token = ++loadToken;
  loading.value = true;
  error.value = '';
  try {
    const [memoryResult, conflictResult, structuredResult] = await Promise.all([
      fetchConversationMemories(conversationId, { includeArchived: includeArchived.value }),
      fetchMemoryConflicts(conversationId),
      fetchConversationMemoryState(conversationId, { actorId: actorId.value })
    ]);
    if (disposed || token !== loadToken || conversationId !== props.conversationId) return;
    memories.value = Array.isArray(memoryResult?.memories) ? memoryResult.memories : [];
    conflicts.value = Array.isArray(conflictResult?.candidates) ? conflictResult.candidates : [];
    memoryState.value = structuredResult;
    dossierRefreshKey.value += 1;
    selected.value = new Set([...selected.value].filter((id) => memories.value.some((memory) => memory.id === id)));
  } catch (failure) {
    if (disposed || token !== loadToken) return;
    error.value = failure?.message || '记忆加载失败';
  } finally {
    if (!disposed && token === loadToken) loading.value = false;
  }
}

/** Refresh accepted records and notify the owning chat when recovery changes this conversation's core state. */
async function handleProcessingSettled(state) {
  if (disposed || state?.conversationId !== props.conversationId) return;
  emit('processing-settled', state);
  await load();
}

function openCreate() {
  editor.value = { id: '', revision: 0, memoryType: 'event', subject: '', content: '', confidence: 1, enabled: true, visibility: 'public', truthStatus: 'established', actorIds: [] };
}
function openEdit(memory) {
  const event = (memoryState.value?.events || []).find((item) => (item.memoryId || item.memory_id) === memory.id);
  editor.value = { ...memory, visibility: memory.visibility || event?.visibility || 'public', truthStatus: memory.truthStatus || event?.truthStatus || event?.truth_status || 'unverified', actorIds: [...(memory.actorIds || event?.actorIds || [])] };
}
function toggle(memory) {
  const next = new Set(selected.value);
  next.has(memory.id) ? next.delete(memory.id) : next.add(memory.id);
  selected.value = next;
}

async function request(operation, success, refreshContext = true) {
  if (busy.value) return null;
  const conversationId = props.conversationId;
  const token = ++mutationToken;
  busy.value = true;
  error.value = '';
  try {
    const result = await operation(conversationId);
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
  if (form.visibility === 'restricted' && !form.actorIds.length) { error.value = '受限记忆至少需要一个知情角色'; return; }
  const payload = { memoryType: form.memoryType, subject: form.subject, content: form.content, confidence: Number(form.confidence), enabled: form.enabled, revision: form.revision, visibility: form.visibility, truthStatus: form.truthStatus, actorIds: form.actorIds };
  const result = await request((id) => form.id ? updateConversationMemory(id, form.id, payload) : createConversationMemory(id, payload), form.id ? '记忆已更新' : '记忆已创建');
  if (result) editor.value = null;
}

async function singleAction(memory, action) {
  if (action === 'delete') {
    deleteCandidate.value = memory;
    return;
  }
  const labels = { confirm: '记忆已确认', disable: '记忆已禁用', rollback: '记忆已归档' };
  const actions = { confirm: confirmConversationMemory, disable: disableConversationMemory, rollback: rollbackConversationMemory };
  await request((id) => actions[action](id, memory.id, memory.revision), labels[action]);
}

async function confirmDelete() {
  const memory = deleteCandidate.value;
  if (!memory) return;
  const result = await request((id) => deleteConversationMemory(id, memory.id, memory.revision), '记忆已删除');
  if (result) deleteCandidate.value = null;
}

async function togglePin(memory) {
  await request((id) => pinConversationMemory(id, memory.id, { pinned: !memory.pinned, revision: memory.revision }), memory.pinned ? '已取消置顶' : '记忆已置顶');
}

async function batch(action) {
  const items = selectedMemories.value.map(({ id, revision }) => ({ id, revision }));
  const labels = { confirm: '所选记忆已确认', disable: '所选记忆已禁用', invalidate: '所选记忆已标记失效' };
  const result = await request((id) => batchConversationMemories(id, { action, items }), labels[action]);
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
  const result = await request((id) => mergeConversationMemories(id, {
      targetId: target.id, targetRevision: target.revision,
      sourceItems: draft.memories.filter((memory) => memory.id !== target.id).map(({ id, revision }) => ({ id, revision })),
      subject: draft.subject, content: draft.content
    }), '记忆已合并');
  if (result) { lastMergeOperationId.value = result.operationId; mergeCandidate.value = null; selected.value = new Set(); }
}

async function undoMerge() {
  const operationId = lastMergeOperationId.value;
  const result = await request((id) => undoMemoryMerge(id, operationId), '合并已撤销');
  if (result) lastMergeOperationId.value = '';
}

watch(() => [props.conversationId, props.open], () => {
  loadToken += 1;
  mutationToken += 1;
  busy.value = false;
  memories.value = [];
  memoryState.value = null;
  actorId.value = '';
  conflicts.value = [];
  selected.value = new Set();
  editor.value = null;
  packetEditor.value = null;
  packetError.value = '';
  mergeCandidate.value = null;
  deleteCandidate.value = null;
  lastMergeOperationId.value = '';
  error.value = '';
});
watch(() => [props.conversationId, props.open, props.refreshKey, includeArchived.value, actorId.value], () => void load(), { immediate: true });

function rowText(row) { return row.text || row.content || row.statement || row.description || row.title || row.predicate || row.name || ''; }
/** Knowledge rows describe a belief about an event, whose scoped text comes from the same workbench response. */
function structuredRowText(row) {
  if (view.value !== 'actors') return rowText(row);
  if (row.beliefContent || row.belief_content) return row.beliefContent || row.belief_content;
  const event = (memoryState.value?.events || []).find((item) => item.id === (row.eventId || row.event_id));
  const claim = (memoryState.value?.claims || []).find((item) => item.id === (row.claimId || row.claim_id));
  return rowText(row) || rowText(event || claim || {});
}
function actorName(id) { const actor = (memoryState.value?.entities || []).find((entity) => entity.id === id); return actor?.canonicalName || actor?.canonical_name || actor?.name || id; }
function rowEvidence(row) { return row.evidence || row.evidenceRefs || row.evidence_refs || []; }
function rebuildIndex() { return request((id) => reindexConversationMemory(id), '检索索引已安排重建', false); }

function openPacketEditor() {
  packetError.value = '';
  packetEditor.value = { revision: memoryState.value?.revision, idempotencyKey: createRequestId(), submittedText: '', text: JSON.stringify({ version: 1, sources: [], entities: [], events: [], claims: [], knowledge: [], threads: [] }, null, 2) };
}

/** Preserve the submission key after transport failures; edited packets start a new operation. */
async function savePacket() {
  const draft = packetEditor.value;
  if (!draft || busy.value) return;
  packetError.value = '';
  let packet;
  try { packet = JSON.parse(draft.text); }
  catch { packetError.value = 'JSON 格式无效，请修正后提交'; return; }
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) { packetError.value = '提交内容需要是一个结构化记忆对象'; return; }
  if (!Number.isInteger(draft.revision)) { packetError.value = '缺少记忆版本，请关闭后刷新记忆再重试'; return; }
  const submittedText = JSON.stringify(packet);
  if (draft.submittedText && draft.submittedText !== submittedText) draft.idempotencyKey = createRequestId();
  draft.submittedText = submittedText;
  const result = await request((id) => submitConversationMemoryPacket(id, { expectedRevision: draft.revision, packet: { ...packet, idempotencyKey: draft.idempotencyKey } }), '结构化修订已提交');
  if (result) packetEditor.value = null;
}
onBeforeUnmount(() => { disposed = true; loadToken += 1; mutationToken += 1; });
</script>

<template>
  <section v-if="open" class="memory-review" :class="{ 'is-character-workspace': workspace === 'characters' }" aria-label="对话记忆审阅">
    <header class="review-header">
      <div class="review-heading">
        <div class="review-title"><h3>对话记忆</h3><span v-if="workspace === 'all'" class="memory-count">{{ visibleMemories.length }} 条</span></div>
        <p>查看角色的经历，整理故事中的重要记录</p>
      </div>
      <div class="header-actions">
        <button type="button" @click="emit('open-settings')">整理设置</button>
        <label v-if="workspace === 'all'" class="archive-toggle"><input v-model="includeArchived" type="checkbox">显示归档</label>
        <button class="icon-button" type="button" title="刷新" aria-label="刷新记忆" :disabled="loading || busy" @click="load"><RefreshCw :size="17" /></button>
        <button v-if="workspace === 'all'" class="primary" type="button" :disabled="busy" @click="openCreate"><Plus :size="17" />新增</button>
        <button v-if="workspace === 'all'" type="button" :disabled="busy || !Number.isInteger(memoryState?.revision)" @click="openPacketEditor">结构化修订</button>
      </div>
    </header>

    <nav class="memory-workspace-tabs" aria-label="记忆工作区"><button type="button" :aria-pressed="workspace === 'characters'" @click="workspace = 'characters'">角色档案</button><button type="button" :aria-pressed="workspace === 'all'" @click="workspace = 'all'">全部记忆</button></nav>
    <details class="processing-details"><summary><ChevronDown :size="14" />同步与恢复</summary><ChatProcessingStatus :conversation-id="conversationId" :refresh-key="refreshKey" show-progress @settled="handleProcessingSettled" />
    <div v-if="memoryState" class="memory-watermarks" role="status">
      <span>{{ memoryState.coreReady ? '核心记忆已就绪' : '核心记忆待同步' }}</span>
      <span>核心 {{ memoryState.watermarks?.core ?? 0 }} · 摘要 {{ memoryState.watermarks?.summary ?? 0 }} · 索引 {{ memoryState.watermarks?.index ?? 0 }}</span>
      <button type="button" :disabled="busy || memoryState.index?.enabled === false" @click="rebuildIndex">重建检索索引</button>
    </div>
    </details>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <ConversationActorDossier v-if="workspace === 'characters'" :conversation-id="conversationId" :refresh-key="`${refreshKey}:${dossierRefreshKey}`" />
    <template v-else>
    <nav class="memory-tabs" aria-label="记忆视图">
      <button v-for="tab in [{ id: 'records', label: '记忆审阅' }, { id: 'events', label: '事件' }, { id: 'claims', label: '事实与关系' }, { id: 'actors', label: '角色认知' }, { id: 'threads', label: '剧情线' }, { id: 'summaries', label: '分层摘要' }]" :key="tab.id" type="button" :aria-pressed="view === tab.id" @click="view = tab.id">{{ tab.label }}</button>
    </nav>
    <template v-if="view !== 'records'">
      <label v-if="view === 'actors'" class="actor-filter">查看角色<select v-model="actorId"><option value="">全部角色（作者视图）</option><option v-for="actor in actors" :key="actor.id" :value="actor.id">{{ actor.canonicalName || actor.canonical_name || actor.name }}</option></select></label>
      <p v-if="view === 'actors'" class="view-hint">信念与客观事实分别记录。多角色同次生成属于软隔离；严格视角需指定单个角色，只使用该角色有权获知的来源。未分类作者卡、历史原文与摘要不进入严格视角；角色设定可作为该角色可见的固定记忆维护。</p>
      <details v-if="view === 'actors' && actors.length" class="memory-source"><summary>角色标识与来源范围</summary><ul><li v-for="actor in actors" :key="actor.id">{{ actorName(actor.id) }} · ID：<code>{{ actor.id }}</code><span v-if="actor.castKey || actor.cast_key"> · cast key：{{ actor.castKey || actor.cast_key }}</span></li></ul></details>
      <div v-if="!structuredRows.length" class="empty">此视图暂无已提交记录</div>
      <ul v-else class="memory-list structured-list">
        <li v-for="row in structuredRows" :key="row.id">
          <div class="memory-meta"><span>{{ row.kind || row.level || row.threadType || row.thread_type || knowledgeLabels[row.epistemicState || row.epistemic_state] || row.status }}</span><span v-if="row.actorId || row.actor_id">{{ actorName(row.actorId || row.actor_id) }}</span><span>{{ lifecycleLabels[row.lifecycle] || row.truthStatus || row.truth_status || '' }}</span></div>
          <p>{{ structuredRowText(row) }}</p>
          <details v-if="rowEvidence(row).length" class="memory-source"><summary>来源与版本</summary><pre>{{ JSON.stringify(rowEvidence(row), null, 2) }}</pre></details>
        </li>
      </ul>
    </template>

    <template v-else>

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
            <span class="memory-status" :class="memory.enabled ? 'enabled' : memory.pending ? 'pending' : 'disabled'">{{ lifecycleLabels[memory.lifecycle] || (memory.enabled ? '已接受' : memory.pending ? '待审核' : '已禁用') }}</span>
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
    </template>

    <div v-if="editor" class="dialog-backdrop" role="presentation" @click.self="editor = null">
      <form class="dialog" role="dialog" aria-modal="true" aria-label="记忆编辑" @submit.prevent="saveEditor" @keydown.esc.stop.prevent="editor = null">
        <header><h4>{{ editor.id ? '编辑记忆' : '新增记忆' }}</h4><button class="icon-button" type="button" aria-label="关闭" @click="editor = null"><X :size="18" /></button></header>
        <div class="dialog-body">
        <label>类型<select v-model="editor.memoryType"><option v-for="(label, type) in memoryTypeLabels" :key="type" :value="type">{{ label }}</option></select></label>
        <label>主体<input v-model="editor.subject" maxlength="160"></label>
        <label>内容<textarea v-model="editor.content" rows="5" maxlength="5000" required></textarea></label>
        <label>置信度<input v-model.number="editor.confidence" type="number" min="0" max="1" step="0.05"></label>
        <label>事实状态<select v-model="editor.truthStatus"><option value="established">已确立</option><option value="unverified">未核实</option><option value="disputed">有争议</option><option value="false">已知为假</option><option value="unknown">未知</option></select></label>
        <label>知情范围<select v-model="editor.visibility"><option value="public">公共事实</option><option value="restricted">指定角色可见</option><option value="author">仅作者真相</option></select></label>
        <label v-if="editor.visibility === 'restricted'">知情角色<select v-model="editor.actorIds" multiple size="3"><option v-for="actor in actors" :key="actor.id" :value="actor.id">{{ actorName(actor.id) }}</option></select><span class="view-hint">只授予选中角色；其他角色无法召回该条记忆。</span></label>
        <label class="check"><input v-model="editor.enabled" type="checkbox">启用</label>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        </div>
        <footer><button type="button" @click="editor = null">取消</button><button class="primary" type="submit" :disabled="busy">保存</button></footer>
      </form>
    </div>

    <div v-if="packetEditor" class="dialog-backdrop" role="presentation" @click.self="packetEditor = null">
      <form class="dialog" role="dialog" aria-modal="true" aria-label="结构化记忆修订" @submit.prevent="savePacket" @keydown.esc.stop.prevent="packetEditor = null">
        <header><h4>结构化记忆修订</h4><button class="icon-button" type="button" aria-label="关闭结构化修订" @click="packetEditor = null"><X :size="18" /></button></header>
        <div class="dialog-body">
        <p class="view-hint">在版本 {{ packetEditor.revision }} 上提交事件、关系和角色认知变更。实体与事件引用使用当前会话 ID；证据需提供消息 ID、revision 和原文引文。修订追加版本，不改写旧证据。</p>
        <label>修订 JSON<textarea v-model="packetEditor.text" rows="16" maxlength="500000" spellcheck="false" required></textarea></label>
        <p v-if="packetError || error" class="error" role="alert">{{ packetError || error }}</p>
        </div>
        <footer><button type="button" @click="packetEditor = null">取消</button><button class="primary" type="submit" :disabled="busy">提交修订</button></footer>
      </form>
    </div>

    <div v-if="mergeCandidate" class="dialog-backdrop" role="presentation" @click.self="mergeCandidate = null">
      <form class="dialog" role="dialog" aria-modal="true" aria-label="合并记忆" @submit.prevent="merge" @keydown.esc.stop.prevent="mergeCandidate = null">
        <header><h4>审阅合并</h4><button class="icon-button" type="button" aria-label="关闭" @click="mergeCandidate = null"><X :size="18" /></button></header>
        <div class="dialog-body">
        <label>保留记录<select v-model="mergeCandidate.targetId"><option v-for="memory in mergeCandidate.memories" :key="memory.id" :value="memory.id">{{ memory.subject || memory.content.slice(0, 30) }}</option></select></label>
        <label>主体<input v-model="mergeCandidate.subject" maxlength="160"></label>
        <label>合并内容<textarea v-model="mergeCandidate.content" rows="6" maxlength="5000" required></textarea></label>
        </div>
        <footer><button type="button" @click="mergeCandidate = null">取消</button><button class="primary" type="submit" :disabled="busy"><GitMerge :size="16" />合并</button></footer>
      </form>
    </div>

    </template>
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
.memory-workspace-tabs { display: flex; gap: 8px; padding-bottom: 12px; border-bottom: 1px solid var(--line); }
.memory-workspace-tabs button[aria-pressed='true'] { color: var(--primary); border-color: var(--primary); background: var(--primary-soft); }
.processing-details { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; color: var(--muted); }
.processing-details > summary { font-size: 12px; }
.processing-details .memory-watermarks { padding-top: 12px; }
.memory-watermarks, .memory-tabs { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }
.memory-tabs button[aria-pressed='true'] { border-color: var(--primary); color: var(--primary); background: var(--surface-hover); }
.actor-filter { display: grid; gap: 6px; font-size: 13px; }
.actor-filter select { max-width: 100%; min-height: 40px; color: var(--text); background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 8px; }
.view-hint { color: var(--muted); font-size: 12px; line-height: 1.6; }
.structured-list pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11px; }
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
.dialog { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; width: min(520px, 100%); max-height: calc(100dvh - 32px); overflow: hidden; gap: 14px; padding: 20px; border: 1px solid var(--line); border-radius: 16px; background: var(--surface-raised); box-shadow: var(--shadow-lg); }
.dialog-body { display: grid; min-height: 0; gap: 14px; overflow: auto; padding: 3px; }
.dialog header { justify-content: space-between; }
.dialog footer { justify-content: flex-end; padding-top: 8px; border-top: 1px solid var(--line); }
.dialog label { display: grid; gap: 7px; color: var(--muted); font-size: 12px; }
.dialog .check { display: flex; align-items: center; }
input, textarea, select { min-width: 0; min-height: 40px; padding: 9px 11px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--text); font: inherit; font-size: 13px; }
textarea { resize: vertical; line-height: 1.7; }
@media (max-width: 640px) {
  .memory-review { gap: 12px; }
  .is-character-workspace .review-header { flex-wrap: nowrap; align-items: center; gap: 8px; }
  .is-character-workspace .review-heading p { display: none; }
  .is-character-workspace .header-actions { width: auto; flex-wrap: nowrap; }
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
