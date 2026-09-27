<script setup>
import { computed } from 'vue';
import { BookOpen, ChevronDown, Image as ImageIcon, Save, Upload, X } from '@lucide/vue';
import { isStatusTemplateMeterProperty, parseStatusTemplateToken } from '../../../../shared/statusTemplateTokens.js';
import {
  STATUS_VARIABLE_TYPES,
  STATUS_VARIABLE_TYPE_LABELS,
  normalizeStatusVariableType,
  normalizeStatusVariableValueForType,
  resolveStatusVariableKind
} from '../../../../shared/statusVariables.js';
import { STATUS_BAR_LAYOUT_OPTIONS, STATUS_BAR_VARIANT_OPTIONS } from '../../utils/statusBarOptions.js';
import { STATUS_TEMPLATE_REFERENCE } from '../../utils/statusTemplateReference.js';
import { buildModelSelectOptions } from '../../services/modelCatalog';

// Rendered from the SFC template; keep the script bindings visible to source
// hygiene checks.
void STATUS_VARIABLE_TYPES;
void STATUS_VARIABLE_TYPE_LABELS;
void STATUS_BAR_LAYOUT_OPTIONS;
void STATUS_BAR_VARIANT_OPTIONS;
void STATUS_TEMPLATE_REFERENCE;

const props = defineProps({
  open: { type: Boolean, default: false },
  conversation: { type: Object, default: null },
  sending: { type: Boolean, default: false },
  imageGenerationEnabled: { type: Boolean, default: true },
  canGenerateImages: { type: Boolean, default: false },
  canToggleImageGeneration: { type: Boolean, default: false },
  imageModel: { type: String, default: '' },
  imageModelOptions: { type: Array, default: () => [] },
  imageModelHint: { type: String, default: '' },
  authorChatAppearance: { type: Object, default: () => ({}) },
  chatAppearanceForm: { type: Object, default: () => ({}) },
  appearanceSaving: { type: Boolean, default: false },
  chatLorebookId: { type: String, default: null },
  worldBooks: { type: Array, default: () => [] },
  worldBooksLoading: { type: Boolean, default: false },
  accessorySettingsOpen: { type: Boolean, default: false },
  accessorySaving: { type: Boolean, default: false },
  accessorySkills: { type: Object, default: () => ({}) },
  accessorySkillItems: { type: Array, default: () => [] },
  providerModelOptions: { type: Array, default: () => [] },
  statusBar: { type: Object, default: null },
  statusBarEditorOpen: { type: Boolean, default: false },
  statusBarSaving: { type: Boolean, default: false },
  statusBarForm: { type: Object, default: () => ({}) },
  statusBarTemplateMode: { type: String, default: 'builtin' },
  statusBarTemplateIssues: { type: Array, default: () => [] },
  statusBarTemplateCfg: { type: Object, default: () => ({ variant: 'default', density: 'default', layout: 'grid', accentColor: '', effects: [], customCss: '' }) }
});

const emit = defineEmits([
  'close',
  'toggle-image-generation',
  'update:image-model',
  'save-appearance',
  'reset-appearance',
  'update:chatLorebookId',
  'background-upload',
  'clear-field',
  'update:accessorySettingsOpen',
  'save-accessory',
  'open-skill-settings',
  'update:accessorySkillEnabled',
  'update:accessorySkillModel',
  'open-status-bar-editor',
  'close-status-bar-editor',
  'update:statusBarTemplateMode',
  'add-status-bar-variable',
  'remove-status-bar-variable',
  'save-status-bar',
  'delete-status-bar',
  'add-status-character',
  'remove-status-character',
  'add-character-variable',
  'remove-character-variable',
  'add-quick-reply',
  'remove-quick-reply'
]);

const statusBarEditorRows = computed(() => {
  const form = props.statusBarForm || {};
  const variables = Array.isArray(form.variables) ? form.variables : [];
  const compositeRows = extractStatusTemplateCompositeRows(form.template);
  const compositeChildKeys = new Set();
  const compositeLabelKeys = new Set();
  const rows = [];
  for (let index = 0; index < compositeRows.length; index += 1) {
    const row = compositeRows[index];
    compositeLabelKeys.add(normalizeStatusVariableKey(row.label));
    let compositePartKey = '';
    for (let partIndex = 0; partIndex < row.parts.length; partIndex += 1) {
      const part = row.parts[partIndex];
      compositeChildKeys.add(normalizeStatusVariableKey(part.name));
      compositePartKey += `${partIndex > 0 ? '|' : ''}${part?.name ?? ''}`;
    }
    rows.push({
      kind: 'composite',
      key: `composite:${index}:${row.label}:${compositePartKey}`,
      label: row.label,
      parts: row.parts
    });
  }

  for (let index = 0; index < variables.length; index += 1) {
    const variable = variables[index];
    const key = normalizeStatusVariableKey(variable?.name);
    if (
      !key ||
      compositeChildKeys.has(key) ||
      compositeLabelKeys.has(key) ||
      isCompositeStatusPlaceholderValue(variable?.value, variable?.name)
    ) {
      continue;
    }
    const type = normalizeStatusVariableType(variable?.type) || resolveStatusVariableKind(variable);
    rows.push({
      kind: 'variable',
      key: `variable:${index}:${key}`,
      variable,
      index,
      type,
      isNumeric: type === 'meter' || type === 'number',
      valuePlaceholder: type === 'list' ? '长剑、药水、地图' : type === 'text' ? '当前文本' : '当前值'
    });
  }

  return rows;
});

