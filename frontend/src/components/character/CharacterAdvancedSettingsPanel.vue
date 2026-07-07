<script setup>
import { Settings, Upload, WandSparkles } from '@lucide/vue';
import CharacterStatusBlueprintEditor from './CharacterStatusBlueprintEditor.vue';

defineProps({
  accessorySkillItems: { type: Array, default: () => [] },
  advancedAiLoading: { type: Boolean, default: false },
  advancedAiRequirement: { type: String, default: '' },
  advancedSettings: { type: Object, required: true },
  aiUseCurrentDraft: { type: Boolean, default: false },
  backgroundUploading: { type: Object, required: true },
  canEdit: { type: Boolean, default: false },
  characterAiActionBusy: { type: Boolean, default: false },
  modelOverrideOptions: { type: Function, required: true },
  statusBarBlueprintTemplateStats: { type: Object, required: true },
  statusBlueprintEditorRows: { type: Array, default: () => [] }
});

const emit = defineEmits([
  'add-status-variable',
  'background-change',
  'clear-background',
  'clear-status-template',
  'complete-ai',
  'preview-status',
  'remove-status-variable',
  'sample-status-template',
  'set-color',
  'set-composite-value',
  'set-variable-mode',
  'stop-ai',
  'sync-status-template',
  'update:advancedAiRequirement',
  'update:aiUseCurrentDraft'
]);

function readInputValue(event) {
  const value = event?.target?.value;
  return typeof value === 'string' ? value : '';
}

function readInputChecked(event) {
  return Boolean(event?.target?.checked);
}
</script>

