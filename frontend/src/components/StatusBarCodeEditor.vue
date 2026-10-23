<script setup>
import { computed, ref } from 'vue';
import { Code, Eye, Sparkles } from '@lucide/vue';
import StatusBar from './StatusBar.vue';
import {
  createStatusBarRuntimeExample,
  parseStatusBarRuntime,
  serializeStatusBarRuntime,
  STATUS_BAR_RUNTIME_LIMIT
} from '../../../shared/statusBarRuntime.js';

const props = defineProps({
  modelValue: { type: String, default: '' },
  variables: { type: Array, default: () => [] },
  name: { type: String, default: '状态栏' },
  disabled: { type: Boolean, default: false }
});
const emit = defineEmits(['update:modelValue']);
const previewOpen = ref(false);
const previewVariables = ref(null);
const previewNotice = ref('');
const config = computed(() => parseStatusBarRuntime(props.modelValue) || createStatusBarRuntimeExample());
const codeLengthExceeded = computed(() => props.modelValue.length > STATUS_BAR_RUNTIME_LIMIT);
const formattedCodeLimit = STATUS_BAR_RUNTIME_LIMIT.toLocaleString();
const codeFields = [
  { key: 'html', label: 'HTML / Vue 模板', rows: 12, placeholder: '<section>{{ values["体力"] }}</section>' },
  { key: 'css', label: 'CSS', rows: 9, placeholder: 'body { margin: 0; }' },
  { key: 'javascript', label: 'JavaScript', rows: 12, placeholder: 'const count = Vue.ref(0);\nreturn { count };' }
];
const previewStatusBar = computed(() => ({
  id: 'status-bar-code-preview',
  name: props.name || '状态栏',
  template: props.modelValue,
  variables: previewVariables.value || props.variables
}));

function updateField(key, value) {
  if (props.disabled) return;
  emit('update:modelValue', serializeStatusBarRuntime({ ...config.value, [key]: value }));
}

function applyExample() {
  if (props.disabled) return;
  emit('update:modelValue', serializeStatusBarRuntime(createStatusBarRuntimeExample(config.value.framework)));
  previewVariables.value = null;
}

function togglePreview() {
  previewOpen.value = !previewOpen.value;
  previewVariables.value = null;
  previewNotice.value = '';
}

function updatePreviewVariables(updates) {
  const current = (previewVariables.value || props.variables).map((variable) => ({ ...variable }));
  for (const update of Array.isArray(updates) ? updates : []) {
    const index = current.findIndex((variable) => variable.name === update.name);
    if (index >= 0) current[index] = { ...current[index], ...update };
    else current.push({ ...update });
  }
  previewVariables.value = current;
}

function showPreviewAction(value) {
  previewNotice.value = `预览动作：${String(value?.text || value || '打开设置')}`;
}
</script>