const chatLorebookBindingLabel = computed(() => {
  const selectedId = props.chatLorebookId;
  if (!selectedId) {
    return '';
  }
  const books = Array.isArray(props.worldBooks) ? props.worldBooks : [];
  for (let index = 0; index < books.length; index += 1) {
    const book = books[index];
    if (book?.id === selectedId) {
      return book?.name || selectedId;
    }
  }
  return selectedId;
});

function getStatusBarVariableValue(name = '') {
  const variable = findStatusBarVariable(name);
  return variable ? String(variable.value ?? '') : '';
}

function setStatusBarVariableValue(name = '', value = '') {
  const normalizedName = normalizeTemplateVariableName(name);
  const form = props.statusBarForm || {};
  if (!normalizedName || !form || typeof form !== 'object') {
    return;
  }
  if (!Array.isArray(form.variables)) {
    form.variables = [];
  }
  let variable = findStatusBarVariable(normalizedName);
  if (!variable) {
    variable = { name: normalizedName, value: '' };
    form.variables.push(variable);
  }
  variable.value = String(value ?? '');
  delete variable.max;
  delete variable.color;
}

function findStatusBarVariable(name = '') {
  const key = normalizeStatusVariableKey(name);
  const variables = Array.isArray(props.statusBarForm?.variables) ? props.statusBarForm.variables : [];
  for (let index = 0; index < variables.length; index += 1) {
    const variable = variables[index];
    if (normalizeStatusVariableKey(variable?.name) === key) {
      return variable;
    }
  }
  return null;
}

