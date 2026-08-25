<script setup>
import { computed } from 'vue';

const props = defineProps({
  assistantModel: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  modelOptions: { type: Array, default: () => [] },
  options: { type: Object, required: true },
  requirement: { type: String, default: '' },
  useCurrentDraft: { type: Boolean, default: true }
});

const emit = defineEmits([
  'set-option',
  'update:assistantModel',
  'update:requirement',
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
    <label class="field ai-requirement-field">
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

      <div class="ai-context-card">
        <label class="checkbox-line ai-context-toggle">
          <input
            type="checkbox"
            :checked="useCurrentDraft"
            :disabled="disabled"
            @change="emit('update:useCurrentDraft', readInputChecked($event))"
          />
          <span>结合当前已填写内容进行优化</span>
        </label>
        <p class="ai-context-hint">
          {{ useCurrentDraft ? '助手会参考表单现有内容，只修改所选范围。' : '助手只按完善要求生成，不读取当前表单内容。' }}
        </p>
      </div>
    </div>

    <details class="ai-scope-disclosure">
      <summary>
        <span>完善范围</span>
        <small>{{ selectedOptionCount }} / {{ optionCount }} 已选择</small>
      </summary>
      <div class="ai-scope-toolbar">
        <p>仅勾选需要 AI 回填的部分，减少无关修改。</p>
        <div class="ai-scope-actions">
          <button class="ghost-button" type="button" :disabled="disabled" @click="setAllOptions(true)">全选</button>
          <button class="ghost-button" type="button" :disabled="disabled" @click="setAllOptions(false)">清空</button>
        </div>
      </div>
      <div class="ai-scope-grid">
        <label v-for="(enabled, key) in options" :key="key" class="checkbox-line">
          <input
            type="checkbox"
            :checked="enabled"
            :disabled="disabled"
            @change="emit('set-option', key, readInputChecked($event))"
          />
          <span>{{ optionLabel(key) }}</span>
        </label>
      </div>
    </details>
  </div>
</template>
