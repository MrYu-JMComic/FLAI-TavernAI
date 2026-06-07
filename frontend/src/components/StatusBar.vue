<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ChevronDown } from '@lucide/vue';
import { buildScopedChatCss } from '../utils/chatAppearance';

const VALID_VARIANTS = ['default', 'compact', 'minimal', 'neon'];
const VALID_DENSITIES = ['default', 'cozy', 'compact'];
const VALID_EFFECTS = ['glow', 'striped', 'pulse'];
const VALID_DISPLAY_MODES = ['immersive', 'compact'];
const VALID_CHAR_STATUSES = ['active', 'dead', 'forgotten', 'left', 'hidden'];
const MAX_TEMPLATE_RESOLVE_DEPTH = 4;

const STATUS_LABELS = {
  active: '在线',
  dead: '死亡',
  forgotten: '遗忘',
  left: '离开',
  hidden: '隐藏'
};

const UPDATE_STATUS_META = {
  updating: { key: 'updating', label: '更新中' },
  updated: { key: 'updated', label: '已更新' },
  'not-updated': { key: 'not-updated', label: '未更新' }
};

const props = defineProps({
  statusBar: {
    type: Object,
    default: null
  },
  templateConfig: {
    type: Object,
    default: () => ({})
  },
  updateStatus: {
    type: String,
    default: 'not-updated'
  }
});

const emit = defineEmits(['quick-reply']);
const collapsed = ref(false);
const templateScopeId = ref(`flai-sb-${Math.random().toString(36).slice(2, 10)}`);
let customTemplateStyleElement = null;

const cfg = computed(() => {
  const raw = props.templateConfig || {};
  const variant = VALID_VARIANTS.includes(raw.variant) ? raw.variant : 'default';
  const density = VALID_DENSITIES.includes(raw.density) ? raw.density : 'default';
  const effects = Array.isArray(raw.effects)
    ? raw.effects.filter((e) => VALID_EFFECTS.includes(e))
    : [];
  const accentColor = typeof raw.accentColor === 'string' && raw.accentColor.trim()
    ? raw.accentColor.trim()
    : '';
  const customCss = typeof raw.customCss === 'string' ? raw.customCss : '';
  const displayMode = VALID_DISPLAY_MODES.includes(raw.displayMode) ? raw.displayMode : 'compact';
  const characters = Array.isArray(raw.characters) ? raw.characters : [];
  const quickReplies = Array.isArray(raw.quickReplies) ? raw.quickReplies : [];
  return { variant, density, effects, accentColor, customCss, displayMode, characters, quickReplies };
});

const hasContent = computed(() => {
  return props.statusBar && Array.isArray(props.statusBar.variables) && props.statusBar.variables.length > 0;
});

const hasImmersiveContent = computed(() => {
  return cfg.value.displayMode === 'immersive' && cfg.value.characters.length > 0;
});

const displayVariables = computed(() => {
  if (!props.statusBar?.variables) return [];
  return props.statusBar.variables.map(normalizeDisplayVariable);
});

const customTemplate = computed(() => {
  const raw = String(props.statusBar?.template || '').trim();
  if (!raw || raw[0] === '{') {
    return { html: '', css: '' };
  }
  const extracted = extractTemplateStyleBlocks(interpolateTemplate(raw));
  const styleBlocks = [];
  const html = sanitizeTemplateHtml(extracted.html, styleBlocks);
  const safeStyleBlocks = [...extracted.styleBlocks, ...styleBlocks]
    .map((block) => sanitizeStyleBlock(block))
    .filter(Boolean);
  const css = safeStyleBlocks.length
    ? buildScopedChatCss(safeStyleBlocks.join('\n\n'), `[data-status-bar-scope="${templateScopeId.value}"]`)
    : '';
  return { html, css };
});

const customTemplateHtml = computed(() => customTemplate.value.html);
const customTemplateCss = computed(() => customTemplate.value.css);
const hasCustomTemplate = computed(() => Boolean(customTemplateHtml.value));

const wrapperClasses = computed(() => {
  const classes = ['status-bar-container'];
  if (cfg.value.variant !== 'default') classes.push(`sb-${cfg.value.variant}`);
  if (cfg.value.density !== 'default') classes.push(`sb-density-${cfg.value.density}`);
  for (const fx of cfg.value.effects) {
    classes.push(`sb-fx-${fx}`);
  }
  if (hasImmersiveContent.value) classes.push('sb-immersive');
  if (hasCustomTemplate.value) classes.push('sb-custom-mode');
  if (collapsed.value) classes.push('sb-collapsed');
  return classes;
});

const collapseStorageKey = computed(() => {
  const rawKey = props.statusBar?.id || props.statusBar?.name || 'default';
  return `flai-status-bar-collapsed:${String(rawKey).slice(0, 80)}`;
});

const statusBarTitle = computed(() => props.statusBar?.name || '状态栏');

const statusBarMeta = computed(() => {
  if (hasImmersiveContent.value) {
    return `${cfg.value.characters.length} 个角色`;
  }
  if (displayVariables.value.length) {
    return `${displayVariables.value.length} 项状态`;
  }
  if (hasCustomTemplate.value) {
    return '自定义模板';
  }
  return '';
});

const collapsedSummary = computed(() => {
  return statusBarMeta.value
    ? `${statusBarTitle.value} · ${statusBarMeta.value}`
    : statusBarTitle.value;
});

const statusBarVisible = computed(() => hasCustomTemplate.value || hasContent.value || hasImmersiveContent.value);
const updateStatusMeta = computed(() => UPDATE_STATUS_META[props.updateStatus] || UPDATE_STATUS_META['not-updated']);

watch(collapseStorageKey, (key) => {
  collapsed.value = readCollapsedState(key);
}, { immediate: true });

watch(customTemplateCss, (css) => {
  syncCustomTemplateStyle(css);
}, { immediate: true });

