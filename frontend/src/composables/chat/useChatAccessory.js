import { computed, reactive, ref } from 'vue';
import {
  deleteStatusBar,
  fetchConversationAccessorySkills,
  fetchConversationEconomy,
  fetchStatusBar,
  saveConversationAccessorySkills,
  saveStatusBar
} from '../../api';

const VALID_VARIANTS = ['default', 'compact', 'minimal', 'neon'];
const VALID_DENSITIES = ['default', 'cozy', 'compact'];
const VALID_EFFECTS = ['glow', 'striped', 'pulse'];
const VALID_DISPLAY_MODES = ['immersive', 'compact'];
const VALID_CHAR_STATUSES = ['active', 'dead', 'forgotten', 'left', 'hidden'];
const STATUS_BAR_VARIABLE_LIMIT = 60;

function parseCharacter(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const ch = {};
  if (typeof raw.id === 'string') ch.id = raw.id;
  if (typeof raw.name === 'string' && raw.name.trim()) ch.name = raw.name.trim();
  if (typeof raw.role === 'string' && raw.role.trim()) ch.role = raw.role.trim();
  if (VALID_CHAR_STATUSES.includes(raw.status)) ch.status = raw.status;
  if (typeof raw.note === 'string') ch.note = raw.note;
  if (typeof raw.accentColor === 'string' && raw.accentColor.trim()) ch.accentColor = raw.accentColor.trim();
  if (typeof raw.customCss === 'string' && raw.customCss.trim()) ch.customCss = raw.customCss.trim();
  if (Array.isArray(raw.variables)) {
    ch.variables = raw.variables
      .filter((v) => v && typeof v === 'object')
      .map((v) => ({
        name: String(v.name || ''),
        value: Number(v.value) || 0,
        max: Number(v.max) || 100,
        color: String(v.color || '#6c757d')
      }))
      .filter((v) => v.name);
  }
  return ch;
}

function parseQuickReply(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.label !== 'string' || !raw.label.trim()) return null;
  if (typeof raw.text !== 'string' || !raw.text.trim()) return null;
  return { label: raw.label.trim(), text: raw.text.trim() };
}

function parseTemplateConfig(raw) {
  if (!raw || typeof raw !== 'string' || !raw.trim()) return {};
  const trimmed = raw.trim();
  if (trimmed[0] !== '{') return {};
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const cfg = {};
    if (VALID_VARIANTS.includes(parsed.variant)) cfg.variant = parsed.variant;
    if (VALID_DENSITIES.includes(parsed.density)) cfg.density = parsed.density;
    if (typeof parsed.accentColor === 'string' && parsed.accentColor.trim()) {
      cfg.accentColor = parsed.accentColor.trim();
    }
    if (Array.isArray(parsed.effects)) {
      const valid = parsed.effects.filter((e) => VALID_EFFECTS.includes(e));
      if (valid.length) cfg.effects = valid;
    }
    if (typeof parsed.customCss === 'string' && parsed.customCss.trim()) {
      cfg.customCss = parsed.customCss.trim();
    }
    if (VALID_DISPLAY_MODES.includes(parsed.displayMode)) {
      cfg.displayMode = parsed.displayMode;
    }
    if (Array.isArray(parsed.characters)) {
      const chars = parsed.characters.map(parseCharacter).filter(Boolean);
      if (chars.length) cfg.characters = chars;
    }
    if (Array.isArray(parsed.quickReplies)) {
      const qrs = parsed.quickReplies.map(parseQuickReply).filter(Boolean);
      if (qrs.length) cfg.quickReplies = qrs;
    }
    return cfg;
  } catch {
    return {};
  }
}

