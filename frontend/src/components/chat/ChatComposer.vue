<script setup>
import { computed, ref } from 'vue';
import { Bot, Brain, ChevronDown, ImagePlus, Send, Sparkles, Square, X } from '@lucide/vue';

const props = defineProps({
  input: { type: String, default: '' },
  sending: { type: Boolean, default: false },
  canSend: { type: Boolean, default: false },
  useStream: { type: Boolean, default: true },
  thinkingEnabled: { type: Boolean, default: false },
  imageGenerationEnabled: { type: Boolean, default: false },
  canToggleThinking: { type: Boolean, default: false },
  chatViewportIsPhone: { type: Boolean, default: false },
  showScrollBottomButton: { type: Boolean, default: false },
  usage: { type: Object, default: null },
  attachments: { type: Array, default: () => [] },
  attachmentBusy: { type: Boolean, default: false },
  presetList: { type: Array, default: () => [] },
  selectedPresetId: { type: String, default: '' },
  currentModel: { type: String, default: '' },
  modelOptions: { type: Array, default: () => [] },
  modelSaving: { type: Boolean, default: false },
  currentModelSupportsReasoning: { type: Boolean, default: false }
});

const emit = defineEmits([
  'update:input',
  'submit',
  'stop',
  'toggle-stream',
  'toggle-thinking',
  'toggle-image-generation',
  'open-model-switcher',
  'quick-model-change',
  'add-attachments',
  'remove-attachment',
  'clear-attachments',
  'scroll-to-bottom',
  'update:selectedPresetId',
  'composer-input'
]);

const wrapRef = ref(null);
const textareaRef = ref(null);
const attachmentInputRef = ref(null);
const quickModelOptions = computed(() => buildQuickModelOptions(props.modelOptions, props.currentModel));
const modelSwitchLocked = computed(() => props.sending || props.modelSaving);
const canQuickSwitchModel = computed(() => {
  if (!quickModelOptions.value.length) {
    return false;
  }
  return !props.currentModel || quickModelOptions.value.length > 1;
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

function onPresetChange(event) {
  const value = readEventTargetValue(event);
  if (value === undefined) {
    return;
  }
  emit('update:selectedPresetId', value);
}

function onQuickModelChange(event) {
  const value = readEventTargetValue(event);
  if (value === undefined) {
    return;
  }
  const nextModel = String(value || '').trim();
  if (!nextModel || nextModel === props.currentModel) {
    return;
  }
  emit('quick-model-change', nextModel);
}

function openAttachmentPicker() {
  if (props.sending || props.attachmentBusy) {
    return;
  }
  attachmentInputRef.value?.click?.();
}

function onAttachmentChange(event) {
  const target = event?.target;
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

function buildQuickModelOptions(sourceModels, currentModel) {
  const byId = new Map();
  const current = String(currentModel || '').trim();
  if (current) {
    byId.set(current, {
      id: current,
      label: current,
      current: true
    });
  }
  const models = Array.isArray(sourceModels) ? sourceModels : [];
  for (const item of models) {
    const id = String(item?.id || item?.name || item?.model || item || '').trim();
    if (!id) {
      continue;
    }
    byId.set(id, {
      id,
      label: String(item?.label || item?.displayName || item?.name || id).trim() || id,
      current: id === current
    });
  }
  return collectQuickModelOptions(byId);
}

function collectQuickModelOptions(byId) {
  const options = [];
  for (const option of byId.values()) {
    options.push(option);
  }
  return options;
}

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
    <form class="deep-composer" :aria-busy="sending" @submit.prevent="emit('submit', { isEnter: false })">
      <textarea
        ref="textareaRef"
        :value="input"
        aria-label="聊天消息输入"
        placeholder="给 AI 发送消息"
        :rows="chatViewportIsPhone ? 1 : 2"
        @input="onComposerInput"
        @keydown.enter.exact="emit('submit', { isEnter: true, event: $event })"
      />
      <div v-if="attachments.length" class="composer-attachments" aria-label="待发送图片">
        <figure v-for="attachment in attachments" :key="attachment.id" class="composer-attachment">
          <img :src="attachment.dataUrl" :alt="attachmentLabel(attachment)" />
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
          @change="onAttachmentChange"
        />
        <button
          class="mode-pill attachment-pill"
          type="button"
          title="添加图片"
          aria-label="添加图片"
          :disabled="sending || attachmentBusy"
          :aria-busy="attachmentBusy"
          @click="openAttachmentPicker"
        >
          <ImagePlus :size="16" />
          <span>图片</span>
        </button>
        <button
          class="mode-pill image-generation-pill"
          :class="{ active: imageGenerationEnabled }"
          type="button"
          :aria-pressed="String(imageGenerationEnabled)"
          :disabled="sending || attachmentBusy"
          :aria-busy="sending || attachmentBusy"
          title="生图模式"
          @click="emit('toggle-image-generation')"
        >
          <Sparkles :size="16" />
          <span>{{ imageGenerationEnabled ? '生图中' : '生图' }}</span>
        </button>
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
        <label v-if="quickModelOptions.length" class="model-quick-select" :class="{ 'is-saving': modelSaving }">
          <Bot :size="16" />
          <select
            :value="currentModel"
            aria-label="快速切换聊天模型"
            title="快速切换聊天模型"
            :disabled="modelSwitchLocked || !canQuickSwitchModel"
            :aria-busy="modelSaving"
            @change="onQuickModelChange"
          >
            <option v-if="!currentModel" value="" disabled>选择模型</option>
            <option v-for="model in quickModelOptions" :key="model.id" :value="model.id">
              {{ model.label || model.id }}{{ model.current ? ' 当前' : '' }}
            </option>
          </select>
          <span v-if="currentModelSupportsReasoning" class="model-ability-chip">推理</span>
        </label>
        <button
          v-if="!quickModelOptions.length"
          class="mode-pill model-switch-pill"
          type="button"
          :title="currentModel ? `搜索或刷新模型：${currentModel}` : '搜索或刷新模型'"
          :disabled="sending"
          :aria-busy="sending"
          @click="emit('open-model-switcher')"
        >
          <Bot :size="16" />
          <span>{{ currentModel || '切换模型' }}</span>
        </button>
        <button
          class="mode-pill stream-pill"
          :class="{ active: useStream }"
          type="button"
          :aria-pressed="String(useStream)"
          :disabled="sending"
          :aria-busy="sending"
          @click="emit('toggle-stream')"
        >
          <Sparkles :size="16" />
          <span>流式输出</span>
        </button>
        <button
          class="mode-pill thinking-pill"
          :class="{ active: canToggleThinking && thinkingEnabled }"
          type="button"
          :aria-pressed="String(canToggleThinking && thinkingEnabled)"
          :disabled="sending || !canToggleThinking"
          :aria-busy="sending"
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
