import { computed, watch } from 'vue';
import { parseStatusTemplateToken } from '../../../../shared/statusTemplateTokens.js';

const STATUS_BLUEPRINT_VARIABLE_LIMIT = 60;
const STATUS_BLUEPRINT_SAMPLE_TEMPLATE = [
  '<section class="sb-sample-card">',
  '  <style>',
  '    .sb-sample-card{display:grid;gap:8px;font-size:13px}',
  '    .sb-sample-card .sb-row{display:grid;grid-template-columns:72px 1fr;gap:8px;align-items:center}',
  '    .sb-sample-card .sb-label{color:#6b7280;font-weight:700}',
  '    .sb-sample-card .sb-val{min-width:0;overflow-wrap:anywhere}',
  '    .sb-sample-card .sb-track{height:8px;overflow:hidden;border-radius:999px;background:#e5e7eb}',
  '    .sb-sample-card .sb-fill{height:100%;width:{{体力.percent}};background:{{体力.color}}}',
  '    .sb-sample-card .sb-actions{display:flex;flex-wrap:wrap;gap:6px}',
  '    .sb-sample-card button{border:1px solid #d1d5db;border-radius:6px;padding:4px 8px;background:#fff;color:#111827}',
  '  </style>',
  '  <div class="sb-row"><span class="sb-label">姓名</span><span class="sb-val">{{姓名}}</span></div>',
  '  <div class="sb-row"><span class="sb-label">所在地</span><span class="sb-val">{{所在地}}</span></div>',
  '  <div class="sb-row"><span class="sb-label">体力</span><span class="sb-val">{{体力}} / {{体力.max}}</span></div>',
  '  <div class="sb-track"><div class="sb-fill"></div></div>',
  '  <div class="sb-actions">',
  '    <button type="button" data-sb-action="quick-reply" data-sb-text="查看状态">查看状态</button>',
  '    <button type="button" data-sb-action="copy" data-sb-copy="{{姓名}}｜{{所在地}}">复制摘要</button>',
  '  </div>',
  '</section>'
].join('\n');

