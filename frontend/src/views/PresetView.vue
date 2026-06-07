<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import {
  fetchPresets,
  createPreset,
  updatePreset,
  deletePreset,
  setDefaultPreset
} from '../api';
import { useNotify } from '../composables/useNotify';
import {
  SlidersHorizontal,
  Plus,
  Star,
  Trash2,
  Save,
  X,
  AlertCircle,
  ArrowLeft
} from '@lucide/vue';

const emit = defineEmits(['navigate']);

const notify = useNotify();
const presets = ref([]);
const loading = ref(true);
const saving = ref(false);
const deletingPresetId = ref('');
const defaultingPresetId = ref('');
const error = ref(null);
let presetViewDisposed = false;
let presetLoadInFlight = false;
let presetLoadToken = 0;
let presetSaveToken = 0;
let presetDeleteToken = 0;
let presetDefaultToken = 0;

// editing: null = list mode, {} = create mode, {id,...} = edit mode
const editing = ref(null);
const form = ref(createEmptyForm());

const isCreate = computed(() => editing.value !== null && !editing.value.id);
const isEdit = computed(() => editing.value !== null && Boolean(editing.value.id));
const formTitle = computed(() => isCreate.value ? '新建预设' : '编辑预设');
const presetListActionBusy = computed(() => (
  loading.value
  || saving.value
  || Boolean(deletingPresetId.value)
  || Boolean(defaultingPresetId.value)
));

function createEmptyForm() {
  return {
    name: '',
    systemPrompt: '',
    temperature: 1.0,
    maxTokens: 4096,
    topP: 1.0,
    frequencyPenalty: 0,
    presencePenalty: 0,
    isDefault: false
  };
}

onMounted(loadPresets);

onBeforeUnmount(() => {
  presetViewDisposed = true;
  presetLoadToken += 1;
  presetSaveToken += 1;
  presetDeleteToken += 1;
  presetDefaultToken += 1;
});

async function loadPresets() {
  if (presetViewDisposed || presetLoadInFlight) return;
  const requestToken = ++presetLoadToken;
  presetLoadInFlight = true;
  loading.value = true;
  error.value = null;
  try {
    const nextPresets = await fetchPresets();
    if (!isCurrentPresetLoad(requestToken)) return;
    presets.value = nextPresets;
  } catch (err) {
    if (!isCurrentPresetLoad(requestToken)) return;
    error.value = err.message;
    notify.error(err.message);
  } finally {
    if (isCurrentPresetLoad(requestToken)) {
      loading.value = false;
      presetLoadInFlight = false;
    }
  }
}

function isCurrentPresetLoad(requestToken) {
  return !presetViewDisposed && requestToken === presetLoadToken;
}

function startCreate() {
  if (presetListActionBusy.value) return;
  editing.value = {};
  form.value = createEmptyForm();
}

function startEdit(preset) {
  if (presetListActionBusy.value) return;
  editing.value = { id: preset.id };
  form.value = {
    name: preset.name || '',
    systemPrompt: preset.systemPrompt || '',
    temperature: Number(preset.temperature) || 1.0,
    maxTokens: Math.round(Number(preset.maxTokens)) || 4096,
    topP: Number(preset.topP) || 1.0,
    frequencyPenalty: Number(preset.frequencyPenalty) || 0,
    presencePenalty: Number(preset.presencePenalty) || 0,
    isDefault: Boolean(preset.isDefault)
  };
}

function cancelEdit() {
  editing.value = null;
  form.value = createEmptyForm();
}

