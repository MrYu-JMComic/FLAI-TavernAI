<script setup>
defineProps({
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
</script>

<template>
  <label class="field">
    <span>完善要求</span>
    <textarea
      :value="requirement"
      rows="5"
      placeholder="例如：赛博茶馆老板娘，温柔但有边界，会把用户称作{user}；需要把用户输入里的'老板'替换成'掌柜'。"
      :disabled="disabled"
      @input="emit('update:requirement', readInputValue($event))"
    />
  </label>
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
  <label class="checkbox-line ai-context-toggle">
    <input
      type="checkbox"
      :checked="useCurrentDraft"
      :disabled="disabled"
      @change="emit('update:useCurrentDraft', readInputChecked($event))"
    />
    <span>结合当前已填写内容 + 完善要求进行优化</span>
  </label>
  <p class="ai-context-hint">
    {{ useCurrentDraft ? '开启后，助手会参考表单现有内容并按你的消息优化。' : '关闭后，助手只按完善要求生成，不读取当前表单内容。' }}
  </p>
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
</template>
