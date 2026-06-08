import { parseStatusTemplateToken } from '../../../shared/statusTemplateTokens.js';

const STATUS_BLUEPRINT_VARIABLE_LIMIT = 60;

export function normalizeAdvancedSettings(input = {}) {
  const source = normalizeObject(input);
  return {
    desktopBackgroundUrl: normalizeImageUrl(source.desktopBackgroundUrl ?? source.desktop_background_url ?? ''),
    mobileBackgroundUrl: normalizeImageUrl(source.mobileBackgroundUrl ?? source.mobile_background_url ?? ''),
    customCss: normalizeText(source.customCss ?? source.custom_css ?? ''),
    customJs: normalizeText(source.customJs ?? source.custom_js ?? ''),
    statusBarPrompt: normalizeText(source.statusBarPrompt ?? source.status_bar_prompt ?? source.status_bar_prompt_text ?? ''),
    statusBarBlueprint: normalizeStatusBarBlueprint(source.statusBarBlueprint ?? source.status_bar_blueprint ?? {}),
    accessorySkills: normalizeAccessorySkills(source.accessorySkills ?? source.accessory_skills ?? {})
  };
}

export function mergeAdvancedSettings(author = {}, user = {}) {
  const userSource = normalizeObject(user);
  const authorSettings = normalizeAdvancedSettings(author);
  const userSettings = normalizeAdvancedSettings(user);
  return {
    desktopBackgroundUrl: userSettings.desktopBackgroundUrl || authorSettings.desktopBackgroundUrl,
    mobileBackgroundUrl: userSettings.mobileBackgroundUrl || authorSettings.mobileBackgroundUrl,
    customCss: [authorSettings.customCss, userSettings.customCss].filter(Boolean).join('\n\n'),
    customJs: [authorSettings.customJs, userSettings.customJs].filter(Boolean).join('\n\n'),
    statusBarPrompt: [authorSettings.statusBarPrompt, userSettings.statusBarPrompt].filter(Boolean).join('\n\n'),
    statusBarBlueprint: hasStatusBarBlueprint(userSettings.statusBarBlueprint)
      ? userSettings.statusBarBlueprint
      : authorSettings.statusBarBlueprint,
    accessorySkills: mergeAccessorySkills(
      authorSettings.accessorySkills,
      userSource.accessorySkills ?? userSource.accessory_skills ?? {}
    )
  };
}

export function normalizeStatusBarBlueprint(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const template = normalizeText(source.template).slice(0, 50000);
  return {
    name: normalizeText(source.name).slice(0, 50),
    variables: normalizeStatusVariables(source.variables, template),
    template
  };
}

export function hasStatusBarBlueprint(input = {}) {
  const blueprint = normalizeStatusBarBlueprint(input);
  return Boolean(
    blueprint.name ||
      blueprint.template ||
      blueprint.variables.length
  );
}

export function createDefaultAccessorySkills() {
  return {
    npcAgent: createSkillConfig(false),
    statusBarAgent: createSkillConfig('auto'),
    economyAgent: createSkillConfig(false),
    talentPrompt: createSkillConfig(false),
    cgScene: createSkillConfig(false)
  };
}

export function normalizeAccessorySkills(input = {}, fallback = createDefaultAccessorySkills()) {
  const source = input && typeof input === 'object' ? input : {};
  const defaults = createDefaultAccessorySkills();
  const normalized = {};
  for (const key of Object.keys(defaults)) {
    normalized[key] = normalizeSkillConfig(source[key], fallback[key] || defaults[key]);
  }
  return normalized;
}

export function mergeAccessorySkills(author = {}, user = {}) {
  return normalizeAccessorySkills(user, normalizeAccessorySkills(author));
}

export function isAccessorySkillActive(skills = {}, key, context = {}) {
  context = normalizeObject(context);
  const normalized = normalizeAccessorySkills(skills);
  const skill = normalized[key];
  if (!skill) {
    return false;
  }
  if (skill.enabled === true) {
    return true;
  }
  if (skill.enabled !== 'auto') {
    return false;
  }
  if (key === 'statusBarAgent') {
    return Boolean(
      context.statusBar?.variables?.length ||
        normalizeText(context.statusBarPrompt).trim() ||
        hasStatusBarBlueprint(context.statusBarBlueprint)
    );
  }
  return false;
}

function normalizeText(value) {
  const text = String(value || '');
  return text.trim() ? text : '';
}

function normalizeStatusVariables(value, template = '') {
  const sourceVariables = Array.isArray(value) ? value : [];
  const normalized = sourceVariables
    .map((item) => {
      const hasMax = hasExplicitStatusMax(item);
      const variableValue = normalizeStatusVariableValue(item?.value, { emptyText: !hasMax });
      const max = hasMax
        ? Number(item.max)
        : typeof variableValue === 'number'
          ? 100
          : undefined;
      return {
        name: normalizeText(item?.name).slice(0, 40),
        value: variableValue,
        ...(max !== undefined ? { max } : {}),
        color: normalizeColor(item?.color)
      };
    })
    .filter((item) => item.name)
    .slice(0, STATUS_BLUEPRINT_VARIABLE_LIMIT);
  return inferStatusVariablesFromTemplate(template, normalized).slice(0, STATUS_BLUEPRINT_VARIABLE_LIMIT);
}