const CUSTOM_TEMPLATE_ALLOWED_TAGS = new Set([
  'article',
  'b',
  'br',
  'button',
  'div',
  'em',
  'footer',
  'header',
  'hr',
  'i',
  'li',
  'ol',
  'p',
  'section',
  'small',
  'span',
  'strong',
  'style',
  'ul'
]);
const CUSTOM_TEMPLATE_VOID_TAGS = new Set(['br', 'hr']);
const CUSTOM_TEMPLATE_DANGEROUS_CSS = /@import|expression\s*\(|javascript:|url\s*\(|behavior\s*:/i;

function validateStatusBarCustomTemplate(template) {
  const raw = String(template || '').trim();
  const issues = [];
  if (!raw) {
    return ['自定义模板不能为空；如果只想显示变量，请切回“内置样式”。'];
  }
  if (raw[0] === '{') {
    return [];
  }
  if (/<\s*script\b|<\/\s*script\s*>/i.test(raw)) {
    issues.push('自定义模板不支持 <script> 或 JavaScript。');
  }
  if (/<\s*(iframe|object|embed|link|meta|base|form|input|textarea|select)\b/i.test(raw)) {
    issues.push('自定义模板只能使用安全展示标签，不支持表单、外链或嵌入标签。');
  }
  if (/\son[a-z]+\s*=/i.test(raw) || /javascript:/i.test(raw)) {
    issues.push('自定义模板不支持 onClick 等事件属性或 javascript: 链接。');
  }
  if (/\{\{\s*\}\}|\{\s*\}/.test(raw)) {
    issues.push('占位符不能为空，请使用 {{HP}}、{{HP.max}} 或 {HP}。');
  }
  if ((raw.match(/\{\{/g) || []).length !== (raw.match(/\}\}/g) || []).length) {
    issues.push('双花括号占位符数量不匹配，请检查 {{变量}} 是否闭合。');
  }

  const styleBlocks = raw.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || [];
  for (const block of styleBlocks) {
    const css = block.replace(/^<style\b[^>]*>/i, '').replace(/<\/style>$/i, '');
    if (CUSTOM_TEMPLATE_DANGEROUS_CSS.test(css)) {
      issues.push('CSS 不支持 @import、url()、expression()、behavior 或 javascript:。');
      break;
    }
    if (!hasBalancedCssBraces(css)) {
      issues.push('CSS 花括号不成对，请检查 <style> 里的规则。');
      break;
    }
  }

  const stack = [];
  const tagPattern = /<\s*(\/?)([a-z][\w:-]*)(?:\s[^<>]*)?>/gi;
  let match;
  while ((match = tagPattern.exec(raw))) {
    const tag = match[2].toLowerCase();
    const isClosing = match[1] === '/';
    const tagText = match[0];
    if (!CUSTOM_TEMPLATE_ALLOWED_TAGS.has(tag)) {
      issues.push(`不支持 <${tag}> 标签；请改用 div/span/p/ul/li 等展示标签。`);
      continue;
    }
    if (isClosing) {
      const previous = stack.pop();
      if (previous !== tag) {
        issues.push(`标签闭合顺序不正确：遇到 </${tag}>，但上一个未闭合标签是 <${previous || '无'}>。`);
        break;
      }
      continue;
    }
    if (!CUSTOM_TEMPLATE_VOID_TAGS.has(tag) && !/\/\s*>$/.test(tagText)) {
      stack.push(tag);
    }
  }
  if (stack.length) {
    issues.push(`标签未闭合：<${stack[stack.length - 1]}>。`);
  }

  return [...new Set(issues)].slice(0, 5);
}

function hasBalancedCssBraces(css) {
  let depth = 0;
  for (const char of String(css || '')) {
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

export { parseTemplateConfig, validateStatusBarCustomTemplate };

export function useChatAccessory({ conversation, showActionNotice, showError }) {
  const statusBar = ref(null);
  const statusBarEditorOpen = ref(false);
  const statusBarSaving = ref(false);
  const statusBarTemplateMode = ref('builtin');
  const accessorySettingsOpen = ref(false);
  const accessorySaving = ref(false);
  const accessorySkillResults = ref([]);
  const economyAccounts = ref([]);
  const statusBarForm = reactive({
    name: '',
    variables: [],
    template: ''
  });
  const statusBarTemplateCfg = reactive({
    variant: 'default',
    density: 'default',
    accentColor: '',
    effects: [],
    customCss: '',
    displayMode: 'compact',
    characters: [],
    quickReplies: []
  });
  const accessorySkills = reactive(createDefaultAccessorySkills());

  const statusBarTemplateIssues = computed(() => {
    if (statusBarTemplateMode.value !== 'custom') return [];
    return validateStatusBarCustomTemplate(statusBarForm.template);
  });

  const accessorySkillItems = [
    { key: 'npcAgent', label: 'NPC Agent', auto: false },
    { key: 'statusBarAgent', label: '状态栏 Agent', auto: true },
    { key: 'economyAgent', label: '经济识别', auto: false },
    { key: 'talentPrompt', label: '天赋提示', auto: false },
    { key: 'cgScene', label: 'CG 场景', auto: false }
  ];

  const hasStatusBarVariables = computed(() => {
    return Boolean(statusBar.value && Array.isArray(statusBar.value.variables) && statusBar.value.variables.length);
  });

  const hasStatusBarContent = computed(() => {
    if (!statusBar.value) return false;
    if (hasStatusBarVariables.value) return true;
    const template = String(statusBar.value.template || '').trim();
    if (template && template[0] !== '{') return true;
    const parsed = parseTemplateConfig(template);
    return parsed.displayMode === 'immersive' && Array.isArray(parsed.characters) && parsed.characters.length > 0;
  });

  const hasStatusBarAutomationContext = computed(() => {
    if (hasStatusBarContent.value) return true;
    return getStatusBarSettingSources().some((settings) => (
      String(settings.statusBarPrompt || '').trim() ||
        hasStatusBarBlueprintContent(settings.statusBarBlueprint)
    ));
  });

  const statusBarTemplateConfig = computed(() => ({
    variant: statusBarTemplateCfg.variant,
    density: statusBarTemplateCfg.density,
    accentColor: statusBarTemplateCfg.accentColor,
    effects: [...statusBarTemplateCfg.effects],
    customCss: statusBarTemplateCfg.customCss,
    displayMode: statusBarTemplateCfg.displayMode,
    characters: statusBarTemplateCfg.characters.map((c) => ({ ...c, variables: (c.variables || []).map((v) => ({ ...v })) })),
    quickReplies: statusBarTemplateCfg.quickReplies.map((q) => ({ ...q }))
  }));

  const showEconomyFeature = computed(() => {
    return isAccessorySkillActiveLocal('economyAgent');
  });

  const showNpcFeature = computed(() => isAccessorySkillActiveLocal('npcAgent'));

  async function loadStatusBar() {
    const conversationId = conversation.value?.id;
    if (!conversationId) {
      statusBar.value = null;
      return null;
    }
    try {
      const result = await fetchStatusBar(conversationId);
      if (conversation.value?.id !== conversationId) {
        return statusBar.value;
      }
      statusBar.value = result;
      if (result) {
        syncStatusBarForm(result);
      }
      return result;
    } catch {
      return statusBar.value;
    }
  }

  async function loadEconomyBalance() {
    const conversationId = conversation.value?.id;
    if (!conversationId) {
      economyAccounts.value = [];
      return;
    }
    try {
      const result = await fetchConversationEconomy(conversationId, { ensure: false });
      if (conversation.value?.id !== conversationId) {
        return;
      }
      economyAccounts.value = result.accounts || [];
    } catch {
      if (conversation.value?.id !== conversationId) {
        return;
      }
      economyAccounts.value = [];
    }
  }

  async function loadAccessorySkills() {
    const conversationId = conversation.value?.id;
    if (!conversationId) {
      syncAccessorySkills();
      return;
    }
    try {
      const payload = await fetchConversationAccessorySkills(conversationId);
      if (conversation.value?.id !== conversationId) {
        return;
      }
      syncAccessorySkills(payload.skills);
    } catch {
      if (conversation.value?.id !== conversationId) {
        return;
      }
      syncAccessorySkills(conversation.value?.settings?.accessorySkills);
    }
  }

  function createDefaultAccessorySkills() {
    return {
      npcAgent: { enabled: false, modelOverride: '' },
      statusBarAgent: { enabled: 'auto', modelOverride: '' },
      economyAgent: { enabled: false, modelOverride: '' },
      talentPrompt: { enabled: false, modelOverride: '' },
      cgScene: { enabled: false, modelOverride: '' }
    };
  }

  function syncAccessorySkills(next = {}) {
    const defaults = createDefaultAccessorySkills();
    for (const key of Object.keys(defaults)) {
      const source = next?.[key] || {};
      accessorySkills[key] = {
        enabled: normalizeSkillEnabled(source.enabled, defaults[key].enabled),
        modelOverride: String(source.modelOverride || source.model_override || '').trim()
      };
    }
  }

  function normalizeSkillEnabled(value, fallback = false) {
    if (value === 'auto') return 'auto';
    if (value === true || value === 'true' || value === 'on') return true;
    if (value === false || value === 'false' || value === 'off') return false;
    return fallback;
  }

  function isAccessorySkillActiveLocal(key) {
    const skill = accessorySkills[key] || {};
    if (skill.enabled === true) return true;
    if (skill.enabled !== 'auto') return false;
    return key === 'statusBarAgent' && hasStatusBarAutomationContext.value;
  }

  async function saveAccessorySkillChanges() {
    const conversationId = conversation.value?.id;
    if (!conversationId || accessorySaving.value) return;
    accessorySaving.value = true;
    try {
      const payload = await saveConversationAccessorySkills(conversationId, { accessorySkills });
      if (conversation.value?.id !== conversationId) {
        return;
      }
      syncAccessorySkills(payload.skills);
      conversation.value = {
        ...conversation.value,
        settings: {
          ...(conversation.value?.settings || {}),
          accessorySkills: payload.skills
        },
        userSettings: {
          ...(conversation.value?.userSettings || {}),
          accessorySkills: payload.skills
        }
      };
      await loadEconomyBalance();
      showActionNotice('附属技能已保存');
    } catch (err) {
      if (conversation.value?.id !== conversationId) {
        return;
      }
      showError(err.message);
    } finally {
      if (conversation.value?.id === conversationId) {
        accessorySaving.value = false;
      }
    }
  }

  function handleSkillResult(data = {}) {
    accessorySkillResults.value = [data, ...accessorySkillResults.value].slice(0, 8);
    if (!data.ok) {
      return;
    }
    const result = data.result || {};
    if (data.skill === 'statusBarAgent' && result.statusBar) {
      statusBar.value = result.statusBar;
      syncStatusBarForm(result.statusBar);
    }
    if (data.skill === 'economyAgent' && Array.isArray(result.transactions) && result.transactions.length) {
      loadEconomyBalance();
    }
  }

  function syncStatusBarForm(data = {}) {
    statusBarForm.name = data.name || '状态栏';
    statusBarForm.variables = Array.isArray(data.variables)
      ? data.variables.map((v) => ({ ...v }))
      : [];
    statusBarForm.template = data.template || '';
    statusBarTemplateMode.value = isCustomTemplate(statusBarForm.template) ? 'custom' : 'builtin';
    syncTemplateCfgFromForm();
  }

  function addStatusBarVariable() {
    statusBarForm.variables.push({
      name: '新变量',
      value: 100,
      max: 100,
      color: '#6c757d'
    });
  }

  function removeStatusBarVariable(index) {
    statusBarForm.variables.splice(index, 1);
  }

  async function saveStatusBarChanges() {
    if (!conversation.value?.id || statusBarSaving.value) return;
    if (statusBarTemplateMode.value === 'builtin') {
      syncTemplateCfgToForm();
    } else if (statusBarTemplateIssues.value.length) {
      showError(statusBarTemplateIssues.value.join('\n'));
      return;
    }
    statusBarSaving.value = true;
    try {
      const result = await saveStatusBar(conversation.value.id, {
        name: statusBarForm.name,
        variables: normalizeStatusVariablesForPayload(statusBarForm.variables),
        template: statusBarForm.template
      });
      statusBar.value = result;
      showActionNotice('状态栏已保存');
    } catch (err) {
      showError(err.message);
    } finally {
      statusBarSaving.value = false;
    }
  }

  async function deleteStatusBarAction() {
    if (!conversation.value?.id) return;
    if (!window.confirm('确定删除当前状态栏？')) return;
    try {
      await deleteStatusBar(conversation.value.id);
      statusBar.value = null;
      statusBarForm.name = '';
      statusBarForm.variables = [];
      statusBarForm.template = '';
      statusBarTemplateMode.value = 'builtin';
      showActionNotice('状态栏已删除');
    } catch (err) {
      showError(err.message);
    }
  }

  function openStatusBarEditor() {
    if (statusBar.value) {
      syncStatusBarForm(statusBar.value);
    } else {
      statusBarForm.name = '状态栏';
      statusBarForm.variables = [
        { name: 'HP', value: 100, max: 100, color: '#e74c3c' },
        { name: 'MP', value: 50, max: 50, color: '#3498db' }
      ];
      statusBarForm.template = '';
      statusBarTemplateMode.value = 'builtin';
    }
    syncTemplateCfgFromForm();
    if (!statusBar.value) {
      const charName = conversation.value?.characterName || conversation.value?.character?.name || '';
      if (charName && !statusBarTemplateCfg.characters.length) {
        statusBarTemplateCfg.characters = [{
          id: 'char_' + Date.now(),
          name: charName,
          role: '主角',
          status: 'active',
          note: '',
          accentColor: '',
          customCss: '',
          variables: []
        }];
      }
    }
    statusBarEditorOpen.value = true;
  }

  function syncTemplateCfgFromForm() {
    if (statusBarTemplateMode.value !== 'builtin') {
      resetTemplateCfg();
      return;
    }
    const parsed = parseTemplateConfig(statusBarForm.template);
    statusBarTemplateCfg.variant = parsed.variant || 'default';
    statusBarTemplateCfg.density = parsed.density || 'default';
    statusBarTemplateCfg.accentColor = parsed.accentColor || '';
    statusBarTemplateCfg.effects = parsed.effects || [];
    statusBarTemplateCfg.customCss = parsed.customCss || '';
    statusBarTemplateCfg.displayMode = parsed.displayMode || 'compact';
    statusBarTemplateCfg.characters = Array.isArray(parsed.characters)
      ? parsed.characters.map((c) => ({ ...c, variables: (c.variables || []).map((v) => ({ ...v })) }))
      : [];
    statusBarTemplateCfg.quickReplies = Array.isArray(parsed.quickReplies)
      ? parsed.quickReplies.map((q) => ({ ...q }))
      : [];
  }

  function syncTemplateCfgToForm() {
    if (statusBarTemplateMode.value !== 'builtin') {
      return;
    }
    const cfg = {};
    if (statusBarTemplateCfg.variant !== 'default') cfg.variant = statusBarTemplateCfg.variant;
    if (statusBarTemplateCfg.density !== 'default') cfg.density = statusBarTemplateCfg.density;
    if (statusBarTemplateCfg.accentColor) cfg.accentColor = statusBarTemplateCfg.accentColor;
    if (statusBarTemplateCfg.effects.length) cfg.effects = statusBarTemplateCfg.effects;
    if (statusBarTemplateCfg.customCss) cfg.customCss = statusBarTemplateCfg.customCss;
    if (statusBarTemplateCfg.displayMode !== 'compact') cfg.displayMode = statusBarTemplateCfg.displayMode;
    if (statusBarTemplateCfg.characters.length) cfg.characters = statusBarTemplateCfg.characters;
    if (statusBarTemplateCfg.quickReplies.length) cfg.quickReplies = statusBarTemplateCfg.quickReplies;
    statusBarForm.template = Object.keys(cfg).length ? JSON.stringify(cfg) : '';
  }

  function resetTemplateCfg() {
    statusBarTemplateCfg.variant = 'default';
    statusBarTemplateCfg.density = 'default';
    statusBarTemplateCfg.accentColor = '';
    statusBarTemplateCfg.effects = [];
    statusBarTemplateCfg.customCss = '';
    statusBarTemplateCfg.displayMode = 'compact';
    statusBarTemplateCfg.characters = [];
    statusBarTemplateCfg.quickReplies = [];
  }

  function normalizeStatusVariablesForPayload(variables = []) {
    if (!Array.isArray(variables)) {
      return [];
    }
    return variables
      .map((variable) => {
        const hasMax = hasExplicitVariableMax(variable);
        const value = normalizeStatusVariableValue(variable?.value, { emptyText: !hasMax });
        const max = hasMax
          ? Number(variable.max)
          : typeof value === 'number'
            ? 100
            : undefined;
        return {
          name: String(variable?.name || '').trim(),
          value,
          ...(max !== undefined ? { max } : {}),
          color: String(variable?.color || '').trim()
        };
      })
      .filter((variable) => variable.name)
      .slice(0, STATUS_BAR_VARIABLE_LIMIT);
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

  function hasExplicitVariableMax(variable) {
    return String(variable?.max ?? '').trim() !== '' && Number.isFinite(Number(variable?.max));
  }

  function setStatusBarTemplateMode(mode) {
    const nextMode = mode === 'custom' ? 'custom' : 'builtin';
    if (statusBarTemplateMode.value === nextMode) {
      return;
    }
    statusBarTemplateMode.value = nextMode;
    if (nextMode === 'custom') {
      if (!isCustomTemplate(statusBarForm.template)) {
        statusBarForm.template = '';
      }
      resetTemplateCfg();
      return;
    }
    syncTemplateCfgToForm();
    syncTemplateCfgFromForm();
  }

  function isCustomTemplate(raw) {
    const trimmed = String(raw || '').trim();
    return Boolean(trimmed && trimmed[0] !== '{');
  }

  function hasStatusBarBlueprintContent(input = {}) {
    if (!input || typeof input !== 'object') return false;
    const variables = Array.isArray(input.variables) ? input.variables : [];
    return Boolean(
      String(input.name || '').trim() ||
        String(input.template || '').trim() ||
        variables.some((item) => String(item?.name || '').trim())
    );
  }

  function getStatusBarSettingSources() {
    return [
      conversation.value?.settings,
      conversation.value?.authorSettings,
      conversation.value?.userSettings
    ].filter((item) => item && typeof item === 'object');
  }

  function closeStatusBarEditor() {
    statusBarEditorOpen.value = false;
  }

  function addStatusCharacter() {
    statusBarTemplateCfg.characters.push({
      id: 'char_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      name: '新角色',
      role: '',
      status: 'active',
      note: '',
      accentColor: '',
      customCss: '',
      variables: []
    });
  }

  function removeStatusCharacter(index) {
    statusBarTemplateCfg.characters.splice(index, 1);
  }

  function addCharacterVariable(charIndex) {
    const ch = statusBarTemplateCfg.characters[charIndex];
    if (!ch) return;
    if (!ch.variables) ch.variables = [];
    ch.variables.push({ name: '新变量', value: 100, max: 100, color: '#6c757d' });
  }

  function removeCharacterVariable(charIndex, varIndex) {
    const ch = statusBarTemplateCfg.characters[charIndex];
    if (!ch || !ch.variables) return;
    ch.variables.splice(varIndex, 1);
  }

  function addQuickReply() {
    statusBarTemplateCfg.quickReplies.push({ label: '新选项', text: '' });
  }

  function removeQuickReply(index) {
    statusBarTemplateCfg.quickReplies.splice(index, 1);
  }

  return {
    statusBar,
    statusBarForm,
    statusBarEditorOpen,
    statusBarSaving,
    statusBarTemplateMode,
    statusBarTemplateConfig,
    statusBarTemplateIssues,
    statusBarTemplateCfg,
    accessorySettingsOpen,
    accessorySaving,
    accessorySkills,
    accessorySkillResults,
    economyAccounts,
    accessorySkillItems,
    hasStatusBarContent,
    hasStatusBarAutomationContext,
    showEconomyFeature,
    showNpcFeature,
    loadStatusBar,
    loadEconomyBalance,
    loadAccessorySkills,
    syncAccessorySkills,
    isAccessorySkillActiveLocal,
    saveAccessorySkillChanges,
    handleSkillResult,
    syncStatusBarForm,
    addStatusBarVariable,
    removeStatusBarVariable,
    saveStatusBarChanges,
    deleteStatusBarAction,
    openStatusBarEditor,
    closeStatusBarEditor,
    setStatusBarTemplateMode,
    addStatusCharacter,
    removeStatusCharacter,
    addCharacterVariable,
    removeCharacterVariable,
    addQuickReply,
    removeQuickReply
  };
}
