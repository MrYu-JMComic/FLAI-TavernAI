<script setup>
import { Download, Plus, RefreshCw, Save, Sliders, Trash2, Upload } from '@lucide/vue';

const props = defineProps({
  actionBusy: { type: Boolean, default: false },
  actionBusyId: { type: String, default: '' },
  controlsBusy: { type: Boolean, default: false },
  editing: { type: [String, Number], default: null },
  form: { type: Object, required: true },
  loadError: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  presetList: { type: Array, default: () => [] },
  showEditor: { type: Boolean, default: false }
});

const emit = defineEmits([
  'cancel-edit',
  'export',
  'import-file',
  'load',
  'make-default',
  'remove',
  'save',
  'start-edit',
  'start-new',
  'update-form-field'
]);

function readInputValue(event) {
  const target = event?.target;
  return target && target.value !== undefined ? target.value : '';
}

function readNumberInputValue(event) {
  const value = Number(readInputValue(event));
  return Number.isFinite(value) ? value : 0;
}

function updateField(key, value) {
  emit('update-form-field', key, value);
}

function presetDefaultActionId(id) {
  return `preset-default:${id}`;
}

function presetDeleteActionId(id) {
  return `preset-delete:${id}`;
}

function isPresetDefaultBusy(id) {
  return props.actionBusyId === presetDefaultActionId(id);
}

function isPresetDeleteBusy(id) {
  return props.actionBusyId === presetDeleteActionId(id);
}
</script>

<template>
  <section id="extension-section-presets" class="form-panel preset-management-panel form-section-group">
    <div class="inline-heading">
      <div>
        <h2>对话预设</h2>
        <p>管理对话参数预设，可设置系统提示词和生成参数。选择预设后在聊天时自动生效。</p>
      </div>
      <Sliders :size="20" />
    </div>
    <div class="preset-actions-row">
      <button class="ghost-button" type="button" :disabled="controlsBusy" @click="emit('start-new')">
        <Plus :size="17" />
        <span>新建预设</span>
      </button>
      <button class="ghost-button" type="button" :disabled="controlsBusy || !presetList.length" @click="emit('export')">
        <Download :size="17" />
        <span>导出</span>
      </button>
      <label class="ghost-button file-import-button" :class="{ disabled: controlsBusy }">
        <Upload :size="17" />
        <span>导入</span>
        <input type="file" accept=".json" :disabled="controlsBusy" @change="emit('import-file', $event)" />
      </label>
    </div>
    <p v-if="loading" class="muted-text" aria-live="polite">正在加载预设...</p>
    <div v-if="loadError" class="section-load-status error-state" role="alert">
      <span>{{ loadError }}</span>
      <button class="ghost-button compact-button" type="button" :disabled="controlsBusy" @click="emit('load')">
        <RefreshCw :size="17" />
        <span>{{ loading ? '重试中...' : '重试' }}</span>
      </button>
    </div>

    <form v-if="showEditor" class="preset-editor" :aria-busy="actionBusy" @submit.prevent="emit('save')">
      <h3>{{ editing ? '编辑预设' : '新建预设' }}</h3>
      <label class="field">
        <span>预设名称</span>
        <input
          :value="form.name"
          placeholder="如：创意写作、精确回答"
          maxlength="80"
          :disabled="actionBusy"
          required
          @input="updateField('name', readInputValue($event).trim())"
        />
      </label>
      <label class="field">
        <span>系统提示词</span>
        <textarea
          :value="form.systemPrompt"
          rows="4"
          placeholder="可选，会作为额外的 system 消息发送给模型"
          :disabled="actionBusy"
          @input="updateField('systemPrompt', readInputValue($event))"
        />
      </label>
      <div class="form-grid two-col">
        <label class="field">
          <span>Temperature ({{ form.temperature }})</span>
          <input :value="form.temperature" type="range" min="0" max="2" step="0.1" :disabled="actionBusy" @input="updateField('temperature', readNumberInputValue($event))" />
        </label>
        <label class="field">
          <span>Max Tokens</span>
          <input :value="form.maxTokens" type="number" min="1" max="128000" step="1" :disabled="actionBusy" @input="updateField('maxTokens', readNumberInputValue($event))" />
        </label>
        <label class="field">
          <span>Top P ({{ form.topP }})</span>
          <input :value="form.topP" type="range" min="0" max="1" step="0.05" :disabled="actionBusy" @input="updateField('topP', readNumberInputValue($event))" />
        </label>
        <label class="field">
          <span>Frequency Penalty ({{ form.frequencyPenalty }})</span>
          <input :value="form.frequencyPenalty" type="range" min="-2" max="2" step="0.1" :disabled="actionBusy" @input="updateField('frequencyPenalty', readNumberInputValue($event))" />
        </label>
        <label class="field">
          <span>Presence Penalty ({{ form.presencePenalty }})</span>
          <input :value="form.presencePenalty" type="range" min="-2" max="2" step="0.1" :disabled="actionBusy" @input="updateField('presencePenalty', readNumberInputValue($event))" />
        </label>
      </div>
      <div class="form-actions">
        <button class="primary-button" type="submit" :disabled="actionBusy" :aria-busy="actionBusyId === 'preset-save'">
          <Save :size="18" />
          <span>{{ actionBusyId === 'preset-save' ? '保存中...' : editing ? '保存修改' : '创建预设' }}</span>
        </button>
        <button class="ghost-button" type="button" :disabled="actionBusy" @click="emit('cancel-edit')">
          取消
        </button>
      </div>
    </form>

    <div v-if="presetList.length" class="preset-card-list">
      <div v-for="preset in presetList" :key="preset.id" class="preset-card" :class="{ 'is-default': preset.isDefault }">
        <div class="preset-card-header">
          <strong>{{ preset.name }}</strong>
          <span v-if="preset.isDefault" class="default-badge">默认</span>
        </div>
        <div class="preset-card-params">
          <small>T={{ preset.temperature }} · max={{ preset.maxTokens }} · topP={{ preset.topP }}</small>
        </div>
        <p v-if="preset.systemPrompt" class="preset-card-prompt">{{ preset.systemPrompt.slice(0, 100) }}{{ preset.systemPrompt.length > 100 ? '...' : '' }}</p>
        <div class="preset-card-actions">
          <button class="icon-button" type="button" title="编辑" :aria-label="`编辑预设：${preset.name}`" :disabled="controlsBusy" @click="emit('start-edit', preset)">
            <Sliders :size="16" />
          </button>
          <button
            v-if="!preset.isDefault"
            class="icon-button"
            type="button"
            title="设为默认"
            :aria-label="`设为默认预设：${preset.name}`"
            :disabled="controlsBusy"
            :aria-busy="isPresetDefaultBusy(preset.id)"
            @click="emit('make-default', preset.id)"
          >
            <Save :size="16" />
          </button>
          <button
            class="icon-button danger"
            type="button"
            title="删除"
            :aria-label="`删除预设：${preset.name}`"
            :disabled="controlsBusy"
            :aria-busy="isPresetDeleteBusy(preset.id)"
            @click="emit('remove', preset.id, preset.name)"
          >
            <Trash2 :size="16" />
          </button>
        </div>
      </div>
    </div>
    <p v-else-if="!loading && !loadError" class="muted-text">还没有预设，点击「新建预设」创建第一个。</p>
  </section>
</template>