async function handleSave() {
  if (presetViewDisposed || saving.value) {
    return;
  }
  const saveContext = getPresetSaveContext();
  if (saveContext.mode === 'none') {
    return;
  }

  const saveToken = ++presetSaveToken;
  if (!form.value.name.trim()) {
    form.value.name = '未命名预设';
  }

  const payload = {
    name: form.value.name.trim(),
    systemPrompt: form.value.systemPrompt,
    temperature: clamp(form.value.temperature, 0, 2),
    maxTokens: clampInt(form.value.maxTokens, 1, 128000),
    topP: clamp(form.value.topP, 0, 1),
    frequencyPenalty: clamp(form.value.frequencyPenalty, -2, 2),
    presencePenalty: clamp(form.value.presencePenalty, -2, 2),
    isDefault: form.value.isDefault
  };

  saving.value = true;
  try {
    if (saveContext.mode === 'edit') {
      await updatePreset(saveContext.id, payload);
      if (!isCurrentPresetSave(saveToken, saveContext)) return;
      notify.success('预设已更新');
    } else {
      await createPreset(payload);
      if (!isCurrentPresetSave(saveToken, saveContext)) return;
      notify.success('预设已创建');
    }
    cancelEdit();
    await loadPresets();
  } catch (err) {
    if (!isCurrentPresetSave(saveToken, saveContext)) return;
    notify.error(err.message);
  } finally {
    if (isActivePresetSave(saveToken)) {
      saving.value = false;
    }
  }
}

function getPresetSaveContext() {
  const mode = isEdit.value ? 'edit' : isCreate.value ? 'create' : 'none';
  return {
    mode,
    id: editing.value?.id || '',
    editingRef: editing.value
  };
}

function isCurrentPresetSave(saveToken, context = {}) {
  return isActivePresetSave(saveToken)
    && context.editingRef === editing.value
    && context.mode === getPresetSaveContext().mode
    && (context.mode !== 'edit' || context.id === editing.value?.id);
}

function isActivePresetSave(saveToken) {
  return !presetViewDisposed && saveToken === presetSaveToken;
}

async function handleDelete(preset) {
  if (presetViewDisposed || presetListActionBusy.value || !preset?.id) {
    return;
  }
  if (presets.value.length <= 1) {
    notify.warning('至少需要保留一个预设');
    return;
  }
  if (!window.confirm(`确定删除预设「${preset.name}」吗？`)) return;
  const deleteToken = ++presetDeleteToken;
  const presetId = preset.id;
  deletingPresetId.value = presetId;
  try {
    await deletePreset(presetId);
    if (!isCurrentPresetDelete(deleteToken, presetId)) return;
    notify.success('预设已删除');
    if (editing.value?.id === presetId) {
      cancelEdit();
    }
    await loadPresets();
  } catch (err) {
    if (!isCurrentPresetDelete(deleteToken, presetId)) return;
    notify.error(err.message);
  } finally {
    if (isActivePresetDelete(deleteToken)) {
      deletingPresetId.value = '';
    }
  }
}

function isCurrentPresetDelete(deleteToken, presetId) {
  return isActivePresetDelete(deleteToken) && deletingPresetId.value === presetId;
}

function isActivePresetDelete(deleteToken) {
  return !presetViewDisposed && deleteToken === presetDeleteToken;
}

async function handleSetDefault(preset) {
  if (presetViewDisposed || presetListActionBusy.value || !preset?.id) {
    return;
  }

  const defaultToken = ++presetDefaultToken;
  const presetId = preset.id;
  defaultingPresetId.value = presetId;
  try {
    await setDefaultPreset(presetId);
    if (!isCurrentPresetDefault(defaultToken, presetId)) return;
    await loadPresets();
    if (!isCurrentPresetDefault(defaultToken, presetId)) return;
    notify.success(`已将「${preset.name}」设为默认预设`);
  } catch (err) {
    if (!isCurrentPresetDefault(defaultToken, presetId)) return;
    notify.error(err.message);
  } finally {
    if (isActivePresetDefault(defaultToken)) {
      defaultingPresetId.value = '';
    }
  }
}

function isCurrentPresetDefault(defaultToken, presetId) {
  return isActivePresetDefault(defaultToken) && defaultingPresetId.value === presetId;
}

function isActivePresetDefault(defaultToken) {
  return !presetViewDisposed && defaultToken === presetDefaultToken;
}

function promptSummary(text) {
  if (!text) return '';
  return text.length > 80 ? text.slice(0, 80) + '...' : text;
}

