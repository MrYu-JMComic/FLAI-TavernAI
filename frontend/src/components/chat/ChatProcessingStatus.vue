<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Check, LoaderCircle, RefreshCw, Square, TriangleAlert } from '@lucide/vue';
import { fetchConversationProcessing, rebuildConversationProcessing } from '../../api/memories.js';
import { cancelJob, retryJob } from '../../api/jobs.js';

const props = defineProps({ conversationId: { type: String, required: true }, refreshKey: { type: [String, Number], default: '' }, generating: { type: Boolean, default: false }, showProgress: { type: Boolean, default: false } });
const emit = defineEmits(['settled', 'open-memory']);
const state = ref(null);
const busy = ref(false);
const error = ref('');
const actionError = ref('');
const confirmAction = ref('');
const rebuildCount = ref(0);
let timer;
let token = 0;
let actionToken = 0;
let disposed = false;
const stages = computed(() => state.value?.stages || state.value?.job?.stages || {});
const coreJobs = computed(() => coreJobsFor(state.value));
const coreJob = computed(() => {
  const jobs = coreJobs.value;
  const selected = jobs.find((job) => job.status === 'running') || jobs.find((job) => job.status === 'queued')
    || jobs.find((job) => ['failed', 'cancelled'].includes(job.status)) || jobs.at(-1);
  return selected && selected.id === state.value?.job?.id ? { ...selected, canRetry: state.value.job.canRetry } : selected;
});
const coreReady = computed(() => state.value?.coreReady ?? state.value?.job?.coreReady
  ?? (!coreJobs.value.some((job) => ['queued', 'running', 'failed', 'cancelled'].includes(job.status)) && ['ready', 'legacy'].includes(state.value?.stateStatus)));
const pendingCount = computed(() => state.value?.corePendingCount ?? state.value?.job?.corePendingCount
  ?? state.value?.job?.pendingCount ?? coreJobs.value.filter((job) => ['queued', 'running'].includes(job.status)).length);
const failedCount = computed(() => state.value?.coreFailedCount ?? state.value?.job?.coreFailedCount
  ?? state.value?.job?.failedCount ?? coreJobs.value.filter((job) => ['failed', 'cancelled'].includes(job.status)).length);
const failedCore = computed(() => coreJobs.value.find((job) => ['failed', 'cancelled'].includes(job.status)));
const coreFailure = computed(() => failedCore.value ? failureMessage(failedCore.value.error) : '');
const derivedJobs = computed(() => ['summary', 'index'].flatMap((stage) => stageJobs(stages.value[stage])
  .filter((job) => ['queued', 'running', 'failed', 'cancelled'].includes(job.status))
  .map((job, index) => ({ ...job, stage, label: `${stage === 'index' ? '检索索引' : '分层摘要'}${index ? ` ${index + 1}` : ''}` }))));
const active = computed(() => ['queued', 'running'].includes(coreJob.value?.status));
const derivedActive = computed(() => derivedJobs.value.some((job) => ['queued', 'running'].includes(job.status)));
const displayedDerivedJobs = computed(() => props.showProgress ? derivedJobs.value : derivedJobs.value.filter(job => ['failed', 'cancelled'].includes(job.status)));
const visible = computed(() => props.showProgress && active.value || Boolean(failedCore.value) || displayedDerivedJobs.value.length || ['needs_review', 'needs_rebuild', 'legacy_partial', 'stale'].includes(state.value?.stateStatus) || Boolean(error.value || actionError.value));
const label = computed(() => {
  if (error.value) return props.showProgress ? error.value : '记忆同步状态暂不可用';
  if (!props.showProgress) return coreReady.value ? '部分后台记忆任务待恢复，可继续对话' : '部分剧情记忆待恢复';
  if (active.value) return `核心记忆同步 ${coreJob.value.progress || 0}% · 待处理 ${pendingCount.value || 1} 轮${failedCount.value ? ` · ${failedCount.value} 轮待恢复` : ''}`;
  if (coreReady.value && derivedActive.value) return '核心记忆已就绪 · 摘要或检索索引在后台更新，可继续对话';
  if (coreReady.value && derivedJobs.value.length) return '核心记忆已就绪 · 部分后台检索待重试，可继续对话';
  if (state.value?.stateStatus === 'legacy_partial') return '此历史记录未包含完整剧情状态';
  if (state.value?.stateStatus === 'needs_review') return '剧情状态同步未完成';
  return '历史已修改，剧情状态待重建';
});

