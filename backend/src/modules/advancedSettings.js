export function createDefaultAdvancedSettings() {
  return {
    desktopBackgroundUrl: '',
    mobileBackgroundUrl: '',
    customCss: '',
    customJs: '',
    statusBarPrompt: '',
    accessorySkills: createDefaultAccessorySkills()
  };
}

export function normalizeAdvancedSettings(input = {}) {
  return {
    desktopBackgroundUrl: normalizeImageUrl(input.desktopBackgroundUrl ?? input.desktop_background_url ?? ''),
    mobileBackgroundUrl: normalizeImageUrl(input.mobileBackgroundUrl ?? input.mobile_background_url ?? ''),
    customCss: normalizeText(input.customCss ?? input.custom_css ?? ''),
    customJs: normalizeText(input.customJs ?? input.custom_js ?? ''),
    statusBarPrompt: normalizeText(input.statusBarPrompt ?? input.status_bar_prompt ?? input.status_bar_prompt_text ?? ''),
    accessorySkills: normalizeAccessorySkills(input.accessorySkills ?? input.accessory_skills ?? {})
  };
}

export function mergeAdvancedSettings(author = {}, user = {}) {
  const authorSettings = normalizeAdvancedSettings(author);
  const userSettings = normalizeAdvancedSettings(user);
  return {
    desktopBackgroundUrl: userSettings.desktopBackgroundUrl || authorSettings.desktopBackgroundUrl,
    mobileBackgroundUrl: userSettings.mobileBackgroundUrl || authorSettings.mobileBackgroundUrl,
    customCss: [authorSettings.customCss, userSettings.customCss].filter(Boolean).join('\n\n'),
    customJs: [authorSettings.customJs, userSettings.customJs].filter(Boolean).join('\n\n'),
    statusBarPrompt: [authorSettings.statusBarPrompt, userSettings.statusBarPrompt].filter(Boolean).join('\n\n'),
    accessorySkills: mergeAccessorySkills(
      authorSettings.accessorySkills,
      user.accessorySkills ?? user.accessory_skills ?? {}
    )
  };
}

export function splitAdvancedSettings(settings = {}) {
  const normalized = normalizeAdvancedSettings(settings);
  return {
    appearance: {
      desktopBackgroundUrl: normalized.desktopBackgroundUrl,
      mobileBackgroundUrl: normalized.mobileBackgroundUrl,
      customCss: normalized.customCss,
      customJs: normalized.customJs
    },
    statusBarPrompt: normalized.statusBarPrompt,
    accessorySkills: normalized.accessorySkills
  };
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
  return Object.fromEntries(
    Object.entries(createDefaultAccessorySkills()).map(([key, defaultValue]) => [
      key,
      normalizeSkillConfig(source[key], fallback[key] || defaultValue)
    ])
  );
}

export function mergeAccessorySkills(author = {}, user = {}) {
  return normalizeAccessorySkills(user, normalizeAccessorySkills(author));
}

export function isAccessorySkillActive(skills = {}, key, context = {}) {
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
    return Boolean(context.statusBar?.variables?.length);
  }
  return false;
}

function normalizeText(value) {
  const text = String(value || '');
  return text.trim() ? text : '';
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
