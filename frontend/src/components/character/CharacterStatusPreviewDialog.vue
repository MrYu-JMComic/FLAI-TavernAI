<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RotateCcw, X } from '@lucide/vue';
import StatusBar from '../StatusBar.vue';
import { normalizeStatusBarBlueprintForPayload } from '../../composables/character/useCharacterStatusBlueprint.js';
import { normalizeStatusVariableKey, resolveStatusVariableKind } from '../../../../shared/statusVariables.js';

const props = defineProps({
  statusBar: { type: Object, default: null },
  templateConfig: { type: Object, required: true },
  sourceLabel: { type: String, default: '当前草稿' },
  context: { type: Object, default: () => ({}) }
});

const emit = defineEmits(['close']);
const dialog = ref(null);
const preview = ref(null);
const actionPreview = ref('');
const previewId = `character-status-preview-${Math.random().toString(36).slice(2)}`;
let previousFocus = null;

function resetPreview() {
  preview.value = props.statusBar ? {
    ...JSON.parse(JSON.stringify(props.statusBar)),
    id: previewId
  } : null;
  actionPreview.value = '';
}

// This copy is deliberately local: trying a template's buttons must never
// update the character draft or call a conversation save endpoint.
function updateVariables(updates) {
  if (!preview.value || !Array.isArray(updates)) return;
  const variables = [...(preview.value.variables || [])];
  for (const update of updates) {
    const key = normalizeStatusVariableKey(update?.name);
    if (!key || update.value === undefined) continue;
    const index = variables.findIndex((variable) => normalizeStatusVariableKey(variable.name) === key);
    const current = index < 0 ? { name: update.name } : variables[index];
    const next = { ...current, value: update.value };
    if (Number.isFinite(Number(update.max)) && update.max !== null && update.max !== '') next.max = Number(update.max);
    if (index < 0) variables.push(next);
    else variables[index] = next;
  }
  preview.value = {
    ...preview.value,
    variables: normalizeStatusBarBlueprintForPayload({ ...preview.value, variables }).variables
  };
}

function previewAction(label, text = '') {
  actionPreview.value = `${label}${text ? `：${text}` : ''}`;
}

function isNumeric(variable) {
  return ['meter', 'number'].includes(resolveStatusVariableKind(variable));
}

watch(() => props.statusBar, resetPreview, { immediate: true, deep: true });

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
  <dialog
    ref="dialog"
    class="status-preview-dialog form-panel"
    aria-modal="true"
    aria-labelledby="status-preview-title"
    @cancel.prevent="emit('close')"
    @click="($event.target === dialog) && emit('close')"
  >
    <header class="status-preview-header">
      <div>
        <h2 id="status-preview-title">状态栏预览</h2>
        <p>{{ sourceLabel }} · 预览调整不会保存到角色卡。</p>
      </div>
      <button class="icon-button status-preview-close" type="button" aria-label="关闭状态栏预览" autofocus @click="emit('close')"><X :size="18" /></button>
    </header>
    <div class="status-preview-body">
      <StatusBar
        v-if="preview"
        :status-bar="preview"
        :template-config="templateConfig"
        :context="context"
        @update-variables="updateVariables"
        @quick-reply="previewAction('快捷回复预览', $event)"
        @send="previewAction('发送预览', $event)"
        @script-action="previewAction('脚本操作预览', $event.name)"
        @open-settings="previewAction('设置按钮已触发，可返回角色编辑调整状态栏')"
        @escape="emit('close')"
      />
      <p v-else class="muted-text status-blueprint-empty">尚未配置状态栏，添加变量或模板后即可预览。</p>
    </div>
    <details v-if="preview?.variables?.length" class="status-preview-variables">
      <summary>调整预览变量（{{ preview.variables.length }} 项）</summary>
      <div class="status-preview-variable-grid">
        <label v-for="variable in preview.variables" :key="variable.name">
          <span>{{ variable.name }}</span>
          <input :value="variable.value" :type="isNumeric(variable) ? 'number' : 'text'" :aria-label="`预览变量 ${variable.name}`" @input="updateVariables([{ name: variable.name, value: $event.target.value }])" />
        </label>
      </div>
    </details>
    <p v-if="actionPreview" class="status-preview-action" role="status">{{ actionPreview }}</p>
    <footer class="status-preview-footer">
      <button v-if="preview" class="ghost-button" type="button" @click="resetPreview"><RotateCcw :size="15" />重置预览变量</button>
      <button class="ghost-button" type="button" @click="emit('close')">关闭预览</button>
    </footer>
  </dialog>
</template>

<style scoped>
.status-preview-dialog { padding: 20px; color: var(--text); background: var(--surface); border: 1px solid var(--line); border-radius: 18px; }
.status-preview-dialog::backdrop { background: rgb(0 0 0 / 55%); backdrop-filter: blur(8px); }
.status-preview-variables summary { cursor: pointer; color: var(--muted); font-size: .85rem; }
.status-preview-variable-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 14px; }
.status-preview-variable-grid label { display: grid; gap: 6px; min-width: 0; font-size: .85rem; overflow-wrap: anywhere; }
.status-preview-variable-grid input { width: 100%; min-width: 0; }
.status-preview-action { margin: 0; padding: 10px 12px; color: var(--muted); background: var(--surface-strong); border-radius: 8px; font-size: .85rem; white-space: pre-wrap; overflow-wrap: anywhere; }
.status-preview-footer { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; padding-top: 12px; border-top: 1px solid var(--line); }
@media (max-width: 600px) { .status-preview-dialog { padding: 16px; } .status-preview-variable-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
