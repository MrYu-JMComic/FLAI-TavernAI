<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { ChevronDown } from '@lucide/vue';
import { renderStatusTemplate } from '../../../shared/statusTemplateRenderer.js';
import {
  adjustStatusVariableValue,
  buildStatusDisplayVariable,
  cycleStatusVariableValue,
  normalizeStatusVariableKey
} from '../../../shared/statusVariables.js';
import { buildScopedChatCss } from '../utils/chatAppearance';
import { recordFrontendDiagnostic } from '../diagnostics.js';
import { copyTextToClipboard } from '../utils/clipboard.js';
import {
  STATUS_BAR_TEMPLATE_ALLOWED_ATTRS,
  STATUS_BAR_TEMPLATE_ALLOWED_TAGS,
  STATUS_BAR_TEMPLATE_DATA_ATTR_LIMIT,
  STATUS_BAR_TEMPLATE_DATA_ATTR_PREFIX,
  escapeStatusBarTemplateHtml as escapeHtml,
  isSafeStatusBarCssValue as isSafeCssValue,
  namespaceStatusBarKeyframes,
  sanitizeStatusBarStyleBlock as sanitizeStyleBlock,
  sanitizeStatusBarStyleText as sanitizeStyleText
} from '../utils/statusBarTemplateSecurity';
import {
  STATUS_BAR_DENSITIES as VALID_DENSITIES,
  STATUS_BAR_DISPLAY_MODES as VALID_DISPLAY_MODES,
  STATUS_BAR_EFFECTS as VALID_EFFECTS,
  STATUS_BAR_LAYOUTS as VALID_LAYOUTS,
  STATUS_BAR_VARIANTS as VALID_VARIANTS
} from '../utils/statusBarOptions.js';

const STATUS_LABELS = {
  active: '在线',
  dead: '死亡',
  forgotten: '遗忘',
  left: '离开',
  hidden: '隐藏'
};

const UPDATE_STATUS_META = {
  updating: { key: 'updating', label: '正在同步' },
  updated: { key: 'updated', label: '本轮已同步' },
  'not-updated': { key: 'not-updated', label: '等待新回复' }
};

// `.sb-val` nodes whose template content is a placeholder are marked before
// rendering so the label auto-sync below only fixes hard-coded values.
const SB_VAL_OPEN_TAG = /<([a-z][\w-]*)(\s[^<>]*?\bclass\s*=\s*(["'])[^"']*\bsb-val\b[^"']*\3[^<>]*?)(\/?)>/gi;
const TEMPLATE_TOKEN_TEST = /\{\{[^{}]+\}\}|\{\s*[\w一-龥][\w一-龥 .-]*\}/;

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
  },
  collapseRequest: {
    type: Number,
    default: 0
  },
  embedded: {
    type: Boolean,
    default: false
  },
  // { user, char } for the {{user}} / {{char}} built-ins.
  context: {
    type: Object,
    default: () => ({})
  }
});

const emit = defineEmits(['collapse', 'quick-reply', 'send', 'update-variables', 'open-settings', 'script-action']);
const collapsed = ref(false);
const effectiveCollapsed = computed(() => !props.embedded && collapsed.value);
const templateScopeId = ref(`flai-sb-${Math.random().toString(36).slice(2, 10)}`);
const customTemplateRef = ref(null);
// Toggle / tab choices survive re-renders: the rendered HTML always starts
// from the authored state and these are re-applied on top of it.
const templateUiState = { toggled: new Map(), tabs: new Map() };
let customTemplateStyleElement = null;

const cfg = computed(() => {
  const raw = props.templateConfig || {};
  const variant = isAllowedTemplateOption(VALID_VARIANTS, raw.variant) ? raw.variant : 'default';
  const density = isAllowedTemplateOption(VALID_DENSITIES, raw.density) ? raw.density : 'default';
  const layout = isAllowedTemplateOption(VALID_LAYOUTS, raw.layout) ? raw.layout : 'grid';
  const effects = normalizeTemplateEffects(raw.effects);
  const accentColor = typeof raw.accentColor === 'string' && raw.accentColor.trim()
    ? raw.accentColor.trim()
    : '';
  const customCss = typeof raw.customCss === 'string' ? raw.customCss : '';
  const displayMode = isAllowedTemplateOption(VALID_DISPLAY_MODES, raw.displayMode) ? raw.displayMode : 'compact';
  const characters = Array.isArray(raw.characters) ? raw.characters : [];
  const quickReplies = Array.isArray(raw.quickReplies) ? raw.quickReplies : [];
  return { variant, density, layout, effects, accentColor, customCss, displayMode, characters, quickReplies };
});

function isAllowedTemplateOption(options, value) {
  for (let index = 0; index < options.length; index += 1) {
    if (options[index] === value) {
      return true;
    }
  }
  return false;
}

function normalizeTemplateEffects(effects) {
  const rows = [];
  const source = Array.isArray(effects) ? effects : [];
  for (let index = 0; index < source.length; index += 1) {
    const effect = source[index];
    if (isAllowedTemplateOption(VALID_EFFECTS, effect)) {
      rows.push(effect);
    }
  }
  return rows;
}