onBeforeUnmount(() => {
  removeCustomTemplateStyle();
});

const ALLOWED_STYLE_PROPS = new Set(['borderRadius', 'background', 'boxShadow', 'fontFamily']);

function parseSafeStyle(css) {
  if (!css || typeof css !== 'string') return {};
  const style = {};
  try {
    const obj = JSON.parse(css);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      for (const [key, value] of Object.entries(obj)) {
        if ((ALLOWED_STYLE_PROPS.has(key) || key.startsWith('--sb-')) && isSafeCssValue(value)) {
          style[key] = String(value);
        }
      }
      return style;
    }
  } catch (_) { /* not JSON, parse as CSS text */ }
  const segments = css.split(';');
  for (const seg of segments) {
    const colonIdx = seg.indexOf(':');
    if (colonIdx === -1) continue;
    const rawProp = seg.substring(0, colonIdx).trim();
    const value = seg.substring(colonIdx + 1).trim();
    if (!rawProp || !value) continue;
    const camel = rawProp.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if ((ALLOWED_STYLE_PROPS.has(camel) || rawProp.startsWith('--sb-')) && isSafeCssValue(value)) {
      style[camel] = value;
    }
  }
  return style;
}

function isSafeCssValue(value) {
  return !/@import|expression\s*\(|javascript:|url\s*\(|behavior\s*:/i.test(String(value || ''));
}

const wrapperStyle = computed(() => {
  const style = {};
  if (cfg.value.accentColor) {
    style['--sb-accent'] = cfg.value.accentColor;
  }
  Object.assign(style, parseSafeStyle(cfg.value.customCss));
  return style;
});

function defaultColor(name) {
  const safeName = String(name || '');
  const colorMap = {
    'HP': '#e74c3c',
    'MP': '#3498db',
    'SP': '#f39c12',
    '体力': '#27ae60',
    '魔力': '#8e44ad',
    '好感度': '#e91e63',
    '好感': '#e91e63',
    '生命': '#e74c3c',
    '法力': '#3498db',
    '能量': '#f39c12',
    '怒气': '#c0392b',
    '经验': '#2ecc71',
    'EXP': '#2ecc71',
    '饥饿': '#e67e22',
    '心情': '#9b59b6'
  };
  for (const [key, color] of Object.entries(colorMap)) {
    if (safeName.toLowerCase().includes(key.toLowerCase())) {
      return color;
    }
  }
  return 'var(--sb-accent, #6c757d)';
}

function barStyle(variable) {
  return {
    width: `${variable.isMeter ? variable.percentage : 0}%`,
    backgroundColor: variable.color
  };
}

function charStyle(ch) {
  const style = {};
  if (ch.accentColor) style['--sb-ch-accent'] = ch.accentColor;
  Object.assign(style, parseSafeStyle(ch.customCss));
  return style;
}

function charVariables(ch) {
  if (!ch.variables || !Array.isArray(ch.variables)) return [];
  return ch.variables.map((v) => normalizeDisplayVariable(v, '#6c757d'));
}

function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

function statusClass(status) {
  return `sb-char-status-${status}`;
}

function onQuickReply(text) {
  if (text) emit('quick-reply', text);
}

function onCustomTemplateClick(event) {
  const target = event.target?.closest?.('[data-sb-action]');
  if (!target || !event.currentTarget?.contains(target)) {
    return;
  }
  const action = String(target.getAttribute('data-sb-action') || '').trim().toLowerCase();
  const text = String(
    target.getAttribute('data-sb-text') ||
      target.getAttribute('data-sb-reply') ||
      target.getAttribute('data-sb-copy') ||
      target.textContent ||
      ''
  ).trim();
  if (['quick-reply', 'reply', 'option'].includes(action)) {
    onQuickReply(text);
    return;
  }
  if (action === 'copy') {
    copyTemplateText(text);
    return;
  }
  if (['collapse', 'toggle-collapse'].includes(action)) {
    toggleCollapsed();
  }
}

async function copyTemplateText(text) {
  if (!text || typeof window === 'undefined') {
    return;
  }
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall back to a temporary textarea below.
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
  } catch {
    // Copy buttons are optional; ignore unavailable clipboard APIs.
  } finally {
    document.body.removeChild(textarea);
  }
}

function toggleCollapsed() {
  collapsed.value = !collapsed.value;
  writeCollapsedState(collapseStorageKey.value, collapsed.value);
}

function readCollapsedState(key) {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    return window.localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function writeCollapsedState(key, value) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(key, String(Boolean(value)));
  } catch {
    // Collapsing should keep working even when storage is unavailable.
  }
}

function interpolateTemplate(template) {
  return resolveTemplateText(template, { escape: true });
}

function resolveTemplateText(value, options = {}) {
  const depth = Number.isFinite(Number(options.depth)) ? Number(options.depth) : 0;
  const text = String(value ?? '');
  if (!text || depth > MAX_TEMPLATE_RESOLVE_DEPTH) {
    return text;
  }
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}|\{([\w\u4e00-\u9fa5 .-]+)\}/g, (_, doubleToken, singleToken) => {
    const resolved = resolveTemplateToken(doubleToken || singleToken, depth + 1);
    return options.escape ? escapeHtml(resolved) : String(resolved ?? '');
  });
}

function resolveTemplateToken(token, depth = 0) {
  const [rawName, rawProp = 'value'] = String(token || '').split('.').map((part) => part.trim());
  if (!rawName) return '';
  const variable = findDisplayVariable(rawName);
  if (!variable) return '';
  if (rawProp === 'max') return variable.isMeter ? variable.max : '';
  if (rawProp === 'percent') return variable.isMeter ? `${Math.round(variable.percentage)}%` : '';
  if (rawProp === 'percentage') return variable.isMeter ? Math.round(variable.percentage) : '';
  if (rawProp === 'display' || rawProp === 'displayValue') {
    return cleanResolvedTemplateText(resolveTemplateText(variable.displayValue, { depth }));
  }
  if (rawProp === 'color') return variable.color;
  return cleanResolvedTemplateText(resolveTemplateText(variable.value, { depth }));
}