function normalizeStatusVariableValue(value, options = {}) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const text = String(value ?? '').trim();
  if (!text) {
    return options.emptyText ? '' : 0;
  }
  const numeric = Number(text);
  if (Number.isFinite(numeric) && /^[-+]?(?:\d+|\d*\.\d+)$/.test(text)) {
    return numeric;
  }
  return text.length > 200 ? text.slice(0, 200) : text;
}

function normalizeColor(value) {
  const color = String(value || '').trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? color : '';
}

function inferStatusVariablesFromTemplate(template, variables = []) {
  const inferred = dedupeStatusVariables(variables);
  const seen = new Set(inferred.map((item) => normalizeStatusVariableKey(item.name)));
  const raw = String(template || '');
  if (!raw) {
    return inferred;
  }

  for (const item of extractTemplateRowVariables(raw)) {
    const key = normalizeStatusVariableKey(item.name);
    if (!seen.has(key)) {
      inferred.push(item);
      seen.add(key);
    }
  }

  const placeholderPattern = /\{\{\s*([^{}]+?)\s*\}\}|\{([\w\u4e00-\u9fa5 ._-]+)\}/g;
  let match;
  while ((match = placeholderPattern.exec(raw))) {
    const token = String(match[1] || match[2] || '').trim();
    const { rawName, rawProperty } = parseStatusTemplateToken(token);
    const name = normalizeTemplateVariableName(rawName);
    const key = normalizeStatusVariableKey(name);
    if (!name || seen.has(key)) {
      continue;
    }
    inferred.push(isMeterTemplateProperty(rawProperty)
      ? { name: name.slice(0, 40), value: 0, max: 100, color: '' }
      : { name: name.slice(0, 40), value: '', color: '' });
    seen.add(key);
    if (inferred.length >= STATUS_BLUEPRINT_VARIABLE_LIMIT) {
      break;
    }
  }

  return inferred;
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
    if (hasTemplatePlaceholder(rawValue)) {
      return;
    }
    const value = normalizeStatusVariableValue(normalizeHtmlText(rawValue), { emptyText: true });
    rows.push({ name, value, color: '' });
    seen.add(key);
  };

  const pairPattern = /<[^>]+\bclass\s*=\s*(['"])[^'"]*\bsb-label\b[^'"]*\1[^>]*>([\s\S]*?)<\/[^>]+>[\s\S]{0,180}?<[^>]+\bclass\s*=\s*(['"])[^'"]*\bsb-val\b[^'"]*\3[^>]*>([\s\S]*?)<\/[^>]+>/gi;
  let match;
  while ((match = pairPattern.exec(template))) {
    addRow(match[2], match[4]);
  }

  const inlineValuePattern = /(?:^|>|\n)([^<>\n]{1,40}?)[\s:\uFF1A]+<[^>]+\bclass\s*=\s*(['"])[^'"]*\bsb-val\b[^'"]*\2[^>]*>([\s\S]*?)<\/[^>]+>/gi;
  while ((match = inlineValuePattern.exec(template))) {
    addRow(match[1], match[3]);
  }
  return rows;
}

function hasTemplatePlaceholder(value) {
  return /\{\{\s*[^{}]+?\s*\}\}|\{[\w\u4e00-\u9fa5 ._-]+\}/.test(String(value || ''));
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

function dedupeStatusVariables(variables = []) {
  const byKey = new Map();
  for (const item of Array.isArray(variables) ? variables : []) {
    const key = normalizeStatusVariableKey(item?.name);
    if (!key) {
      continue;
    }
    if (!byKey.has(key)) {
      byKey.set(key, item);
    }
  }
  return [...byKey.values()];
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

function hasExplicitStatusMax(item = {}) {
  return String(item?.max ?? '').trim() !== '' && Number.isFinite(Number(item?.max));
}

function isMeterTemplateProperty(property = '') {
  return ['max', 'percent', 'percentage', 'color', 'display', 'displayValue'].includes(String(property || '').trim());
}

function createSkillConfig(enabled) {
  return {
    enabled,
    modelOverride: ''
  };
}

function normalizeSkillConfig(value, fallback = createSkillConfig(false)) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    enabled: normalizeEnabled(input.enabled, fallback.enabled),
    modelOverride: normalizeModelOverride(input.modelOverride ?? input.model_override ?? fallback.modelOverride)
  };
}

function normalizeObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function normalizeEnabled(value, fallback) {
  if (value === 'auto') {
    return 'auto';
  }
  if (value === true || value === 'true' || value === 'on') {
    return true;
  }
  if (value === false || value === 'false' || value === 'off') {
    return false;
  }
  return fallback;
}

function normalizeModelOverride(value) {
  return String(value || '').trim().slice(0, 100);
}

function normalizeImageUrl(value) {
  const input = String(value || '').trim();
  if (!input) {
    return '';
  }

  const unwrapped = input.replace(/^url\((.*)\)$/i, '$1').trim().replace(/^['"]|['"]$/g, '');
  if (
    /^https?:\/\//i.test(unwrapped)
    || unwrapped.startsWith('/')
    || /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(unwrapped)
  ) {
    return unwrapped;
  }

  return '';
}
