<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ArrowLeft, RefreshCw } from '@lucide/vue';
import { apiRequest } from '../../api/core.js';

const props = defineProps({ conversationId: { type: String, required: true }, open: { type: Boolean, default: true } });
const traces = ref([]);
const detail = ref(null);
const loading = ref(false);
const error = ref('');
let token = 0;
let disposed = false;

const detailJson = computed(() => detail.value ? {
  logicalMessages: detail.value.logicalMessages || [],
  selection: detail.value.selection || {},
  budget: detail.value.budget || {}
} : null);
const detailSummary = computed(() => detail.value
  ? `${date(detail.value.createdAt)} · ${detail.value.requestCount ?? detail.value.requests?.length ?? 0} 次传输`
  : `${traces.value.length} 条记录`);

async function loadList() {
  const conversationId = props.conversationId;
  if (!props.open || !conversationId) return;
  const current = ++token; loading.value = true; error.value = '';
  try {
    const result = await apiRequest(`/api/conversations/${encodeURIComponent(conversationId)}/context/traces`);
    if (isCurrent(conversationId, current)) traces.value = Array.isArray(result?.traces) ? result.traces : [];
  } catch (failure) { if (isCurrent(conversationId, current)) error.value = failure?.message || '请求历史加载失败'; }
  finally { if (isCurrent(conversationId, current)) loading.value = false; }
}

async function openTrace(traceId) {
  const conversationId = props.conversationId;
  const current = ++token; loading.value = true; error.value = '';
  try {
    const result = await apiRequest(`/api/conversations/${encodeURIComponent(conversationId)}/context/traces/${encodeURIComponent(traceId)}`);
    if (isCurrent(conversationId, current)) detail.value = result || null;
  } catch (failure) { if (isCurrent(conversationId, current)) error.value = failure?.message || '请求详情加载失败'; }
  finally { if (isCurrent(conversationId, current)) loading.value = false; }
}

function isCurrent(conversationId, current) { return !disposed && props.open && props.conversationId === conversationId && token === current; }
function pretty(value) { try { return JSON.stringify(value, null, 2); } catch { return '[无法序列化]'; } }
function date(value) { return value ? new Date(value).toLocaleString('zh-CN') : '-'; }
function tokenCount(request) { return request?.tokenEstimate?.estimatedTokens ?? request?.tokenEstimate?.tokens ?? 0; }
function coverageLabel(request) {
  const estimate = request?.tokenEstimate || {};
  return estimate.inheritedContext
    ? `继承上下文 · ${estimate.coverage || '仅当前请求'}`
    : `完整构建上下文 · ${estimate.coverage || 'constructed-request'}`;
}
function truncated(value) { return Boolean(value?.truncated); }
watch(() => [props.conversationId, props.open], () => { token += 1; traces.value = []; detail.value = null; error.value = ''; void loadList(); }, { immediate: true });
onBeforeUnmount(() => { disposed = true; token += 1; });
</script>

