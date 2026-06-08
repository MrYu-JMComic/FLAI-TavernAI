import { computed, reactive, ref } from 'vue';
import {
  deleteStatusBar,
  fetchConversationAccessorySkills,
  fetchConversationEconomy,
  fetchStatusBar,
  saveConversationAccessorySkills,
  saveStatusBar
} from '../../api.js';
import {
  STATUS_BAR_TEMPLATE_VALIDATOR_ALLOWED_TAGS,
  STATUS_BAR_TEMPLATE_VOID_TAGS,
  hasDangerousStatusBarCss
} from '../../utils/statusBarTemplateSecurity.js';

const VALID_VARIANTS = ['default', 'compact', 'minimal', 'neon'];
const VALID_DENSITIES = ['default', 'cozy', 'compact'];
const VALID_EFFECTS = ['glow', 'striped', 'pulse'];
const VALID_DISPLAY_MODES = ['immersive', 'compact'];
const VALID_CHAR_STATUSES = ['active', 'dead', 'forgotten', 'left', 'hidden'];
const STATUS_BAR_VARIABLE_LIMIT = 60;
const STATUS_BAR_TEMPLATE_ISSUE_LIMIT = 5;
const ACCESSORY_SKILL_RESULT_LIMIT = 8;

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
    const variables = [];
    for (let index = 0; index < raw.variables.length; index += 1) {
      const variable = raw.variables[index];
      if (!variable || typeof variable !== 'object') {
        continue;
      }
      const name = String(variable.name || '');
      if (!name) {
        continue;
      }
      variables.push({
        name,
        value: Number(variable.value) || 0,
        max: Number(variable.max) || 100,
        color: String(variable.color || '#6c757d')
      });
    }
    ch.variables = variables;
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
      const effects = [];
      for (let index = 0; index < parsed.effects.length; index += 1) {
        const effect = parsed.effects[index];
        if (VALID_EFFECTS.includes(effect)) {
          effects.push(effect);
        }
      }
      if (effects.length) cfg.effects = effects;
    }
    if (typeof parsed.customCss === 'string' && parsed.customCss.trim()) {
      cfg.customCss = parsed.customCss.trim();
    }
    if (VALID_DISPLAY_MODES.includes(parsed.displayMode)) {
      cfg.displayMode = parsed.displayMode;
    }
    if (Array.isArray(parsed.characters)) {
      const chars = [];
      for (let index = 0; index < parsed.characters.length; index += 1) {
        const character = parseCharacter(parsed.characters[index]);
        if (character) {
          chars.push(character);
        }
      }
      if (chars.length) cfg.characters = chars;
    }
    if (Array.isArray(parsed.quickReplies)) {
      const qrs = [];
      for (let index = 0; index < parsed.quickReplies.length; index += 1) {
        const quickReply = parseQuickReply(parsed.quickReplies[index]);
        if (quickReply) {
          qrs.push(quickReply);
        }
      }
      if (qrs.length) cfg.quickReplies = qrs;
    }
    return cfg;
  } catch {
    return {};
  }
}

function cloneTemplateConfig(cfg = {}) {
  return {
    variant: cfg.variant,
    density: cfg.density,
    accentColor: cfg.accentColor,
    effects: cloneTemplateEffects(cfg.effects),
    customCss: cfg.customCss,
    displayMode: cfg.displayMode,
    characters: cloneTemplateCharacters(cfg.characters),
    quickReplies: cloneTemplateQuickReplies(cfg.quickReplies)
  };
}

function cloneTemplateEffects(effects = []) {
  const cloned = [];
  const sourceEffects = Array.isArray(effects) ? effects : [];
  for (let index = 0; index < sourceEffects.length; index += 1) {
    cloned.push(sourceEffects[index]);
  }
  return cloned;
}

function cloneTemplateCharacters(characters = []) {
  const cloned = [];
  const sourceCharacters = Array.isArray(characters) ? characters : [];
  for (let index = 0; index < sourceCharacters.length; index += 1) {
    const character = sourceCharacters[index] || {};
    cloned.push({
      ...character,
      variables: cloneTemplateVariables(character.variables)
    });
  }
  return cloned;
}

