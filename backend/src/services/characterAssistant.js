import { runToolCompletion } from './providers.js';
import { resolvePromptUserName, userVariableToken } from './promptVariables.js';
import { normalizeAdvancedSettings, normalizeAccessorySkills } from '../modules/advancedSettings.js';

const characterTools = [
  {
    type: 'function',
    function: {
      name: 'set_character_profile',
      description: '更新角色基础设定字段。只传入需要新增或改写的字段，允许保留空字段。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '角色名，1-40 个字符。' },
          gender: { type: 'string', description: '性别或性别表达，可留空。' },
          age: { type: 'string', description: '年龄、年龄段或外观年龄，可留空。' },
          background: { type: 'string', description: `角色背景。可使用 ${userVariableToken} 代表当前用户。` },
          worldview: { type: 'string', description: `世界观、时代、地点和规则。可使用 ${userVariableToken}。` },
          persona: { type: 'string', description: `人设、说话方式、行为边界。可使用 ${userVariableToken}。` },
          openingMessage: { type: 'string', description: `第一条开场白。可使用 ${userVariableToken}。` },
          tags: {
            type: 'array',
            description: '角色标签，最多 8 个。',
            items: { type: 'string' }
          },
          visibility: {
            type: 'string',
            enum: ['private', 'public'],
            description: '展示权限。默认 private。'
          }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_regex_rule',
      description: '添加一个高阶正则替换规则。仅在用户明确需要口癖替换、敏感词替换、格式清洗等自动替换时使用。',
      parameters: {
        type: 'object',
        properties: {
          label: { type: 'string', description: '规则名称。' },
          pattern: { type: 'string', description: 'JavaScript 正则 pattern，不包含首尾斜杠。' },
          replacement: { type: 'string', description: '替换文本。' },
          flags: { type: 'string', description: '正则 flags，例如 g、gi、gim。默认 g。' },
          scope: {
            type: 'string',
            enum: ['input', 'output', 'both'],
            description: '作用域：input 用户输入，output 模型输出，both 双向。'
          },
          enabled: { type: 'boolean', description: '是否启用。' }
        },
        required: ['label', 'pattern', 'replacement'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'replace_regex_rules',
      description: '当需要整体重写正则规则时使用。没有正则需求时不要调用。',
      parameters: {
        type: 'object',
        properties: {
          rules: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                pattern: { type: 'string' },
                replacement: { type: 'string' },
                flags: { type: 'string' },
                scope: { type: 'string', enum: ['input', 'output', 'both'] },
                enabled: { type: 'boolean' }
              },
              required: ['label', 'pattern', 'replacement'],
              additionalProperties: false
            }
          }
        },
        required: ['rules'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_character_extensions',
      description: 'Suggest optional character extensions such as world book notes, markdown render plugins, and accessory skill defaults.',
      parameters: {
        type: 'object',
        properties: {
          worldBookSuggestion: { type: 'string' },
          renderPlugins: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                type: { type: 'string', enum: ['fold'] },
                pattern: { type: 'string' },
                flags: { type: 'string' },
                titleTemplate: { type: 'string' },
                enabled: { type: 'boolean' }
              },
              required: ['label', 'pattern'],
              additionalProperties: false
            }
          },
          accessorySkills: {
            type: 'object',
            additionalProperties: true,
            properties: {
              npcAgent: skillConfigSchema(),
              statusBarAgent: skillConfigSchema(),
              economyAgent: skillConfigSchema(),
              talentPrompt: skillConfigSchema(),
              cgScene: skillConfigSchema()
            }
          },
          statusBarPrompt: { type: 'string' }
        },
        additionalProperties: false
      }
    }
  }
];

