<script setup>
import { ref } from 'vue';
import { Bot, Brain, ChevronDown, Send, Sparkles, Square } from '@lucide/vue';

defineProps({
  input: { type: String, default: '' },
  sending: { type: Boolean, default: false },
  canSend: { type: Boolean, default: false },
  useStream: { type: Boolean, default: true },
  thinkingEnabled: { type: Boolean, default: false },
  canToggleThinking: { type: Boolean, default: false },
  chatViewportIsPhone: { type: Boolean, default: false },
  showScrollBottomButton: { type: Boolean, default: false },
  usage: { type: Object, default: null },
  presetList: { type: Array, default: () => [] },
  selectedPresetId: { type: String, default: '' },
  currentModel: { type: String, default: '' }
});

const emit = defineEmits([
  'update:input',
  'submit',
  'stop',
  'toggle-stream',
  'toggle-thinking',
  'open-model-switcher',
  'scroll-to-bottom',
  'update:selectedPresetId',
  'composer-input'
]);

const wrapRef = ref(null);
const textareaRef = ref(null);

defineExpose({ wrapRef, textareaRef });
</script>

<template>
  <footer ref="wrapRef" class="deep-composer-wrap">
    <button
      v-if="showScrollBottomButton"
      class="scroll-bottom-button"
      type="button"
      aria-label="滚动到底部"
      title="滚动到底部"
      @click="emit('scroll-to-bottom')"
    >
      <ChevronDown :size="18" />
    </button>
    <form class="deep-composer" @submit.prevent="emit('submit', { isEnter: false })">
      <textarea
        ref="textareaRef"
        :value="input"
        aria-label="聊天消息输入"
        placeholder="给 AI 发送消息"
        :rows="chatViewportIsPhone ? 1 : 2"
        @input="emit('update:input', $event.target.value); emit('composer-input', $event)"
        @keydown.enter.exact="emit('submit', { isEnter: true, event: $event })"
      />
      <div class="composer-actions" :class="{ 'has-preset': presetList.length }">
        <select
          v-if="presetList.length"
          :value="selectedPresetId"
          class="preset-select"
          aria-label="选择对话预设"
          title="选择对话预设"
          @change="emit('update:selectedPresetId', $event.target.value)"
        >
          <option value="">无预设</option>
          <option v-for="p in presetList" :key="p.id" :value="p.id">
            {{ p.name }}{{ p.isDefault ? ' 默认' : '' }}
          </option>
        </select>
        <button
          class="mode-pill model-switch-pill"
          type="button"
          :title="currentModel ? `当前模型：${currentModel}` : '切换模型'"
          @click="emit('open-model-switcher')"
        >
          <Bot :size="16" />
          <span>{{ currentModel || '切换模型' }}</span>
        </button>
        <button
          class="mode-pill"
          :class="{ active: useStream }"
          type="button"
          :aria-pressed="String(useStream)"
          @click="emit('toggle-stream')"
        >
          <Sparkles :size="16" />
          <span>流式输出</span>
        </button>
        <button
          class="mode-pill"
          :class="{ active: canToggleThinking && thinkingEnabled }"
          type="button"
          :aria-pressed="String(canToggleThinking && thinkingEnabled)"
          :disabled="!canToggleThinking"
          title="Model thinking mode"
          @click="emit('toggle-thinking')"
        >
          <Brain :size="16" />
          <span>{{ thinkingEnabled ? '深度思考' : '普通回复' }}</span>
        </button>
        <span v-if="usage" class="token-chip">tokens {{ usage.total_tokens || usage.totalTokens || '-' }}</span>
        <button v-if="sending" class="round-send stop" type="button" aria-label="停止生成" title="停止生成" @click="emit('stop')">
          <Square :size="18" />
        </button>
        <button v-else class="round-send" type="submit" aria-label="发送消息" title="发送" :disabled="!canSend">
          <Send :size="19" />
        </button>
      </div>
    </form>
  </footer>
</template>