function cloneTemplateVariables(variables = []) {
  const cloned = [];
  const sourceVariables = Array.isArray(variables) ? variables : [];
  for (let index = 0; index < sourceVariables.length; index += 1) {
    cloned.push({ ...sourceVariables[index] });
  }
  return cloned;
}

function cloneTemplateQuickReplies(quickReplies = []) {
  const cloned = [];
  const sourceQuickReplies = Array.isArray(quickReplies) ? quickReplies : [];
  for (let index = 0; index < sourceQuickReplies.length; index += 1) {
    cloned.push({ ...sourceQuickReplies[index] });
  }
  return cloned;
}

function prependAccessorySkillResult(result, currentResults = []) {
  const nextResults = [result];
  const sourceResults = Array.isArray(currentResults) ? currentResults : [];
  for (
    let index = 0;
    index < sourceResults.length && nextResults.length < ACCESSORY_SKILL_RESULT_LIMIT;
    index += 1
  ) {
    nextResults.push(sourceResults[index]);
  }
  return nextResults;
}

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
    if (hasDangerousStatusBarCss(css)) {
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
    if (!STATUS_BAR_TEMPLATE_VALIDATOR_ALLOWED_TAGS.has(tag)) {
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
    if (!STATUS_BAR_TEMPLATE_VOID_TAGS.has(tag) && !/\/\s*>$/.test(tagText)) {
      stack.push(tag);
    }
  }
  if (stack.length) {
    issues.push(`标签未闭合：<${stack[stack.length - 1]}>。`);
  }

  return collectStatusBarTemplateIssues(issues);
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

function collectStatusBarTemplateIssues(issues) {
  const collected = [];
  const sourceIssues = Array.isArray(issues) ? issues : [];
  for (let index = 0; index < sourceIssues.length && collected.length < STATUS_BAR_TEMPLATE_ISSUE_LIMIT; index += 1) {
    const issue = sourceIssues[index];
    if (!issue || hasStatusBarTemplateIssue(collected, issue)) {
      continue;
    }
    collected.push(issue);
  }
  return collected;
}

function hasStatusBarTemplateIssue(issues, issue) {
  for (let index = 0; index < issues.length; index += 1) {
    if (issues[index] === issue) {
      return true;
    }
  }
  return false;
}

export { parseTemplateConfig, validateStatusBarCustomTemplate };

export function useChatAccessory({ conversation, setActiveConversationIfChanged, showActionNotice, showError }) {
  const statusBar = ref(null);
  const statusBarEditorOpen = ref(false);
  const statusBarSaving = ref(false);
  const statusBarTemplateMode = ref('builtin');
  const accessorySettingsOpen = ref(false);
  const accessorySaving = ref(false);
  const accessorySkillResults = ref([]);
  const economyAccounts = ref([]);
  let statusBarLoadToken = 0;
  let statusBarMutationToken = 0;
  let economyLoadToken = 0;
  let accessorySkillsLoadToken = 0;
  let accessorySaveToken = 0;
  let accessoryDisposed = false;
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
    return hasStatusBarAutomationSettingSource(conversation.value?.settings)
      || hasStatusBarAutomationSettingSource(conversation.value?.authorSettings)
      || hasStatusBarAutomationSettingSource(conversation.value?.userSettings);
  });

  const statusBarTemplateConfig = computed(() => cloneTemplateConfig(statusBarTemplateCfg));

  const showEconomyFeature = computed(() => {
    return isAccessorySkillActiveLocal('economyAgent');
  });

  const showNpcFeature = computed(() => isAccessorySkillActiveLocal('npcAgent'));

  async function loadStatusBar() {
    if (accessoryDisposed) return statusBar.value;
    const conversationId = conversation.value?.id;
    const requestToken = ++statusBarLoadToken;
    if (!conversationId) {
      setStatusBarIfChanged(null, { syncForm: false });
      return null;
    }
    try {
      const result = await fetchStatusBar(conversationId);
      if (!isCurrentStatusBarLoad(requestToken, conversationId)) {
        return statusBar.value;
      }
      setStatusBarIfChanged(result);
      return statusBar.value;
    } catch {
      return statusBar.value;
    }
  }

  function setStatusBarIfChanged(nextStatusBar, options = {}) {
    const normalizedStatusBar = nextStatusBar && typeof nextStatusBar === 'object'
      ? nextStatusBar
      : null;
    if (sameStatusBarSummary(statusBar.value, normalizedStatusBar)) {
      return false;
    }
    statusBar.value = normalizedStatusBar;
    if (normalizedStatusBar && options.syncForm !== false) {
      syncStatusBarForm(normalizedStatusBar);
    }
    return true;
  }

  function applyStatusBarUpdate(nextStatusBar, options = {}) {
    return setStatusBarIfChanged(nextStatusBar, options);
  }

  function sameStatusBarSummary(current, next) {
    if (current === next) {
      return true;
    }
    if (!current || !next) {
      return !current && !next;
    }
    return current.id === next.id
      && current.conversationId === next.conversationId
      && current.name === next.name
      && current.template === next.template
      && current.createdAt === next.createdAt
      && current.updatedAt === next.updatedAt
      && sameStatusVariableList(current.variables, next.variables);
  }

  function sameStatusVariableList(currentVariables, nextVariables) {
    const currentList = Array.isArray(currentVariables) ? currentVariables : [];
    const nextList = Array.isArray(nextVariables) ? nextVariables : [];
    if (currentList === nextList) {
      return true;
    }
    if (currentList.length !== nextList.length) {
      return false;
    }
    for (let index = 0; index < currentList.length; index += 1) {
      if (!sameStatusVariableSummary(currentList[index], nextList[index])) {
        return false;
      }
    }
    return true;
  }

  function sameStatusVariableSummary(current = {}, next = {}) {
    return current?.name === next?.name
      && current?.value === next?.value
      && current?.max === next?.max
      && current?.color === next?.color;
  }

  async function loadEconomyBalance() {
    if (accessoryDisposed) return;
    const conversationId = conversation.value?.id;
    const requestToken = ++economyLoadToken;
    if (!conversationId) {
      setEconomyAccountsIfChanged([]);
      return;
    }
    try {
      const result = await fetchConversationEconomy(conversationId, { ensure: false });
      if (!isCurrentEconomyLoad(requestToken, conversationId)) {
        return;
      }
      setEconomyAccountsIfChanged(result.accounts);
    } catch {
      if (!isCurrentEconomyLoad(requestToken, conversationId)) {
        return;
      }
      setEconomyAccountsIfChanged([]);
    }
  }

  function setEconomyAccountsIfChanged(nextAccounts) {
    const normalizedAccounts = Array.isArray(nextAccounts) ? nextAccounts : [];
    const currentAccounts = Array.isArray(economyAccounts.value) ? economyAccounts.value : [];
    if (sameEconomyAccountList(currentAccounts, normalizedAccounts)) {
      return false;
    }
    economyAccounts.value = normalizedAccounts;
    return true;
  }

  function sameEconomyAccountList(currentAccounts, nextAccounts) {
    if (currentAccounts === nextAccounts) {
      return true;
    }
    if (currentAccounts.length !== nextAccounts.length) {
      return false;
    }
    for (let index = 0; index < currentAccounts.length; index += 1) {
      if (!sameEconomyAccountSummary(currentAccounts[index], nextAccounts[index])) {
        return false;
      }
    }
    return true;
  }

  function sameEconomyAccountSummary(current = {}, next = {}) {
    return current?.id === next?.id
      && current?.conversationId === next?.conversationId
      && current?.currencyType === next?.currencyType
      && current?.balance === next?.balance;
  }

  async function loadAccessorySkills() {
    if (accessoryDisposed) return;
    const conversationId = conversation.value?.id;
    const requestToken = ++accessorySkillsLoadToken;
    if (!conversationId) {
      syncAccessorySkills();
      return;
    }
    try {
      const payload = await fetchConversationAccessorySkills(conversationId);
      if (!isCurrentAccessorySkillsLoad(requestToken, conversationId)) {
        return;
      }
      syncAccessorySkills(payload.skills);
    } catch {
      if (!isCurrentAccessorySkillsLoad(requestToken, conversationId)) {
        return;
      }
      syncAccessorySkills(conversation.value?.settings?.accessorySkills);
    }
  }

  function isCurrentStatusBarLoad(requestToken, conversationId) {
    return !accessoryDisposed && requestToken === statusBarLoadToken && conversation.value?.id === conversationId;
  }

  function isCurrentEconomyLoad(requestToken, conversationId) {
    return !accessoryDisposed && requestToken === economyLoadToken && conversation.value?.id === conversationId;
  }

  function isCurrentAccessorySkillsLoad(requestToken, conversationId) {
    return !accessoryDisposed && requestToken === accessorySkillsLoadToken && conversation.value?.id === conversationId;
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
      const normalizedSkill = {
        enabled: normalizeSkillEnabled(source.enabled, defaults[key].enabled),
        modelOverride: String(source.modelOverride || source.model_override || '').trim()
      };
      if (!sameAccessorySkillConfig(accessorySkills[key], normalizedSkill)) {
        accessorySkills[key] = normalizedSkill;
      }
    }
  }

  function sameAccessorySkillConfig(current = {}, next = {}) {
    return current?.enabled === next?.enabled
      && current?.modelOverride === next?.modelOverride;
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
    if (accessoryDisposed || !conversationId || accessorySaving.value) return;
    const requestToken = ++accessorySaveToken;
    accessorySaving.value = true;
    try {
      const payload = await saveConversationAccessorySkills(conversationId, { accessorySkills });
      if (!isCurrentAccessorySave(requestToken, conversationId)) {
        return;
      }
      syncAccessorySkills(payload.skills);
      updateActiveConversationIfChanged({
        ...conversation.value,
        settings: {
          ...(conversation.value?.settings || {}),
          accessorySkills: payload.skills
        },
        userSettings: {
          ...(conversation.value?.userSettings || {}),
          accessorySkills: payload.skills
        }
      });
      await loadEconomyBalance();
      if (!isCurrentAccessorySave(requestToken, conversationId)) {
        return;
      }
      showActionNotice('附属技能已保存');
    } catch (err) {
      if (!isCurrentAccessorySave(requestToken, conversationId)) {
        return;
      }
      showError(err.message);
    } finally {
      if (isActiveAccessorySave(requestToken)) {
        accessorySaving.value = false;
      }
    }
  }

  function isCurrentAccessorySave(requestToken, conversationId) {
    return isActiveAccessorySave(requestToken) && conversation.value?.id === conversationId;
  }

  function updateActiveConversationIfChanged(nextConversation) {
    if (typeof setActiveConversationIfChanged === 'function') {
      return setActiveConversationIfChanged(nextConversation);
    }
    conversation.value = nextConversation || null;
    return true;
  }

  function isActiveAccessorySave(requestToken) {
    return !accessoryDisposed && requestToken === accessorySaveToken;
  }

  function handleSkillResult(data = {}) {
    if (accessoryDisposed || !isCurrentSkillResult(data)) return;
    accessorySkillResults.value = prependAccessorySkillResult(data, accessorySkillResults.value);
    if (!data.ok) {
      return;
    }
    const result = data.result || {};
    if (data.skill === 'statusBarAgent' && result.statusBar) {
      applyStatusBarUpdate(result.statusBar);
    }
    if (data.skill === 'economyAgent' && Array.isArray(result.transactions) && result.transactions.length) {
      loadEconomyBalance();
    }
  }

  function syncStatusBarForm(data = {}) {
    statusBarForm.name = data.name || '状态栏';
    statusBarForm.variables = cloneTemplateVariables(data.variables);
    statusBarForm.template = data.template || '';
    statusBarTemplateMode.value = isCustomTemplate(statusBarForm.template) ? 'custom' : 'builtin';
    syncTemplateCfgFromForm();
  }

  function isStatusBarEditorLocked() {
    return accessoryDisposed || statusBarSaving.value;
  }

  function addStatusBarVariable() {
    if (isStatusBarEditorLocked()) return;
    statusBarForm.variables.push({
      name: '新变量',
      value: 100,
      max: 100,
      color: '#6c757d'
    });
  }

  function removeStatusBarVariable(index) {
    if (isStatusBarEditorLocked()) return;
    statusBarForm.variables.splice(index, 1);
  }

  async function saveStatusBarChanges() {
    const conversationId = conversation.value?.id;
    if (accessoryDisposed || !conversationId || statusBarSaving.value) return;
    if (statusBarTemplateMode.value === 'builtin') {
      syncTemplateCfgToForm();
    } else if (statusBarTemplateIssues.value.length) {
      showError(statusBarTemplateIssues.value.join('\n'));
      return;
    }
    const requestToken = ++statusBarMutationToken;
    statusBarSaving.value = true;
    try {
      const result = await saveStatusBar(conversationId, {
        name: statusBarForm.name,
        variables: normalizeStatusVariablesForPayload(statusBarForm.variables),
        template: statusBarForm.template
      });
      if (!isCurrentStatusBarMutation(requestToken, conversationId)) {
        return;
      }
      applyStatusBarUpdate(result);
      showActionNotice('状态栏已保存');
    } catch (err) {
      if (!isCurrentStatusBarMutation(requestToken, conversationId)) {
        return;
      }
      showError(err.message);
    } finally {
      if (isActiveStatusBarMutation(requestToken)) {
        statusBarSaving.value = false;
      }
    }
  }

  function isCurrentSkillResult(data = {}) {
    const eventConversationId = String(data?.conversationId || '').trim();
    return Boolean(eventConversationId && eventConversationId === conversation.value?.id);
  }

  async function deleteStatusBarAction() {
    const conversationId = conversation.value?.id;
    if (accessoryDisposed || !conversationId || statusBarSaving.value) return;
    if (!window.confirm('确定删除当前状态栏？')) return;
    const requestToken = ++statusBarMutationToken;
    statusBarSaving.value = true;
    try {
      await deleteStatusBar(conversationId);
      if (!isCurrentStatusBarMutation(requestToken, conversationId)) {
        return;
      }
      applyStatusBarUpdate(null, { syncForm: false });
      statusBarForm.name = '';
      statusBarForm.variables = [];
      statusBarForm.template = '';
      statusBarTemplateMode.value = 'builtin';
      showActionNotice('状态栏已删除');
    } catch (err) {
      if (!isCurrentStatusBarMutation(requestToken, conversationId)) {
        return;
      }
      showError(err.message);
    } finally {
      if (isActiveStatusBarMutation(requestToken)) {
        statusBarSaving.value = false;
      }
    }
  }

  function isCurrentStatusBarMutation(requestToken, conversationId) {
    return isActiveStatusBarMutation(requestToken) && conversation.value?.id === conversationId;
  }

  function isActiveStatusBarMutation(requestToken) {
    return !accessoryDisposed && requestToken === statusBarMutationToken;
  }

  function openStatusBarEditor() {
    if (isStatusBarEditorLocked()) return;
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
    statusBarTemplateCfg.characters = cloneTemplateCharacters(parsed.characters);
    statusBarTemplateCfg.quickReplies = cloneTemplateQuickReplies(parsed.quickReplies);
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
    const normalized = [];
    for (let index = 0; index < variables.length && normalized.length < STATUS_BAR_VARIABLE_LIMIT; index += 1) {
      const variable = variables[index];
      const hasMax = hasExplicitVariableMax(variable);
      const value = normalizeStatusVariableValue(variable?.value, { emptyText: !hasMax });
      const name = String(variable?.name || '').trim();
      if (!name || isCompositeStatusPlaceholderValue(value, name)) {
        continue;
      }
      const max = hasMax
        ? Number(variable.max)
        : typeof value === 'number'
          ? 100
          : undefined;
      const row = {
        name,
        value,
        color: String(variable?.color || '').trim()
      };
      if (max !== undefined) {
        row.max = max;
      }
      normalized.push(row);
    }
    return normalized;
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

  function isCompositeStatusPlaceholderValue(value = '', name = '') {
    const labelKey = normalizeStatusVariableKey(name);
    const seen = new Set();
    const placeholderPattern = /\{\{\s*([^{}]+?)\s*\}\}|\{([\w\u4e00-\u9fa5 ._-]+)\}/g;
    let match;
    while ((match = placeholderPattern.exec(String(value || '')))) {
      const token = String(match[1] || match[2] || '').trim();
      const { rawName, rawProperty } = parseStatusPlaceholderToken(token);
      const key = normalizeStatusVariableKey(rawName);
      if (!key || key === labelKey || seen.has(key) || ['max', 'percent', 'percentage'].includes(rawProperty)) {
        continue;
      }
      seen.add(key);
      if (seen.size >= 2) {
        return true;
      }
    }
    return false;
  }

  function normalizeStatusVariableKey(value = '') {
    return String(value || '').trim().toLowerCase();
  }

  function parseStatusPlaceholderToken(token = '') {
    const text = String(token || '');
    const separatorIndex = text.indexOf('.');
    if (separatorIndex === -1) {
      return { rawName: text.trim(), rawProperty: 'value' };
    }
    const nextSeparatorIndex = text.indexOf('.', separatorIndex + 1);
    return {
      rawName: text.slice(0, separatorIndex).trim(),
      rawProperty: text.slice(
        separatorIndex + 1,
        nextSeparatorIndex === -1 ? text.length : nextSeparatorIndex
      ).trim()
    };
  }

  function setStatusBarTemplateMode(mode) {
    if (isStatusBarEditorLocked()) return;
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
    if (String(input.name || '').trim() || String(input.template || '').trim()) {
      return true;
    }
    for (let index = 0; index < variables.length; index += 1) {
      if (String(variables[index]?.name || '').trim()) {
        return true;
      }
    }
    return false;
  }

  function hasStatusBarAutomationSettingSource(settings) {
    if (!settings || typeof settings !== 'object') {
      return false;
    }
    return Boolean(
      String(settings.statusBarPrompt || '').trim() ||
        hasStatusBarBlueprintContent(settings.statusBarBlueprint)
    );
  }

  function closeStatusBarEditor() {
    if (isStatusBarEditorLocked()) return;
    statusBarEditorOpen.value = false;
  }

  function closeAccessoryPanels() {
    statusBarEditorOpen.value = false;
    accessorySettingsOpen.value = false;
  }

  function cleanupAccessory() {
    accessoryDisposed = true;
    statusBarLoadToken += 1;
    statusBarMutationToken += 1;
    economyLoadToken += 1;
    accessorySkillsLoadToken += 1;
    accessorySaveToken += 1;
    statusBarSaving.value = false;
    accessorySaving.value = false;
  }

  function addStatusCharacter() {
    if (isStatusBarEditorLocked()) return;
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
    if (isStatusBarEditorLocked()) return;
    statusBarTemplateCfg.characters.splice(index, 1);
  }

  function addCharacterVariable(charIndex) {
    if (isStatusBarEditorLocked()) return;
    const ch = statusBarTemplateCfg.characters[charIndex];
    if (!ch) return;
    if (!ch.variables) ch.variables = [];
    ch.variables.push({ name: '新变量', value: 100, max: 100, color: '#6c757d' });
  }

  function removeCharacterVariable(charIndex, varIndex) {
    if (isStatusBarEditorLocked()) return;
    const ch = statusBarTemplateCfg.characters[charIndex];
    if (!ch || !ch.variables) return;
    ch.variables.splice(varIndex, 1);
  }

  function addQuickReply() {
    if (isStatusBarEditorLocked()) return;
    statusBarTemplateCfg.quickReplies.push({ label: '新选项', text: '' });
  }

  function removeQuickReply(index) {
    if (isStatusBarEditorLocked()) return;
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
    applyStatusBarUpdate,
    handleSkillResult,
    syncStatusBarForm,
    addStatusBarVariable,
    removeStatusBarVariable,
    saveStatusBarChanges,
    deleteStatusBarAction,
    openStatusBarEditor,
    closeStatusBarEditor,
    closeAccessoryPanels,
    setStatusBarTemplateMode,
    addStatusCharacter,
    removeStatusCharacter,
    addCharacterVariable,
    removeCharacterVariable,
    addQuickReply,
    removeQuickReply,
    cleanupAccessory
  };
}