export function useCharacterStatusBlueprint({
  canEdit,
  form,
  notify
} = {}) {
  const statusBarBlueprintPreview = computed(() => {
    const blueprint = normalizeStatusBarBlueprintForPayload(form.authorAdvancedSettings.statusBarBlueprint || {});
    if (!hasStatusBarBlueprintContent(blueprint)) {
      return null;
    }
    return {
      id: 'character-status-blueprint-preview',
      name: blueprint.name || '状态栏',
      variables: blueprint.variables,
      template: blueprint.template
    };
  });

  const statusBarBlueprintPreviewConfig = computed(() => (
    parseStatusBarTemplateConfig(statusBarBlueprintPreview.value?.template || '')
  ));

  const statusBarBlueprintTemplateStats = computed(() => {
    const blueprint = form.authorAdvancedSettings.statusBarBlueprint || {};
    const normalized = normalizeStatusBarBlueprintForPayload(blueprint);
    const template = normalized.template;
    const variableStats = countStatusBlueprintVariableStats(normalized.variables, template);
    return {
      variables: normalized.variables.length,
      inferred: variableStats.inferred,
      text: Math.max(0, normalized.variables.length - variableStats.meter),
      meter: variableStats.meter,
      placeholders: countStatusTemplatePlaceholders(template),
      actions: countStatusTemplateActions(template),
      lines: template ? template.split(/\r\n|\r|\n/).length : 0,
      hasTemplate: Boolean(template)
    };
  });

  const statusBlueprintEditorRows = computed(() => {
    const blueprint = form.authorAdvancedSettings.statusBarBlueprint || {};
    const template = String(blueprint.template || '');
    const variables = Array.isArray(blueprint.variables) ? blueprint.variables : [];
    const compositeRows = extractStatusTemplateCompositeRows(template);
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
        parts: getStatusBlueprintCompositeParts(row.parts)
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
      rows.push({
        kind: 'variable',
        key: `variable:${index}:${key}`,
        variable,
        index,
        isMeter: isStatusBlueprintMeterVariable(variable),
        color: normalizeHexColor(variable?.color)
      });
    }

    return rows;
  });

  watch(
    () => form.authorAdvancedSettings.statusBarBlueprint.template,
    () => {
      syncStatusBlueprintVariablesFromTemplate();
    }
  );

  function ensureStatusBlueprint() {
    if (!form.authorAdvancedSettings.statusBarBlueprint || typeof form.authorAdvancedSettings.statusBarBlueprint !== 'object') {
      form.authorAdvancedSettings.statusBarBlueprint = createDefaultStatusBarBlueprint();
    }
    if (!Array.isArray(form.authorAdvancedSettings.statusBarBlueprint.variables)) {
      form.authorAdvancedSettings.statusBarBlueprint.variables = [];
    }
    return form.authorAdvancedSettings.statusBarBlueprint;
  }

  function syncStatusBlueprintVariablesFromTemplate({ notifyUser = false } = {}) {
    const blueprint = ensureStatusBlueprint();
    if (!blueprint || typeof blueprint !== 'object') {
      return;
    }
    const normalized = normalizeStatusBarBlueprintForPayload(blueprint);
    const changed = !sameStatusVariableList(blueprint.variables, normalized.variables);
    if (changed) {
      blueprint.variables = cloneStatusVariableList(normalized.variables);
    }
    if (notifyUser) {
      notify?.success?.(changed ? '已重新同步模板变量' : '变量已是最新');
    }
  }

  function refreshStatusBlueprintVariables() {
    if (!canEdit?.value) {
      return;
    }
    syncStatusBlueprintVariablesFromTemplate({ notifyUser: true });
  }

  function applyStatusBlueprintSampleTemplate() {
    if (!canEdit?.value) {
      return;
    }
    const blueprint = ensureStatusBlueprint();
    if (!String(blueprint.name || '').trim()) {
      blueprint.name = '状态栏';
    }
    blueprint.template = STATUS_BLUEPRINT_SAMPLE_TEMPLATE;
    syncStatusBlueprintVariablesFromTemplate();
    notify?.success?.('已套用示例模板并同步变量');
  }

  function clearStatusBlueprintTemplate() {
    if (!canEdit?.value) {
      return;
    }
    const blueprint = ensureStatusBlueprint();
    if (!String(blueprint.template || '').trim()) {
      notify?.info?.('模板已经是空的');
      return;
    }
    blueprint.template = '';
    syncStatusBlueprintVariablesFromTemplate();
    notify?.success?.('已清空模板，变量仍保留');
  }

  function isStatusBlueprintMeterVariable(variable = {}) {
    return shouldTreatStatusVariableAsMeter(variable, form.authorAdvancedSettings.statusBarBlueprint.template);
  }

  function getStatusBlueprintVariableValue(name = '') {
    const variable = findStatusBlueprintVariable(name);
    return variable ? String(variable.value ?? '') : '';
  }

  function getStatusBlueprintCompositeParts(parts = []) {
    const normalizedParts = [];
    for (const part of Array.isArray(parts) ? parts : []) {
      const name = String(part?.name || '');
      normalizedParts.push({
        name,
        value: getStatusBlueprintVariableValue(name)
      });
    }
    return normalizedParts;
  }

  function setStatusBlueprintVariableValue(name = '', value = '') {
    if (!canEdit?.value) {
      return;
    }
    const normalizedName = normalizeTemplateVariableName(name);
    if (!normalizedName) {
      return;
    }
    const blueprint = ensureStatusBlueprint();
    let variable = findStatusBlueprintVariable(normalizedName);
    if (!variable) {
      variable = { name: normalizedName, value: '' };
      blueprint.variables.push(variable);
    }
    variable.value = normalizeStatusTextVariableValue(value);
    delete variable.max;
    delete variable.color;
  }

  function findStatusBlueprintVariable(name = '') {
    const key = normalizeStatusVariableKey(name);
    if (!key) {
      return null;
    }
    const blueprint = form.authorAdvancedSettings.statusBarBlueprint || {};
    const variables = Array.isArray(blueprint.variables) ? blueprint.variables : [];
    for (const variable of variables) {
      if (normalizeStatusVariableKey(variable?.name) === key) {
        return variable;
      }
    }
    return null;
  }

  function setStatusBlueprintVariableMode(variable, mode) {
    if (!canEdit?.value || !variable || typeof variable !== 'object') {
      return;
    }
    if (mode === 'meter') {
      variable.value = normalizeStatusMeterVariableValue(variable.value);
      variable.max = normalizeStatusMeterMax(variable.max);
      variable.color = normalizeHexColor(variable.color);
      return;
    }
    variable.value = normalizeStatusTextVariableValue(variable.value) || defaultStatusTextValueForName(variable.name);
    delete variable.max;
    delete variable.color;
  }

  function setStatusBlueprintVariableValueFromEvent(name, event) {
    const value = readEventTargetValue(event);
    if (value === undefined) {
      return;
    }
    setStatusBlueprintVariableValue(name, value);
  }

  function setStatusBlueprintVariableModeFromEvent(variable, event) {
    const value = readEventTargetValue(event);
    if (value === undefined) {
      return;
    }
    setStatusBlueprintVariableMode(variable, value);
  }

  function setColorValueFromEvent(target, key, event) {
    const value = readEventTargetValue(event);
    if (value === undefined) {
      return;
    }
    setColorValue(target, key, value);
  }

  function addStatusBlueprintVariable() {
    if (!canEdit?.value) {
      return;
    }
    const blueprint = ensureStatusBlueprint();
    blueprint.variables.push({
      name: `变量 ${blueprint.variables.length + 1}`,
      value: '待定'
    });
  }

  function removeStatusBlueprintVariable(index) {
    if (!canEdit?.value) {
      return;
    }
    form.authorAdvancedSettings.statusBarBlueprint.variables.splice(index, 1);
  }

  return {
    addStatusBlueprintVariable,
    applyStatusBlueprintSampleTemplate,
    clearStatusBlueprintTemplate,
    refreshStatusBlueprintVariables,
    removeStatusBlueprintVariable,
    setColorValueFromEvent,
    setStatusBlueprintVariableModeFromEvent,
    setStatusBlueprintVariableValueFromEvent,
    statusBarBlueprintPreview,
    statusBarBlueprintPreviewConfig,
    statusBarBlueprintTemplateStats,
    statusBlueprintEditorRows
  };
}