<template>
  <section class="status-code-editor" aria-label="状态栏代码编辑器">
    <div class="status-code-toolbar">
      <label class="status-code-framework">
        <span><Code :size="15" /> 运行方式</span>
        <select :value="config.framework" :disabled="disabled" @change="updateField('framework', $event.target.value)">
          <option value="vue">Vue 3</option>
          <option value="html">HTML + JavaScript</option>
        </select>
      </label>
      <button class="chat-setting-inline-button" type="button" :disabled="disabled" @click="applyExample">
        <Sparkles :size="14" /> 套用示例
      </button>
      <button class="chat-setting-inline-button" type="button" :aria-expanded="previewOpen" @click="togglePreview">
        <Eye :size="14" /> {{ previewOpen ? '收起预览' : '运行预览' }}
      </button>
    </div>
    <p class="status-code-hint">支持完整 HTML、CSS、JavaScript、外部资源与 Vue 指令。变量变化会实时传入，修改代码会重新运行。</p>
    <p class="status-code-hint" :role="codeLengthExceeded ? 'alert' : undefined">配置长度：{{ modelValue.length.toLocaleString() }} / {{ formattedCodeLimit }} 字符{{ codeLengthExceeded ? '，请缩短代码后保存' : '' }}</p>
    <div class="status-code-fields">
      <label v-for="field in codeFields" :key="field.key" class="status-code-field">
        <span>{{ field.label }}</span>
        <textarea
          :value="config[field.key]"
          :rows="field.rows"
          :placeholder="field.placeholder"
          :disabled="disabled"
          :aria-label="`状态栏 ${field.label} 代码`"
          spellcheck="false"
          autocapitalize="off"
          @input="updateField(field.key, $event.target.value)"
        />
      </label>
    </div>
    <details class="status-code-reference">
      <summary>运行时 API 与变量用法</summary>
      <dl>
        <dt><code>variables / values / context</code></dt>
        <dd>variables 是响应式变量列表；values 按名称访问值，例如 values['体力']；context 提供状态栏上下文。</dd>
        <dt><code>JavaScript / Vue</code></dt>
        <dd>JavaScript 作为 setup 函数体执行，可使用 Vue.ref、Vue.computed 等全部 Vue API，并 return { ... } 暴露给模板。HTML 模式可直接操作 document。</dd>
        <dt><code>api.setVariable('体力', 80)</code></dt>
        <dd>设置单个变量；api.updateVariables([{ name: '体力', value: 80 }]) 批量更新并保存。</dd>
        <dt><code>api.send('继续探索') / api.quickReply('查看状态')</code></dt>
        <dd>发送聊天消息或填入快捷回复；api.openSettings() 打开状态栏设置。</dd>
        <dt><code>api.onUpdate(callback) / api.onCleanup(callback)</code></dt>
        <dd>监听变量和上下文更新；注册定时器、外部监听等资源的卸载清理函数。</dd>
      </dl>
    </details>
    <div v-if="previewOpen" class="status-code-preview">
      <StatusBar
        :status-bar="previewStatusBar"
        embedded
        @update-variables="updatePreviewVariables"
        @quick-reply="showPreviewAction"
        @send="showPreviewAction"
        @open-settings="showPreviewAction"
      />
      <p class="status-code-hint">预览中的变量和聊天动作仅在此处演示。</p>
      <p v-if="previewNotice" class="status-code-hint" role="status">{{ previewNotice }}</p>
    </div>
  </section>
</template>

<style scoped>
.status-code-editor { display: grid; gap: 12px; min-width: 0; }
.status-code-toolbar { display: flex; flex-wrap: wrap; align-items: end; gap: 10px; }
.status-code-framework { display: grid; gap: 6px; flex: 1; min-width: 150px; }
.status-code-framework > span { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
.status-code-editor select { width: 100%; padding: 8px 10px; color: inherit; background: var(--bg-input, #171b25); border: 1px solid var(--border-color, #3a4252); border-radius: 8px; }
.status-code-hint { margin: 0; font-size: 12px; line-height: 1.65; opacity: .75; overflow-wrap: anywhere; }
.status-code-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: 10px; }
.status-code-field { display: grid; align-content: start; gap: 6px; min-width: 0; font-size: 12px; }
.status-code-field textarea { box-sizing: border-box; width: 100%; min-height: 220px; resize: vertical; padding: 12px; border: 1px solid var(--border-color, #3a4252); border-radius: 10px; color: inherit; background: var(--bg-input, #171b25); font: 12px/1.7 Consolas, monospace; tab-size: 2; }
.status-code-field textarea:focus { outline: 2px solid var(--accent-color, #ae8063); outline-offset: 1px; }
.status-code-reference { padding: 10px 12px; border: 1px solid var(--border-color, #3a4252); border-radius: 10px; font-size: 12px; }
.status-code-reference summary { cursor: pointer; }
.status-code-reference dl { margin-bottom: 0; display: grid; gap: 6px; }
.status-code-reference dd { margin: 0 0 8px; line-height: 1.65; opacity: .8; }
.status-code-reference code { overflow-wrap: anywhere; }
.status-code-preview { min-width: 0; padding: 10px; border: 1px solid var(--border-color, #3a4252); border-radius: 10px; }
</style>