function extractTemplateStyleBlocks(template) {
  const styleBlocks = [];
  const html = String(template || '').replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_match, css) => {
    styleBlocks.push(String(css || ''));
    return '';
  });
  return { html, styleBlocks };
}

function syncCustomTemplateStyle(css) {
  if (typeof document === 'undefined') {
    return;
  }
  const nextCss = String(css || '').trim();
  if (!nextCss) {
    removeCustomTemplateStyle();
    return;
  }
  if (!customTemplateStyleElement) {
    customTemplateStyleElement = document.createElement('style');
    customTemplateStyleElement.setAttribute('data-flai-status-bar-style', templateScopeId.value);
    document.head.appendChild(customTemplateStyleElement);
  }
  customTemplateStyleElement.textContent = nextCss;
}

function removeCustomTemplateStyle() {
  if (customTemplateStyleElement?.parentNode) {
    customTemplateStyleElement.parentNode.removeChild(customTemplateStyleElement);
  }
  customTemplateStyleElement = null;
}

function sanitizeTemplateHtml(html, styleBlocks = []) {
  if (typeof window === 'undefined' || typeof window.DOMParser !== 'function') {
    return escapeHtml(html);
  }
  const parser = new window.DOMParser();
  const doc = parser.parseFromString(String(html || ''), 'text/html');
  const allowedTags = new Set(['article', 'b', 'br', 'button', 'div', 'em', 'footer', 'header', 'hr', 'i', 'li', 'ol', 'p', 'section', 'small', 'span', 'strong', 'ul']);
  const allowedAttrs = new Set(['aria-label', 'class', 'data-sb-action', 'data-sb-copy', 'data-sb-reply', 'data-sb-text', 'role', 'style', 'title', 'type']);
  for (const node of [...doc.body.querySelectorAll('*')]) {
    const tag = node.tagName.toLowerCase();
    if (tag === 'style') {
      const safeCss = sanitizeStyleBlock(node.textContent);
      if (safeCss) {
        styleBlocks.push(safeCss);
      }
      node.remove();
      continue;
    }
    if (!allowedTags.has(tag)) {
      node.replaceWith(...node.childNodes);
      continue;
    }
    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || !allowedAttrs.has(name)) {
        node.removeAttribute(attr.name);
        continue;
      }
      if (name === 'style') {
        const safeStyle = sanitizeStyleText(attr.value);
        if (safeStyle) {
          node.setAttribute('style', safeStyle);
        } else {
          node.removeAttribute(attr.name);
        }
        continue;
      }
      if (name === 'type' && tag === 'button') {
        node.setAttribute('type', 'button');
        continue;
      }
      if (name.startsWith('data-sb-')) {
        node.setAttribute(attr.name, String(attr.value || '').slice(0, 500));
      }
    }
    if (tag === 'button') {
      node.setAttribute('type', 'button');
    }
  }
  applyTemplateRowVariables(doc.body);
  normalizeTemplateValueText(doc.body);
  return doc.body.innerHTML;
}

function normalizeDisplayVariable(variable, fallbackColor) {
  const rawValue = variable?.value;
  const numberValue = Number(rawValue);
  const hasNumberValue = isNumericLike(rawValue) && Number.isFinite(numberValue);
  const max = Number(variable?.max);
  const isMeter = hasNumberValue && Number.isFinite(max) && max > 0;
  const value = hasNumberValue ? numberValue : String(rawValue ?? '').trim();
  const percentage = isMeter ? Math.min(100, Math.max(0, (numberValue / max) * 100)) : 0;
  return {
    name: variable?.name || '?',
    value,
    max: isMeter ? max : '',
    percentage,
    isMeter,
    color: variable?.color || fallbackColor || defaultColor(variable?.name),
    displayValue: isMeter ? `${formatStatusNumber(numberValue)}/${formatStatusNumber(max)}` : (String(rawValue ?? '').trim() || '—')
  };
}

function isNumericLike(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  const text = String(value ?? '').trim();
  return /^[-+]?(?:\d+|\d*\.\d+)$/.test(text);
}

function formatStatusNumber(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function findDisplayVariable(name) {
  const key = normalizeVariableKey(name);
  return displayVariables.value.find((item) => normalizeVariableKey(item.name) === key);
}

function normalizeVariableKey(value) {
  return String(value || '')
    .replace(/[\s\u3000:\uFF1A;\uFF1B,\uFF0C.\u3002\u3001/\\|()[\]{}"'`~!@#$%^&*_+=?<>-]+/g, '')
    .trim()
    .toLowerCase();
}

function applyTemplateRowVariables(root) {
  if (!root?.querySelectorAll) {
    return;
  }
  const pairs = findTemplateValuePairs(root);
  for (const { label, value } of pairs) {
    const variable = findDisplayVariable(label);
    if (variable && value) {
      value.textContent = templateDisplayValue(variable);
    }
  }
}

function normalizeTemplateValueText(root) {
  if (!root?.querySelectorAll) {
    return;
  }
  for (const value of [...root.querySelectorAll('.sb-val')]) {
    value.textContent = cleanResolvedTemplateText(value.textContent);
  }
}

function templateDisplayValue(variable) {
  const value = String(variable?.displayValue ?? '');
  if (!hasTemplateToken(value)) {
    return value;
  }
  return cleanResolvedTemplateText(resolveTemplateText(value));
}

function hasTemplateToken(value) {
  return /\{\{\s*[^{}]+?\s*\}\}|\{[\w\u4e00-\u9fa5 .-]+\}/.test(String(value ?? ''));
}

function cleanResolvedTemplateText(value) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s>›|,，:：;；/]+|[\s>›|,，:：;；/]+$/g, '')
    .trim();
  return /[A-Za-z0-9\u4e00-\u9fff]/.test(text) ? text : '';
}

