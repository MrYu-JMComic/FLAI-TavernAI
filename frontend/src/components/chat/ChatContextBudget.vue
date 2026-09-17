<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { RefreshCw, Save } from '@lucide/vue';
import { apiRequest } from '../../api/core.js';
import { useNotify } from '../../composables/useNotify';

const props = defineProps({ conversationId: { type: String, required: true }, open: { type: Boolean, default: true } });
const emit = defineEmits(['changed']);
const notify = useNotify();
const BUDGET_CONFIG_FIELDS = ['inputTokenLimit', 'reservedOutputTokens', 'imageTokensPerImage', 'contextWindowTokens'];
const config = reactive({ inputTokenLimit: '', reservedOutputTokens: '', imageTokensPerImage: '', contextWindowTokens: '' });
const resolved = ref(null);
const provider = ref(null);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const MAX_BUDGET_VALUE = 10_000_000;
let token = 0;
let disposed = false;

const rows = computed(() => resolved.value ? [
  ['上下文窗口', resolved.value.contextWindowTokens],
  ['输入上下文上限', resolved.value.inputTokenLimit],
  ['输入窗口预留', resolved.value.reservedOutputTokens],
  ['每张图片', resolved.value.imageTokensPerImage]
] : []);

function resetState() {
  for (const key of BUDGET_CONFIG_FIELDS) config[key] = '';
  resolved.value = null;
  provider.value = null;
  loading.value = false;
  saving.value = false;
  error.value = '';
}

async function load() {
  const conversationId = props.conversationId;
  if (!props.open || !conversationId) return;
  const current = ++token;
  loading.value = true;
  error.value = '';
  try {
    const result = await apiRequest(`/api/conversations/${encodeURIComponent(conversationId)}/context/budget`);
    if (!isCurrent(conversationId, current)) return;
    for (const key of BUDGET_CONFIG_FIELDS) config[key] = result.config?.[key] ?? '';
    resolved.value = result.resolved || null;
    provider.value = result.provider || null;
  } catch (failure) {
    if (isCurrent(conversationId, current)) error.value = failure?.message || '预算加载失败';
  } finally { if (isCurrent(conversationId, current)) loading.value = false; }
}

async function save() {
  if (!props.open || !props.conversationId || loading.value || saving.value) return;
  const conversationId = props.conversationId;
  const current = ++token;
  saving.value = true;
  error.value = '';
  try {
    const body = buildBudgetPayload();
    const result = await apiRequest(`/api/conversations/${encodeURIComponent(conversationId)}/context/budget`, {
      method: 'PUT', body: JSON.stringify(body)
    });
    if (!isCurrent(conversationId, current)) return;
    for (const key of BUDGET_CONFIG_FIELDS) config[key] = result.config?.[key] ?? '';
    resolved.value = result.resolved || null;
    provider.value = result.provider || null;
    notify.success('上下文预算已保存');
    emit('changed', result);
  } catch (failure) {
    if (!isCurrent(conversationId, current)) return;
    error.value = failure?.message || '预算保存失败';
    notify.error(error.value);
  } finally { if (isCurrent(conversationId, current)) saving.value = false; }
}

function buildBudgetPayload() {
  const entries = [];
  for (const key of BUDGET_CONFIG_FIELDS) {
    const value = config[key];
    if (value === '') {
      entries.push([key, null]);
      continue;
    }
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric < 1 || numeric > MAX_BUDGET_VALUE) {
      throw new Error('预算字段必须是 1 到 10000000 之间的整数');
    }
    entries.push([key, numeric]);
  }
  return Object.fromEntries(entries);
}

function isCurrent(conversationId, current) { return !disposed && props.open && props.conversationId === conversationId && token === current; }
function resolvedValue(row) {
  if (row[0] === '上下文窗口' && row[1] == null) return '未设置';
  return Number(row[1] || 0).toLocaleString('zh-CN');
}
watch(() => [props.conversationId, props.open], () => { token += 1; resetState(); void load(); }, { immediate: true });
onBeforeUnmount(() => { disposed = true; token += 1; resetState(); });
</script>

<template>
  <section class="context-budget" aria-label="输入上下文预算设置" :aria-busy="loading || saving">
    <header>
      <div>
        <h3>上下文预算</h3>
        <p>{{ provider?.providerType || '未配置' }} · {{ provider?.model || '未选择模型' }}</p>
      </div>
      <button class="icon" type="button" title="刷新预算" aria-label="刷新预算" :disabled="loading || saving" @click="load">
        <RefreshCw :size="17" />
      </button>
    </header>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <form @submit.prevent="save">
      <label>输入上下文 Token 上限<input v-model="config.inputTokenLimit" :placeholder="String(resolved?.inputTokenLimit || 16384)" :disabled="loading || saving" type="number" min="1" max="10000000" step="1"></label>
      <label>输入窗口预留 Token<input v-model="config.reservedOutputTokens" :placeholder="String(resolved?.reservedOutputTokens || 4096)" :disabled="loading || saving" type="number" min="1" max="10000000" step="1"></label>
      <label>每张图片估算 Token<input v-model="config.imageTokensPerImage" :placeholder="String(resolved?.imageTokensPerImage || 1024)" :disabled="loading || saving" type="number" min="1" max="10000000" step="1"></label>
      <label>模型上下文窗口<input v-model="config.contextWindowTokens" :disabled="loading || saving" type="number" min="1" max="10000000" step="1" placeholder="未设置"></label>
      <button class="primary" type="submit" :disabled="loading || saving"><Save :size="17" />{{ saving ? '保存中' : '保存' }}</button>
    </form>
    <dl v-if="rows.length"><div v-for="row in rows" :key="row[0]"><dt>{{ row[0] }}</dt><dd>{{ resolvedValue(row) }}</dd></div></dl>
    <p v-if="resolved" class="notice">估算值 · 非精确计数<span v-if="resolved.warning"> · {{ resolved.warning }}</span></p>
  </section>
</template>

<style scoped>
.context-budget { display: grid; gap: 14px; min-width: 0; } header, header div { display: flex; align-items: center; gap: 8px; min-width: 0; } header { flex-wrap: wrap; justify-content: space-between; } header div { flex: 1 1 220px; flex-wrap: wrap; } h3, p { margin: 0; } h3 { font-size: .94rem; } header p, .notice { color: var(--muted); font-size: .76rem; overflow-wrap: anywhere; }
form { display: grid; gap: 10px; } label { display: grid; gap: 5px; color: var(--muted); font-size: .78rem; } input { min-height: 38px; padding: 7px 9px; border: 1px solid var(--line); border-radius: 6px; color: var(--text); background: var(--surface); font: inherit; }
button { display: inline-flex; min-height: 38px; align-items: center; justify-content: center; gap: 6px; padding: 7px 10px; border: 1px solid var(--line); border-radius: 6px; color: var(--text); background: var(--surface); cursor: pointer; } button:disabled { opacity: .5; cursor: default; } button:focus-visible, input:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; } .icon { width: 38px; padding: 6px; } .primary { color: #fff; border-color: var(--primary); background: var(--primary); }
dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 0; } dl div { padding: 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface-strong); } dt { color: var(--muted); font-size: .72rem; } dd { margin: 3px 0 0; font-weight: 750; } .error { padding: 8px; color: var(--danger); background: var(--danger-soft); }
@media (max-width: 640px) { button, input { min-height: var(--touch-min); } .icon { width: var(--touch-min); } dl { grid-template-columns: 1fr; } }
</style>