function extractStatusTemplateCompositeRows(template = '') {
  const rows = [];
  const seen = new Set();
  const addRow = (rawLabel, rawValue) => {
    const label = normalizeTemplateVariableName(rawLabel);
    const key = normalizeStatusVariableKey(label);
    if (!label || !key || seen.has(key)) {
      return;
    }
    const parts = extractCompositePlaceholderParts(rawValue, label);
    if (parts.length < 2) {
      return;
    }
    rows.push({ label, parts });
    seen.add(key);
  };

  const rawTemplate = String(template || '');
  if (!rawTemplate || rawTemplate.trim()[0] === '{') {
    return rows;
  }

  const pairPattern = /<[^>]+\bclass\s*=\s*(['"])[^'"]*\bsb-label\b[^'"]*\1[^>]*>([\s\S]*?)<\/[^>]+>[\s\S]{0,180}?<[^>]+\bclass\s*=\s*(['"])[^'"]*\bsb-val\b[^'"]*\3[^>]*>([\s\S]*?)<\/[^>]+>/gi;
  let match;
  while ((match = pairPattern.exec(rawTemplate))) {
    addRow(match[2], match[4]);
  }

  const inlineValuePattern = /(?:^|>|\n)([^<>\n]{1,40}?)[\s:\uFF1A]+<[^>]+\bclass\s*=\s*(['"])[^'"]*\bsb-val\b[^'"]*\2[^>]*>([\s\S]*?)<\/[^>]+>/gi;
  while ((match = inlineValuePattern.exec(rawTemplate))) {
    addRow(match[1], match[3]);
  }
  return rows;
}

function extractCompositePlaceholderParts(value = '', label = '') {
  const parts = [];
  const seen = new Set();
  const labelKey = normalizeStatusVariableKey(label);
  const placeholderPattern = /\{\{\s*([^{}]+?)\s*\}\}|\{([\w\u4e00-\u9fa5 ._-]+)\}/g;
  let match;
  while ((match = placeholderPattern.exec(normalizeHtmlText(value)))) {
    const token = String(match[1] || match[2] || '').trim();
    const parsed = parseStatusTemplateToken(token);
    const rawProperty = parsed.rawProperty.trim() || 'value';
    const name = normalizeTemplateVariableName(parsed.rawName.trim());
    const key = normalizeStatusVariableKey(name);
    if (!name || !key || key === labelKey || seen.has(key) || isMeterTemplateProperty(rawProperty)) {
      continue;
    }
    parts.push({ name });
    seen.add(key);
  }
  return parts;
}

function isCompositeStatusPlaceholderValue(value = '', name = '') {
  return extractCompositePlaceholderParts(value, name).length >= 2;
}

function isMeterTemplateProperty(value = '') {
  return isStatusTemplateMeterProperty(value);
}

function normalizeTemplateVariableName(value = '') {
  return normalizeHtmlText(value).slice(0, 60);
}

function normalizeStatusVariableKey(value = '') {
  return String(value || '').trim().toLowerCase();
}

function normalizeHtmlText(value = '') {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function toggleEffect(effect) {
  const cfg = props.statusBarTemplateCfg;
  const idx = cfg.effects.indexOf(effect);
  if (idx >= 0) {
    cfg.effects.splice(idx, 1);
  } else {
    cfg.effects.push(effect);
  }
}

function colorInputValue(value, fallback = '#6c757d') {
  const normalized = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : fallback;
}

function setColorValue(target, key, value) {
  if (!target || typeof target !== 'object') {
    return;
  }
  target[key] = String(value || '').trim();
}

function readEventTargetValue(event) {
  const target = event?.target;
  return target && target.value !== undefined ? target.value : undefined;
}

function onChatLorebookChange(event) {
  const value = readEventTargetValue(event);
  if (value === undefined) {
    return;
  }
  emit('update:chatLorebookId', value || null);
}

function onStatusBarTemplateModeChange(event) {
  const value = readEventTargetValue(event);
  if (value === undefined) {
    return;
  }
  emit('update:statusBarTemplateMode', value);
}

function setColorValueFromEvent(target, key, event) {
  const value = readEventTargetValue(event);
  if (value === undefined) {
    return;
  }
  setColorValue(target, key, value);
}

function setStatusBarVariableValueFromEvent(name, event) {
  const value = readEventTargetValue(event);
  if (value === undefined) {
    return;
  }
  setStatusBarVariableValue(name, value);
}

// Switching type keeps the value usable and drops the fields the new type
// does not have, mirroring the character blueprint editor.
function setStatusBarVariableType(variable, event) {
  const value = readEventTargetValue(event);
  const type = normalizeStatusVariableType(value);
  if (!variable || typeof variable !== 'object' || !type) {
    return;
  }
  variable.type = type;
  variable.value = normalizeStatusVariableValueForType(variable.value, type, { emptyText: true });
  if (type === 'meter') {
    if (!Number.isFinite(Number(variable.max)) || Number(variable.max) <= 0) {
      variable.max = 100;
    }
    return;
  }
  delete variable.max;
  delete variable.min;
  delete variable.color;
  if (type !== 'number') {
    delete variable.unit;
  }
}

function modelOverrideOptions(value = '') {
  return buildModelSelectOptions(props.providerModelOptions, value, '使用当前模型');
}

function skillSourceSummary(skill = {}) {
  const profileId = String(skill?.providerProfileId || '').trim();
  const model = String(skill?.modelOverride || '').trim();
  if (profileId) return model ? `单独配置 · ${model}` : '单独配置的供应商';
  return model ? `跟随主聊天 · ${model}` : '跟随主聊天设置';
}

const drawerCloseLocked = computed(() => props.appearanceSaving || props.accessorySaving || props.statusBarSaving);

function requestClose() {
  if (drawerCloseLocked.value) return;
  emit('close');
}
</script>

<template>
  <button
    class="chat-settings-backdrop"
    :class="{ visible: open }"
    type="button"
    aria-label="关闭高阶设置"
    :aria-hidden="String(!open)"
    :disabled="drawerCloseLocked"
    :aria-busy="drawerCloseLocked"
    @click="requestClose"
  ></button>

  <aside class="chat-settings-drawer" :class="{ open: open }" aria-label="高阶设置" :aria-hidden="String(!open)">
    <header class="chat-settings-header">
      <div>
        <p>高阶设置</p>
        <h2>{{ conversation?.title || '当前会话' }}</h2>
      </div>
      <button class="deep-icon-button" type="button" aria-label="关闭设置" title="关闭设置" :disabled="drawerCloseLocked" :aria-busy="drawerCloseLocked" @click="requestClose">
        <X :size="18" />
      </button>
    </header>

    <div class="chat-settings-body">
      <section class="chat-settings-section author-settings-section">
        <div class="settings-section-title">
          <h3>作者固定设置</h3>
          <p>来自角色创建/编辑页，只读展示；下方会话设置会叠加在作者设置之后。</p>
        </div>
        <div class="readonly-settings-grid">
          <label class="chat-setting-field">
            <span>电脑端背景</span>
            <input :value="authorChatAppearance.desktopBackgroundUrl || '未设置'" type="text" readonly />
          </label>
          <label class="chat-setting-field">
            <span>手机端背景</span>
            <input :value="authorChatAppearance.mobileBackgroundUrl || '未设置'" type="text" readonly />
          </label>
        </div>
        <label class="chat-setting-field">
          <span>状态栏提示词</span>
          <textarea
            class="chat-code-textarea readonly"
            aria-label="作者状态栏提示词"
            rows="4"
            :value="authorChatAppearance.statusBarPrompt || '未设置'"
            readonly
          />
        </label>
      </section>

      <section class="chat-settings-section">
        <div class="settings-section-title">
          <h3>回复模式</h3>
          <p>开启后，发送消息会调用独立图片模型；关闭则使用文字回复。</p>
        </div>
        <label class="chat-setting-toggle image-generation-setting">
          <input
            class="chat-setting-toggle-input"
            type="checkbox"
            :checked="canToggleImageGeneration && imageGenerationEnabled"
            :disabled="sending || !canToggleImageGeneration"
            :aria-busy="sending"
            @change="emit('toggle-image-generation')"
          />
          <span class="chat-setting-toggle-control" aria-hidden="true"></span>
          <span class="chat-setting-toggle-copy">
            <strong>
              <ImageIcon :size="15" />
              <span>{{ canToggleImageGeneration && imageGenerationEnabled ? '生成图片' : '文字回复' }}</span>
            </strong>
            <small>{{ imageModelHint || (canToggleImageGeneration ? `图片模型：${imageModel || '供应商默认'}` : '当前供应商未配置可用的图片模型。') }}</small>
          </span>
        </label>
        <label class="chat-setting-field image-generation-model-field">
          <span>图片模型</span>
          <input
            :value="imageModel"
            list="chat-image-model-options"
            :disabled="sending || !canGenerateImages"
            aria-label="图片模型"
            placeholder="例如 gpt-image-2"
            @input="emit('update:image-model', readEventTargetValue($event))"
          />
          <datalist id="chat-image-model-options">
            <option v-for="model in imageModelOptions" :key="model.id" :value="model.id">
              {{ model.label || model.id }}
            </option>
          </datalist>
        </label>
      </section>

      <section class="chat-settings-section">
        <div class="settings-section-title">
          <h3>聊天背景</h3>
          <p>电脑端和手机端可以分别设置，留空则回退到默认暖色背景。</p>
        </div>

        <label class="chat-setting-field">
          <span>电脑端背景</span>
          <input
            v-model="chatAppearanceForm.desktopBackgroundUrl"
            type="text"
            placeholder="图片链接、短链或 data URL"
            :disabled="appearanceSaving"
          />
        </label>
        <div class="chat-setting-actions">
          <label class="chat-setting-upload" :class="{ 'is-disabled': appearanceSaving }">
            <Upload :size="15" />
            <span>上传图片</span>
            <input
              type="file"
              accept="image/*"
              :disabled="appearanceSaving"
              @change="emit('background-upload', { event: $event, field: 'desktopBackgroundUrl' })"
            />
          </label>
          <button class="chat-setting-inline-button" type="button" :disabled="appearanceSaving" @click="emit('clear-field', 'desktopBackgroundUrl')">
            清空
          </button>
        </div>

        <label class="chat-setting-field">
          <span>手机端背景</span>
          <input
            v-model="chatAppearanceForm.mobileBackgroundUrl"
            type="text"
            placeholder="图片链接、短链或 data URL"
            :disabled="appearanceSaving"
          />
        </label>
        <div class="chat-setting-actions">
          <label class="chat-setting-upload" :class="{ 'is-disabled': appearanceSaving }">
            <Upload :size="15" />
            <span>上传图片</span>
            <input
              type="file"
              accept="image/*"
              :disabled="appearanceSaving"
              @change="emit('background-upload', { event: $event, field: 'mobileBackgroundUrl' })"
            />
          </label>
          <button class="chat-setting-inline-button" type="button" :disabled="appearanceSaving" @click="emit('clear-field', 'mobileBackgroundUrl')">
            清空
          </button>
        </div>
      </section>

      <section class="chat-settings-section">
        <div class="settings-section-title">
          <h3>高级设置</h3>
        </div>
        <label class="chat-setting-toggle">
          <input
            v-model="chatAppearanceForm.highlightDialogue"
            class="chat-setting-toggle-input"
            type="checkbox"
            :disabled="appearanceSaving"
          />
          <span class="chat-setting-toggle-control" aria-hidden="true"></span>
          <span class="chat-setting-toggle-copy">
            <strong>引号对白着色</strong>
          </span>
        </label>
      </section>

      <section class="chat-settings-section">
        <div class="settings-section-title">
          <h3>内置 CSS</h3>
          <p>只会作用于当前会话。可以写动画、布局和局部样式，留空则不生效。</p>
        </div>
        <label class="chat-setting-toggle">
          <input
            v-model="chatAppearanceForm.customCssEnabled"
            class="chat-setting-toggle-input"
            type="checkbox"
            :disabled="appearanceSaving"
          />
          <span class="chat-setting-toggle-control" aria-hidden="true"></span>
          <span class="chat-setting-toggle-copy">
            <strong>启用当前会话 CSS</strong>
            <small>确认后才会应用下面的样式文本。</small>
          </span>
        </label>
        <label class="chat-setting-toggle">
          <input
            v-model="chatAppearanceForm.customCssRiskAccepted"
            class="chat-setting-toggle-input"
            type="checkbox"
            :disabled="appearanceSaving"
          />
          <span class="chat-setting-toggle-control" aria-hidden="true"></span>
          <span class="chat-setting-toggle-copy">
            <strong>确认 CSS 风险</strong>
            <small>勾选后，已启用的样式才会生效。</small>
          </span>
        </label>
        <textarea
          v-model="chatAppearanceForm.customCss"
          class="chat-code-textarea"
          aria-label="当前会话内置 CSS"
          rows="10"
          placeholder=".deep-bubble { border-radius: 22px; }\n@keyframes floatIn { ... }"
          :disabled="appearanceSaving"
        />
      </section>

      <section class="chat-settings-section">
        <div class="settings-section-title">
          <h3>内置 JS</h3>
          <p>可读取当前会话、消息区和聊天容器。脚本可返回清理函数，留空则不执行。</p>
        </div>
        <label class="chat-setting-toggle">
          <input
            v-model="chatAppearanceForm.customJsEnabled"
            class="chat-setting-toggle-input"
            type="checkbox"
            :disabled="appearanceSaving"
          />
          <span class="chat-setting-toggle-control" aria-hidden="true"></span>
          <span class="chat-setting-toggle-copy">
            <strong>启用当前会话 JS</strong>
            <small>确认后才会执行下面的脚本文本。</small>
          </span>
        </label>
        <label class="chat-setting-toggle">
          <input
            v-model="chatAppearanceForm.customJsRiskAccepted"
            class="chat-setting-toggle-input"
            type="checkbox"
            :disabled="appearanceSaving"
          />
          <span class="chat-setting-toggle-control" aria-hidden="true"></span>
          <span class="chat-setting-toggle-copy">
            <strong>确认 JS 风险</strong>
            <small>勾选后，已启用的脚本才会执行。</small>
          </span>
        </label>
        <textarea
          v-model="chatAppearanceForm.customJs"
          class="chat-code-textarea code-js"
          aria-label="当前会话内置 JS"
          rows="12"
          placeholder="const bubble = query('.deep-bubble');\nif (bubble) bubble.classList.add('pulse');\nreturn () => bubble?.classList.remove('pulse');"
          :disabled="appearanceSaving"
        />
      </section>

      <section class="chat-settings-section">
        <div class="settings-section-title">
          <h3>状态栏提示词</h3>
          <p>供状态栏 Agent 判断变量变化；主聊天回复不会被要求调用状态栏工具。</p>
        </div>
        <textarea
          v-model="chatAppearanceForm.statusBarPrompt"
          class="chat-code-textarea"
          aria-label="状态栏提示词"
          rows="6"
          placeholder="例如：HP 降低、好感变化、获得金币时更新对应变量。"
          :disabled="appearanceSaving"
        />
      </section>

      <section class="chat-settings-section">
        <div class="settings-section-title">
          <h3>聊天世界书</h3>
          <p>为当前对话绑定专属世界书；其条目只在此对话中激活。</p>
        </div>
        <label class="chat-setting-field">
          <span>绑定世界书</span>
          <select
            :value="chatLorebookId || ''"
            :disabled="worldBooksLoading || appearanceSaving"
            @change="onChatLorebookChange"
          >
            <option value="">无（不绑定）</option>
            <option
              v-for="book in worldBooks"
              :key="book.id"
              :value="book.id"
            >
              {{ book.name }}（{{ book.entryCount ?? 0 }} 条目）
            </option>
          </select>
        </label>
        <label class="chat-setting-toggle">
          <input
            v-model="chatAppearanceForm.showWorldBookMatches"
            class="chat-setting-toggle-input"
            type="checkbox"
            :disabled="appearanceSaving"
          />
          <span class="chat-setting-toggle-control" aria-hidden="true"></span>
          <span class="chat-setting-toggle-copy">
            <strong>显示世界书命中来源</strong>
            <small>关闭后隐藏消息下方的世界书命中来源按钮和弹窗。</small>
          </span>
        </label>
        <p v-if="worldBooksLoading" class="chat-lorebook-hint">加载世界书列表中...</p>
        <p v-else-if="chatLorebookBindingLabel" class="chat-lorebook-hint">
          已绑定：{{ chatLorebookBindingLabel }}
        </p>
      </section>

      <section class="chat-settings-section accessory-skills-section">
        <button class="settings-section-toggle" type="button" @click="emit('update:accessorySettingsOpen', !accessorySettingsOpen)">
          <span class="settings-section-title">
            <h3>附属技能</h3>
            <p>为当前会话单独启用子智能体；未配置模型时使用当前聊天模型。</p>
          </span>
          <ChevronDown :size="17" :class="{ rotated: accessorySettingsOpen }" />
        </button>

        <fieldset v-if="accessorySettingsOpen" class="accessory-skills-grid" :disabled="accessorySaving" :aria-busy="accessorySaving">
          <div v-for="item in accessorySkillItems" :key="item.key" class="accessory-skill-row">
            <label class="chat-setting-field compact">
              <span>{{ item.label }}</span>
              <select
                v-model="accessorySkills[item.key].enabled"
              >
                <option :value="false">关闭</option>
                <option :value="true">开启</option>
                <option v-if="item.auto" value="auto">自动</option>
              </select>
            </label>
            <div v-if="item.configurable" class="chat-setting-field compact accessory-skill-configure">
              <span>模型与工具</span>
              <button
                class="accessory-skill-configure-button"
                type="button"
                :aria-label="`打开${item.label}设置`"
                @click="emit('open-skill-settings', item.key)"
              >
                <span>{{ skillSourceSummary(accessorySkills[item.key]) }}</span>
                <small>弹窗设置</small>
              </button>
            </div>
            <label v-else-if="item.model !== false" class="chat-setting-field compact">
              <span>模型覆盖</span>
              <select
                v-model="accessorySkills[item.key].modelOverride"
              >
                <option
                  v-for="model in modelOverrideOptions(accessorySkills[item.key].modelOverride)"
                  :key="model.id || `current-${item.key}`"
                  :value="model.id"
                >
                  {{ model.label || model.id }}
                </option>
              </select>
            </label>
          </div>
          <button class="chat-settings-save" type="button" :disabled="accessorySaving" @click="emit('save-accessory')">
            <Save :size="15" />
            <span>{{ accessorySaving ? '保存中...' : '保存附属技能' }}</span>
          </button>
        </fieldset>
      </section>

      <section class="chat-settings-section">
        <div class="settings-section-title">
          <h3>状态栏</h3>
          <p>在聊天顶部显示自定义状态栏；变量更新由状态栏 Agent 或手动编辑完成。</p>
        </div>
        <div class="status-bar-editor-actions">
          <button v-if="!statusBar" class="chat-setting-inline-button" type="button" :disabled="statusBarSaving" :aria-busy="statusBarSaving" @click="emit('open-status-bar-editor')">
            创建状态栏
          </button>
          <template v-else>
            <button class="chat-setting-inline-button" type="button" :disabled="statusBarSaving" :aria-busy="statusBarSaving" @click="emit('open-status-bar-editor')">
              编辑状态栏
            </button>
            <button class="chat-setting-inline-button danger" type="button" :disabled="statusBarSaving" :aria-busy="statusBarSaving" @click="emit('delete-status-bar')">
              删除状态栏
            </button>
          </template>
        </div>

        <div v-if="statusBarEditorOpen" class="status-bar-editor" :aria-busy="statusBarSaving">
          <fieldset class="status-bar-editor-fields" :disabled="statusBarSaving">
          <label class="chat-setting-field">
            <span>状态栏名称</span>
            <input
              v-model="statusBarForm.name"
              type="text"
              placeholder="状态栏"
              maxlength="50"
            />
          </label>

          <div class="sb-template-editor">
            <label class="chat-setting-field compact">
              <span>模板模式</span>
              <select
                :value="statusBarTemplateMode"
                @change="onStatusBarTemplateModeChange"
              >
                <option value="builtin">内置样式</option>
                <option value="custom">完全自定义</option>
              </select>
            </label>
            <template v-if="statusBarTemplateMode === 'custom'">
              <label class="chat-setting-field compact">
                <span>自定义模板</span>
                <textarea
                  v-model="statusBarForm.template"
                  class="chat-code-textarea sb-custom-template"
                  rows="8"
                  placeholder="<div class=&quot;sb-row&quot;><span class=&quot;sb-label&quot;>HP</span><span class=&quot;sb-val&quot;>{{HP}} / {{HP.max}}</span></div>"
                />
              </label>
              <details class="status-blueprint-reference">
                <summary>
                  <BookOpen :size="15" />
                  <span>语法速查：占位符、变量类型、过滤器、条件循环、表达式、按钮动作、样式类</span>
                  <ChevronDown :size="15" aria-hidden="true" />
                </summary>
                <div class="status-blueprint-reference-body">
                  <section v-for="group in STATUS_TEMPLATE_REFERENCE" :key="group.key" class="status-blueprint-reference-group">
                    <h4>{{ group.title }}</h4>
                    <dl>
                      <template v-for="item in group.items" :key="item.code">
                        <dt><code>{{ item.code }}</code></dt>
                        <dd>{{ item.summary }}</dd>
                      </template>
                    </dl>
                  </section>
                </div>
              </details>
            </template>
            <div v-if="statusBarTemplateIssues.length" class="status-bar-template-alert" role="alert">
              <span>模板需要调整：</span>
              <ul>
                <li v-for="issue in statusBarTemplateIssues" :key="issue">{{ issue }}</li>
              </ul>
            </div>
            <template v-else>
            <div class="sb-template-row">
              <label class="chat-setting-field compact">
                <span>样式风格</span>
                <select v-model="statusBarTemplateCfg.variant">
                  <option v-for="option in STATUS_BAR_VARIANT_OPTIONS" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
              </label>
              <label class="chat-setting-field compact">
                <span>排列</span>
                <select v-model="statusBarTemplateCfg.layout">
                  <option v-for="option in STATUS_BAR_LAYOUT_OPTIONS" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
              </label>
              <label class="chat-setting-field compact">
                <span>间距</span>
                <select v-model="statusBarTemplateCfg.density">
                  <option value="default">默认</option>
                  <option value="cozy">宽松</option>
                  <option value="compact">紧凑</option>
                </select>
              </label>
              <label class="chat-setting-field compact">
                <span>显示模式</span>
                <select v-model="statusBarTemplateCfg.displayMode">
                  <option value="compact">紧凑</option>
                  <option value="immersive">沉浸</option>
                </select>
              </label>
            </div>
            <label class="chat-setting-field compact">
              <span>强调色</span>
              <div class="sb-accent-row">
                <input
                  v-model="statusBarTemplateCfg.accentColor"
                  type="text"
                  placeholder="留空使用主题色，如 #e91e63"
                  maxlength="30"
                />
                <input
                  :value="colorInputValue(statusBarTemplateCfg.accentColor, '#8f3f2f')"
                  type="color"
                  class="sb-accent-picker"
                  title="选择颜色"
                  @input="setColorValueFromEvent(statusBarTemplateCfg, 'accentColor', $event)"
                />
              </div>
            </label>
            <div class="sb-effects-field">
              <span class="sb-effects-label">动效</span>
              <div class="sb-effects-grid">
                <label class="sb-effect-check">
                  <input
                    type="checkbox"
                    :checked="statusBarTemplateCfg.effects.includes('glow')"
                    @change="toggleEffect('glow')"
                  />
                  <span>光晕</span>
                </label>
                <label class="sb-effect-check">
                  <input
                    type="checkbox"
                    :checked="statusBarTemplateCfg.effects.includes('striped')"
                    @change="toggleEffect('striped')"
                  />
                  <span>条纹</span>
                </label>
                <label class="sb-effect-check">
                  <input
                    type="checkbox"
                    :checked="statusBarTemplateCfg.effects.includes('pulse')"
                    @change="toggleEffect('pulse')"
                  />
                  <span>脉冲</span>
                </label>
              </div>
            </div>
            <label class="chat-setting-field compact">
              <span>自定义 CSS 变量</span>
              <textarea
                v-model="statusBarTemplateCfg.customCss"
                class="chat-code-textarea sb-custom-css"
                rows="3"
                placeholder='--sb-accent: #e91e63; border-radius: 20px;'
              />
            </label>
            </template>
          </div>

          <div v-if="statusBarTemplateMode !== 'custom' && statusBarTemplateCfg.displayMode === 'immersive'" class="sb-characters-editor">
            <div class="variables-editor-header">
              <span>角色列表</span>
              <button class="chat-setting-inline-button small" type="button" @click="emit('add-status-character')">
                + 添加角色
              </button>
            </div>
            <div
              v-for="(ch, ci) in statusBarTemplateCfg.characters"
              :key="ch.id || ci"
              class="sb-char-editor-row"
            >
              <div class="sb-char-editor-grid">
                <label class="chat-setting-field compact">
                  <span>名称</span>
                  <input v-model="ch.name" type="text" placeholder="角色名" maxlength="30" class="variable-input name" />
                </label>
                <label class="chat-setting-field compact">
                  <span>分类</span>
                  <input v-model="ch.role" type="text" placeholder="如 主角/NPC" maxlength="20" class="variable-input name" />
                </label>
                <label class="chat-setting-field compact">
                  <span>状态</span>
                  <select v-model="ch.status" class="variable-input">
                    <option value="active">在线</option>
                    <option value="dead">死亡</option>
                    <option value="forgotten">遗忘</option>
                    <option value="left">离开</option>
                    <option value="hidden">隐藏</option>
                  </select>
                </label>
                <label class="chat-setting-field compact">
                  <span>备注</span>
                  <input v-model="ch.note" type="text" placeholder="简短备注" maxlength="80" class="variable-input name" />
                </label>
                <label class="chat-setting-field compact">
                  <span>强调色</span>
                  <input :value="colorInputValue(ch.accentColor)" type="color" class="variable-input color" title="角色强调色" @input="setColorValueFromEvent(ch, 'accentColor', $event)" />
                </label>
                <label class="chat-setting-field compact sb-char-css-field">
                  <span>自定义 CSS</span>
                  <input v-model="ch.customCss" type="text" placeholder='--sb-ch-accent: #e91e63;' maxlength="120" class="variable-input name" />
                </label>
              </div>
              <div class="sb-char-vars">
                <span class="sb-char-vars-label">角色变量</span>
                <div
                  v-for="(v, vi) in ch.variables"
                  :key="vi"
                  class="variable-editor-row"
                >
                  <input v-model="v.name" class="variable-input name" type="text" :aria-label="`角色变量 ${vi + 1} 名称`" placeholder="变量名" maxlength="20" />
                  <input v-model.number="v.value" class="variable-input num" type="number" :aria-label="`角色变量 ${vi + 1} 当前值`" placeholder="值" />
                  <span class="variable-separator">/</span>
                  <input v-model.number="v.max" class="variable-input num" type="number" :aria-label="`角色变量 ${vi + 1} 最大值`" placeholder="最大" />
                  <input :value="colorInputValue(v.color)" class="variable-input color" type="color" title="颜色" @input="setColorValueFromEvent(v, 'color', $event)" />
                  <button class="variable-remove" type="button" title="删除变量" @click="emit('remove-character-variable', ci, vi)">x</button>
                </div>
                <button class="chat-setting-inline-button small" type="button" @click="emit('add-character-variable', ci)">+ 添加变量</button>
              </div>
              <button class="variable-remove char-remove" type="button" title="删除角色" @click="emit('remove-status-character', ci)">x</button>
            </div>
          </div>

          <div v-if="statusBarTemplateMode !== 'custom'" class="sb-quick-replies-editor">
            <div class="variables-editor-header">
              <span>快捷回复</span>
              <button class="chat-setting-inline-button small" type="button" @click="emit('add-quick-reply')">+ 添加</button>
            </div>
            <div
              v-for="(qr, qi) in statusBarTemplateCfg.quickReplies"
              :key="qi"
              class="variable-editor-row"
            >
              <input v-model="qr.label" class="variable-input name" type="text" :aria-label="`快捷回复 ${qi + 1} 按钮文字`" placeholder="按钮文字" maxlength="20" />
              <input v-model="qr.text" class="variable-input name" type="text" :aria-label="`快捷回复 ${qi + 1} 发送文本`" placeholder="发送文本" maxlength="200" />
              <button class="variable-remove" type="button" title="删除" @click="emit('remove-quick-reply', qi)">x</button>
            </div>
          </div>

          <div class="status-bar-variables-editor">
            <div class="variables-editor-header">
              <span>变量列表</span>
              <button class="chat-setting-inline-button small" type="button" @click="emit('add-status-bar-variable')">
                + 添加变量
              </button>
            </div>
            <div
              v-for="row in statusBarEditorRows"
              :key="row.key"
              class="status-variable-card"
              :class="`is-${row.kind === 'composite' ? 'composite' : row.type}`"
            >
              <template v-if="row.kind === 'composite'">
                <div class="status-variable-line">
                  <input
                    :value="row.label"
                    class="variable-input name"
                    type="text"
                    readonly
                    :aria-label="`状态栏组合行 ${row.label}`"
                  />
                  <span class="status-variable-type-tag">组合行</span>
                </div>
                <div class="status-composite-values">
                  <label
                    v-for="part in row.parts"
                    :key="part.name"
                    class="status-composite-value"
                  >
                    <span>{{ part.name }}</span>
                    <input
                      class="variable-input value"
                      type="text"
                      :value="getStatusBarVariableValue(part.name)"
                      placeholder="当前值"
                      :aria-label="`状态栏 ${row.label} 的 ${part.name}`"
                      @input="setStatusBarVariableValueFromEvent(part.name, $event)"
                    />
                  </label>
                </div>
              </template>
              <template v-else>
                <div class="status-variable-line">
                  <input
                    v-model="row.variable.name"
                    class="variable-input name"
                    type="text"
                    :aria-label="`状态栏变量 ${row.index + 1} 名称`"
                    placeholder="变量名"
                    maxlength="40"
                  />
                  <select
                    class="variable-input kind"
                    :value="row.type"
                    :aria-label="`状态栏变量 ${row.index + 1} 类型`"
                    @change="setStatusBarVariableType(row.variable, $event)"
                  >
                    <option v-for="type in STATUS_VARIABLE_TYPES" :key="type" :value="type">
                      {{ STATUS_VARIABLE_TYPE_LABELS[type] }}
                    </option>
                  </select>
                  <button
                    class="variable-remove"
                    type="button"
                    title="删除变量"
                    :aria-label="`删除状态栏变量 ${row.index + 1}`"
                    @click="emit('remove-status-bar-variable', row.index)"
                  >
                    x
                  </button>
                </div>
                <div class="status-variable-line is-detail">
                  <label class="status-variable-field is-value">
                    <span>{{ row.type === 'list' ? '条目' : '当前值' }}</span>
                    <input
                      v-model="row.variable.value"
                      class="variable-input value"
                      :type="row.isNumeric ? 'number' : 'text'"
                      :aria-label="`状态栏变量 ${row.index + 1} 当前值`"
                      :placeholder="row.valuePlaceholder"
                    />
                  </label>
                  <template v-if="row.type === 'meter'">
                    <label class="status-variable-field is-num">
                      <span>下限</span>
                      <input
                        v-model.number="row.variable.min"
                        class="variable-input num"
                        type="number"
                        :aria-label="`状态栏变量 ${row.index + 1} 最小值`"
                        placeholder="0"
                      />
                    </label>
                    <label class="status-variable-field is-num">
                      <span>上限</span>
                      <input
                        v-model.number="row.variable.max"
                        class="variable-input num"
                        type="number"
                        :aria-label="`状态栏变量 ${row.index + 1} 最大值`"
                        placeholder="100"
                      />
                    </label>
                  </template>
                  <label v-if="row.isNumeric" class="status-variable-field is-unit">
                    <span>单位</span>
                    <input
                      v-model="row.variable.unit"
                      class="variable-input unit"
                      type="text"
                      :aria-label="`状态栏变量 ${row.index + 1} 单位`"
                      placeholder="点 / G"
                      maxlength="12"
                    />
                  </label>
                  <label v-if="row.type === 'meter'" class="status-variable-field is-color">
                    <span>颜色</span>
                    <input
                      :value="colorInputValue(row.variable.color)"
                      class="variable-input color"
                      type="color"
                      :aria-label="`状态栏变量 ${row.index + 1} 颜色`"
                      @input="setColorValueFromEvent(row.variable, 'color', $event)"
                    />
                  </label>
                </div>
              </template>
            </div>
          </div>

          </fieldset>

          <div class="status-bar-editor-footer">
            <button class="chat-settings-save" type="button" :disabled="statusBarSaving || statusBarTemplateIssues.length > 0" :aria-busy="statusBarSaving" @click="emit('save-status-bar')">
              <Save :size="15" />
              <span>{{ statusBarSaving ? '保存中...' : '保存状态栏' }}</span>
            </button>
            <button class="chat-setting-inline-button" type="button" :disabled="statusBarSaving" @click="emit('close-status-bar-editor')">
              取消
            </button>
          </div>
        </div>
      </section>
    </div>

    <footer class="chat-settings-footer">
      <button class="chat-setting-inline-button" type="button" :disabled="appearanceSaving" @click="emit('reset-appearance')">
        恢复当前会话
      </button>
      <button class="chat-settings-save" type="button" :disabled="appearanceSaving" :aria-busy="appearanceSaving" @click="emit('save-appearance')">
        <Save :size="15" />
        <span>{{ appearanceSaving ? '保存中...' : '保存并应用' }}</span>
      </button>
    </footer>
  </aside>
</template>