function clamp(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, num));
}

function clampInt(value, min, max) {
  const num = Math.round(Number(value));
  if (!Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, num));
}
</script>

<template>
  <section class="page-stack">
    <!-- List Mode -->
    <template v-if="!editing">
      <div class="section-heading">
        <div>
          <p>对话预设管理</p>
          <h1>预设</h1>
        </div>
        <div class="heading-actions">
          <button class="primary-button" :disabled="presetListActionBusy" :aria-busy="presetListActionBusy" @click="startCreate">
            <Plus :size="18" />
            <span>新建预设</span>
          </button>
          <button class="ghost-button" @click="emit('navigate', 'home')">
            <ArrowLeft :size="18" />
            <span>返回</span>
          </button>
        </div>
      </div>

      <div v-if="loading" class="loading-state">
        <div class="loading-spinner"></div>
        <p>正在加载预设...</p>
      </div>

      <div v-else-if="error" class="empty-state error-state">
        <AlertCircle :size="48" />
        <h2>加载失败</h2>
        <p>{{ error }}</p>
        <button class="ghost-button" :disabled="loading" :aria-busy="loading" @click="loadPresets">
          <span>重试</span>
        </button>
      </div>

      <div v-else-if="!presets.length" class="empty-state">
        <SlidersHorizontal :size="48" />
        <h2>还没有预设</h2>
        <p>预设可以保存系统提示词和生成参数组合，快速切换对话风格。</p>
        <button class="primary-button" :disabled="presetListActionBusy" :aria-busy="presetListActionBusy" @click="startCreate">
          <Plus :size="18" />
          <span>创建第一个预设</span>
        </button>
      </div>

      <div v-else class="preset-grid">
        <div
          v-for="preset in presets"
          :key="preset.id"
          class="preset-card"
          :class="{ 'is-default': preset.isDefault, 'is-busy': presetListActionBusy }"
          :aria-disabled="presetListActionBusy"
          @click="startEdit(preset)"
        >
          <div class="preset-card-header">
            <strong>{{ preset.name }}</strong>
            <span v-if="preset.isDefault" class="default-badge">
              <Star :size="14" />
              默认
            </span>
          </div>
          <p v-if="preset.systemPrompt" class="preset-card-prompt">
            {{ promptSummary(preset.systemPrompt) }}
          </p>
          <p v-else class="preset-card-prompt muted-text">无系统提示词</p>
          <div class="preset-card-params">
            <span>T={{ preset.temperature }}</span>
            <span>Max={{ preset.maxTokens }}</span>
            <span>TopP={{ preset.topP }}</span>
          </div>
          <div class="preset-card-actions" @click.stop>
            <button
              v-if="!preset.isDefault"
              class="icon-button"
              type="button"
              title="设为默认"
              :aria-label="`设为默认预设：${preset.name}`"
              :disabled="presetListActionBusy"
              :aria-busy="defaultingPresetId === preset.id"
              @click="handleSetDefault(preset)"
            >
              <Star :size="16" />
            </button>
            <button
              class="icon-button danger"
              type="button"
              :title="deletingPresetId === preset.id ? '删除中...' : '删除'"
              :aria-label="deletingPresetId === preset.id ? `正在删除预设：${preset.name}` : `删除预设：${preset.name}`"
              :disabled="presetListActionBusy"
              :aria-busy="deletingPresetId === preset.id"
              @click="handleDelete(preset)"
            >
              <Trash2 :size="16" />
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- Edit/Create Mode -->
    <template v-else>
      <div class="section-heading">
        <div>
          <p>{{ formTitle }}</p>
          <h1>{{ isEdit ? form.name || '编辑预设' : '新建预设' }}</h1>
        </div>
        <div class="heading-actions">
          <button class="ghost-button" :disabled="saving" @click="cancelEdit">
            <ArrowLeft :size="18" />
            <span>返回列表</span>
          </button>
        </div>
      </div>

      <form class="form-panel preset-form" @submit.prevent="handleSave">
        <label class="field">
          <span>预设名称</span>
          <input
            v-model.trim="form.name"
            maxlength="100"
            placeholder="如：创意写作、精确回答"
          />
        </label>

        <label class="field">
          <span>系统提示词</span>
          <textarea
            v-model="form.systemPrompt"
            rows="6"
            maxlength="50000"
            placeholder="可选，会作为额外的 system 消息发送给模型"
          />
        </label>

        <div class="form-grid two-col">
          <label class="field">
            <span>Temperature ({{ form.temperature }})</span>
            <input
              v-model.number="form.temperature"
              type="range"
              min="0"
              max="2"
              step="0.1"
            />
          </label>
          <label class="field">
            <span>Max Tokens</span>
            <input
              v-model.number="form.maxTokens"
              type="number"
              min="1"
              max="128000"
              step="1"
            />
          </label>
          <label class="field">
            <span>Top P ({{ form.topP }})</span>
            <input
              v-model.number="form.topP"
              type="range"
              min="0"
              max="1"
              step="0.05"
            />
          </label>
          <label class="field">
            <span>Frequency Penalty ({{ form.frequencyPenalty }})</span>
            <input
              v-model.number="form.frequencyPenalty"
              type="range"
              min="-2"
              max="2"
              step="0.1"
            />
          </label>
          <label class="field">
            <span>Presence Penalty ({{ form.presencePenalty }})</span>
            <input
              v-model.number="form.presencePenalty"
              type="range"
              min="-2"
              max="2"
              step="0.1"
            />
          </label>
        </div>

        <label class="checkbox-line">
          <input v-model="form.isDefault" type="checkbox" />
          <span>设为默认预设</span>
        </label>

        <div class="form-actions">
          <button class="primary-button" type="submit" :disabled="saving">
            <Save :size="18" />
            <span>{{ saving ? '保存中...' : '保存' }}</span>
          </button>
          <button class="ghost-button" type="button" :disabled="saving" @click="cancelEdit">
            <X :size="18" />
            <span>取消</span>
          </button>
          <button
            v-if="isEdit"
            class="danger-button"
            type="button"
            :disabled="saving || Boolean(deletingPresetId)"
            @click="handleDelete({ id: editing.id, name: form.name })"
          >
            <Trash2 :size="18" />
            <span>{{ deletingPresetId === editing.id ? '删除中...' : '删除' }}</span>
          </button>
        </div>
      </form>
    </template>
  </section>