const hasContent = computed(() => {
  return props.statusBar && Array.isArray(props.statusBar.variables) && props.statusBar.variables.length > 0;
});

const hasImmersiveContent = computed(() => {
  return cfg.value.displayMode === 'immersive' && cfg.value.characters.length > 0;
});

const displayVariables = computed(() => {
  return normalizeDisplayVariables(props.statusBar?.variables);
});

const displayCharacters = computed(() => {
  return normalizeDisplayCharacters(cfg.value.characters);
});

const templateContext = computed(() => ({
  user: String(props.context?.user || ''),
  char: String(props.context?.char || '')
}));

const customTemplate = computed(() => {
  const raw = String(props.statusBar?.template || '').trim();
  if (!raw || raw[0] === '{') {
    return { html: '', css: '' };
  }
  const extracted = extractTemplateStyleBlocks(interpolateTemplate(markBoundTemplateValues(raw)));
  const styleBlocks = [];
  const html = sanitizeTemplateHtml(extracted.html, styleBlocks);
  const css = buildCustomTemplateCss(
    extracted.styleBlocks,
    styleBlocks,
    `[data-status-bar-scope="${templateScopeId.value}"]`
  );
  return { html, css };
});

const customTemplateHtml = computed(() => customTemplate.value.html);
const customTemplateCss = computed(() => customTemplate.value.css);
const hasCustomTemplate = computed(() => Boolean(customTemplateHtml.value));

const wrapperClasses = computed(() => {
  const classes = ['status-bar-container'];
  if (props.embedded) classes.push('sb-embedded');
  if (cfg.value.variant !== 'default') classes.push(`sb-${cfg.value.variant}`);
  if (cfg.value.density !== 'default') classes.push(`sb-density-${cfg.value.density}`);
  if (cfg.value.layout !== 'grid') classes.push(`sb-layout-${cfg.value.layout}`);
  for (const fx of cfg.value.effects) {
    classes.push(`sb-fx-${fx}`);
  }
  if (hasImmersiveContent.value) classes.push('sb-immersive');
  if (hasCustomTemplate.value) classes.push('sb-custom-mode');
  if (effectiveCollapsed.value) classes.push('sb-collapsed');
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
  templateUiState.toggled.clear();
  templateUiState.tabs.clear();
}, { immediate: true });

watch(customTemplateCss, (css) => {
  syncCustomTemplateStyle(css);
}, { immediate: true });

watch([customTemplateHtml, customTemplateRef], () => {
  nextTick(applyTemplateUiState);
}, { flush: 'post' });

watch(() => props.collapseRequest, (request) => {
  if (!request || collapsed.value) {
    return;
  }
  setCollapsed(true);
});

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
  } catch (error) {
    recordFrontendDiagnostic('statusBar.safeStyle.jsonFallback', error, { parser: 'JSON.parse' });
  }
  applySafeStyleText(style, css);
  return style;
}

function applySafeStyleText(style, css) {
  const text = String(css || '');
  let segmentStart = 0;
  for (let index = 0; index <= text.length; index += 1) {
    if (index < text.length && text[index] !== ';') {
      continue;
    }
    applySafeStyleSegment(style, text.slice(segmentStart, index));
    segmentStart = index + 1;
  }
}

function applySafeStyleSegment(style, segment) {
  const colonIdx = segment.indexOf(':');
  if (colonIdx === -1) return;
  const rawProp = segment.substring(0, colonIdx).trim();
  const value = segment.substring(colonIdx + 1).trim();
  if (!rawProp || !value) return;
  const camel = toCamelStyleProp(rawProp);
  if ((ALLOWED_STYLE_PROPS.has(camel) || rawProp.startsWith('--sb-')) && isSafeCssValue(value)) {
    style[camel] = value;
  }
}