/** Accept stage arrays from the HTTP contract and individual jobs used by older callers. */
function stageJobs(stage) {
  const jobs = Array.isArray(stage) ? stage : stage?.job ? [stage.job] : stage ? [stage] : [];
  return jobs.filter((job) => job && (job.id || job.status));
}

/** Optional raw-mode work must not become a blocking core failure. */
function coreJobsFor(value) {
  const stage = (value?.stages || value?.job?.stages)?.core;
  const required = (job) => job.payload?.requiredStages?.length !== 0;
  const jobs = stageJobs(stage).filter(required);
  return stage !== undefined ? jobs : value?.job && required(value.job) && (!value.job.stage || value.job.stage === 'core') ? [value.job] : [];
}

/** Derived status changes must not cause chat or domain panels to reload. */
function coreTransitionKey(value) {
  return JSON.stringify([value?.stateStatus, value?.coreReady ?? value?.job?.coreReady,
    coreJobsFor(value).map(({ id, status }) => [id, status])]);
}

/** Keep the provider's public reason, with a recovery action for a known schema mismatch. */
function failureMessage(failure) {
  const message = failure?.message || '任务未完成，请重试；若反复失败，请检查模型配置和服务端日志。';
  return /no (?:such )?(?:column|table)|has no column named/i.test(message)
    ? '服务端记忆数据结构需要升级。请重启后端完成升级，再重试同步；若仍失败，请查看服务端日志。'
    : message;
}

function isCurrentAction(id, current) { return !disposed && id === props.conversationId && current === actionToken; }

async function refresh() {
  const id = props.conversationId;
  const current = ++token;
  clearTimeout(timer);
  if (!id || disposed) return;
  try {
    const next = await fetchConversationProcessing(id);
    if (disposed || current !== token || id !== props.conversationId) return;
    const previous = state.value;
    state.value = next;
    error.value = '';
    // Only core transitions refresh domain panels; derived completion never reloads chat messages.
    if (previous && coreTransitionKey(previous) !== coreTransitionKey(next)) emit('settled', next);
  } catch (failure) {
    if (disposed || current !== token) return;
    error.value = failure.message;
  } finally {
    if (!disposed && current === token && (active.value || derivedActive.value) && !error.value) {
      timer = setTimeout(refresh, 1000);
    }
  }
}

/** Preview the replay range before recovery and retain failed actions for an explicit retry. */
async function action(name, confirmed = false) {
  if (busy.value || props.generating && ['rebuild', 'accept'].includes(name)) return;
  const id = props.conversationId;
  const jobId = coreJob.value?.id;
  const current = ++actionToken;
  busy.value = true;
  actionError.value = '';
  try {
    if (name === 'rebuild' && !confirmed) {
      const preview = await rebuildConversationProcessing(id);
      if (!isCurrentAction(id, current)) return;
      if (preview?.confirmationRequired !== true || !Number.isSafeInteger(preview.turnCount) || preview.turnCount < 0) {
        throw new Error('无法获取有效的重建范围，请刷新同步状态后重试。');
      }
      rebuildCount.value = preview.turnCount;
      confirmAction.value = 'rebuild';
      return;
    }
    if (name === 'accept' && !confirmed) { confirmAction.value = 'accept'; return; }
    if (name === 'cancel' || name === 'retry') {
      await (name === 'retry' ? retryJob(jobId) : cancelJob(jobId));
    } else {
      await rebuildConversationProcessing(id, { confirmed: true, acceptCurrent: name === 'accept',
        ...(name === 'rebuild' ? { expectedTurnCount: rebuildCount.value } : {}) });
    }
    if (!isCurrentAction(id, current)) return;
    confirmAction.value = '';
    await refresh();
    if (isCurrentAction(id, current)) emit('settled', state.value);
  } catch (failure) {
    if (isCurrentAction(id, current)) actionError.value = failure.message;
  } finally {
    if (isCurrentAction(id, current)) busy.value = false;
  }
}

/** Retry only this derived job; other batches and core readiness keep their own states. */
async function retryDerived(job) {
  if (busy.value) return;
  const id = props.conversationId;
  const current = ++actionToken;
  busy.value = true;
  actionError.value = '';
  try {
    await retryJob(job.id);
    if (isCurrentAction(id, current)) await refresh();
  } catch (failure) {
    if (isCurrentAction(id, current)) actionError.value = failure.message;
  } finally { if (isCurrentAction(id, current)) busy.value = false; }
}

