<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ChevronDown, Globe, ImagePlus, Send, SlidersHorizontal, Sparkles, Square, X } from '@lucide/vue';

const props = defineProps({
  input: { type: String, default: '' },
  draftStatus: { type: String, default: 'empty' },
  sending: { type: Boolean, default: false },
  canSend: { type: Boolean, default: false },
  useStream: { type: Boolean, default: true },
  thinkingEnabled: { type: Boolean, default: false },
  thinkingLevel: { type: String, default: 'off' },
  thinkingOptions: { type: Array, default: () => [] },
  canToggleThinking: { type: Boolean, default: false },
  webSearchEnabled: { type: Boolean, default: false },
  canToggleWebSearch: { type: Boolean, default: false },
  canUseStream: { type: Boolean, default: true },
  canAddAttachments: { type: Boolean, default: true },
  chatViewportIsPhone: { type: Boolean, default: false },
  showScrollBottomButton: { type: Boolean, default: false },
  usage: { type: Object, default: null },
  attachments: { type: Array, default: () => [] },
  attachmentBusy: { type: Boolean, default: false },
  presetList: { type: Array, default: () => [] },
  selectedPresetId: { type: String, default: '' },
  currentModel: { type: String, default: '' },
  modelSaving: { type: Boolean, default: false }
});

const emit = defineEmits([
  'update:input',
  'submit',
  'stop',
  'toggle-stream',
  'toggle-thinking',
  'toggle-web-search',
  'update:thinking-level',
  'open-model-switcher',
  'add-attachments',
  'remove-attachment',
  'clear-attachments',
  'scroll-to-bottom',
  'update:selectedPresetId',
  'composer-input'
]);

const wrapRef = ref(null);
const textareaRef = ref(null);
const modelSwitchButtonRef = ref(null);
const attachmentInputRef = ref(null);
const responseModeMenuRef = ref(null);
const responseModeTriggerRef = ref(null);
const responseModeMenuOpen = ref(false);
const modelSwitchLocked = computed(() => props.sending || props.modelSaving);
const currentThinkingLabel = computed(() => (
  props.thinkingOptions.find((option) => option?.value === props.thinkingLevel)?.label || props.thinkingLevel || '关闭'
));

function toggleResponseModeMenu() {
  responseModeMenuOpen.value = !responseModeMenuOpen.value;
}

function closeResponseModeMenu() {
  responseModeMenuOpen.value = false;
}

function onResponseModeFocusout(event) {
  if (!event.currentTarget?.contains(event.relatedTarget)) {
    closeResponseModeMenu();
  }
}

// Keep the compact settings popover easy to dismiss with pointer and keyboard input.
function onResponseModePointerDown(event) {
  if (responseModeMenuOpen.value && !responseModeMenuRef.value?.contains(event.target)) {
    closeResponseModeMenu();
  }
}

function onResponseModeKeydown(event) {
  if (event.key !== 'Escape' || !responseModeMenuOpen.value) {
    return;
  }
  closeResponseModeMenu();
  responseModeTriggerRef.value?.focus({ preventScroll: true });
}

onMounted(() => {
  document.addEventListener('pointerdown', onResponseModePointerDown);
  document.addEventListener('keydown', onResponseModeKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onResponseModePointerDown);
  document.removeEventListener('keydown', onResponseModeKeydown);
});

function readEventTargetValue(event) {
  const target = event?.target;
  return target && target.value !== undefined ? target.value : undefined;
}

function onComposerInput(event) {
  const value = readEventTargetValue(event);
  if (value === undefined) {
    return;
  }
  emit('update:input', value);
  emit('composer-input', event);
}

function submitComposer(payload) {
  emit('submit', payload);
}

function onPresetChange(event) {
  const value = readEventTargetValue(event);
  if (value === undefined) {
    return;
  }
  emit('update:selectedPresetId', value);
}

