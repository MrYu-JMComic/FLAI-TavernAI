<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import vueRuntimeUrl from 'vue/dist/vue.global.prod.js?url';
import templateStyles from '../styles/status-template.css?raw';
import { parseStatusBarRuntime } from '../../../shared/statusBarRuntime.js';
import { buildStatusBarRuntimeDocument } from '../utils/statusBarRuntimeDocument.js';

const props = defineProps({
  statusBar: { type: Object, required: true },
  context: { type: Object, default: () => ({}) },
  templateHtml: { type: String, default: null }
});
const emit = defineEmits(['quick-reply', 'send', 'update-variables', 'open-settings', 'template-ready', 'template-click', 'escape']);
const frame = ref(null);
const source = ref('');
const height = ref(80);
const error = ref('');
const loading = ref(true);
const runtime = computed(() => parseStatusBarRuntime(props.statusBar.template)
  || { framework: 'html', html: '', css: templateStyles, javascript: '' });
let runtimeId = '';
let mounted = false;
let templateRoot = null;

function templateClick(event) { emit('template-click', event); }

function syncTemplateRoot() {
  if (props.templateHtml === null) return;
  const root = frame.value?.contentDocument?.getElementById('flai-status-runtime-root');
  if (root !== templateRoot) {
    templateRoot?.removeEventListener('click', templateClick);
    templateRoot = root;
    templateRoot?.addEventListener('click', templateClick);
  }
  emit('template-ready', root);
}

function snapshot() {
  return JSON.parse(JSON.stringify({ statusBar: props.statusBar, context: props.context,
    ...(props.templateHtml === null ? {} : { templateHtml: props.templateHtml }) }));
}

function post(action, payload = {}) {
  frame.value?.contentWindow?.postMessage({ type: 'flai-status-host', id: runtimeId, action, ...payload }, '*');
}

function reload() {
  post('dispose');
  if (templateRoot) {
    templateRoot.removeEventListener('click', templateClick);
    templateRoot = null;
    emit('template-ready', null);
  }
  runtimeId = `sb-${Math.random().toString(36).slice(2)}`;
  loading.value = true;
  error.value = '';
  height.value = 80;
  const style = frame.value ? getComputedStyle(frame.value) : null;
  const themeVariables = {};
  if (style) for (const name of style) {
    if (name.startsWith('--')) themeVariables[name] = style.getPropertyValue(name);
  }
  source.value = buildStatusBarRuntimeDocument(runtime.value, {
    ...snapshot(), id: runtimeId,
    moduleUrl: new URL(vueRuntimeUrl, window.location.href).href,
    theme: { color: style?.color, colorScheme: style?.colorScheme, variables: themeVariables }
  });
}

function receive(event) {
  const data = event.data;
  if (event.source !== frame.value?.contentWindow || data?.id !== runtimeId || data?.type !== 'flai-status-runtime') return;
  if (data.action === 'resize' && Number.isFinite(data.height)) height.value = Math.max(40, Math.min(20000, data.height));
  if (data.action === 'ready') { loading.value = false; syncTemplateRoot(); post('update', snapshot()); }
  if (data.action === 'template-updated') syncTemplateRoot();
  if (data.action === 'error') { error.value = String(data.message || '运行失败').slice(0, 2000); loading.value = false; }
  if (data.action === 'update-variables' && Array.isArray(data.updates)) emit('update-variables', data.updates);
  if ((data.action === 'quick-reply' || data.action === 'send') && typeof data.text === 'string') emit(data.action, data.text);
  if (data.action === 'open-settings') emit('open-settings');
  if (data.action === 'escape') emit('escape');
}

watch([
  () => props.statusBar.id,
  () => props.statusBar.conversationId,
  () => props.statusBar.template
], () => { if (mounted) reload(); });
watch(() => [props.statusBar, props.context, props.templateHtml], () => { if (mounted) post('update', snapshot()); }, { deep: true });
onMounted(() => { mounted = true; window.addEventListener('message', receive); reload(); });
onBeforeUnmount(() => {
  mounted = false; post('dispose'); window.removeEventListener('message', receive);
  templateRoot?.removeEventListener('click', templateClick);
  emit('template-ready', null);
});
</script>

<template>
  <div class="status-bar-runtime" :aria-busy="loading">
    <p v-if="loading" class="runtime-loading" role="status">正在加载状态栏…</p>
    <div v-if="error" class="runtime-error" role="alert">
      <strong>状态栏运行错误</strong>
      <pre>{{ error }}</pre>
      <button type="button" @click="reload">重新运行</button>
    </div>
    <iframe ref="frame" :srcdoc="source" :style="{ height: `${height}px` }" title="自定义状态栏" class="runtime-frame"></iframe>
  </div>
</template>

<style scoped>
.status-bar-runtime { width: 100%; min-width: 0; }
.runtime-frame { display: block; width: 100%; border: 0; background: transparent; color-scheme: inherit; }
.runtime-loading { margin: 8px; color: var(--text-secondary); font-size: 12px; }
.runtime-error { padding: 12px; border: 1px solid var(--danger, #e26c6c); border-radius: 10px; color: var(--danger, #e26c6c); }
.runtime-error pre { margin: 8px 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; }
.runtime-error button { padding: 5px 12px; border: 1px solid currentColor; border-radius: 6px; color: inherit; background: transparent; cursor: pointer; }
</style>
