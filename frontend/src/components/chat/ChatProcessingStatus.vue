<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Check, LoaderCircle, RefreshCw, Square, TriangleAlert } from '@lucide/vue';
import { apiRequest } from '../../api/core.js';
import { useNotify } from '../../composables/useNotify';

const props = defineProps({ conversationId: { type: String, required: true }, refreshKey: { type: [String, Number], default: '' }, generating: { type: Boolean, default: false } });
const emit = defineEmits(['settled']);
const notify = useNotify();
const state = ref(null);
const busy = ref(false);
const error = ref('');
const confirmAction = ref('');
const rebuildCount = ref(0);
let timer;
let token = 0;
let disposed = false;
const active = computed(() => ['queued', 'running'].includes(state.value?.job?.status));
const visible = computed(() => active.value || ['needs_review', 'needs_rebuild', 'legacy_partial', 'stale'].includes(state.value?.stateStatus) || Boolean(error.value));
const label = computed(() => {
  if (error.value) return error.value;
  if (active.value) return `后台同步 ${state.value.job.progress || 0}% · 待处理 ${state.value.job.pendingCount || 1} 轮${state.value.job.failedCount ? ` · ${state.value.job.failedCount} 轮待恢复` : ''}`;
  if (state.value?.stateStatus === 'legacy_partial') return '此历史记录未包含完整剧情状态';
  if (state.value?.stateStatus === 'needs_review') return '剧情状态同步未完成';
  return '历史已修改，剧情状态待重建';
});

async function refresh() {
  const id = props.conversationId;
  const current = ++token;
  clearTimeout(timer);
  if (!id || disposed) return;
  try {
    const next = await apiRequest(`/api/conversations/${encodeURIComponent(id)}/processing`);
    if (disposed || current !== token || id !== props.conversationId) return;
    const previous = state.value;
    state.value = next;
    error.value = '';
    if (previous && (previous.stateStatus !== next.stateStatus || previous.job?.id !== next.job?.id || previous.job?.status !== next.job?.status)) emit('settled', next);
  } catch (failure) {
    if (disposed || current !== token) return;
    error.value = failure.message;
  } finally {
    if (!disposed && current === token && active.value && !error.value) {
      timer = setTimeout(refresh, 1000);
    }
  }
}

async function action(name, confirmed = false) {
  if (busy.value || props.generating && ['rebuild', 'accept'].includes(name)) return;
  const id = props.conversationId;
  const jobId = state.value?.job?.id;
  busy.value = true;
  try {
    const base = `/api/conversations/${encodeURIComponent(id)}/processing/rebuild`;
    if (name === 'rebuild' && !confirmed) {
      const preview = await apiRequest(base, { method: 'POST', body: JSON.stringify({}) });
      if (id !== props.conversationId || disposed) return;
      rebuildCount.value = preview.turnCount || 0;
      confirmAction.value = 'rebuild';
      return;
    }
    if (name === 'accept' && !confirmed) { confirmAction.value = 'accept'; return; }
    if (name === 'cancel' || name === 'retry') {
      await apiRequest(`/api/jobs/${encodeURIComponent(jobId)}${name === 'retry' ? '/retry' : ''}`, { method: name === 'retry' ? 'POST' : 'DELETE' });
    } else {
      await apiRequest(base, { method: 'POST', body: JSON.stringify({ confirmed: true, acceptCurrent: name === 'accept' }) });
    }
    if (id !== props.conversationId || disposed) return;
    confirmAction.value = '';
    await refresh();
    emit('settled', state.value);
  } catch (failure) {
    if (id === props.conversationId && !disposed) notify.error(failure.message);
  } finally {
    busy.value = false;
  }
}

watch(() => [props.conversationId, props.refreshKey], () => { confirmAction.value = ''; void refresh(); }, { immediate: true });
watch(() => props.conversationId, () => { state.value = null; error.value = ''; });
onBeforeUnmount(() => { disposed = true; token += 1; clearTimeout(timer); });
</script>

<template>
  <section v-if="visible" class="chat-processing-status" aria-label="剧情同步状态">
    <div class="processing-summary" role="status" aria-live="polite">
      <LoaderCircle v-if="active" :size="16" aria-hidden="true" />
      <TriangleAlert v-else :size="16" aria-hidden="true" />
      <span>{{ label }}</span>
    </div>
    <div v-if="!confirmAction" class="processing-actions">
      <button v-if="active" type="button" class="icon-button" title="取消同步" aria-label="取消同步" :disabled="busy" @click="action('cancel')"><Square :size="16" /></button>
      <button v-else-if="state?.job?.canRetry" type="button" class="icon-button" title="重试同步" aria-label="重试同步" :disabled="busy" @click="action('retry')"><RefreshCw :size="16" /></button>
      <button v-if="!active && !error" type="button" :disabled="busy || generating" @click="action('rebuild')"><RefreshCw :size="16" />重建状态</button>
      <button v-if="!active && !error" type="button" :disabled="busy || generating" @click="action('accept')"><Check :size="16" />保留当前状态</button>
      <button v-if="error" type="button" class="icon-button" title="刷新同步状态" aria-label="刷新同步状态" @click="refresh"><RefreshCw :size="16" /></button>
    </div>
    <div v-else class="processing-confirm" role="group" aria-label="确认剧情状态操作">
      <span>{{ confirmAction === 'rebuild' ? `重建 ${rebuildCount} 轮剧情状态？可能产生模型调用费用。` : '将当前状态作为新的剧情基线？' }}</span>
      <button type="button" :disabled="busy || generating" @click="action(confirmAction, true)"><Check :size="16" />确认</button>
      <button type="button" :disabled="busy" @click="confirmAction = ''">取消</button>
    </div>
  </section>
</template>

<style scoped>
.chat-processing-status { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 8px 16px; border-bottom: 1px solid var(--line); color: var(--text); background: var(--surface); font-size: 13px; }
.processing-summary { display: flex; align-items: center; gap: 8px; flex: 1 1 180px; min-width: 0; overflow-wrap: anywhere; }
.processing-summary svg { flex-shrink: 0; }
.processing-actions, .processing-confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.processing-confirm span { flex: 1 1 180px; }
button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 36px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px; background: transparent; color: inherit; cursor: pointer; font: inherit; }
button:hover { background: var(--surface-hover, var(--bg)); }
button:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
button:disabled { opacity: .5; cursor: default; }
.icon-button { width: 36px; flex-shrink: 0; padding: 6px; }
@media (max-width: 600px) { button { min-height: 44px; } .icon-button { width: 44px; } .chat-processing-status { padding-inline: 12px; } }
</style>
