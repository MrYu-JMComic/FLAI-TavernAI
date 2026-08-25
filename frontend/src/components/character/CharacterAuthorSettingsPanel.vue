<script setup>
import { Upload, WandSparkles } from '@lucide/vue';

defineProps({
  advancedAiLoading: { type: Boolean, default: false },
  advancedAiRequirement: { type: String, default: '' },
  advancedSettings: { type: Object, required: true },
  aiUseCurrentDraft: { type: Boolean, default: false },
  backgroundUploading: { type: Object, required: true },
  canEdit: { type: Boolean, default: false },
  characterAiActionBusy: { type: Boolean, default: false }
});

const emit = defineEmits([
  'background-change',
  'clear-background',
  'complete-ai',
  'stop-ai',
  'update:advancedAiRequirement',
  'update:aiUseCurrentDraft'
]);

const BACKGROUND_FIELDS = [
  { key: 'desktopBackgroundUrl', label: '电脑端背景', placeholder: '图片链接、短链或 data URL，可留空' },
  { key: 'mobileBackgroundUrl', label: '手机端背景', placeholder: '手机端专用背景，可留空' }
];

function readInputValue(event) {
  const value = event?.target?.value;
  return typeof value === 'string' ? value : '';
}

function readInputChecked(event) {
  return Boolean(event?.target?.checked);
}
</script>

<template>
  <section id="section-advanced-settings" class="form-panel character-panel">
    <header class="character-panel-head">
      <div>
        <h2>外观与 AI</h2>
        <p>角色背景图会随角色进入对话；使用者仍可在会话内覆盖。</p>
      </div>
    </header>

    <div class="character-panel-body">
      <div class="form-grid two-col">
        <div v-for="field in BACKGROUND_FIELDS" :key="field.key" class="field background-url-field">
          <span>{{ field.label }}</span>
          <input
            v-model="advancedSettings[field.key]"
            type="text"
            :placeholder="field.placeholder"
            :aria-label="`${field.label}图片链接`"
            :disabled="!canEdit"
          />
          <div v-if="canEdit" class="background-upload-actions">
            <label class="chat-setting-inline-button background-upload-button" :class="{ disabled: backgroundUploading[field.key] }">
              <Upload :size="14" />
              <span>{{ backgroundUploading[field.key] ? '读取中...' : '上传图片' }}</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                :disabled="backgroundUploading[field.key]"
                @change="emit('background-change', $event, field.key)"
              />
            </label>
            <button class="chat-setting-inline-button" type="button" @click="emit('clear-background', field.key)">清空</button>
          </div>
        </div>
      </div>

      <div v-if="canEdit" class="character-panel-subsection">
        <h3>作者侧 AI 完善</h3>
        <label class="field">
          <span>高阶设置 AI 需求</span>
          <textarea
            :value="advancedAiRequirement"
            rows="3"
            placeholder="例如：生成适合豪门恋爱角色的状态栏提示词、附属技能默认值和一点聊天气泡 CSS。"
            :disabled="characterAiActionBusy"
            @input="emit('update:advancedAiRequirement', readInputValue($event))"
          />
        </label>
        <label class="checkbox-line ai-context-toggle compact">
          <input
            :checked="aiUseCurrentDraft"
            type="checkbox"
            :disabled="characterAiActionBusy"
            @change="emit('update:aiUseCurrentDraft', readInputChecked($event))"
          />
          <span>结合当前已填写内容优化</span>
        </label>
        <div class="ai-action-row">
          <button
            class="ghost-button"
            type="button"
            :disabled="characterAiActionBusy"
            :aria-busy="advancedAiLoading"
            @click="emit('complete-ai')"
          >
            <WandSparkles :size="17" />
            <span>{{ advancedAiLoading ? 'AI 正在完善...' : 'AI 完善高阶设置' }}</span>
          </button>
          <button v-if="advancedAiLoading" class="ghost-button" type="button" @click="emit('stop-ai')">
            <span>暂停</span>
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