export async function completeCharacterDraft(settings, { requirement = '', current = {}, user = {} } = {}) {
  const draft = normalizeDraft(current);
  let summary = '';
  const userName = resolvePromptUserName(user);

  const result = await runToolCompletion(
    settings,
    [
      {
        role: 'system',
        content: [
          '你是 FLAI Tavern AI 的角色设定助手。',
          '必须通过工具填写角色设定，不要只输出自然语言。',
          '目标是生成适合角色扮演对话的中文 Tavern 角色卡。',
          `可在背景、世界观、人设、开场白中使用 ${userVariableToken}，它运行时会替换为当前用户：${userName}。`,
          '没有必要的字段保持为空；不要为了填满表单而编造无关设定。',
          '正则规则只在用户明确需要自动替换、口癖清洗、禁词替换、格式规范时添加。',
          '正则 pattern 必须是 JavaScript 可用正则，避免过宽、灾难性回溯或破坏正常中文内容。',
          'You may call set_character_extensions to suggest world book notes, markdown fold render plugins, and opening accessory skill defaults.',
          'Do not enable economyAgent, talentPrompt, or cgScene unless the user explicitly asks for economy, talents, CG, portraits, or scene art.',
          'Prefer statusBarAgent:auto only when the character has clear status variables; keep npcAgent off unless side-character memory is important.'
        ].join('\n')
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            requirement: String(requirement || '').trim(),
            currentCharacter: draft
          },
          null,
          2
        )
      }
    ],
    characterTools,
    (name, args) => executeCharacterTool(name, args, draft),
    { maxRounds: 6, thinkingEnabled: false }
  );

  if (!result.toolCalls.length && result.content) {
    mergeProfile(draft, parseLooseJson(result.content));
  }
  summary = result.content || summarizeDraft(result.toolCalls);

  return {
    character: normalizeDraft(draft),
    toolCalls: result.toolCalls.map((call) => ({
      name: call.name,
      arguments: call.arguments
    })),
    summary,
    usage: result.usage || null
  };
}

function executeCharacterTool(name, args, draft) {
  if (name === 'set_character_profile') {
    const applied = mergeProfile(draft, args);
    return { ok: true, applied };
  }
  if (name === 'add_regex_rule') {
    const rule = normalizeRegexRule(args, draft.regexRules.length);
    if (rule.pattern) {
      draft.regexRules.push(rule);
    }
    return { ok: true, rule };
  }
  if (name === 'replace_regex_rules') {
    draft.regexRules = Array.isArray(args.rules)
      ? args.rules.map((rule, index) => normalizeRegexRule(rule, index)).filter((rule) => rule.pattern)
      : [];
    return { ok: true, count: draft.regexRules.length };
  }
  if (name === 'set_character_extensions') {
    const applied = mergeExtensions(draft, args);
    return { ok: true, applied };
  }
  return { ok: false, error: `未知工具：${name}` };
}

function mergeProfile(draft, args = {}) {
  const applied = {};
  for (const key of ['name', 'gender', 'age', 'background', 'worldview', 'persona', 'openingMessage']) {
    if (Object.prototype.hasOwnProperty.call(args, key)) {
      draft[key] = limitText(args[key], key);
      applied[key] = draft[key];
    }
  }
  if (Object.prototype.hasOwnProperty.call(args, 'visibility')) {
    draft.visibility = args.visibility === 'public' ? 'public' : 'private';
    applied.visibility = draft.visibility;
  }
  if (Array.isArray(args.tags)) {
    draft.tags = normalizeTags(args.tags);
    applied.tags = draft.tags;
  }
  if (Array.isArray(args.regexRules)) {
    draft.regexRules = args.regexRules.map((rule, index) => normalizeRegexRule(rule, index)).filter((rule) => rule.pattern);
    applied.regexRules = draft.regexRules;
  }
  Object.assign(applied, mergeExtensions(draft, args));
  return applied;
}

function mergeExtensions(draft, args = {}) {
  const applied = {};
  if (Array.isArray(args.renderPlugins)) {
    draft.renderPlugins = args.renderPlugins
      .map((plugin, index) => normalizeRenderPlugin(plugin, index))
      .filter((plugin) => plugin.pattern)
      .slice(0, 12);
    applied.renderPlugins = draft.renderPlugins;
  }
  const accessorySkills = args.accessorySkills || args.accessory_skills;
  if (accessorySkills || Object.prototype.hasOwnProperty.call(args, 'statusBarPrompt')) {
    draft.authorAdvancedSettings = normalizeAdvancedSettings({
      ...(draft.authorAdvancedSettings || {}),
      statusBarPrompt: args.statusBarPrompt ?? draft.authorAdvancedSettings?.statusBarPrompt,
      accessorySkills: normalizeAccessorySkills(accessorySkills || draft.authorAdvancedSettings?.accessorySkills)
    });
    applied.authorAdvancedSettings = draft.authorAdvancedSettings;
  }
  if (Object.prototype.hasOwnProperty.call(args, 'worldBookSuggestion')) {
    draft.worldBookSuggestion = limitText(args.worldBookSuggestion, 'worldBookSuggestion');
    applied.worldBookSuggestion = draft.worldBookSuggestion;
  }
  return applied;
}