function toCamelStyleProp(rawProp) {
  let value = '';
  let upperNext = false;
  for (let index = 0; index < rawProp.length; index += 1) {
    const char = rawProp[index];
    if (char === '-') {
      upperNext = true;
      continue;
    }
    value += upperNext ? char.toUpperCase() : char;
    upperNext = false;
  }
  return value;
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

// Long text and longer lists take a full row so they are shown completely
// instead of being squeezed into a narrow tile.
function isWideVariable(variable) {
  if (variable.kind === 'list') return variable.items.length > 3 || variable.displayValue.length > 16;
  return variable.kind === 'text' && [...variable.displayValue].length > 16;
}

function charStyle(ch) {
  const style = {};
  if (ch.accentColor) style['--sb-ch-accent'] = ch.accentColor;
  Object.assign(style, parseSafeStyle(ch.customCss));
  return style;
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
  const target = event?.target?.closest?.('[data-sb-action]');
  if (!target || !event?.currentTarget?.contains?.(target)) {
    return;
  }
  const action = String(target.getAttribute('data-sb-action') || '').trim().toLowerCase();
  const text = readActionText(target);
  if (['quick-reply', 'reply', 'option'].includes(action)) {
    onQuickReply(text);
    return;
  }
  if (action === 'send') {
    if (text) emit('send', text);
    return;
  }
  if (action === 'copy') {
    copyTemplateText(text);
    return;
  }
  if (action === 'set' || action === 'adjust' || action === 'cycle') {
    emitVariableAction(action, target);
    return;
  }
  if (action === 'toggle') {
    toggleTemplateTarget(target);
    return;
  }
  if (action === 'tab') {
    activateTemplateTab(target);
    return;
  }
  if (action === 'script') {
    const name = String(target.getAttribute('data-sb-script') || '').trim();
    if (name) emit('script-action', { name, value: String(target.getAttribute('data-sb-value') ?? ''), text });
    return;
  }
  if (action === 'open-settings') {
    emit('open-settings');
    return;
  }
  if (action === 'collapse') {
    requestCollapse();
    return;
  }
  if (action === 'toggle-collapse') {
    if (props.embedded) {
      emit('collapse');
      return;
    }
    toggleCollapsed();
  }
}

function readActionText(target) {
  return String(
    target.getAttribute('data-sb-text') ||
      target.getAttribute('data-sb-reply') ||
      target.getAttribute('data-sb-copy') ||
      target.textContent ||
      ''
  ).trim();
}

// set / adjust / cycle compute the next value from the rendered variable so
// meters stay inside min~max; the owner persists the change.
function emitVariableAction(action, target) {
  const name = String(target.getAttribute('data-sb-var') || '').trim();
  if (!name) return;
  const variable = findDisplayVariable(name);
  let value;
  if (action === 'adjust') {
    if (!variable) return;
    value = adjustStatusVariableValue(variable, target.getAttribute('data-sb-delta'));
  } else if (action === 'cycle') {
    value = cycleStatusVariableValue(variable || {}, target.getAttribute('data-sb-options'));
  } else {
    value = coerceActionValue(target.getAttribute('data-sb-value'), variable);
  }
  emit('update-variables', [{ name: variable?.name || name, value }]);
}

function coerceActionValue(raw, variable) {
  const text = String(raw ?? '').trim();
  if (!variable || (variable.kind !== 'meter' && variable.kind !== 'number')) {
    return text;
  }
  const numeric = Number(text);
  if (!text || !Number.isFinite(numeric)) return text;
  return variable.kind === 'meter' ? adjustStatusVariableValue({ ...variable, value: numeric }, 0) : numeric;
}

function toggleTemplateTarget(target) {
  const selector = String(target.getAttribute('data-sb-target') || '').trim();
  if (!selector) return;
  templateUiState.toggled.set(selector, !templateUiState.toggled.get(selector));
  applyTemplateUiState();
}

function activateTemplateTab(target) {
  const selector = String(target.getAttribute('data-sb-target') || '').trim();
  if (!selector) return;
  templateUiState.tabs.set(templateTabGroup(target), selector);
  applyTemplateUiState();
}

function templateTabGroup(trigger) {
  return String(trigger.getAttribute('data-sb-group') || 'default').trim() || 'default';
}

function applyTemplateUiState() {
  const container = customTemplateRef.value;
  if (!container?.querySelectorAll) return;
  for (const [selector, flipped] of templateUiState.toggled) {
    for (const element of queryTemplateElements(container, selector)) {
      if (!element.hasAttribute('data-sb-initial-hidden')) {
        element.setAttribute('data-sb-initial-hidden', element.classList.contains('sb-hidden') ? '1' : '0');
      }
      const initiallyHidden = element.getAttribute('data-sb-initial-hidden') === '1';
      element.classList.toggle('sb-hidden', flipped ? !initiallyHidden : initiallyHidden);
    }
    for (const trigger of queryTemplateElements(container, '[data-sb-action="toggle"]')) {
      if (String(trigger.getAttribute('data-sb-target') || '').trim() === selector) {
        trigger.classList.toggle('sb-active', flipped);
        trigger.setAttribute('aria-pressed', String(flipped));
      }
    }
  }
  for (const [group, activeSelector] of templateUiState.tabs) {
    for (const trigger of queryTemplateElements(container, '[data-sb-action="tab"]')) {
      if (templateTabGroup(trigger) !== group) continue;
      const selector = String(trigger.getAttribute('data-sb-target') || '').trim();
      const active = selector === activeSelector;
      trigger.classList.toggle('sb-active', active);
      trigger.setAttribute('aria-selected', String(active));
      for (const panel of queryTemplateElements(container, selector)) {
        panel.classList.toggle('sb-hidden', !active);
      }
    }
  }
}

function queryTemplateElements(container, selector) {
  try {
    return Array.from(container.querySelectorAll(selector));
  } catch {
    return [];
  }
}

async function copyTemplateText(text) {
  if (!text || typeof window === 'undefined') {
    return;
  }
  try {
    await copyTextToClipboard(text);
  } catch {
    // Copy buttons are optional; ignore unavailable clipboard APIs.
  }
}

function toggleCollapsed() {
  setCollapsed(!collapsed.value);
}

function requestCollapse() {
  if (props.embedded) {
    emit('collapse');
    return;
  }
  setCollapsed(true);
}

function setCollapsed(value) {
  collapsed.value = Boolean(value);
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
  return renderStatusTemplate(template, {
    resolveVariable: findDisplayVariable,
    listVariables: () => displayVariables.value,
    escape: escapeHtml,
    context: templateContext.value
  });
}

function markBoundTemplateValues(template) {
  return String(template || '').replace(SB_VAL_OPEN_TAG, (full, tag, attrs, _quote, selfClosing, offset, source) => {
    if (selfClosing) return full;
    const start = offset + full.length;
    const close = source.toLowerCase().indexOf(`</${tag.toLowerCase()}`, start);
    const inner = source.slice(start, close < 0 ? source.length : close);
    return TEMPLATE_TOKEN_TEST.test(inner) ? `<${tag}${attrs} data-sb-bound="1">` : full;
  });
}

function extractTemplateStyleBlocks(template) {
  const styleBlocks = [];
  const html = String(template || '').replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_match, css) => {
    styleBlocks.push(String(css || ''));
    return '';
  });
  return { html, styleBlocks };
}