function findTemplateValuePairs(root) {
  const pairs = [];
  const usedValues = new Set();
  for (const label of [...root.querySelectorAll('.sb-label')]) {
    const value = findValueForTemplateLabel(label);
    if (!value || usedValues.has(value)) {
      continue;
    }
    pairs.push({ label: templateLabelText(label.textContent), value });
    usedValues.add(value);
  }
  for (const value of [...root.querySelectorAll('.sb-val')]) {
    if (usedValues.has(value)) {
      continue;
    }
    const label = findInlineLabelBeforeValue(value);
    if (!label) {
      continue;
    }
    pairs.push({ label, value });
    usedValues.add(value);
  }
  return pairs;
}

function findValueForTemplateLabel(label) {
  for (let node = label.nextSibling; node; node = node.nextSibling) {
    if (node.nodeType === 1) {
      if (node.classList?.contains('sb-label')) {
        return null;
      }
      if (node.classList?.contains('sb-val')) {
        return node;
      }
      const nested = node.querySelector?.('.sb-val');
      if (nested) {
        return nested;
      }
    }
  }
  const parentValues = [...(label.parentElement?.querySelectorAll?.('.sb-val') || [])];
  return parentValues.find((value) => label.compareDocumentPosition(value) & Node.DOCUMENT_POSITION_FOLLOWING) || null;
}

function findInlineLabelBeforeValue(value) {
  let text = '';
  for (let node = value.previousSibling; node; node = node.previousSibling) {
    if (node.nodeType === 1 && node.classList?.contains('sb-val')) {
      break;
    }
    text = `${node.textContent || ''}${text}`;
    if (/[:\uFF1A\n\r]/.test(node.textContent || '') || text.length > 60) {
      break;
    }
  }
  const match = text.match(/([^:\uFF1A\n\r]{1,40})[:\uFF1A]?\s*$/);
  return templateLabelText(match?.[1] || '');
}

function templateLabelText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/^[\s\u3000:\uFF1A;\uFF1B,\uFF0C.\u3002]+|[\s\u3000:\uFF1A;\uFF1B,\uFF0C.\u3002]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeStyleText(value) {
  return String(value || '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part && isSafeCssValue(part))
    .join('; ');
}

function sanitizeStyleBlock(value) {
  return String(value || '')
    .replace(/@import[^;]+;?/gi, '')
    .replace(/url\s*\([^)]*\)/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/behavior\s*:/gi, '');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}
</script>

<template>
  <div
    v-if="statusBarVisible"
    :class="wrapperClasses"
    :style="wrapperStyle"
    :data-status-bar-scope="templateScopeId"
    class="status-bar-root"
    :aria-expanded="String(!collapsed)"
  >
    <button
      v-if="collapsed"
      class="flai-statusbar-collapsed-card"
      type="button"
      :title="`展开状态栏：${collapsedSummary}`"
      :aria-label="`展开状态栏：${collapsedSummary}`"
      @click="toggleCollapsed"
    >
      <span class="status-bar-collapsed-label">状态栏</span>
      <span class="flai-statusbar-title">{{ statusBarTitle }}</span>
      <span v-if="statusBarMeta" class="flai-statusbar-meta">{{ statusBarMeta }}</span>
      <span
        class="flai-statusbar-update-badge"
        :class="`is-${updateStatusMeta.key}`"
        role="status"
        aria-live="polite"
      >
        <span class="flai-statusbar-update-dot" aria-hidden="true"></span>
        <span>{{ updateStatusMeta.label }}</span>
      </span>
      <span class="flai-statusbar-action">
        <ChevronDown :size="16" class="flai-statusbar-toggle-icon" />
        <span>展开</span>
      </span>
    </button>

    <template v-else>
      <div class="flai-statusbar-header">
        <button
          class="flai-statusbar-summary"
          type="button"
          :title="'收起状态栏'"
          :aria-label="`收起状态栏：${collapsedSummary}`"
          @click="toggleCollapsed"
        >
          <span class="status-bar-collapsed-label">状态栏</span>
          <span class="flai-statusbar-title">{{ statusBarTitle }}</span>
          <span v-if="statusBarMeta" class="flai-statusbar-meta">{{ statusBarMeta }}</span>
          <span
            class="flai-statusbar-update-badge"
            :class="`is-${updateStatusMeta.key}`"
            role="status"
            aria-live="polite"
          >
            <span class="flai-statusbar-update-dot" aria-hidden="true"></span>
            <span>{{ updateStatusMeta.label }}</span>
          </span>
        </button>
        <button
          class="flai-statusbar-toggle"
          type="button"
          title="收起状态栏"
          aria-label="收起状态栏"
          :aria-pressed="String(collapsed)"
          @click="toggleCollapsed"
        >
          <ChevronDown :size="16" class="flai-statusbar-toggle-icon expanded" />
          <span>收起</span>
        </button>
      </div>

      <div class="status-bar-collapse-body" :class="{ 'status-bar-collapse-body-custom': hasCustomTemplate }">
        <div v-if="hasCustomTemplate" class="status-bar-custom" @click="onCustomTemplateClick" v-html="customTemplateHtml"></div>
        <template v-else>
          <div v-if="hasContent" class="status-bar-header">
            <span class="status-bar-label">状态同步</span>
            <span class="status-bar-context">关联最新 AI 回复</span>
            <span
              class="flai-statusbar-update-badge"
              :class="`is-${updateStatusMeta.key}`"
              role="status"
              aria-live="polite"
            >
              <span class="flai-statusbar-update-dot" aria-hidden="true"></span>
              <span>{{ updateStatusMeta.label }}</span>
            </span>
            <span class="status-bar-name">{{ statusBar.name || '状态栏' }}</span>
          </div>
          <div v-if="hasContent" class="status-bar-variables">
            <div
              v-for="(variable, index) in displayVariables"
              :key="index"
              class="status-bar-variable"
            >
              <div class="variable-header">
                <span class="variable-name">{{ variable.name }}</span>
                <span class="variable-value">{{ variable.displayValue }}</span>
              </div>
              <div v-if="variable.isMeter" class="variable-bar-track">
                <div class="variable-bar-fill" :style="barStyle(variable)"></div>
              </div>
            </div>
          </div>

          <div v-if="hasImmersiveContent" class="sb-characters-section">
            <div
              v-for="ch in cfg.characters"
              :key="ch.id"
              class="sb-char-card"
              :class="statusClass(ch.status)"
              :style="charStyle(ch)"
            >
              <div class="sb-char-header">
                <span class="sb-char-name">{{ ch.name }}</span>
                <span v-if="ch.role" class="sb-char-role">{{ ch.role }}</span>
                <span class="sb-char-status" :class="statusClass(ch.status)">{{ statusLabel(ch.status) }}</span>
              </div>
              <p v-if="ch.note" class="sb-char-note">{{ ch.note }}</p>
              <div v-if="charVariables(ch).length" class="sb-char-variables">
                <div
                  v-for="(v, vi) in charVariables(ch)"
                  :key="vi"
                  class="sb-char-variable"
                >
                  <div class="variable-header">
                    <span class="variable-name">{{ v.name }}</span>
                    <span class="variable-value">{{ v.displayValue }}</span>
                  </div>
                  <div v-if="v.isMeter" class="variable-bar-track">
                    <div class="variable-bar-fill" :style="barStyle(v)"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-if="cfg.quickReplies.length" class="sb-quick-replies">
            <button
              v-for="(qr, qi) in cfg.quickReplies"
              :key="qi"
              class="sb-quick-reply-btn"
              type="button"
              @click="onQuickReply(qr.text)"
            >
              {{ qr.label }}
            </button>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* -- Scoped CSS variable bridge -- */