function normalizeDraft(value = {}) {
  return {
    name: limitText(value.name, 'name'),
    gender: limitText(value.gender, 'gender'),
    age: limitText(value.age, 'age'),
    background: limitText(value.background, 'background'),
    worldview: limitText(value.worldview, 'worldview'),
    persona: limitText(value.persona, 'persona'),
    openingMessage: limitText(value.openingMessage, 'openingMessage'),
    visibility: value.visibility === 'public' ? 'public' : 'private',
    tags: normalizeTags(value.tags),
    regexRules: Array.isArray(value.regexRules)
      ? value.regexRules.map((rule, index) => normalizeRegexRule(rule, index)).filter((rule) => rule.pattern)
      : [],
    renderPlugins: Array.isArray(value.renderPlugins)
      ? value.renderPlugins.map((plugin, index) => normalizeRenderPlugin(plugin, index)).filter((plugin) => plugin.pattern)
      : [],
    authorAdvancedSettings: normalizeAdvancedSettings(value.authorAdvancedSettings || value.advancedSettings || {}),
    worldBookSuggestion: limitText(value.worldBookSuggestion, 'worldBookSuggestion')
  };
}

function normalizeTags(tags = []) {
  return tags.map((tag) => String(tag || '').trim()).filter(Boolean).slice(0, 8);
}

function normalizeRegexRule(rule = {}, index = 0) {
  const flags = normalizeFlags(rule.flags);
  const pattern = String(rule.pattern || '').trim();
  if (pattern) {
    try {
      new RegExp(pattern, flags);
    } catch {
      return {
        label: String(rule.label || `规则 ${index + 1}`).trim().slice(0, 60),
        pattern: '',
        replacement: '',
        flags,
        scope: 'input',
        enabled: false
      };
    }
  }
  return {
    label: String(rule.label || `规则 ${index + 1}`).trim().slice(0, 60),
    pattern,
    replacement: String(rule.replacement || '').slice(0, 500),
    flags,
    scope: ['input', 'output', 'both'].includes(rule.scope) ? rule.scope : 'input',
    enabled: rule.enabled !== false
  };
}

function normalizeRenderPlugin(plugin = {}, index = 0) {
  const flags = normalizeFlags(plugin.flags || 'u').replace(/g/g, '') || 'u';
  const pattern = String(plugin.pattern || '').trim();
  if (pattern) {
    try {
      new RegExp(pattern, flags);
    } catch {
      return {
        label: String(plugin.label || `Render plugin ${index + 1}`).trim().slice(0, 60),
        type: 'fold',
        pattern: '',
        flags,
        titleTemplate: '$1',
        enabled: false
      };
    }
  }
  return {
    label: String(plugin.label || `Render plugin ${index + 1}`).trim().slice(0, 60),
    type: 'fold',
    pattern,
    flags,
    titleTemplate: String(plugin.titleTemplate || plugin.title_template || '$1').slice(0, 120),
    enabled: plugin.enabled !== false
  };
}

function skillConfigSchema() {
  return {
    type: 'object',
    additionalProperties: true,
    properties: {
      enabled: { oneOf: [{ type: 'boolean' }, { type: 'string', enum: ['auto'] }] },
      modelOverride: { type: 'string' }
    }
  };
}

function normalizeFlags(flags) {
  return [...new Set(String(flags || 'g').replace(/[^dgimsuvy]/g, '').split(''))].join('') || 'g';
}

function limitText(value, key) {
  const limits = {
    name: 40,
    gender: 24,
    age: 24,
    background: 4000,
    worldview: 4000,
    persona: 4000,
    openingMessage: 2000,
    worldBookSuggestion: 3000
  };
  return String(value || '').trim().slice(0, limits[key] || 1000);
}

function parseLooseJson(text) {
  const value = String(text || '').trim();
  if (!value) {
    return {};
  }
  try {
    return JSON.parse(value);
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) {
      return {};
    }
    try {
      return JSON.parse(match[0]);
    } catch {
      return {};
    }
  }
}

function summarizeDraft(toolCalls = []) {
  if (!toolCalls.length) {
    return '';
  }
  return `已调用 ${toolCalls.length} 次工具完善角色设定。`;
}
