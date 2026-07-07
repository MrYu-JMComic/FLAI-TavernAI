import {
  createDefaultStatusBarBlueprint,
  normalizeStatusBarBlueprintForPayload
} from './useCharacterStatusBlueprint';

export function emptyCharacter() {
  return {
    name: '',
    avatarUrl: '',
    gender: '',
    age: '',
    background: '',
    worldview: '',
    persona: '',
    openingMessage: '',
    visibility: 'private',
    tagsText: '',
    selectedTags: [],
    worldBookId: '',
    renderPlugins: [defaultRenderPlugin()],
    authorAdvancedSettings: {
      desktopBackgroundUrl: '',
      mobileBackgroundUrl: '',
      customCss: '',
      customCssEnabled: false,
      customCssRiskAccepted: false,
      customJs: '',
      customJsEnabled: false,
      customJsRiskAccepted: false,
      statusBarPrompt: '',
      statusBarBlueprint: createDefaultStatusBarBlueprint(),
      accessorySkills: createDefaultAccessorySkills()
    },
    regexRules: [],
    canEdit: true,
    canUse: true,
    isOwner: true
  };
}

export function defaultRenderPlugin() {
  return {
    label: '档案标题折叠',
    type: 'fold',
    pattern: '^[>▸▾▶▼◆◇✦✧★☆*+\\-\\s]*[【\\[]([^】\\]\\n]*(?:档案|情报|状态栏|记忆栏|设定|剧情|世界观|摘要|面板|资料)[^】\\]\\n]*)[】\\]][◆◇✦✧★☆*+\\-\\s]*$',
    flags: 'u',
    titleTemplate: '$1',
    enabled: true
  };
}

export function createDefaultAccessorySkills() {
  return {
    npcAgent: { enabled: false, modelOverride: '' },
    statusBarAgent: { enabled: 'auto', modelOverride: '' },
    economyAgent: { enabled: false, modelOverride: '' },
    talentPrompt: { enabled: false, modelOverride: '' },
    cgScene: { enabled: false, modelOverride: '' }
  };
}

export function normalizeAccessorySkillsForPayload(input = {}) {
  const defaults = createDefaultAccessorySkills();
  const normalized = {};
  for (const key in defaults) {
    if (!Object.prototype.hasOwnProperty.call(defaults, key)) continue;
    const source = input?.[key] || {};
    normalized[key] = {
      enabled: normalizeSkillEnabled(source.enabled, defaults[key].enabled),
      modelOverride: String(source.modelOverride || source.model_override || '').trim()
    };
  }
  return normalized;
}

export function normalizeAdvancedSettingsForForm(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    ...emptyCharacter().authorAdvancedSettings,
    ...source,
    customCssEnabled: normalizeBoolean(source.customCssEnabled ?? source.custom_css_enabled, false),
    customCssRiskAccepted: normalizeBoolean(source.customCssRiskAccepted ?? source.custom_css_risk_accepted, false),
    customJsEnabled: normalizeBoolean(source.customJsEnabled ?? source.custom_js_enabled, false),
    customJsRiskAccepted: normalizeBoolean(source.customJsRiskAccepted ?? source.custom_js_risk_accepted, false),
    statusBarBlueprint: normalizeStatusBarBlueprintForPayload(source.statusBarBlueprint || source.status_bar_blueprint || {}),
    accessorySkills: normalizeAccessorySkillsForPayload(source.accessorySkills)
  };
}

export function hasNonDefaultAccessorySkills(skills = {}) {
  const defaults = createDefaultAccessorySkills();
  for (const key in defaults) {
    if (!Object.prototype.hasOwnProperty.call(defaults, key)) {
      continue;
    }
    const current = skills?.[key] || {};
    const fallback = defaults[key] || {};
    if (
      normalizeSkillEnabled(current.enabled, fallback.enabled) !== fallback.enabled ||
      String(current.modelOverride || current.model_override || '').trim()
    ) {
      return true;
    }
  }
  return false;
}

export function normalizeSkillEnabled(value, fallback = false) {
  if (value === 'auto') return 'auto';
  if (value === true || value === 'true' || value === 'on') return true;
  if (value === false || value === 'false' || value === 'off') return false;
  return fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (value === true || value === 'true' || value === '1' || value === 'on') {
    return true;
  }
  if (value === false || value === 'false' || value === '0' || value === 'off') {
    return false;
  }
  return fallback;
}

export function normalizeForForm(character) {
  return {
    ...emptyCharacter(),
    ...character,
    visibility: character.visibility || 'private',
    worldBookId: character.worldBookId || '',
    canEdit: character.canEdit !== false,
    canUse: character.canUse !== false,
    isOwner: character.isOwner === true,
    tagsText: (character.tags || []).join(', '),
    selectedTags: collectCharacterTagNames(character.characterTags),
    renderPlugins: character.renderPlugins || [],
    authorAdvancedSettings: {
      ...normalizeAdvancedSettingsForForm(character.authorAdvancedSettings || character.advancedSettings || {})
    },
    regexRules: character.regexRules || []
  };
}

export function normalizeCharacterDraftPayload(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    name: String(source.name || ''),
    avatarUrl: String(source.avatarUrl || ''),
    gender: String(source.gender || ''),
    age: String(source.age || ''),
    background: String(source.background || ''),
    worldview: String(source.worldview || ''),
    persona: String(source.persona || ''),
    openingMessage: String(source.openingMessage || ''),
    visibility: source.visibility === 'public' ? 'public' : 'private',
    authorAdvancedSettings: normalizeAdvancedSettingsForForm(source.authorAdvancedSettings || source.advancedSettings || {}),
    renderPlugins: Array.isArray(source.renderPlugins) ? source.renderPlugins : [defaultRenderPlugin()],
    regexRules: Array.isArray(source.regexRules) ? source.regexRules : [],
    worldBookId: String(source.worldBookId || ''),
    tags: normalizeCharacterDraftTags(source.tags)
  };
}

export function normalizeCharacterDraftTags(input) {
  const tags = [];
  for (const item of Array.isArray(input) ? input : []) {
    const name = typeof item === 'string' ? item : item?.name;
    const trimmed = String(name || '').trim();
    if (trimmed) {
      tags.push(trimmed);
    }
  }
  return tags;
}

export function parseTagsTextForPayload(value = '') {
  const tags = [];
  const source = String(value || '');
  let start = 0;
  for (let index = 0; index <= source.length; index += 1) {
    if (index < source.length && source[index] !== ',') {
      continue;
    }
    const tag = source.slice(start, index).trim();
    if (tag) {
      tags.push(tag);
    }
    start = index + 1;
  }
  return tags;
}

export function collectCharacterTagNames(tags = []) {
  const currentTags = Array.isArray(tags) ? tags : [];
  const tagNames = [];
  for (const tag of currentTags) {
    tagNames.push(tag.name);
  }
  return tagNames;
}

export function applyLocalRules(text, rules, phase) {
  const currentRules = Array.isArray(rules) ? rules : [];
  let value = text;
  for (const rule of currentRules) {
    if (!rule.enabled || !rule.pattern || !(rule.scope === phase || rule.scope === 'both')) {
      continue;
    }
    try {
      value = value.replace(new RegExp(rule.pattern, rule.flags || 'g'), rule.replacement || '');
    } catch {
      continue;
    }
  }
  return value;
}
