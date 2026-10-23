<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { Check, History, LoaderCircle, RotateCcw, X } from '@lucide/vue';

const props = defineProps({
  versions: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
  canResetDraft: { type: Boolean, default: false },
  resettingDraft: { type: Boolean, default: false },
  draftReset: { type: Boolean, default: false },
  resetError: { type: String, default: '' }
});
const emit = defineEmits(['close', 'reload', 'restore', 'reset-draft']);
const dialog = ref(null);
const operationBusy = computed(() => props.busy || props.resettingDraft);
let previousFocus;

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { hour12: false });
}

onMounted(() => {
  previousFocus = document.activeElement;
  dialog.value?.showModal();
});
onBeforeUnmount(() => {
  dialog.value?.close();
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
});
</script>

<template>
  <dialog ref="dialog" class="assistant-history-dialog" aria-labelledby="assistant-history-title" @cancel.prevent="!operationBusy && emit('close')" @click="($event.target === dialog && !operationBusy) && emit('close')">
    <header>
      <div><h2 id="assistant-history-title"><History :size="19" />草稿历史版本</h2><p>选择历史草稿继续编辑，或用已保存角色卡重新开始。</p></div>
      <button class="icon-button" type="button" aria-label="关闭历史版本" :disabled="operationBusy" autofocus @click="emit('close')"><X :size="19" /></button>
    </header>
    <div class="assistant-history-body">
      <div class="history-reset-draft">
        <strong>以已保存角色卡为准</strong>
        <p>从数据库读取完整角色卡并覆盖当前会话草稿，清除旧计划与待应用修改；当前草稿会先保留为历史版本。</p>
        <button class="ghost-button" type="button" aria-label="用已保存角色卡覆盖草稿" :aria-busy="resettingDraft" :disabled="!canResetDraft || operationBusy || loading" @click="emit('reset-draft')"><LoaderCircle v-if="resettingDraft" :size="15" class="spinning" /><RotateCcw v-else :size="15" />{{ resettingDraft ? '正在覆盖草稿…' : '用已保存角色卡覆盖草稿' }}</button>
        <p v-if="draftReset" class="reset-success" role="status"><Check :size="14" />已用已保存角色卡覆盖当前草稿。</p>
        <div v-if="resetError" class="history-error" role="alert"><p>{{ resetError }}</p><button class="ghost-button" type="button" :disabled="!canResetDraft || operationBusy || loading" @click="emit('reset-draft')">重试覆盖草稿</button></div>
      </div>
      <p v-if="loading" role="status"><LoaderCircle :size="16" />正在读取历史版本…</p>
      <div v-if="error" class="history-error" role="alert"><p>{{ error }}</p><button class="ghost-button" type="button" :disabled="operationBusy || loading" @click="emit('reload')">重新读取</button></div>
      <ol v-if="versions.length">
        <li v-for="version in versions" :key="version.id">
          <div class="version-info"><strong>{{ version.title }}</strong><time :datetime="version.createdAt">{{ formatDate(version.createdAt) }}</time></div>
          <div class="version-actions">
            <button class="ghost-button" type="button" title="恢复到当前助手草稿" :disabled="operationBusy || loading" @click="emit('restore', version.id)"><RotateCcw :size="14" />恢复此版</button>
          </div>
        </li>
      </ol>
      <p v-else-if="!loading && !error">暂无历史版本。AI 修改草稿时会自动保留修改前后的版本。</p>
    </div>
    <footer><small>最多保留最近 30 个版本；恢复或覆盖前的草稿也会保留。对话记录保持完整。</small><button class="ghost-button" type="button" :disabled="operationBusy" @click="emit('close')">关闭</button></footer>
  </dialog>
</template>

<style scoped>
.assistant-history-dialog { width: min(680px, calc(100vw - 24px)); max-height: calc(100dvh - 32px); padding: 0; color: var(--text); background: var(--surface); border: 1px solid var(--line); border-radius: 12px; }
.assistant-history-dialog::backdrop { background: rgb(0 0 0 / 55%); }
header, footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 18px 20px; }
header { border-bottom: 1px solid var(--line); }
h2 { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 1rem; }
header p, footer small { color: var(--muted); font-size: .76rem; line-height: 1.7; }
header p { margin: 6px 0 0; }
.assistant-history-body { max-height: 55dvh; overflow-y: auto; padding: 12px 20px; font-size: .83rem; }
.history-reset-draft { display: grid; justify-items: start; gap: 8px; margin-bottom: 10px; padding-bottom: 14px; border-bottom: 1px solid var(--line); }
.history-reset-draft > p { margin: 0; color: var(--muted); font-size: .76rem; line-height: 1.7; }
.history-reset-draft > button { max-width: 100%; white-space: normal; font-size: .76rem; }
.history-reset-draft .history-error { width: 100%; margin: 0; }
.history-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; padding: 9px 10px; color: var(--danger, #b42318); background: color-mix(in srgb, var(--danger, #b42318) 8%, var(--surface)); border: 1px solid color-mix(in srgb, var(--danger, #b42318) 24%, var(--line)); border-radius: 8px; }
.history-error p { min-width: 0; margin: 0; overflow-wrap: anywhere; }
ol { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--line); }
.version-info { display: grid; gap: 5px; min-width: 0; overflow-wrap: anywhere; }
li strong { font-weight: 550; white-space: pre-wrap; }
time { color: var(--muted); font-size: .72rem; }
.version-actions { display: flex; align-items: center; justify-content: flex-end; flex: 0 0 auto; gap: 6px; }
.version-actions button { min-height: 34px; padding: 6px 9px; font-size: .74rem; white-space: nowrap; }
.history-reset-draft > .reset-success { display: flex; align-items: center; gap: 5px; color: var(--success, #16803c); font-size: .74rem; }
.spinning { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
footer { border-top: 1px solid var(--line); }
footer button { flex: 0 0 auto; }
@media (max-width: 600px) {
  header, footer { padding: 12px; }
  header { align-items: flex-start; }
  header p, footer small { font-size: .72rem; }
  .assistant-history-body { max-height: 60dvh; padding: 10px 12px; }
  li { align-items: stretch; flex-direction: column; gap: 8px; padding: 10px 0; }
  .version-actions { flex-wrap: wrap; justify-content: stretch; }
  .version-actions button { flex: 1 1 120px; justify-content: center; padding-inline: 6px; }
  .history-error { align-items: flex-start; flex-direction: column; }
}
</style>