function onThinkingLevelChange(event) {
  const value = readEventTargetValue(event);
  if (value === undefined) {
    return;
  }
  emit('update:thinking-level', value);
}

function focusModelControl() {
  const modelSwitchButton = modelSwitchButtonRef.value;
  if (modelSwitchButton && !modelSwitchButton.disabled) {
    modelSwitchButton.focus({ preventScroll: true });
    return;
  }
  textareaRef.value?.focus({ preventScroll: true });
}

function openAttachmentPicker() {
  if (props.sending || props.attachmentBusy || !props.canAddAttachments) {
    return;
  }
  attachmentInputRef.value?.click?.();
}

function onAttachmentChange(event) {
  const target = event?.target;
  if (!props.canAddAttachments) {
    if (target) {
      target.value = '';
    }
    return;
  }
  const files = target?.files;
  if (!files || !files.length) {
    return;
  }
  emit('add-attachments', files);
  if (target) {
    target.value = '';
  }
}

function attachmentLabel(attachment = {}) {
  return attachment.alt || attachment.name || '聊天图片';
}

function attachmentPreviewUrl(attachment = {}) {
  return attachment.dataUrl || attachment.url || '';
}

defineExpose({ wrapRef, textareaRef, modelSwitchButtonRef, focusModelControl });
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
    <form class="deep-composer" :aria-busy="sending" @submit.prevent="submitComposer({ isEnter: false })">
      <textarea
        ref="textareaRef"
        :value="input"
        aria-label="聊天消息输入"
        placeholder="给 AI 发送消息"
        :rows="chatViewportIsPhone ? 1 : 2"
        @input="onComposerInput"
        @keydown.enter.exact="submitComposer({ isEnter: true, event: $event })"
      />
      <p v-if="draftStatus === 'unavailable'" class="chat-draft-status" role="status">草稿未暂存</p>
      <div v-if="attachments.length" class="composer-attachments" aria-label="待发送图片">
        <figure v-for="attachment in attachments" :key="attachment.id" class="composer-attachment">
          <img :src="attachmentPreviewUrl(attachment)" :alt="attachmentLabel(attachment)" />
          <figcaption>{{ attachmentLabel(attachment) }}</figcaption>
          <button
            type="button"
            aria-label="移除图片"
            title="移除图片"
            :disabled="sending"
            @click="emit('remove-attachment', attachment.id)"
          >
            <X :size="14" />
          </button>
        </figure>
      </div>
      <div class="composer-actions" :class="{ 'has-preset': presetList.length }">
        <input
          ref="attachmentInputRef"
          class="visually-hidden"
          type="file"
          aria-label="选择聊天图片"
          accept="image/png,image/jpeg,image/webp"
          multiple
          :disabled="!canAddAttachments"
          @change="onAttachmentChange"
        />
        <select
          v-if="presetList.length"
          :value="selectedPresetId"
          class="preset-select"
          aria-label="选择对话预设"
          title="选择对话预设"
          :disabled="sending"
          @change="onPresetChange"
        >
          <option value="">无预设</option>
          <option v-for="p in presetList" :key="p.id" :value="p.id">
            {{ p.name }}{{ p.isDefault ? ' 默认' : '' }}
          </option>
        </select>
        <button
          ref="modelSwitchButtonRef"
          class="mode-pill model-switch-pill"
          type="button"
          aria-label="快速切换聊天模型"
          :title="currentModel ? `搜索或刷新模型：${currentModel}` : '搜索或刷新模型'"
          :disabled="modelSwitchLocked"
          :aria-busy="modelSaving"
          @click="emit('open-model-switcher')"
        >
          <span class="model-switch-name">{{ currentModel || '切换模型' }}</span>
          <ChevronDown :size="14" aria-hidden="true" />
        </button>
        <label
          v-if="thinkingOptions.length"
          class="mode-pill thinking-pill thinking-level-control"
          :class="{ active: canToggleThinking && thinkingEnabled, disabled: sending || !canToggleThinking }"
          :title="`思考强度：${currentThinkingLabel}`"
        >
          <span class="thinking-level-copy" aria-hidden="true">
            <span class="thinking-level-name">思考</span>
            <strong class="thinking-level-value">{{ currentThinkingLabel }}</strong>
          </span>
          <select
            class="thinking-level-select"
            :value="thinkingLevel"
            :disabled="sending || !canToggleThinking"
            :aria-label="`思考强度，当前${currentThinkingLabel}`"
            :aria-busy="sending"
            @change="onThinkingLevelChange"
          >
            <option v-for="option in thinkingOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
          <ChevronDown class="thinking-level-chevron" :size="14" aria-hidden="true" />
        </label>
        <button
          v-else
          class="mode-pill thinking-pill"
          :class="{ active: canToggleThinking && thinkingEnabled }"
          type="button"
          :aria-pressed="String(canToggleThinking && thinkingEnabled)"
          :disabled="sending || !canToggleThinking"
          :aria-busy="sending"
          title="Model thinking mode"
          @click="emit('toggle-thinking')"
        >
          <span class="thinking-level-name">思考</span>
          <strong class="thinking-level-value">{{ canToggleThinking && thinkingEnabled ? '开启' : '关闭' }}</strong>
        </button>
        <button
          class="mode-pill attachment-pill"
          type="button"
          title="添加图片"
          aria-label="添加图片"
          :disabled="sending || attachmentBusy || !canAddAttachments"
          :aria-busy="attachmentBusy"
          @click="openAttachmentPicker"
        >
          <ImagePlus :size="16" />
        </button>
        <div ref="responseModeMenuRef" class="response-mode-menu" @focusout="onResponseModeFocusout">
          <button
            ref="responseModeTriggerRef"
            class="mode-pill response-mode-trigger"
            :class="{ active: (canToggleWebSearch && webSearchEnabled) || (canUseStream && !useStream) }"
            type="button"
            aria-label="响应模式设置"
            title="流式输出与 DeepSeek 联网搜索"
            aria-haspopup="dialog"
            :aria-expanded="String(responseModeMenuOpen)"
            aria-controls="composer-response-mode-panel"
            :disabled="sending"
            @click="toggleResponseModeMenu"
          >
            <SlidersHorizontal :size="16" />
          </button>
          <div
            v-if="responseModeMenuOpen"
            id="composer-response-mode-panel"
            class="response-mode-panel"
            role="dialog"
            aria-label="响应模式"
            @click.stop
          >
            <strong class="response-mode-heading">响应模式</strong>
            <div class="response-mode-options">
              <button
                class="mode-pill response-mode-option"
                :class="{ active: canUseStream && useStream }"
                type="button"
                aria-label="流式输出"
                :aria-pressed="String(canUseStream && useStream)"
                :disabled="sending || !canUseStream"
                :aria-busy="sending"
                @click="emit('toggle-stream')"
              >
                <Sparkles :size="16" />
                <span>流式输出</span>
              </button>
              <button
                v-if="canToggleWebSearch"
                class="mode-pill response-mode-option"
                :class="{ active: webSearchEnabled }"
                type="button"
                aria-label="DeepSeek 联网搜索"
                title="DeepSeek Search/Fetch 每千次成功调用各 ¥5，2026-11-01 起计费（北京时间）"
                :aria-pressed="String(webSearchEnabled)"
                :disabled="sending"
                :aria-busy="sending"
                @click="emit('toggle-web-search')"
              >
                <Globe :size="16" />
                <span>联网搜索</span>
              </button>
            </div>
            <p v-if="canToggleWebSearch" class="response-mode-cost-hint">Search/Fetch 各 ¥5/千次成功调用，2026-11-01 起（北京时间）</p>
          </div>
        </div>
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

<style scoped>
.chat-draft-status {
  margin: 0;
  color: var(--text);
  font-size: 0.8125rem;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
</style>