export function createDefaultStatusBarBlueprint() {
  return {
    name: '',
    variables: [],
    template: ''
  };
}

export function normalizeStatusBarBlueprintForPayload(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const template = String(source.template || '').trim();
  const variables = normalizeStatusVariableListForPayload(source.variables, template);
  return {
    name: String(source.name || '').trim(),
    variables: inferStatusVariablesFromTemplate(template, variables),
    template
  };
}

export function hasStatusBarBlueprintContent(blueprint = {}) {
  return Boolean(
    String(blueprint.name || '').trim() ||
      String(blueprint.template || '').trim() ||
      (Array.isArray(blueprint.variables) && blueprint.variables.length)
  );
}

function normalizeStatusVariableListForPayload(variables = [], template = '') {
  const normalizedVariables = [];
  for (const variable of Array.isArray(variables) ? variables : []) {
    const normalized = normalizeStatusVariableForPayload(variable, template);
    if (normalized.name && !isCompositeStatusPlaceholderValue(normalized.value, normalized.name)) {
      normalizedVariables.push(normalized);
    }
  }
  return normalizedVariables;
}

function normalizeStatusVariableForPayload(variable = {}, template = '') {
  const name = String(variable?.name || '').trim();
  if (!name) {
    return { name: '', value: '' };
  }
  if (!shouldTreatStatusVariableAsMeter(variable, template)) {
    return {
      name,
      value: normalizeStatusTextVariableValue(variable?.value)
    };
  }
  return {
    name,
    value: normalizeStatusMeterVariableValue(variable?.value),
    max: normalizeStatusMeterMax(variable?.max),
    color: normalizeHexColor(variable?.color)
  };
}