<template>
  <section id="section-advanced-settings" class="form-panel advanced-settings-panel">
    <div class="inline-heading">
      <div>
        <h2>作者高级设置</h2>
        <p>固定随角色进入对话；从聊天里打开时只读展示，使用者可另加自己的设置。</p>
      </div>
      <Settings :size="20" />
    </div>

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
    <label v-if="canEdit" class="checkbox-line ai-context-toggle compact">
      <input
        :checked="aiUseCurrentDraft"
        type="checkbox"
        :disabled="characterAiActionBusy"
        @change="emit('update:aiUseCurrentDraft', readInputChecked($event))"
      />
      <span>结合当前已填写内容优化</span>
    </label>
    <div v-if="canEdit" class="ai-action-row">
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

    <div class="advanced-grid">
      <div class="field background-url-field">
        <span>电脑端背景</span>
        <input
          v-model="advancedSettings.desktopBackgroundUrl"
          type="text"
          placeholder="图片链接、短链或 data URL，可留空"
          aria-label="电脑端背景图片链接"
          :disabled="!canEdit"
        />
        <div v-if="canEdit" class="background-upload-actions">
          <label class="chat-setting-inline-button background-upload-button" :class="{ disabled: backgroundUploading.desktopBackgroundUrl }">
            <Upload :size="14" />
            <span>{{ backgroundUploading.desktopBackgroundUrl ? '读取中...' : '上传图片' }}</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              :disabled="backgroundUploading.desktopBackgroundUrl"
              @change="emit('background-change', $event, 'desktopBackgroundUrl')"
            />
          </label>
          <button class="chat-setting-inline-button" type="button" @click="emit('clear-background', 'desktopBackgroundUrl')">
            清空
          </button>
        </div>
      </div>
      <div class="field background-url-field">
        <span>手机端背景</span>
        <input
          v-model="advancedSettings.mobileBackgroundUrl"
          type="text"
          placeholder="手机端专用背景，可留空"
          aria-label="手机端背景图片链接"
          :disabled="!canEdit"
        />
        <div v-if="canEdit" class="background-upload-actions">
          <label class="chat-setting-inline-button background-upload-button" :class="{ disabled: backgroundUploading.mobileBackgroundUrl }">
            <Upload :size="14" />
            <span>{{ backgroundUploading.mobileBackgroundUrl ? '读取中...' : '上传图片' }}</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              :disabled="backgroundUploading.mobileBackgroundUrl"
              @change="emit('background-change', $event, 'mobileBackgroundUrl')"
            />
          </label>
          <button class="chat-setting-inline-button" type="button" @click="emit('clear-background', 'mobileBackgroundUrl')">
            清空
          </button>
        </div>
      </div>
    </div>

    <label class="field">
      <span>状态栏提示词</span>
      <textarea
        v-model="advancedSettings.statusBarPrompt"
        rows="4"
        placeholder="例如：HP 降低、好感变化、获得金币时更新对应变量。"
        :disabled="!canEdit"
      />
    </label>

    <CharacterStatusBlueprintEditor
      :blueprint="advancedSettings.statusBarBlueprint"
      :can-edit="canEdit"
      :rows="statusBlueprintEditorRows"
      :stats="statusBarBlueprintTemplateStats"
      @add-variable="emit('add-status-variable')"
      @clear-template="emit('clear-status-template')"
      @preview="emit('preview-status')"
      @remove-variable="emit('remove-status-variable', $event)"
      @sample-template="emit('sample-status-template')"
      @set-color="(...args) => emit('set-color', ...args)"
      @set-composite-value="(...args) => emit('set-composite-value', ...args)"
      @set-variable-mode="(...args) => emit('set-variable-mode', ...args)"
      @sync-template="emit('sync-status-template')"
    />

    <div id="section-accessories" class="accessory-defaults-panel">
      <div class="inline-heading compact">
        <div>
          <h3>附属技能默认值</h3>
          <p>作为新会话默认值；使用者仍可在会话中覆盖。</p>
        </div>
      </div>
      <div class="accessory-skills-grid">
        <div v-for="item in accessorySkillItems" :key="item.key" class="accessory-skill-row">
          <label class="field compact">
            <span>{{ item.label }}</span>
            <select v-model="advancedSettings.accessorySkills[item.key].enabled" :disabled="!canEdit">
              <option :value="false">关闭</option>
              <option :value="true">开启</option>
              <option v-if="item.auto" value="auto">自动</option>
            </select>
          </label>
          <label class="field compact">
            <span>模型覆盖</span>
            <select
              v-model="advancedSettings.accessorySkills[item.key].modelOverride"
              :disabled="!canEdit"
            >
              <option
                v-for="model in modelOverrideOptions(advancedSettings.accessorySkills[item.key].modelOverride)"
                :key="model.id || `current-${item.key}`"
                :value="model.id"
              >
                {{ model.label || model.id }}
              </option>
            </select>
          </label>
        </div>
      </div>
    </div>

    <div class="field">
      <span>内置 CSS</span>
      <label class="inline-checkbox">
        <input
          v-model="advancedSettings.customCssEnabled"
          type="checkbox"
          :disabled="!canEdit"
        />
        <span>启用角色自定义 CSS</span>
      </label>
      <label class="inline-checkbox">
        <input
          v-model="advancedSettings.customCssRiskAccepted"
          type="checkbox"
          :disabled="!canEdit"
        />
        <span>确认风险并允许角色 CSS 生效</span>
      </label>
      <textarea
        v-model="advancedSettings.customCss"
        rows="5"
        aria-label="角色自定义 CSS"
        placeholder=".deep-bubble { ... }"
        :disabled="!canEdit"
      />
    </div>

    <div class="field">
      <span>内置 JS</span>
      <label class="inline-checkbox">
        <input
          v-model="advancedSettings.customJsEnabled"
          type="checkbox"
          :disabled="!canEdit"
        />
        <span>启用角色自定义 JS</span>
      </label>
      <label class="inline-checkbox">
        <input
          v-model="advancedSettings.customJsRiskAccepted"
          type="checkbox"
          :disabled="!canEdit"
        />
        <span>确认风险并允许角色 JS 执行</span>
      </label>
      <textarea
        v-model="advancedSettings.customJs"
        rows="5"
        aria-label="角色自定义 JS"
        placeholder="return () => {}"
        :disabled="!canEdit"
      />
    </div>
  </section>
</template>