watch(() => [props.conversationId, props.refreshKey], () => { confirmAction.value = ''; void refresh(); }, { immediate: true });
watch(() => props.conversationId, () => { actionToken += 1; busy.value = false; state.value = null; error.value = ''; actionError.value = ''; });
onBeforeUnmount(() => { disposed = true; token += 1; clearTimeout(timer); });
</script>

<template>
  <section v-if="visible" class="chat-processing-status" aria-label="剧情同步状态">
    <div class="processing-summary" role="status" aria-live="polite">
      <LoaderCircle v-if="active && showProgress" :size="16" aria-hidden="true" />
      <Check v-else-if="coreReady && !error" :size="16" aria-hidden="true" />
      <TriangleAlert v-else :size="16" aria-hidden="true" />
      <span>{{ label }}</span>
    </div>
    <button v-if="!showProgress" type="button" @click="emit('open-memory')">查看记忆</button>
    <div v-else-if="!confirmAction" class="processing-actions">
      <button v-if="active" type="button" class="icon-button" title="取消同步" aria-label="取消同步" :disabled="busy" @click="action('cancel')"><Square :size="16" /></button>
      <button v-else-if="coreJob?.canRetry" type="button" class="icon-button" title="重试同步" aria-label="重试同步" :disabled="busy" @click="action('retry')"><RefreshCw :size="16" /></button>
      <button v-if="!active && !error && !coreReady" type="button" :disabled="busy || generating" @click="action('rebuild')"><RefreshCw :size="16" />重建状态</button>
      <button v-if="!active && !error && !coreReady" type="button" :disabled="busy || generating" @click="action('accept')"><Check :size="16" />保留当前状态</button>
      <button v-if="error" type="button" class="icon-button" title="刷新同步状态" aria-label="刷新同步状态" @click="refresh"><RefreshCw :size="16" /></button>
    </div>
    <div v-else class="processing-confirm" role="group" aria-label="确认剧情状态操作">
      <span>{{ confirmAction === 'rebuild' ? rebuildCount > 0 ? `重建 ${rebuildCount} 轮剧情状态？可能产生模型调用费用。` : '没有需要重新处理的回复。将恢复已保存的剧情状态，本次不发起剧情重建模型调用。' : '将当前状态作为新的剧情基线？' }}</span>
      <button type="button" :disabled="busy || generating" @click="action(confirmAction, true)"><Check :size="16" />确认</button>
      <button type="button" :disabled="busy" @click="confirmAction = ''">取消</button>
    </div>
    <p v-if="showProgress && coreFailure" class="processing-error" role="alert">核心同步失败：{{ coreFailure }}</p>
    <p v-if="showProgress && actionError" class="processing-error" role="alert">操作未完成：{{ actionError }}</p>
    <ul v-if="showProgress && displayedDerivedJobs.length" class="processing-derived" aria-label="后台派生任务">
      <li v-for="job in displayedDerivedJobs" :key="job.id || `${job.stage}:${job.label}`">
        <span>{{ job.label }} · {{ ({ queued: '等待中', running: '处理中', failed: '失败', cancelled: '已取消' })[job.status] }}<template v-if="job.error">：{{ failureMessage(job.error) }}</template></span>
        <button v-if="['failed', 'cancelled'].includes(job.status) && job.id" type="button" :aria-label="`重试${job.label}`" :disabled="busy" @click="retryDerived(job)"><RefreshCw :size="16" />重试{{ job.stage === 'index' ? '索引' : '摘要' }}</button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.chat-processing-status { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 8px 16px; border-bottom: 1px solid var(--line); color: var(--text); background: var(--surface); font-size: 13px; }
.processing-summary { display: flex; align-items: center; gap: 8px; flex: 1 1 180px; min-width: 0; overflow-wrap: anywhere; }
.processing-summary svg { flex-shrink: 0; }
.processing-actions, .processing-confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.processing-confirm span { flex: 1 1 180px; }
.processing-error { flex-basis: 100%; margin: 0; color: var(--danger, #a33b32); overflow-wrap: anywhere; line-height: 1.6; }
.processing-derived { flex-basis: 100%; display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
.processing-derived li { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.processing-derived li > span { flex: 1 1 200px; min-width: 0; overflow-wrap: anywhere; }
button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 36px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px; background: transparent; color: inherit; cursor: pointer; font: inherit; }
button:hover { background: var(--surface-hover, var(--bg)); }
button:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
button:disabled { opacity: .5; cursor: default; }
.icon-button { width: 36px; flex-shrink: 0; padding: 6px; }
@media (max-width: 600px) { button { min-height: 44px; } .icon-button { width: 44px; } .chat-processing-status { padding-inline: 12px; } }
</style>