function shouldTreatStatusVariableAsMeter(variable = {}, template = '') {
  const name = String(variable?.name || '').trim();
  if (!name) {
    return false;
  }
  const usage = getStatusVariableTemplateUsage(template, name);
  if (usage.meter) {
    return true;
  }
  if (usage.text) {
    return false;
  }
  const value = normalizeStatusVariableValue(variable?.value);
  return typeof value === 'number' && Number.isFinite(Number(variable?.max));
}

function getStatusVariableTemplateUsage(template = '', name = '') {
  const target = normalizeStatusVariableKey(name);
  const usage = { meter: false, text: false };
  if (!target) {
    return usage;
  }
  const placeholderPattern = /\{\{\s*([^{}]+?)\s*\}\}|\{([\w\u4e00-\u9fa5 ._-]+)\}/g;
  let match;
  while ((match = placeholderPattern.exec(String(template || '')))) {
    const token = String(match[1] || match[2] || '').trim();
    const parsed = parseStatusTemplateToken(token);
    if (normalizeStatusVariableKey(parsed.rawName) !== target) {
      continue;
    }
    const property = parsed.rawProperty.trim();
    if (isStatusMeterPlaceholderProperty(property)) {
      usage.meter = true;
    } else {
      usage.text = true;
    }
  }
  return usage;
}

function isStatusMeterPlaceholderProperty(property = '') {
  return ['max', 'percent', 'color', 'display'].includes(String(property || '').trim());
}

function countStatusTemplatePlaceholders(template = '') {
  return (String(template || '').match(/\{\{\s*[^{}]+?\s*\}\}|\{[\w\u4e00-\u9fa5 ._-]+\}/g) || []).length;
}

function countStatusTemplateActions(template = '') {
  return (String(template || '').match(/\bdata-sb-action\s*=/gi) || []).length;
}

function collectInferredStatusVariableKeys(template = '') {
  const inferredKeys = new Set();
  for (const variable of inferStatusVariablesFromTemplate(template, [])) {
    inferredKeys.add(normalizeStatusVariableKey(variable.name));
  }
  return inferredKeys;
}

function countStatusBlueprintVariableStats(variables = [], template = '') {
  const inferredKeys = collectInferredStatusVariableKeys(template);
  const stats = { inferred: 0, meter: 0 };
  for (const variable of Array.isArray(variables) ? variables : []) {
    if (inferredKeys.has(normalizeStatusVariableKey(variable?.name))) {
      stats.inferred += 1;
    }
    if (shouldTreatStatusVariableAsMeter(variable, template)) {
      stats.meter += 1;
    }
  }
  return stats;
}

function normalizeStatusTextVariableValue(value) {
  const text = String(value ?? '').trim();
  return text.length > 200 ? text.slice(0, 200) : text;
}

function normalizeStatusMeterVariableValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeStatusMeterMax(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 100;
}

function normalizeStatusVariableValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const text = String(value ?? '').trim();
  if (!text) {
    return 0;
  }
  const numeric = Number(text);
  if (Number.isFinite(numeric) && /^[-+]?(?:\d+|\d*\.\d+)$/.test(text)) {
    return numeric;
  }
  return text.length > 200 ? text.slice(0, 200) : text;
}

function inferStatusVariablesFromTemplate(template, variables = []) {
  const inferred = dedupeStatusVariables(variables, template);
  const seen = collectStatusVariableKeys(inferred);
  for (const item of extractTemplateRowVariables(template)) {
    const key = normalizeStatusVariableKey(item.name);
    if (!seen.has(key)) {
      inferred.push(item);
      seen.add(key);
    }
  }
  const placeholderPattern = /\{\{\s*([^{}]+?)\s*\}\}|\{([\w\u4e00-\u9fa5 ._-]+)\}/g;
  let match;
  while ((match = placeholderPattern.exec(String(template || '')))) {
    const token = String(match[1] || match[2] || '').trim();
    const parsed = parseStatusTemplateToken(token);
    const name = normalizeTemplateVariableName(parsed.rawName);
    const key = normalizeStatusVariableKey(name);
    if (!name || seen.has(key)) {
      continue;
    }
    inferred.push(
      shouldTreatStatusVariableAsMeter({ name }, template)
        ? { name: name.slice(0, 40), value: 0, max: 100, color: '#6c757d' }
        : { name: name.slice(0, 40), value: defaultStatusTextValueForName(name) }
    );
    seen.add(key);
    if (inferred.length >= STATUS_BLUEPRINT_VARIABLE_LIMIT) {
      break;
    }
  }
  return inferred.slice(0, STATUS_BLUEPRINT_VARIABLE_LIMIT);
}

