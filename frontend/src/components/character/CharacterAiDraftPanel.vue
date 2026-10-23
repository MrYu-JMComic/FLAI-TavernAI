<script setup>
import { X } from '@lucide/vue';
import CharacterAiDraftInputs from './CharacterAiDraftInputs.vue';
import WorldBookTargetPicker from '../worldbook/WorldBookTargetPicker.vue';

defineProps({
  disabled: { type: Boolean, default: false },
  options: { type: Object, required: true },
  streamingEnabled: { type: Boolean, default: false },
  thinkingLevel: { type: String, default: 'off' },
  thinkingOptions: { type: Array, default: () => [] },
  thinkingSupported: { type: Boolean, default: false },
  useCurrentDraft: { type: Boolean, default: true },
  worldBooks: { type: Array, default: () => [] },
  worldBookSelectedIds: { type: Array, default: () => [] },
  worldBookAutomatic: { type: Boolean, default: false },
  worldBookSourceLabel: { type: String, default: '' }
});
const emit = defineEmits(['close', 'set-option', 'update:streamingEnabled', 'update:thinkingLevel', 'update:useCurrentDraft', 'update:worldBookSelectedIds', 'update:worldBookAutomatic', 'new-world-book']);
</script>

<template>
  <section class="assistant-settings-panel" aria-label="助手对话设置">
    <div class="assistant-settings-heading">
      <strong>本次对话设置</strong>
      <button class="ghost-button assistant-icon-button" type="button" aria-label="收起对话设置" @click="emit('close')"><X :size="16" /></button>
    </div>
    <div class="assistant-settings-body">
      <CharacterAiDraftInputs
        :disabled="disabled"
        :options="options"
        :streaming-enabled="streamingEnabled"
        :thinking-level="thinkingLevel"
        :thinking-options="thinkingOptions"
        :thinking-supported="thinkingSupported"
        :use-current-draft="useCurrentDraft"
        @set-option="(key, enabled) => emit('set-option', key, enabled)"
        @update:streaming-enabled="emit('update:streamingEnabled', $event)"
        @update:thinking-level="emit('update:thinkingLevel', $event)"
        @update:use-current-draft="emit('update:useCurrentDraft', $event)"
      />
      <WorldBookTargetPicker
        v-if="options.worldBook"
        :books="worldBooks"
        :selected-ids="worldBookSelectedIds"
        :automatic="worldBookAutomatic"
        :source-label="worldBookSourceLabel"
        :busy="disabled"
        @update:selected-ids="emit('update:worldBookSelectedIds', $event)"
        @update:automatic="emit('update:worldBookAutomatic', $event)"
        @new-book="emit('new-world-book')"
      />
    </div>
  </section>
</template>