<template>
  <section class="prompt-history" aria-label="实际请求历史" :aria-busy="loading">
    <header>
      <div>
        <h3>{{ detail ? '请求详情' : '实际请求' }}</h3>
        <p>{{ detailSummary }}</p>
      </div>
      <button class="icon" type="button" :title="detail ? '返回列表' : '刷新'" :aria-label="detail ? '返回请求列表' : '刷新请求历史'" @click="detail ? (detail = null) : loadList()">
        <ArrowLeft v-if="detail" :size="17" />
        <RefreshCw v-else :size="17" />
      </button>
    </header>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <template v-if="detail">
      <div class="tags"><span>生成状态：{{ detail.status }}</span><span>{{ detail.providerType }} · {{ detail.model || '未指定模型' }}</span><span>{{ detail.outdated ? '已过期' : '当前时间线' }}</span><span>估算 Token · 非精确</span><span v-if="detail.redacted">敏感字段已脱敏</span></div>
      <section v-if="!detail.requests?.length" class="empty">未记录线上传输：可能未发出请求或使用了 mock。</section>
      <article v-for="request in detail.requests || []" :key="request.id" class="request">
        <h4>传输 {{ request.ordinal }} · HTTP {{ request.httpStatus ?? '未返回' }}</h4>
        <p>{{ request.method }} {{ request.host }}{{ request.endpoint }} · 传输状态 {{ request.status }}</p>
        <p>尝试 {{ request.attempt ?? 1 }} · 重定向 {{ request.redirectHop ?? 0 }} · 鉴权 {{ request.authMode || '未记录' }}</p>
        <p>估算 Token {{ tokenCount(request).toLocaleString('zh-CN') }} · {{ coverageLabel(request) }}</p>
        <p v-if="request.errorCode">错误码：{{ request.errorCode }}</p>
        <p v-if="request.body?.truncated">请求 JSON 已截断，原始字符 {{ request.body.originalCharacters }}</p>
        <p v-if="request.redactions?.length">脱敏 {{ request.redactions.length }} 处：{{ request.redactions.map((item) => item.reason).join('、') }}</p>
        <pre>{{ pretty(request.body) }}</pre>
      </article>
      <div v-if="truncated(detail.logicalMessages) || truncated(detail.selection) || truncated(detail.budget)" class="notices" role="status">
        <p v-if="truncated(detail.logicalMessages)">逻辑消息记录已截断，原始字符 {{ detail.logicalMessages.originalCharacters }}</p>
        <p v-if="truncated(detail.selection)">选择记录已截断，原始字符 {{ detail.selection.originalCharacters }}</p>
        <p v-if="truncated(detail.budget)">预算记录已截断，原始字符 {{ detail.budget.originalCharacters }}</p>
      </div>
      <h4>逻辑消息、选择与预算</h4><pre>{{ pretty(detailJson) }}</pre>
    </template>
    <ul v-else-if="traces.length">
      <li v-for="trace in traces" :key="trace.id"><button type="button" @click="openTrace(trace.id)"><strong>{{ trace.operation }} · {{ trace.status }}</strong><span>{{ trace.providerType }} · {{ trace.model || '未指定模型' }}</span><span>{{ date(trace.createdAt) }} · {{ trace.requestCount }} 次传输</span><span v-if="trace.errorCode">{{ trace.errorCode }}</span></button></li>
    </ul>
    <p v-else-if="!loading" class="empty">暂无实际请求记录</p>
  </section>
</template>

<style scoped>
.prompt-history { display: grid; gap: 12px; min-width: 0; } header, header div { display: flex; align-items: center; gap: 8px; min-width: 0; } header { flex-wrap: wrap; justify-content: space-between; } header div { flex: 1 1 220px; flex-wrap: wrap; } h3, h4, p { margin: 0; } h3 { font-size: .94rem; } h4 { font-size: .82rem; } header p, .request p, li span, .empty, .notices { color: var(--muted); font-size: .76rem; overflow-wrap: anywhere; }
button { min-height: 38px; border: 1px solid var(--line); border-radius: 6px; color: var(--text); background: var(--surface); cursor: pointer; } button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; } .icon { display: grid; width: 38px; place-items: center; padding: 6px; } ul { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; } li button { display: grid; width: 100%; min-width: 0; gap: 3px; padding: 10px; text-align: left; } li strong { overflow-wrap: anywhere; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; } .tags span { min-width: 0; padding: 4px 7px; border: 1px solid var(--line); border-radius: 999px; color: var(--muted); font-size: .72rem; overflow-wrap: anywhere; } .request { display: grid; gap: 6px; min-width: 0; padding: 10px; border: 1px solid var(--line); border-radius: 6px; } .request h4 { overflow-wrap: anywhere; }
pre { max-height: 340px; margin: 0; padding: 10px; overflow: auto; border: 1px solid var(--line); border-radius: 6px; color: var(--text); background: var(--surface-strong); font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; } .error { padding: 8px; color: var(--danger); background: var(--danger-soft); }
.notices { display: grid; gap: 4px; padding: 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface-strong); }
@media (max-width: 640px) { button { min-height: var(--touch-min); } .icon { width: var(--touch-min); } }
</style>