</template>

<style scoped>
.preset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.preset-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  cursor: pointer;
  transition: box-shadow 0.2s, border-color 0.2s;
}

.preset-card:hover {
  border-color: var(--primary);
  box-shadow: var(--shadow);
}

.preset-card.is-busy {
  cursor: wait;
  opacity: 0.72;
}

.preset-card.is-busy:hover {
  border-color: var(--line);
  box-shadow: none;
}

.preset-card.is-default {
  border-color: var(--accent, var(--primary));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent, var(--primary)) 20%, transparent);
}

.preset-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.preset-card-header strong {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.default-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent, var(--primary)) 15%, transparent);
  color: var(--accent, var(--primary));
  font-size: 0.78rem;
  font-weight: 600;
  white-space: nowrap;
}

.preset-card-prompt {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--muted);
  font-size: 0.85rem;
  line-height: 1.5;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.preset-card-params {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--muted);
  font-size: 0.78rem;
}

.preset-card-params span {
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--surface-strong, var(--surface));
}

.preset-card-actions {
  display: flex;
  gap: 4px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}

.preset-form {
  max-width: 640px;
}

.preset-form .form-grid {
  display: grid;
  gap: 10px;
}

.preset-form .form-grid.two-col {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.preset-form .field input[type="range"] {
  width: 100%;
}

@media (max-width: 768px) {
  .preset-grid {
    grid-template-columns: 1fr;
  }

  .preset-form .form-grid.two-col {
    grid-template-columns: 1fr;
  }

  .heading-actions {
    flex-wrap: wrap;
  }
}
</style>