function collectStatusVariableKeys(variables = []) {
  const keys = new Set();
  for (const item of Array.isArray(variables) ? variables : []) {
    keys.add(normalizeStatusVariableKey(item?.name));
  }
  return keys;
}

function extractTemplateRowVariables(template) {
  const rows = [];
  const seen = new Set();
  const addRow = (rawName, rawValue) => {
    const name = normalizeTemplateVariableName(rawName);
    const key = normalizeStatusVariableKey(name);
    if (!name || !key || seen.has(key)) {
      return;
    }
    if (isCompositeStatusPlaceholderValue(rawValue, name)) {
      return;
    }
    const rawValueText = normalizeHtmlText(rawValue);
    const value = isSelfStatusPlaceholder(rawValueText, name)
      ? defaultStatusTextValueForName(name)
      : normalizeStatusTextVariableValue(rawValueText);
    rows.push({ name, value });
    seen.add(key);
  };

  const pairPattern = /<[^>]+\bclass\s*=\s*(['"])[^'"]*\bsb-label\b[^'"]*\1[^>]*>([\s\S]*?)<\/[^>]+>[\s\S]{0,180}?<[^>]+\bclass\s*=\s*(['"])[^'"]*\bsb-val\b[^'"]*\3[^>]*>([\s\S]*?)<\/[^>]+>/gi;
  let match;
  while ((match = pairPattern.exec(String(template || '')))) {
    addRow(match[2], match[4]);
  }

  const inlineValuePattern = /(?:^|>|\n)([^<>\n]{1,40}?)[\s:\uFF1A]+<[^>]+\bclass\s*=\s*(['"])[^'"]*\bsb-val\b[^'"]*\2[^>]*>([\s\S]*?)<\/[^>]+>/gi;
  while ((match = inlineValuePattern.exec(String(template || '')))) {
    addRow(match[1], match[3]);
  }
  return rows;
}

function extractStatusTemplateCompositeRows(template) {
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
    if (!name || !key || key === labelKey || seen.has(key)) {
      continue;
    }
    if (isMeterTemplateProperty(rawProperty)) {
      continue;
    }
    parts.push({ name });
    seen.add(key);
  }
  return parts;
}

function isMeterTemplateProperty(value = '') {
  return ['max', 'percent', 'percentage'].includes(String(value || '').trim());
}

function isCompositeStatusPlaceholderValue(value = '', name = '') {
  return extractCompositePlaceholderParts(value, name).length >= 2;
}

function isSelfStatusPlaceholder(value = '', name = '') {
  const escaped = escapeRegExp(String(name || '').trim());
  return Boolean(escaped && new RegExp(`^\\{\\{\\s*${escaped}\\s*\\}\\}$`).test(String(value || '').trim()));
}

function defaultStatusTextValueForName(name = '') {
  const text = String(name || '');
  if (/事件/.test(text)) return '故事尚未开始';
  if (/记忆|淡忘/.test(text)) return '暂无';
  if (/情绪/.test(text)) return '平静';
  if (/倾向/.test(text)) return '无特殊';
  if (/伤病|排泄|特殊|随身/.test(text)) return '无';
  return '待定';
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function dedupeStatusVariables(variables = [], template = '') {
  const byKey = new Map();
  for (const variable of Array.isArray(variables) ? variables : []) {
    const normalized = normalizeStatusVariableForPayload(variable, template);
    const key = normalizeStatusVariableKey(normalized.name);
    if (!key) {
      continue;
    }
    if (byKey.has(key)) {
      byKey.set(key, mergeStatusVariable(byKey.get(key), normalized, template));
    } else {
      byKey.set(key, normalized);
    }
  }
  return [...byKey.values()];
}

function mergeStatusVariable(current, next, template = '') {
  const useMeter = shouldTreatStatusVariableAsMeter(next, template) || shouldTreatStatusVariableAsMeter(current, template);
  if (useMeter) {
    return {
      name: next.name || current.name,
      value: normalizeStatusMeterVariableValue(next.value ?? current.value),
      max: normalizeStatusMeterMax(next.max ?? current.max),
      color: normalizeHexColor(next.color || current.color)
    };
  }
  return {
    name: next.name || current.name,
    value: normalizeStatusTextVariableValue(next.value || current.value)
  };
}

function normalizeTemplateVariableName(value) {
  return normalizeHtmlText(value)
    .replace(/^[\s\u3000:\uFF1A;\uFF1B,\uFF0C.\u3002]+|[\s\u3000:\uFF1A;\uFF1B,\uFF0C.\u3002]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 40);
}

function normalizeStatusVariableKey(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\s\u3000:\uFF1A;\uFF1B,\uFF0C.\u3002\u3001/\\|()[\]{}"'`~!@#$%^&*_+=?<>-]+/g, '')
    .trim()
    .toLowerCase();
}

function sameStatusVariableList(left = [], right = []) {
  const currentList = Array.isArray(left) ? left : [];
  const nextList = Array.isArray(right) ? right : [];
  if (currentList.length !== nextList.length) {
    return false;
  }
  for (let index = 0; index < currentList.length; index += 1) {
    if (!sameStatusVariableForPayload(currentList[index], nextList[index])) {
      return false;
    }
  }
  return true;
}

function sameStatusVariableForPayload(current, next) {
  const currentVariable = normalizeStatusVariableForPayload(current);
  const nextVariable = normalizeStatusVariableForPayload(next);
  return currentVariable.name === nextVariable.name
    && Object.is(currentVariable.value, nextVariable.value)
    && Object.is(currentVariable.max, nextVariable.max)
    && String(currentVariable.color || '') === String(nextVariable.color || '');
}

function cloneStatusVariableList(variables = []) {
  const clonedVariables = [];
  for (const variable of Array.isArray(variables) ? variables : []) {
    clonedVariables.push({ ...variable });
  }
  return clonedVariables;
}

function normalizeHtmlText(value) {
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

function parseStatusBarTemplateConfig(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed || trimmed[0] !== '{') {
    return {};
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const cfg = {};
    if (['default', 'compact', 'minimal', 'neon'].includes(parsed.variant)) cfg.variant = parsed.variant;
    if (['default', 'cozy', 'compact'].includes(parsed.density)) cfg.density = parsed.density;
    if (['immersive', 'compact'].includes(parsed.displayMode)) cfg.displayMode = parsed.displayMode;
    if (typeof parsed.accentColor === 'string' && parsed.accentColor.trim()) cfg.accentColor = parsed.accentColor.trim();
    if (typeof parsed.customCss === 'string' && parsed.customCss.trim()) cfg.customCss = parsed.customCss.trim();
    if (Array.isArray(parsed.effects)) {
      cfg.effects = collectAllowedStatusEffects(parsed.effects);
    }
    if (Array.isArray(parsed.characters)) {
      cfg.characters = parsed.characters;
    }
    if (Array.isArray(parsed.quickReplies)) {
      cfg.quickReplies = parsed.quickReplies;
    }
    return cfg;
  } catch {
    return {};
  }
}

function collectAllowedStatusEffects(effects = []) {
  const currentEffects = Array.isArray(effects) ? effects : [];
  const allowedEffects = [];
  for (const effect of currentEffects) {
    if (isAllowedStatusEffect(effect)) {
      allowedEffects.push(effect);
    }
  }
  return allowedEffects;
}

function isAllowedStatusEffect(effect) {
  return effect === 'glow' || effect === 'striped' || effect === 'pulse';
}

function normalizeHexColor(value, fallback = '#6c757d') {
  const normalized = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : fallback;
}

function setColorValue(target, key, value) {
  if (!target || typeof target !== 'object') {
    return;
  }
  target[key] = normalizeHexColor(value);
}

function readEventTargetValue(event) {
  const target = event?.target;
  return target && target.value !== undefined ? target.value : undefined;
}
