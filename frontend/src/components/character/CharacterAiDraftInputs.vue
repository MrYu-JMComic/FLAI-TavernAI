<script setup>
import { computed } from 'vue';
import { Check, ChevronDown, FileText, Radio, SlidersHorizontal } from '@lucide/vue';

const props = defineProps({
  assistantModel: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  modelOptions: { type: Array, default: () => [] },
  options: { type: Object, required: true },
  requirement: { type: String, default: '' },
  streamingEnabled: { type: Boolean, default: false },
  thinkingLevel: { type: String, default: 'off' },
  thinkingOptions: { type: Array, default: () => [] },
  thinkingSupported: { type: Boolean, default: false },
  useCurrentDraft: { type: Boolean, default: true }
});

const emit = defineEmits([
  'set-option',
  'update:assistantModel',
  'update:requirement',
  'update:streamingEnabled',
  'update:thinkingLevel',
  'update:useCurrentDraft'
]);

const AI_OPTION_LABELS = {
  profile: '基础资料',
  background: '背景',
  worldview: '世界观',
  persona: '人设',
  openingMessage: '开场白',
  tags: '标签',
  regexRules: '正则',
  renderPlugins: '渲染插件',
  worldBookSuggestion: '世界书建议',
  advancedSettings: '高阶设置',
  modSuggestions: 'Mod 建议'
};

function readInputValue(event) {
  const target = event?.target;
  return target && target.value !== undefined ? target.value : '';
}

function readInputChecked(event) {
  const target = event?.target;
  return Boolean(target?.checked);
}

function optionLabel(key) {
  return AI_OPTION_LABELS[key] || key;
}

const optionCount = computed(() => Object.keys(props.options).length);
const selectedOptionCount = computed(() => Object.values(props.options).filter(Boolean).length);

function setAllOptions(enabled) {
  for (const key of Object.keys(props.options)) {
    emit('set-option', key, enabled);
  }
}
</script>

<template>
  <div class="ai-draft-inputs">
    <label class="field">
      <span>完善要求</span>
      <textarea
        :value="requirement"
        rows="4"
        placeholder="例如：赛博茶馆老板娘，温柔但有边界，会把用户称作{user}；需要把用户输入里的“老板”替换成“掌柜”。"
        :disabled="disabled"
        @input="emit('update:requirement', readInputValue($event))"
      />
    </label>

    <div class="ai-config-row">
      <label class="field">
        <span>助手模型</span>
        <select
          :value="assistantModel"
          :disabled="disabled"
          @change="emit('update:assistantModel', readInputValue($event))"
        >
          <option v-for="model in modelOptions" :key="model.id || '__global'" :value="model.id">
            {{ model.label || model.id }}
          </option>
        </select>
      </label>

      <label class="field">
        <span>思考强度</span>
        <select
          :value="thinkingLevel"
          :disabled="disabled || !thinkingSupported"
          @change="emit('update:thinkingLevel', readInputValue($event))"
        >
          <option v-if="!thinkingOptions.length" value="off">当前模型不支持</option>
          <option v-for="option in thinkingOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
    </div>

    <!-- One card, two rows: both switches share the same frame so the column
         never stacks bordered box inside bordered box. -->
    <div class="ai-option-stack">
      <label class="ai-option-row ai-context-row" :class="{ 'is-active': useCurrentDraft }">
        <span class="ai-option-icon" aria-hidden="true"><FileText :size="16" /></span>
        <span class="ai-option-text">
          <strong>结合当前已填写内容</strong>
          <small>{{ useCurrentDraft ? '参考表单现有内容，只修改所选范围' : '忽略表单内容，仅按完善要求生成' }}</small>
        </span>
        <span class="ai-toggle" :class="{ active: useCurrentDraft, disabled }">
          <input
            type="checkbox"
            :checked="useCurrentDraft"
            :disabled="disabled"
            @change="emit('update:useCurrentDraft', readInputChecked($event))"
          />
          <span class="ai-toggle-track" aria-hidden="true"></span>
        </span>
      </label>

      <label class="ai-option-row ai-stream-card" :class="{ 'is-active': streamingEnabled }">
        <span class="ai-option-icon" aria-hidden="true"><Radio :size="16" /></span>
        <span class="ai-option-text">
          <strong>流式调用</strong>
          <small>{{ streamingEnabled ? '实时模式：边生成边回传过程' : '稳定模式：一次性返回完整结果' }}</small>
        </span>
        <span class="ai-toggle ai-stream-toggle" :class="{ active: streamingEnabled, disabled }">
          <input
            type="checkbox"
            :checked="streamingEnabled"
            :disabled="disabled"
            @change="emit('update:streamingEnabled', readInputChecked($event))"
          />
          <span class="ai-toggle-track" aria-hidden="true"></span>
        </span>
      </label>
    </div>

    <details class="ai-scope-disclosure">
      <summary>
        <span class="ai-scope-summary-title">
          <SlidersHorizontal :size="15" aria-hidden="true" />
          完善范围
        </span>
        <span class="ai-scope-summary-meta">
          <small>{{ selectedOptionCount }} / {{ optionCount }}</small>
          <ChevronDown :size="16" aria-hidden="true" />
        </span>
      </summary>
      <div class="ai-scope-toolbar">
        <p>仅勾选需要 AI 回填的部分，减少无关修改。</p>
        <div class="ai-scope-actions">
          <button class="ghost-button" type="button" :disabled="disabled" @click="setAllOptions(true)">全选</button>
          <button class="ghost-button" type="button" :disabled="disabled" @click="setAllOptions(false)">清空</button>
        </div>
      </div>
      <div class="ai-scope-grid">
        <label v-for="(enabled, key) in options" :key="key" class="ai-scope-chip" :class="{ 'is-on': enabled }">
          <input
            type="checkbox"
            :checked="enabled"
            :disabled="disabled"
            @change="emit('set-option', key, readInputChecked($event))"
          />
          <Check :size="12" aria-hidden="true" />
          <span>{{ optionLabel(key) }}</span>
        </label>
      </div>
    </details>
  </div>
</template>