.status-bar-root {
  --sb-accent: var(--primary, #8f3f2f);
}

/* -- Base Card -- */
.status-bar-container {
  position: relative;
  display: grid;
  gap: 10px;
  border: 1px solid color-mix(in srgb, var(--line, rgba(62,48,38,0.14)) 80%, transparent);
  border-radius: 14px;
  padding: 14px 16px;
  background:
    linear-gradient(135deg,
      color-mix(in srgb, var(--surface, #fffaf2) 82%, transparent),
      color-mix(in srgb, var(--surface, #fffaf2) 64%, transparent));
  box-shadow:
    0 2px 12px rgba(67, 45, 30, 0.06),
    inset 0 1px 0 color-mix(in srgb, #ffffff 36%, transparent);
  backdrop-filter: blur(10px);
  transition: box-shadow 0.2s ease, border-color 0.2s ease;
}

.status-bar-container.sb-custom-mode:not(.sb-collapsed) {
  min-width: 0;
}

.flai-statusbar-collapsed-card {
  display: flex !important;
  width: 100%;
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 28px;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.flai-statusbar-collapsed-card:hover .flai-statusbar-title,
.flai-statusbar-summary:hover .flai-statusbar-title {
  color: var(--sb-accent, var(--primary, #8f3f2f));
}

.flai-statusbar-action {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin-left: auto;
  color: var(--sb-accent, var(--primary, #8f3f2f));
  font-size: 0.72rem;
  font-weight: 800;
  white-space: nowrap;
}

.flai-statusbar-header {
  position: relative;
  z-index: 4;
  display: flex !important;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  isolation: isolate;
}

.flai-statusbar-summary {
  display: flex !important;
  flex: 1 1 auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.status-bar-collapsed-label {
  flex: 0 0 auto;
  padding: 2px 8px;
  border-radius: 6px;
  color: var(--sb-accent, var(--primary, #8f3f2f));
  background: color-mix(in srgb, var(--sb-accent, var(--primary, #8f3f2f)) 12%, transparent);
  font-size: 0.68rem;
  font-weight: 800;
  line-height: 1.6;
}

.flai-statusbar-title {
  min-width: 0;
  overflow: hidden;
  color: var(--text, #241f1b);
  font-size: 0.82rem;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flai-statusbar-meta {
  flex: 0 0 auto;
  color: var(--muted, #75685e);
  font-size: 0.72rem;
  font-weight: 700;
  white-space: nowrap;
}

.flai-statusbar-meta::before {
  content: '·';
  margin-right: 8px;
  color: color-mix(in srgb, var(--muted, #75685e) 58%, transparent);
}

.flai-statusbar-update-badge {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 22px;
  padding: 0 8px;
  border: 1px solid color-mix(in srgb, var(--muted, #75685e) 22%, transparent);
  border-radius: 999px;
  color: color-mix(in srgb, var(--muted, #75685e) 92%, var(--text, #241f1b));
  background: color-mix(in srgb, var(--muted, #75685e) 7%, transparent);
  font-size: 0.68rem;
  font-weight: 800;
  line-height: 1;
  white-space: nowrap;
}

.flai-statusbar-update-badge.is-updating {
  border-color: color-mix(in srgb, #d97706 34%, transparent);
  color: #a86400;
  background: color-mix(in srgb, #f59e0b 13%, transparent);
}

.flai-statusbar-update-badge.is-updated {
  border-color: color-mix(in srgb, #16a34a 30%, transparent);
  color: #17803a;
  background: color-mix(in srgb, #22c55e 12%, transparent);
}

.flai-statusbar-update-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.75;
}

.flai-statusbar-update-badge.is-updating .flai-statusbar-update-dot {
  animation: statusBarUpdatePulse 1s ease-in-out infinite;
}

.flai-statusbar-toggle {
  display: inline-flex !important;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 68px;
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid color-mix(in srgb, var(--line, rgba(62,48,38,0.14)) 82%, transparent);
  border-radius: 999px;
  color: var(--sb-accent, var(--primary, #8f3f2f));
  background: color-mix(in srgb, var(--surface, #fffaf2) 88%, transparent);
  box-shadow: 0 4px 12px rgba(67, 45, 30, 0.08);
  font-family: inherit;
  font-size: 0.72rem;
  font-weight: 800;
  cursor: pointer;
  transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease;
}

.flai-statusbar-toggle:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--sb-accent, var(--primary, #8f3f2f)) 42%, var(--line, rgba(62,48,38,0.14)));
  background: color-mix(in srgb, var(--sb-accent, var(--primary, #8f3f2f)) 10%, var(--surface, #fffaf2));
}

@keyframes statusBarUpdatePulse {
  0%, 100% {
    opacity: 0.45;
    transform: scale(0.82);
  }
  50% {
    opacity: 1;
    transform: scale(1.15);
  }
}

.flai-statusbar-toggle-icon {
  transition: transform 0.18s ease;
}

.flai-statusbar-toggle-icon.expanded {
  transform: rotate(180deg);
}

.status-bar-collapse-body {
  min-width: 0;
}

.status-bar-custom {
  min-width: 0;
  max-width: 100%;
  overflow-x: hidden;
  color: var(--text, #2d2420);
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.status-bar-custom :deep(*) {
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.status-bar-custom :deep(.sb-panel),
.status-bar-custom :deep(.sb-section),
.status-bar-custom :deep(.sb-row),
.status-bar-custom :deep(.sb-line),
.status-bar-custom :deep(.sb-val) {
  min-width: 0;
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.status-bar-custom :deep(.sb-label) {
  white-space: nowrap;
}

.status-bar-custom :deep(button) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  margin: 2px 4px 2px 0;
  padding: 0 10px;
  border: 1px solid color-mix(in srgb, var(--sb-accent, var(--primary, #8f3f2f)) 28%, transparent);
  border-radius: 8px;
  color: var(--sb-accent, var(--primary, #8f3f2f));
  background: color-mix(in srgb, var(--sb-accent, var(--primary, #8f3f2f)) 10%, var(--surface, #fffaf2));
  font: inherit;
  font-size: 0.76rem;
  font-weight: 800;
  cursor: pointer;
}

.status-bar-custom :deep(button:hover) {
  border-color: color-mix(in srgb, var(--sb-accent, var(--primary, #8f3f2f)) 46%, transparent);
  background: color-mix(in srgb, var(--sb-accent, var(--primary, #8f3f2f)) 16%, var(--surface, #fffaf2));
}

:root[data-theme="dark"] .status-bar-container {
  background:
    linear-gradient(135deg,
      color-mix(in srgb, var(--surface, #24201d) 88%, transparent),
      color-mix(in srgb, var(--surface, #24201d) 72%, transparent));
  box-shadow:
    0 2px 16px rgba(0, 0, 0, 0.18),
    inset 0 1px 0 color-mix(in srgb, #ffffff 6%, transparent);
}

/* -- Header -- */
.status-bar-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 10px;
}

.status-bar-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 6px;
  color: var(--sb-accent);
  background: color-mix(in srgb, var(--sb-accent) 12%, transparent);
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  line-height: 1.6;
}

.status-bar-label::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--sb-accent);
  opacity: 0.7;
}

.status-bar-name {
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--muted, #75685e);
  letter-spacing: 0.02em;
}

.status-bar-context {
  font-size: 0.64rem;
  color: var(--muted, #75685e);
  opacity: 0.72;
  letter-spacing: 0.01em;
}

/* -- Variables Grid -- */
.status-bar-variables {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.status-bar-variable {
  flex: 1 1 140px;
  min-width: 120px;
}

.variable-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 5px;
}

.variable-name {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text, #241f1b);
}

.variable-value {
  font-size: 0.76rem;
  font-weight: 700;
  color: var(--muted, #75685e);
  font-variant-numeric: tabular-nums;
}

.variable-bar-track {
  height: 7px;
  background: color-mix(in srgb, var(--line, rgba(62,48,38,0.14)) 50%, transparent);
  border-radius: 4px;
  overflow: hidden;
}

.variable-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
}

/* ---------------------------------------
   VARIANT -- compact
   --------------------------------------- */
.sb-compact {
  padding: 10px 12px;
  border-radius: 10px;
}

.sb-compact .status-bar-header {
  margin-bottom: 6px;
}

.sb-compact .status-bar-label {
  font-size: 0.62rem;
  padding: 1px 6px;
}

.sb-compact .status-bar-name {
  font-size: 0.76rem;
}

.sb-compact .status-bar-variables {
  gap: 8px;
}

.sb-compact .status-bar-variable {
  flex: 1 1 100px;
  min-width: 80px;
}

.sb-compact .variable-name {
  font-size: 0.76rem;
}

.sb-compact .variable-value {
  font-size: 0.7rem;
}

.sb-compact .variable-bar-track {
  height: 5px;
}

/* ---------------------------------------
   VARIANT -- minimal
   --------------------------------------- */
.sb-minimal {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--line) 40%, transparent);
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
}

.sb-minimal .status-bar-header {
  margin-bottom: 4px;
}

.sb-minimal .status-bar-label {
  font-size: 0.6rem;
  padding: 1px 5px;
}

.sb-minimal .status-bar-name {
  font-size: 0.72rem;
}

.sb-minimal .variable-bar-track {
  height: 4px;
  border-radius: 2px;
}

.sb-minimal .variable-bar-fill {
  border-radius: 2px;
  box-shadow: none;
}

/* ---------------------------------------
   VARIANT -- neon
   --------------------------------------- */
.sb-neon {
  border-color: color-mix(in srgb, var(--sb-accent) 30%, transparent);
  background:
    linear-gradient(135deg,
      color-mix(in srgb, var(--surface) 60%, transparent),
      color-mix(in srgb, var(--sb-accent) 6%, transparent));
  box-shadow:
    0 0 18px color-mix(in srgb, var(--sb-accent) 10%, transparent),
    0 2px 12px rgba(0, 0, 0, 0.06);
}

.sb-neon .status-bar-label {
  color: var(--sb-accent);
  background: color-mix(in srgb, var(--sb-accent) 18%, transparent);
  box-shadow: 0 0 8px color-mix(in srgb, var(--sb-accent) 14%, transparent);
}

.sb-neon .variable-bar-track {
  background: color-mix(in srgb, var(--sb-accent) 10%, transparent);
}

.sb-neon .variable-bar-fill {
  box-shadow:
    0 0 6px color-mix(in srgb, var(--sb-accent) 30%, transparent),
    0 1px 4px rgba(0, 0, 0, 0.1);
}

/* ---------------------------------------
   DENSITY -- cozy
   --------------------------------------- */
.sb-density-cozy {
  padding: 18px 20px;
}

.sb-density-cozy .status-bar-header {
  margin-bottom: 14px;
}

.sb-density-cozy .status-bar-variables {
  gap: 16px;
}

.sb-density-cozy .variable-bar-track {
  height: 9px;
}

/* ---------------------------------------
   DENSITY -- compact
   --------------------------------------- */
.sb-density-compact {
  padding: 8px 10px;
}

.sb-density-compact .status-bar-header {
  margin-bottom: 6px;
}

.sb-density-compact .status-bar-variables {
  gap: 6px;
}

.sb-density-compact .variable-bar-track {
  height: 4px;
}

/* ---------------------------------------
   EFFECT -- glow
   --------------------------------------- */
.sb-fx-glow {
  box-shadow:
    0 0 20px color-mix(in srgb, var(--sb-accent) 12%, transparent),
    0 2px 12px rgba(0, 0, 0, 0.06);
  animation: sbGlowPulse 3s ease-in-out infinite;
}

@keyframes sbGlowPulse {
  0%, 100% {
    box-shadow:
      0 0 16px color-mix(in srgb, var(--sb-accent) 10%, transparent),
      0 2px 12px rgba(0, 0, 0, 0.06);
  }
  50% {
    box-shadow:
      0 0 28px color-mix(in srgb, var(--sb-accent) 18%, transparent),
      0 2px 16px rgba(0, 0, 0, 0.08);
  }
}

/* ---------------------------------------
   EFFECT -- striped
   --------------------------------------- */
.sb-fx-striped .variable-bar-fill {
  background-image: linear-gradient(
    -45deg,
    color-mix(in srgb, #ffffff 18%, transparent) 25%,
    transparent 25%,
    transparent 50%,
    color-mix(in srgb, #ffffff 18%, transparent) 50%,
    color-mix(in srgb, #ffffff 18%, transparent) 75%,
    transparent 75%,
    transparent
  );
  background-size: 14px 14px;
  animation: sbStripedMove 0.8s linear infinite;
}

@keyframes sbStripedMove {
  0% { background-position: 0 0; }
  100% { background-position: 14px 0; }
}

/* ---------------------------------------
   EFFECT -- pulse
   --------------------------------------- */
.sb-fx-pulse .variable-bar-fill {
  animation: sbBarPulse 2s ease-in-out infinite;
}

@keyframes sbBarPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.65; }
}

/* ---------------------------------------
   EFFECT -- combined glow+striped+pulse
   --------------------------------------- */
.sb-fx-glow.sb-fx-striped.sb-fx-pulse .variable-bar-fill {
  animation:
    sbBarPulse 2s ease-in-out infinite,
    sbStripedMove 0.8s linear infinite;
}

/* -- Immersive Multi-Character Section -- */
.sb-immersive {
  border: 0;
  border-radius: 0;
  padding: 0;
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
}

.sb-immersive .status-bar-header,
.sb-immersive .status-bar-variables {
  display: none;
}

.sb-characters-section {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
  margin-top: 0;
}

.sb-char-card {
  --sb-ch-accent: var(--sb-accent, var(--primary, #8f3f2f));
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--sb-ch-accent) 18%, var(--line, rgba(62,48,38,0.14)));
  border-radius: 10px;
  background:
    linear-gradient(135deg,
      color-mix(in srgb, var(--surface, #fffaf2) 88%, transparent),
      color-mix(in srgb, var(--sb-ch-accent) 4%, transparent));
}

.sb-char-header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.sb-char-name {
  font-size: 0.88rem;
  font-weight: 800;
  color: var(--text, #241f1b);
}

.sb-char-role {
  font-size: 0.72rem;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 6px;
  color: var(--sb-ch-accent);
  background: color-mix(in srgb, var(--sb-ch-accent) 12%, transparent);
}

.sb-char-status {
  font-size: 0.68rem;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 6px;
  line-height: 1.5;
}

.sb-char-status-active {
  color: var(--green, #2e6654);
  background: var(--green-soft, #dfeee6);
}

.sb-char-status-dead {
  color: var(--danger, #b83232);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}

.sb-char-status-forgotten {
  color: var(--muted, #75685e);
  background: color-mix(in srgb, var(--muted) 12%, transparent);
}

.sb-char-status-left {
  color: #a86400;
  background: color-mix(in srgb, #ffc76a 24%, transparent);
}

.sb-char-status-hidden {
  color: var(--muted, #75685e);
  background: color-mix(in srgb, var(--muted) 8%, transparent);
  opacity: 0.7;
}

.sb-char-card.sb-char-status-hidden {
  opacity: 0.55;
  border-style: dashed;
  border-color: color-mix(in srgb, var(--line, rgba(62,48,38,0.14)) 60%, transparent);
  background: color-mix(in srgb, var(--surface, #fffaf2) 40%, transparent);
}

.sb-char-card.sb-char-status-hidden .sb-char-name {
  color: var(--muted, #75685e);
}

.sb-char-note {
  margin: 4px 0 6px;
  font-size: 0.78rem;
  color: var(--muted, #75685e);
  line-height: 1.4;
}

.sb-char-variables {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 6px;
}

.sb-char-variable {
  flex: 1 1 120px;
  min-width: 100px;
}

.status-bar-container.sb-collapsed,
.status-bar-container.sb-collapsed.sb-compact,
.status-bar-container.sb-collapsed.sb-minimal,
.status-bar-container.sb-collapsed.sb-density-cozy,
.status-bar-container.sb-collapsed.sb-density-compact,
.status-bar-container.sb-collapsed.sb-immersive {
  min-height: 48px;
  gap: 0;
  padding: 10px 14px;
  border: 1px solid color-mix(in srgb, var(--line, rgba(62,48,38,0.14)) 80%, transparent);
  border-radius: 14px;
  background:
    linear-gradient(135deg,
      color-mix(in srgb, var(--surface, #fffaf2) 86%, transparent),
      color-mix(in srgb, var(--sb-accent, var(--primary, #8f3f2f)) 6%, transparent));
  box-shadow:
    0 2px 12px rgba(67, 45, 30, 0.06),
    inset 0 1px 0 color-mix(in srgb, #ffffff 32%, transparent);
  backdrop-filter: blur(10px);
}

/* -- Quick Replies -- */
.sb-quick-replies {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}

.sb-quick-reply-btn {
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid color-mix(in srgb, var(--sb-accent, var(--primary)) 30%, var(--line, rgba(62,48,38,0.14)));
  border-radius: 8px;
  color: var(--sb-accent, var(--primary, #8f3f2f));
  background: color-mix(in srgb, var(--sb-accent, var(--primary)) 8%, var(--surface, #fffaf2));
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.sb-quick-reply-btn:hover {
  background: color-mix(in srgb, var(--sb-accent, var(--primary)) 16%, var(--surface, #fffaf2));
  border-color: color-mix(in srgb, var(--sb-accent, var(--primary)) 50%, var(--line));
}

@media (prefers-reduced-motion: reduce) {
  .sb-quick-reply-btn {
    transition: none;
  }
}

@media (max-width: 768px) {
  .status-bar-container {
    padding: 10px 12px;
    border-radius: 10px;
  }

  .flai-statusbar-toggle {
    min-width: 62px;
    min-height: 28px;
    padding: 0 9px;
    font-size: 0.68rem;
  }

  .status-bar-header {
    margin-bottom: 8px;
  }

  .status-bar-label {
    font-size: 0.62rem;
    padding: 1px 6px;
  }

  .status-bar-name {
    font-size: 0.76rem;
  }

  .status-bar-variables {
    gap: 8px;
  }

  .status-bar-variable {
    flex: 1 1 100px;
    min-width: 80px;
  }

  .variable-name {
    font-size: 0.76rem;
  }

  .variable-value {
    font-size: 0.7rem;
  }

  .variable-bar-track {
    height: 5px;
  }

  .sb-characters-section {
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 6px;
  }

  .sb-char-card {
    padding: 8px 10px;
  }

  .sb-char-name {
    font-size: 0.82rem;
  }

  .sb-char-role {
    font-size: 0.68rem;
    padding: 1px 5px;
  }

  .sb-char-status {
    font-size: 0.64rem;
    padding: 1px 5px;
  }

  .sb-char-note {
    font-size: 0.74rem;
  }

  .sb-char-variables {
    gap: 8px;
  }

  .sb-char-variable {
    flex: 1 1 100px;
    min-width: 80px;
  }

  .sb-quick-replies {
    gap: 4px;
    margin-top: 8px;
  }

  .sb-quick-reply-btn {
    min-height: 28px;
    padding: 0 10px;
    font-size: 0.76rem;
  }
}

@media (max-width: 480px) {
  .status-bar-container {
    padding: 8px 10px;
  }

  .flai-statusbar-header {
    gap: 6px;
  }

  .flai-statusbar-title {
    font-size: 0.76rem;
  }

  .flai-statusbar-update-badge {
    gap: 4px;
    min-height: 20px;
    padding: 0 6px;
    font-size: 0.62rem;
  }

  .flai-statusbar-meta {
    display: none;
  }

  .flai-statusbar-toggle {
    min-width: 56px;
    min-height: 28px;
    padding: 0 8px;
  }

  .status-bar-header {
    margin-bottom: 6px;
  }

  .status-bar-label {
    font-size: 0.58rem;
    padding: 1px 5px;
  }

  .status-bar-name {
    font-size: 0.72rem;
  }

  .status-bar-variables {
    gap: 6px;
  }

  .status-bar-variable {
    flex: 1 1 80px;
    min-width: 60px;
  }

  .variable-name {
    font-size: 0.7rem;
  }

  .variable-value {
    font-size: 0.66rem;
  }

  .variable-bar-track {
    height: 4px;
  }

  .sb-characters-section {
    grid-template-columns: 1fr;
    gap: 6px;
  }

  .sb-char-card {
    padding: 6px 8px;
  }

  .sb-char-header {
    gap: 4px;
  }

  .sb-char-name {
    font-size: 0.78rem;
  }

  .sb-char-role {
    font-size: 0.64rem;
  }

  .sb-char-status {
    font-size: 0.6rem;
  }

  .sb-char-note {
    font-size: 0.7rem;
  }

  .sb-char-variable {
    flex: 1 1 80px;
    min-width: 60px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sb-fx-glow {
    animation: none;
  }

  .sb-fx-striped .variable-bar-fill {
    animation: none;
  }

  .sb-fx-pulse .variable-bar-fill {
    animation: none;
  }

  .sb-fx-glow.sb-fx-striped.sb-fx-pulse .variable-bar-fill {
    animation: none;
  }
}
</style>