function buildCustomTemplateCss(extractedStyleBlocks, inlineStyleBlocks, scopeSelector) {
  let cssText = appendSafeStyleBlocks('', extractedStyleBlocks);
  cssText = appendSafeStyleBlocks(cssText, inlineStyleBlocks);
  if (!cssText) return '';
  return buildScopedChatCss(namespaceStatusBarKeyframes(cssText, templateScopeId.value), scopeSelector);
}

function appendSafeStyleBlocks(cssText, blocks) {
  for (const block of Array.isArray(blocks) ? blocks : []) {
    const safeBlock = sanitizeStyleBlock(block);
    if (!safeBlock) {
      continue;
    }
    cssText = cssText ? `${cssText}\n\n${safeBlock}` : safeBlock;
  }
  return cssText;
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
  const nodes = doc.body.querySelectorAll('*');
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    const node = nodes[nodeIndex];
    const tag = node.tagName.toLowerCase();
    if (tag === 'style') {
      const safeCss = sanitizeStyleBlock(node.textContent);
      if (safeCss) {
        styleBlocks.push(safeCss);
      }
      node.remove();
      continue;
    }
    if (!STATUS_BAR_TEMPLATE_ALLOWED_TAGS.has(tag)) {
      node.replaceWith(...node.childNodes);
      continue;
    }
    const attrs = node.attributes;
    for (let attrIndex = attrs.length - 1; attrIndex >= 0; attrIndex -= 1) {
      const attr = attrs[attrIndex];
      const name = attr.name.toLowerCase();
      if (name.startsWith(STATUS_BAR_TEMPLATE_DATA_ATTR_PREFIX)) {
        node.setAttribute(attr.name, String(attr.value || '').slice(0, STATUS_BAR_TEMPLATE_DATA_ATTR_LIMIT));
        continue;
      }
      if (name.startsWith('on') || !STATUS_BAR_TEMPLATE_ALLOWED_ATTRS.has(name)) {
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
      // `hidden` becomes the sb-hidden class so toggle / tab can show it again.
      if (name === 'hidden') {
        node.removeAttribute(attr.name);
        node.classList.add('sb-hidden');
        continue;
      }
      if (name === 'type' && tag === 'button') {
        node.setAttribute('type', 'button');
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
  return buildStatusDisplayVariable(variable, fallbackColor || defaultColor(variable?.name));
}

function normalizeDisplayVariables(variables, fallbackColor) {
  const rows = [];
  for (const variable of Array.isArray(variables) ? variables : []) {
    rows.push(normalizeDisplayVariable(variable, fallbackColor));
  }
  return rows;
}

function normalizeDisplayCharacters(characters) {
  const rows = [];
  const source = Array.isArray(characters) ? characters : [];
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] && typeof source[index] === 'object' ? source[index] : {};
    rows.push({
      key: character.id || index,
      character,
      variables: normalizeDisplayVariables(character.variables, '#6c757d')
    });
  }
  return rows;
}

function findDisplayVariable(name) {
  const key = normalizeStatusVariableKey(name);
  const variables = displayVariables.value;
  for (let index = 0; index < variables.length; index += 1) {
    const item = variables[index];
    if (normalizeStatusVariableKey(item.name) === key) {
      return item;
    }
  }
  return null;
}

function applyTemplateRowVariables(root) {
  if (!root?.querySelectorAll) {
    return;
  }
  const pairs = findTemplateValuePairs(root);
  for (const { label, value } of pairs) {
    if (value.hasAttribute('data-sb-bound')) {
      continue;
    }
    const variable = findDisplayVariable(label);
    if (variable && value) {
      value.textContent = resolveDisplayText(variable.displayValue);
    }
  }
}

// Display text may itself hold placeholders ("平静 {{姓名}}"); it is written
// with textContent, so no escaping is needed here.
function resolveDisplayText(text) {
  const value = String(text ?? '');
  if (!TEMPLATE_TOKEN_TEST.test(value)) return value;
  return cleanResolvedTemplateText(renderStatusTemplate(value, {
    resolveVariable: findDisplayVariable,
    listVariables: () => displayVariables.value,
    context: templateContext.value
  }));
}

function normalizeTemplateValueText(root) {
  if (!root?.querySelectorAll) {
    return;
  }
  const values = root.querySelectorAll('.sb-val');
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.children.length) {
      value.textContent = cleanResolvedTemplateText(value.textContent);
    }
  }
}

