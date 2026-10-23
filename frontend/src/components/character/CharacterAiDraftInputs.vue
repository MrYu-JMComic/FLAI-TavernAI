<script setup>
import { CHARACTER_AI_SECTION_LABELS, aiSectionLabel } from '../../utils/aiSectionLabels.js';

defineProps({
  disabled: { type: Boolean, default: false },
  options: { type: Object, required: true },
  streamingEnabled: { type: Boolean, default: false },
  thinkingLevel: { type: String, default: 'off' },
  thinkingOptions: { type: Array, default: () => [] },
  thinkingSupported: { type: Boolean, default: false },
  useCurrentDraft: { type: Boolean, default: true }
});
const emit = defineEmits(['set-option', 'update:streamingEnabled', 'update:thinkingLevel', 'update:useCurrentDraft']);

function setAllOptions(options, enabled) {
  for (const key of Object.keys(options)) emit('set-option', key, enabled);
}
</script>

<template>
  <div class="assistant-settings-inputs">
    <section class="assistant-settings-group" aria-label="对话选项">
      <div class="assistant-settings-checks">
        <label><input type="checkbox" :checked="useCurrentDraft" :disabled="disabled" @change="emit('update:useCurrentDraft', $event.target.checked)"><span>结合角色草稿</span></label>
        <label><input type="checkbox" :checked="streamingEnabled" :disabled="disabled" @change="emit('update:streamingEnabled', $event.target.checked)"><span>流式响应</span></label>
      </div>
      <label v-if="thinkingSupported" class="assistant-settings-thinking">
        <span>思考强度</span>
        <select :value="thinkingLevel" :disabled="disabled" @change="emit('update:thinkingLevel', $event.target.value)">
          <option v-for="option in thinkingOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </label>
    </section>
    <section class="assistant-settings-group" aria-label="允许助手修改的范围">
      <div class="assistant-scope-heading">
        <strong>允许助手修改的范围</strong>
        <button class="ghost-button" type="button" :disabled="disabled" @click="setAllOptions(options, !Object.values(options).some(Boolean))">{{ Object.values(options).some(Boolean) ? '清空' : '全选' }}</button>
      </div>
      <div class="assistant-scope-options">
        <label v-for="(enabled, key) in options" :key="key" :class="{ active: enabled }">
          <input type="checkbox" :checked="enabled" :disabled="disabled" @change="emit('set-option', key, $event.target.checked)">
          <span>{{ aiSectionLabel(CHARACTER_AI_SECTION_LABELS, key) }}</span>
        </label>
      </div>
    </section>
  </div>
</template>