function cleanResolvedTemplateText(value) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s>›|,，:：;；/]+|[\s>›|,，:：;；/]+$/g, '')
    .trim();
  return /[\p{L}\p{N}\p{Emoji_Presentation}]/u.test(text) ? text : '';
}

function findTemplateValuePairs(root) {
  const pairs = [];
  const usedValues = new Set();
  const labels = root.querySelectorAll('.sb-label');
  for (let labelIndex = 0; labelIndex < labels.length; labelIndex += 1) {
    const label = labels[labelIndex];
    const value = findValueForTemplateLabel(label);
    if (!value || usedValues.has(value)) {
      continue;
    }
    pairs.push({ label: templateLabelText(label.textContent), value });
    usedValues.add(value);
  }
  const values = root.querySelectorAll('.sb-val');
  for (let valueIndex = 0; valueIndex < values.length; valueIndex += 1) {
    const value = values[valueIndex];
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
  const parentValues = label.parentElement?.querySelectorAll?.('.sb-val');
  if (!parentValues) {
    return null;
  }
  for (let index = 0; index < parentValues.length; index += 1) {
    const value = parentValues[index];
    if (label.compareDocumentPosition(value) & Node.DOCUMENT_POSITION_FOLLOWING) {
      return value;
    }
  }
  return null;
}

function findInlineLabelBeforeValue(value) {
  let text = '';
  for (let node = value.previousSibling; node; node = node.previousSibling) {
    if (node.nodeType === 1 && node.classList?.contains('sb-val')) {
      break;
    }
    text = `${node.textContent || ''}${text}`;
    if (/[:：\n\r]/.test(node.textContent || '') || text.length > 60) {
      break;
    }
  }
  const match = text.match(/([^:：\n\r]{1,40})[:：]?\s*$/);
  return templateLabelText(match?.[1] || '');
}

function templateLabelText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/^[\s　:：;；,，.。]+|[\s　:：;；,，.。]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

</script>

<template>
  <div
    v-if="statusBarVisible"
    :class="wrapperClasses"
    :style="wrapperStyle"
    :data-status-bar-scope="templateScopeId"
    class="status-bar-root"
    :aria-expanded="String(!effectiveCollapsed)"
  >
    <button
      v-if="effectiveCollapsed"
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
      <div v-if="!embedded" class="flai-statusbar-header">
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

      <div
        v-if="hasCustomTemplate"
        ref="customTemplateRef"
        class="status-bar-custom"
        @click="onCustomTemplateClick"
        v-html="customTemplateHtml"
      ></div>
      <template v-else>
        <div v-if="hasContent && !hasImmersiveContent" class="status-bar-variables">
          <div
            v-for="(variable, index) in displayVariables"
            :key="index"
            class="status-bar-variable"
            :class="[`is-${variable.kind}`, { 'is-wide': isWideVariable(variable) }]"
          >
            <div class="variable-header">
              <span class="variable-name" :title="variable.name">{{ variable.name }}</span>
              <span v-if="variable.kind === 'meter' || variable.kind === 'number'" class="variable-value">{{ variable.displayValue }}</span>
            </div>
            <div
              v-if="variable.isMeter"
              class="variable-bar-track"
              role="progressbar"
              :aria-label="variable.name"
              :aria-valuemin="variable.min"
              :aria-valuemax="variable.max"
              :aria-valuenow="variable.value"
            >
              <div class="variable-bar-fill" :style="barStyle(variable)"></div>
            </div>
            <div v-else-if="variable.kind === 'list'" class="variable-chips">
              <span v-for="(item, itemIndex) in variable.items" :key="itemIndex" class="variable-chip">{{ item }}</span>
              <span v-if="!variable.items.length" class="variable-text">—</span>
            </div>
            <p v-else-if="variable.kind === 'text'" class="variable-text">{{ variable.displayValue }}</p>
          </div>
        </div>

        <div v-if="hasImmersiveContent" class="sb-characters-section">
          <div
            v-for="entry in displayCharacters"
            :key="entry.key"
            class="sb-char-card"
            :class="statusClass(entry.character.status)"
            :style="charStyle(entry.character)"
          >
            <div class="sb-char-header">
              <span class="sb-char-name">{{ entry.character.name }}</span>
              <span v-if="entry.character.role" class="sb-char-role">{{ entry.character.role }}</span>
              <span class="sb-char-status" :class="statusClass(entry.character.status)">{{ statusLabel(entry.character.status) }}</span>
            </div>
            <p v-if="entry.character.note" class="sb-char-note">{{ entry.character.note }}</p>
            <div v-if="entry.variables.length" class="sb-char-variables">
              <div
                v-for="(v, vi) in entry.variables"
                :key="vi"
                class="sb-char-variable"
                :class="`is-${v.kind}`"
              >
                <div class="variable-header">
                  <span class="variable-name" :title="v.name">{{ v.name }}</span>
                  <span v-if="v.kind === 'meter' || v.kind === 'number'" class="variable-value">{{ v.displayValue }}</span>
                </div>
                <div v-if="v.isMeter" class="variable-bar-track">
                  <div class="variable-bar-fill" :style="barStyle(v)"></div>
                </div>
                <p v-else-if="v.kind !== 'number'" class="variable-text">{{ v.displayValue }}</p>
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
    </template>
  </div>
</template>

<style scoped>
/* -- Scoped CSS variable bridge -- */
.status-bar-root {
  --sb-accent: var(--primary, #8f3f2f);
  --sb-surface: var(--surface, #fffaf2);
  --sb-text: var(--text, #241f1b);
  --sb-muted: var(--muted, #75685e);
  --sb-line: var(--line, rgba(62, 48, 38, 0.14));
}

/* -- Base Card -- */
.status-bar-container {
  position: relative;
  display: grid;
  gap: 12px;
  min-width: 0;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--sb-accent) 18%, var(--sb-line));
  border-radius: 16px;
  padding: 14px 16px;
  color: var(--sb-text);
  background:
    radial-gradient(circle at 100% 0%, color-mix(in srgb, var(--sb-accent) 9%, transparent), transparent 40%),
    linear-gradient(145deg,
      color-mix(in srgb, var(--sb-surface) 96%, transparent),
      color-mix(in srgb, var(--sb-surface) 80%, var(--bg, #f5efe6)));
  box-shadow:
    0 10px 28px color-mix(in srgb, var(--sb-text) 7%, transparent),
    inset 0 1px 0 color-mix(in srgb, #ffffff 48%, transparent);
  backdrop-filter: blur(14px);
  transition: box-shadow 0.2s ease, border-color 0.2s ease;
}

.status-bar-container::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: linear-gradient(180deg,
    var(--sb-accent),
    color-mix(in srgb, var(--sb-accent) 24%, transparent));
  opacity: 0.82;
  pointer-events: none;
}

.status-bar-container.sb-custom-mode:not(.sb-collapsed) {
  min-width: 0;
  border: 0;
  padding: 0;
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
}

.status-bar-container.sb-custom-mode:not(.sb-collapsed)::before {
  display: none;
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
  color: var(--sb-accent);
}

.flai-statusbar-action {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin-left: auto;
  color: var(--sb-accent);
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
  color: var(--sb-accent);
  background: color-mix(in srgb, var(--sb-accent) 12%, transparent);
  font-size: 0.68rem;
  font-weight: 800;
  line-height: 1.6;
}

.flai-statusbar-title {
  min-width: 0;
  overflow: hidden;
  color: var(--sb-text);
  font-size: 0.82rem;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flai-statusbar-meta {
  flex: 0 0 auto;
  color: var(--sb-muted);
  font-size: 0.72rem;
  font-weight: 700;
  white-space: nowrap;
}

.flai-statusbar-meta::before {
  content: '·';
  margin-right: 8px;
  color: color-mix(in srgb, var(--sb-muted) 58%, transparent);
}

.flai-statusbar-update-badge {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 24px;
  padding: 0 9px;
  border: 1px solid color-mix(in srgb, var(--sb-muted) 22%, transparent);
  border-radius: 999px;
  color: color-mix(in srgb, var(--sb-muted) 92%, var(--sb-text));
  background: color-mix(in srgb, var(--sb-muted) 7%, transparent);
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
  border: 1px solid color-mix(in srgb, var(--sb-line) 82%, transparent);
  border-radius: 999px;
  color: var(--sb-accent);
  background: color-mix(in srgb, var(--sb-surface) 88%, transparent);
  box-shadow: 0 4px 12px rgba(67, 45, 30, 0.08);
  font-family: inherit;
  font-size: 0.72rem;
  font-weight: 800;
  cursor: pointer;
  transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease;
}

.flai-statusbar-toggle:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--sb-accent) 42%, var(--sb-line));
  background: color-mix(in srgb, var(--sb-accent) 10%, var(--sb-surface));
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

.status-bar-custom {
  min-width: 0;
  max-width: 100%;
  overflow-x: hidden;
  color: var(--sb-text);
  line-height: 1.55;
  white-space: normal;
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

:root[data-theme="dark"] .status-bar-container {
  background:
    linear-gradient(135deg,
      color-mix(in srgb, var(--sb-surface) 88%, transparent),
      color-mix(in srgb, var(--sb-surface) 72%, transparent));
  box-shadow:
    0 2px 16px rgba(0, 0, 0, 0.18),
    inset 0 1px 0 color-mix(in srgb, #ffffff 6%, transparent);
}

/* -- Variables -- */
.status-bar-variables {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 168px), 1fr));
  gap: 9px;
}

.status-bar-variable {
  display: grid;
  align-content: start;
  gap: 7px;
  min-width: 0;
  padding: 10px 11px;
  border: 1px solid color-mix(in srgb, var(--sb-line) 68%, transparent);
  border-radius: 11px;
  background: color-mix(in srgb, var(--sb-surface) 72%, transparent);
  box-shadow: inset 0 1px 0 color-mix(in srgb, #fff 28%, transparent);
}

.status-bar-variable.is-wide {
  grid-column: 1 / -1;
}

.variable-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.variable-name {
  min-width: 0;
  overflow: hidden;
  font-size: 0.76rem;
  font-weight: 750;
  color: var(--sb-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.variable-value {
  flex: 0 0 auto;
  max-width: 70%;
  overflow: hidden;
  font-size: 0.8rem;
  font-weight: 800;
  color: var(--sb-text);
  font-variant-numeric: tabular-nums;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-bar-variable.is-number .variable-value {
  font-size: 0.98rem;
}

.variable-text {
  margin: 0;
  color: var(--sb-text);
  font-size: 0.82rem;
  font-weight: 650;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.variable-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  min-width: 0;
}

.variable-chip {
  max-width: 100%;
  overflow: hidden;
  padding: 2px 8px;
  border: 1px solid color-mix(in srgb, var(--sb-accent) 22%, transparent);
  border-radius: 999px;
  color: color-mix(in srgb, var(--sb-accent) 78%, var(--sb-text));
  background: color-mix(in srgb, var(--sb-accent) 8%, transparent);
  font-size: 0.74rem;
  font-weight: 700;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.variable-bar-track {
  height: 6px;
  background: color-mix(in srgb, var(--sb-line) 50%, transparent);
  border-radius: 999px;
  overflow: hidden;
}

.variable-bar-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
}

/* -- Layout: list (one row per variable) -- */
.sb-layout-list .status-bar-variables {
  grid-template-columns: minmax(0, 1fr);
  gap: 0;
}

.sb-layout-list .status-bar-variable {
  grid-template-columns: minmax(72px, 28%) minmax(0, 1fr);
  align-items: center;
  column-gap: 12px;
  padding: 8px 2px;
  border: 0;
  border-bottom: 1px dashed color-mix(in srgb, var(--sb-line) 80%, transparent);
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.sb-layout-list .status-bar-variable:last-child {
  border-bottom: 0;
}

.sb-layout-list .status-bar-variable.is-wide {
  grid-column: auto;
}

.sb-layout-list .variable-header {
  display: contents;
}

.sb-layout-list .variable-value {
  justify-self: end;
  max-width: 100%;
}

.sb-layout-list .variable-bar-track {
  grid-column: 2;
}

/* ---------------------------------------
   VARIANT -- compact
   --------------------------------------- */
.sb-compact {
  padding: 10px 12px;
  border-radius: 10px;
}

.sb-compact .status-bar-variables {
  gap: 7px;
}

.sb-compact .status-bar-variable {
  padding: 8px 9px;
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
  border: 1px solid color-mix(in srgb, var(--sb-line) 40%, transparent);
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
}

.sb-minimal .status-bar-variable {
  padding: 4px 2px;
  border: 0;
  background: transparent;
  box-shadow: none;
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
      color-mix(in srgb, var(--sb-surface) 60%, transparent),
      color-mix(in srgb, var(--sb-accent) 6%, transparent));
  box-shadow:
    0 0 18px color-mix(in srgb, var(--sb-accent) 10%, transparent),
    0 2px 12px rgba(0, 0, 0, 0.06);
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
   VARIANT -- glass
   --------------------------------------- */
.sb-glass {
  border-color: color-mix(in srgb, #ffffff 42%, var(--sb-line));
  background:
    linear-gradient(135deg,
      color-mix(in srgb, var(--sb-surface) 58%, transparent),
      color-mix(in srgb, var(--sb-surface) 32%, transparent));
  box-shadow:
    0 12px 32px color-mix(in srgb, var(--sb-text) 10%, transparent),
    inset 0 1px 0 color-mix(in srgb, #ffffff 60%, transparent);
  backdrop-filter: blur(22px) saturate(1.3);
}

.sb-glass .status-bar-variable {
  border-color: color-mix(in srgb, #ffffff 36%, transparent);
  background: color-mix(in srgb, var(--sb-surface) 40%, transparent);
}

/* ---------------------------------------
   VARIANT -- parchment
   --------------------------------------- */
.sb-parchment {
  --sb-accent: #8a5a2b;
  --sb-surface: #fbf3e2;
  --sb-text: #3b2a1a;
  --sb-muted: #7a6147;
  --sb-line: rgba(122, 84, 44, 0.26);
  border-color: rgba(122, 84, 44, 0.32);
  background:
    radial-gradient(circle at 12% 18%, rgba(255, 255, 255, 0.55), transparent 42%),
    linear-gradient(160deg, #fbf1dc, #f2e1bd);
  box-shadow: 0 8px 24px rgba(92, 62, 30, 0.14), inset 0 0 28px rgba(146, 101, 50, 0.12);
  font-family: "Noto Serif SC", "Songti SC", "SimSun", serif;
}

.sb-parchment .status-bar-variable {
  border-color: rgba(122, 84, 44, 0.2);
  background: rgba(255, 250, 238, 0.62);
  box-shadow: none;
}

/* ---------------------------------------
   VARIANT -- terminal
   --------------------------------------- */
.sb-terminal {
  --sb-accent: #3ddc84;
  --sb-surface: #0f1512;
  --sb-text: #c8f7d8;
  --sb-muted: #7fbf95;
  --sb-line: rgba(61, 220, 132, 0.22);
  border-color: rgba(61, 220, 132, 0.3);
  background: linear-gradient(180deg, #0d1310, #111a15);
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.3), inset 0 0 0 1px rgba(61, 220, 132, 0.06);
  font-family: ui-monospace, "Cascadia Code", "Fira Code", Consolas, monospace;
}

.sb-terminal .status-bar-variable {
  border-color: rgba(61, 220, 132, 0.16);
  border-radius: 6px;
  background: rgba(61, 220, 132, 0.04);
  box-shadow: none;
}

.sb-terminal .variable-bar-track {
  border-radius: 2px;
  background: rgba(61, 220, 132, 0.12);
}

.sb-terminal .variable-bar-fill {
  border-radius: 2px;
  box-shadow: 0 0 8px rgba(61, 220, 132, 0.4);
}

.sb-terminal .variable-chip {
  border-radius: 4px;
}

/* ---------------------------------------
   DENSITY -- cozy
   --------------------------------------- */
.sb-density-cozy {
  padding: 18px 20px;
}

.sb-density-cozy .status-bar-variables {
  gap: 14px;
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

.sb-fx-striped.sb-fx-pulse .variable-bar-fill {
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

.sb-immersive::before {
  display: none;
}

.sb-characters-section {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
  gap: 8px;
}

.sb-char-card {
  --sb-ch-accent: var(--sb-accent);
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--sb-ch-accent) 18%, var(--sb-line));
  border-radius: 12px;
  background:
    linear-gradient(135deg,
      color-mix(in srgb, var(--sb-surface) 88%, transparent),
      color-mix(in srgb, var(--sb-ch-accent) 4%, transparent));
}

.sb-char-header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
  margin-bottom: 4px;
}

.sb-char-name {
  min-width: 0;
  font-size: 0.88rem;
  font-weight: 800;
  color: var(--sb-text);
  overflow-wrap: anywhere;
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
  color: var(--sb-muted);
  background: color-mix(in srgb, var(--sb-muted) 12%, transparent);
}

.sb-char-status-left {
  color: #a86400;
  background: color-mix(in srgb, #ffc76a 24%, transparent);
}

.sb-char-status-hidden {
  color: var(--sb-muted);
  background: color-mix(in srgb, var(--sb-muted) 8%, transparent);
  opacity: 0.7;
}

.sb-char-card.sb-char-status-hidden {
  opacity: 0.55;
  border-style: dashed;
  border-color: color-mix(in srgb, var(--sb-line) 60%, transparent);
  background: color-mix(in srgb, var(--sb-surface) 40%, transparent);
}

.sb-char-card.sb-char-status-hidden .sb-char-name {
  color: var(--sb-muted);
}

.sb-char-note {
  margin: 4px 0 6px;
  font-size: 0.78rem;
  color: var(--sb-muted);
  line-height: 1.45;
}

.sb-char-variables {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 120px), 1fr));
  gap: 8px 10px;
  margin-top: 6px;
}

.sb-char-variable {
  display: grid;
  gap: 5px;
  min-width: 0;
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
  border: 1px solid color-mix(in srgb, var(--sb-line) 80%, transparent);
  border-radius: 14px;
  background:
    linear-gradient(135deg,
      color-mix(in srgb, var(--sb-surface) 86%, transparent),
      color-mix(in srgb, var(--sb-accent) 6%, transparent));
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
}

.sb-quick-reply-btn {
  min-height: 32px;
  max-width: 100%;
  padding: 0 12px;
  border: 1px solid color-mix(in srgb, var(--sb-accent) 30%, var(--sb-line));
  border-radius: 8px;
  color: var(--sb-accent);
  background: color-mix(in srgb, var(--sb-accent) 8%, var(--sb-surface));
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
  overflow-wrap: anywhere;
  transition: background 0.15s, border-color 0.15s;
}

.sb-quick-reply-btn:hover {
  background: color-mix(in srgb, var(--sb-accent) 16%, var(--sb-surface));
  border-color: color-mix(in srgb, var(--sb-accent) 50%, var(--sb-line));
}

@media (max-width: 768px) {
  .status-bar-container {
    padding: 10px 12px;
    border-radius: 12px;
  }

  .flai-statusbar-toggle {
    min-width: 62px;
    min-height: 28px;
    padding: 0 9px;
    font-size: 0.68rem;
  }

  .status-bar-variables {
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 140px), 1fr));
    gap: 8px;
  }

  .sb-characters-section {
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 180px), 1fr));
    gap: 6px;
  }

  .sb-char-card {
    padding: 8px 10px;
  }

  .sb-quick-reply-btn {
    min-height: 30px;
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
  }

  .status-bar-variables {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
  }

  .status-bar-variable {
    padding: 8px 9px;
  }

  .sb-layout-list .status-bar-variables {
    grid-template-columns: minmax(0, 1fr);
  }

  .sb-characters-section {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sb-fx-glow,
  .sb-fx-striped .variable-bar-fill,
  .sb-fx-pulse .variable-bar-fill,
  .flai-statusbar-update-badge.is-updating .flai-statusbar-update-dot {
    animation: none;
  }

  .sb-quick-reply-btn,
  .variable-bar-fill {
    transition: none;
  }
}
</style>
