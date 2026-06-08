import { runToolCompletion, streamToolCompletion } from './providers.js';
import { resolvePromptUserName, userVariableToken } from './promptVariables.js';
import { normalizeAdvancedSettings, normalizeAccessorySkills } from '../modules/advancedSettings.js';
import { nullToEmptyObject, objectOrEmpty, parseLooseJsonObject } from './assistantUtils.js';
import { normalizeRegexFlags } from '../../../shared/regexFlags.js';

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
          statusBarPrompt: { type: 'string' },
          statusBarBlueprint: {
            type: 'object',
            description: [
              'Custom status bar seed data. Template labels and placeholders such as {{变量名}} are automatically inferred into variables, so keep labels exact and do not duplicate variable names.',
              'Text rows should use string values when known, for example {"name":"姓名","value":"待定"}, and template markup like <span class="sb-label">姓名</span><span class="sb-val">{{姓名}}</span>.',
              'Numeric meters should use value/max/color and placeholders such as {{体力}}, {{体力.max}}, {{体力.percent}}, and {{体力.color}}.'
            ].join(' '),
            additionalProperties: false,
            properties: {
              name: { type: 'string', description: '状态栏名称。' },
              variables: {
                type: 'array',
                description: '新会话创建时写入的初始状态变量。',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    name: {
                      type: 'string',
                      description: 'Variable name. Use the exact same text in placeholders, for example {{姓名}} or {{体力}}.'
                    },
                    value: {
                      oneOf: [{ type: 'number' }, { type: 'string' }],
                      description: 'Initial value. Use a number for meters, or a string for text rows such as "待定".'
                    },
                    max: {
                      type: 'number',
                      description: 'Optional max value for numeric meters; enables {{变量名.max}} and {{变量名.percent}}.'
                    },
                    color: {
                      type: 'string',
                      description: 'Optional CSS color for numeric meters; enables {{变量名.color}}.'
                    }
                  },
                  required: ['name', 'value']
                }
              },
              template: {
                type: 'string',
                description: [
                  'Optional fully custom status bar template. Leave empty to use built-in rendering.',
                  'Write safe HTML plus optional CSS. Do not write Vue, Markdown code fences, event attributes, external resources, javascript: URLs, or <script>.',
                  'For interactive controls, use safe declarative buttons only: <button data-sb-action="quick-reply" data-sb-text="...">...</button>, <button data-sb-action="copy" data-sb-copy="...">...</button>, or <button data-sb-action="collapse">...</button>.',
                  'Every dynamic visible value should use a placeholder like {{变量名}}; labels and placeholders are inferred into variables automatically, but include variables[] when you know useful initial values.',
                  'Do not hardcode mutable values such as 待定/未知/无 inside .sb-val.',
                  'For text rows, use <span class="sb-label">姓名</span><span class="sb-val">{{姓名}}</span> and variables: [{"name":"姓名","value":"待定"}].',
                  'For numeric meters, use {{体力}}, {{体力.max}}, {{体力.percent}}, and {{体力.color}} with variables: [{"name":"体力","value":80,"max":100,"color":"#27ae60"}].',
                  'Allowed tags include div/span/button/p/section/article/header/footer/ul/ol/li/small/strong/em/b/i/br/hr/style. Keep HTML tags, quotes, CSS braces, and placeholders balanced.'
                ].join(' ')
              }
            }
          },
          desktopBackgroundUrl: { type: 'string' },
          mobileBackgroundUrl: { type: 'string' },
          customCss: { type: 'string' },
          customJs: { type: 'string' },
          modSuggestions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                description: { type: 'string' },
                type: {
                  type: 'string',
                  enum: ['prompt_inject', 'style_enhance', 'custom'],
                  description: 'prompt_inject injects direct system prompt text; style_enhance adds writing style guidance; custom is a named utility block.'
                },
                content: { type: 'string' },
                enabled: { type: 'boolean' }
              },
              required: ['name', 'content'],
              additionalProperties: false
            }
          }
        },
        additionalProperties: false
      }
    }
  }
];

const statusBarBlueprintInstructions = [
  'When the user asks for a status bar, provide both statusBarPrompt and statusBarBlueprint; do not only write the prompt.',
  'statusBarBlueprint.template labels/placeholders are inferred into variables automatically, but statusBarBlueprint.variables remains the best place to provide useful initial values.',
  'Use exact labels and placeholders consistently so inferred variables do not duplicate: text rows render {{变量名}}; numeric bars render {{变量名}}, {{变量名.max}}, {{变量名.percent}}, and {{变量名.color}}.',
  'Do not hardcode dynamic fallback text such as 待定, 未知, 无, or 故事尚未开始 inside .sb-val or visible value spans; put that text in variables[].value and reference {{变量名}}.',
  'For rows like <span class="sb-label">姓名</span><span class="sb-val">...</span>, the label text must equal a variable name and the value span must be <span class="sb-val">{{姓名}}</span>.',
  'Example text variable: {"name":"姓名","value":"待定"}. Example meter: {"name":"体力","value":80,"max":100,"color":"#27ae60"} with style="width:{{体力.percent}};background:{{体力.color}}".',
  'For statusBarBlueprint.template, output plain safe HTML plus optional CSS. It is not Vue or Markdown; do not use script tags, event handlers, javascript:, external resources, or fenced code blocks.',
  'For button behavior, use safe declarative actions: data-sb-action="quick-reply" with data-sb-text, data-sb-action="copy" with data-sb-copy, or data-sb-action="collapse".',
  'Keep statusBarBlueprint.template syntactically valid: balanced HTML tags, balanced quotes, balanced CSS braces, and balanced placeholders. If unsure, leave template empty and rely on variables.'
];

export async function completeCharacterDraft(settings, request = {}) {
  const { requirement = '', current = {}, user = {}, options: rawOptions = {}, signal } = nullToEmptyObject(request);
  const options = rawOptions ?? {};
  const draft = normalizeDraft(current);
  let summary = '';
  const userName = resolvePromptUserName(user);
  const enabledSections = normalizeGenerationOptions(options);
  const optimizeExisting = options.optimizeExisting === true || options.optimize_existing === true;

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
          optimizeExisting
            ? '已开启“结合当前已填写内容优化”：currentCharacter 是用户现有表单，请在保留有效内容的基础上按用户消息优化，不要无故清空字段。'
            : '未开启“结合当前已填写内容优化”：主要依据用户消息生成；currentCharacter 里的空字段不是清空用户表单的指令。',
          '正则规则只在用户明确需要自动替换、口癖清洗、禁词替换、格式规范时添加。',
          '正则 pattern 必须是 JavaScript 可用正则，避免过宽、灾难性回溯或破坏正常中文内容。',
          'You may call set_character_extensions to suggest world book notes, markdown fold render plugins, opening accessory skill defaults, status bar prompt, initial statusBarBlueprint variables/template, and built-in CSS/JS.',
          ...statusBarBlueprintInstructions,
          `Only modify these enabled sections: ${Object.entries(enabledSections).filter(([, value]) => value).map(([key]) => key).join(', ') || 'none'}.`,
          'If a section is not enabled, do not call tools for it and do not include it in arguments.',
          'Do not enable economyAgent, talentPrompt, or cgScene unless the user explicitly asks for economy, talents, CG, portraits, or scene art.',
          'Prefer statusBarAgent:auto only when the character has clear status variables; keep npcAgent off unless side-character memory is important.'
        ].join('\n')
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            requirement: String(requirement || '').trim(),
            currentCharacter: draft,
            enabledSections,
            optimizeExisting
          },
          null,
          2
        )
      }
    ],
    characterTools,
    (name, args) => executeCharacterTool(name, filterToolArgs(name, args, enabledSections), draft),
    { maxRounds: 100, thinkingEnabled: false, signal }
  );

  if (!result.toolCalls.length && result.content) {
    mergeProfile(draft, parseLooseJsonObject(result.content));
  }
  summary = result.content || summarizeDraft(result.toolCalls);

  return {
    character: normalizeDraft(draft),
    toolCalls: result.toolCalls.map((call) => ({
      name: call.name,
      arguments: call.arguments,
      result: call.result
    })),
    process: result.process || [],
    reasoning: collectReasoning(result.process),
    summary,
    usage: result.usage || null
  };
}

export async function streamCharacterDraft(settings, request = {}) {
  const { requirement = '', current = {}, user = {}, options: rawOptions = {}, signal, emit = () => {} } = nullToEmptyObject(request);
  const options = rawOptions ?? {};
  const draft = normalizeDraft(current);
  const userName = resolvePromptUserName(user);
  const enabledSections = normalizeGenerationOptions(options);
  const optimizeExisting = options.optimizeExisting === true || options.optimize_existing === true;

  const result = await streamToolCompletion(
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
          optimizeExisting
            ? '已开启“结合当前已填写内容优化”：currentCharacter 是用户现有表单，请在保留有效内容的基础上按用户消息优化，不要无故清空字段。'
            : '未开启“结合当前已填写内容优化”：主要依据用户消息生成；currentCharacter 里的空字段不是清空用户表单的指令。',
          '正则规则只在用户明确需要自动替换、口癖清洗、禁词替换、格式规范时添加。',
          '正则 pattern 必须是 JavaScript 可用正则，避免过宽、灾难性回溯或破坏正常中文内容。',
          'You may call set_character_extensions to suggest world book notes, markdown fold render plugins, opening accessory skill defaults, status bar prompt, initial statusBarBlueprint variables/template, and built-in CSS/JS.',
          ...statusBarBlueprintInstructions,
          `Only modify these enabled sections: ${Object.entries(enabledSections).filter(([, value]) => value).map(([key]) => key).join(', ') || 'none'}.`,
          'If a section is not enabled, do not call tools for it and do not include it in arguments.',
          'Do not enable economyAgent, talentPrompt, or cgScene unless the user explicitly asks for economy, talents, CG, portraits, or scene art.',
          'Prefer statusBarAgent:auto only when the character has clear status variables; keep npcAgent off unless side-character memory is important.'
        ].join('\n')
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            requirement: String(requirement || '').trim(),
            currentCharacter: draft,
            enabledSections,
            optimizeExisting
          },
          null,
          2
        )
      }
    ],
    characterTools,
    (name, args) => executeCharacterTool(name, filterToolArgs(name, args, enabledSections), draft),
    emit,
    signal,
    { maxRounds: 100, thinkingEnabled: false }
  );

  if (!result.toolCalls.length && result.content) {
    mergeProfile(draft, parseLooseJsonObject(result.content));
  }
  const summary = result.content || summarizeDraft(result.toolCalls);

  return {
    character: normalizeDraft(draft),
    toolCalls: result.toolCalls.map((call) => ({
      name: call.name,
      arguments: call.arguments,
      result: call.result
    })),
    process: result.process || [],
    reasoning: collectReasoning(result.process),
    summary,
    usage: result.usage || null
  };
}

function executeCharacterTool(name, args, draft) {
  const toolArgs = objectOrEmpty(args);
  if (name === 'set_character_profile') {
    const applied = mergeProfile(draft, toolArgs);
    return { ok: true, applied };
  }
  if (name === 'add_regex_rule') {
    const rule = normalizeRegexRule(toolArgs, draft.regexRules.length);
    if (rule.pattern) {
      draft.regexRules.push(rule);
    }
    return { ok: true, rule };
  }
  if (name === 'replace_regex_rules') {
    draft.regexRules = normalizeRegexRuleList(toolArgs.rules);
    return { ok: true, count: draft.regexRules.length };
  }
  if (name === 'set_character_extensions') {
    const applied = mergeExtensions(draft, toolArgs);
    return { ok: true, applied };
  }
  return { ok: false, error: `未知工具：${name}` };
}

function mergeProfile(draft, args = {}) {
  args = objectOrEmpty(args);
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
    draft.regexRules = normalizeRegexRuleList(args.regexRules);
    applied.regexRules = draft.regexRules;
  }
  Object.assign(applied, mergeExtensions(draft, args));
  return applied;
}

function mergeExtensions(draft, args = {}) {
  args = objectOrEmpty(args);
  const applied = {};
  if (Array.isArray(args.renderPlugins)) {
    draft.renderPlugins = normalizeRenderPluginList(args.renderPlugins, 12);
    applied.renderPlugins = draft.renderPlugins;
  }
  const accessorySkills = args.accessorySkills || args.accessory_skills;
  const hasAdvancedField = [
    'statusBarPrompt',
    'desktopBackgroundUrl',
    'mobileBackgroundUrl',
    'customCss',
    'customJs',
    'statusBarBlueprint'
  ].some((key) => Object.prototype.hasOwnProperty.call(args, key));
  if (accessorySkills || hasAdvancedField) {
    draft.authorAdvancedSettings = normalizeAdvancedSettings({
      ...(draft.authorAdvancedSettings || {}),
      statusBarPrompt: args.statusBarPrompt ?? draft.authorAdvancedSettings?.statusBarPrompt,
      statusBarBlueprint: args.statusBarBlueprint ?? draft.authorAdvancedSettings?.statusBarBlueprint,
      desktopBackgroundUrl: args.desktopBackgroundUrl ?? draft.authorAdvancedSettings?.desktopBackgroundUrl,
      mobileBackgroundUrl: args.mobileBackgroundUrl ?? draft.authorAdvancedSettings?.mobileBackgroundUrl,
      customCss: args.customCss ?? draft.authorAdvancedSettings?.customCss,
      customJs: args.customJs ?? draft.authorAdvancedSettings?.customJs,
      accessorySkills: normalizeAccessorySkills(accessorySkills || draft.authorAdvancedSettings?.accessorySkills)
    });
    applied.authorAdvancedSettings = draft.authorAdvancedSettings;
  }
  if (Object.prototype.hasOwnProperty.call(args, 'worldBookSuggestion')) {
    draft.worldBookSuggestion = limitText(args.worldBookSuggestion, 'worldBookSuggestion');
    applied.worldBookSuggestion = draft.worldBookSuggestion;
  }
  if (Array.isArray(args.modSuggestions)) {
    draft.modSuggestions = normalizeModSuggestionList(args.modSuggestions, 8);
    applied.modSuggestions = draft.modSuggestions;
  }
  return applied;
}

function normalizeDraft(value = {}) {
  value = objectOrEmpty(value);
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
    regexRules: normalizeRegexRuleList(value.regexRules),
    renderPlugins: normalizeRenderPluginList(value.renderPlugins),
    authorAdvancedSettings: normalizeAdvancedSettings(value.authorAdvancedSettings || value.advancedSettings || {}),
    worldBookSuggestion: limitText(value.worldBookSuggestion, 'worldBookSuggestion'),
    modSuggestions: normalizeModSuggestionList(value.modSuggestions)
  };
}

function normalizeGenerationOptions(options = {}) {
  const defaults = {
    profile: true,
    background: true,
    worldview: true,
    persona: true,
    openingMessage: true,
    tags: true,
    regexRules: true,
    renderPlugins: true,
    worldBookSuggestion: true,
    advancedSettings: true,
    modSuggestions: true
  };
  const normalized = {};
  for (const key in defaults) {
    if (!Object.prototype.hasOwnProperty.call(defaults, key)) continue;
    const fallback = defaults[key];
    normalized[key] = options[key] === undefined ? fallback : Boolean(options[key]);
  }
  return normalized;
}

function filterToolArgs(name, args = {}, enabled = {}) {
  const toolArgs = objectOrEmpty(args);
  if (name === 'set_character_profile') {
    const allowed = {};
    for (const key of ['name', 'gender', 'age', 'visibility']) {
      if (enabled.profile && Object.prototype.hasOwnProperty.call(toolArgs, key)) allowed[key] = toolArgs[key];
    }
    for (const key of ['background', 'worldview', 'persona', 'openingMessage']) {
      if (enabled[key] && Object.prototype.hasOwnProperty.call(toolArgs, key)) allowed[key] = toolArgs[key];
    }
    if (enabled.tags && Array.isArray(toolArgs.tags)) allowed.tags = toolArgs.tags;
    return allowed;
  }
  if (name === 'add_regex_rule' || name === 'replace_regex_rules') {
    return enabled.regexRules ? toolArgs : {};
  }
  if (name === 'set_character_extensions') {
    const allowed = {};
    if (enabled.worldBookSuggestion && Object.prototype.hasOwnProperty.call(toolArgs, 'worldBookSuggestion')) {
      allowed.worldBookSuggestion = toolArgs.worldBookSuggestion;
    }
    if (enabled.renderPlugins && Array.isArray(toolArgs.renderPlugins)) {
      allowed.renderPlugins = toolArgs.renderPlugins;
    }
    if (enabled.advancedSettings) {
      if (Object.prototype.hasOwnProperty.call(toolArgs, 'statusBarPrompt')) allowed.statusBarPrompt = toolArgs.statusBarPrompt;
      if (Object.prototype.hasOwnProperty.call(toolArgs, 'desktopBackgroundUrl')) allowed.desktopBackgroundUrl = toolArgs.desktopBackgroundUrl;
      if (Object.prototype.hasOwnProperty.call(toolArgs, 'mobileBackgroundUrl')) allowed.mobileBackgroundUrl = toolArgs.mobileBackgroundUrl;
      if (Object.prototype.hasOwnProperty.call(toolArgs, 'customCss')) allowed.customCss = toolArgs.customCss;
      if (Object.prototype.hasOwnProperty.call(toolArgs, 'customJs')) allowed.customJs = toolArgs.customJs;
      if (Object.prototype.hasOwnProperty.call(toolArgs, 'statusBarBlueprint')) allowed.statusBarBlueprint = toolArgs.statusBarBlueprint;
      if (Object.prototype.hasOwnProperty.call(toolArgs, 'accessorySkills')) allowed.accessorySkills = toolArgs.accessorySkills;
    }
    if (enabled.modSuggestions && Array.isArray(toolArgs.modSuggestions)) {
      allowed.modSuggestions = toolArgs.modSuggestions;
    }
    return allowed;
  }
  return toolArgs;
}

function normalizeModSuggestion(mod = {}, index = 0) {
  mod = objectOrEmpty(mod);
  const type = normalizeModType(mod.type);
  return {
    name: String(mod.name || `AI Mod ${index + 1}`).trim().slice(0, 80),
    description: String(mod.description || '').trim().slice(0, 500),
    type,
    content: String(mod.content || '').trim().slice(0, 6000),
    enabled: mod.enabled !== false
  };
}

function normalizeModType(type) {
  if (['prompt_inject', 'style_enhance', 'custom'].includes(type)) {
    return type;
  }
  if (type === 'style') return 'style_enhance';
  if (['system', 'behavior', 'utility'].includes(type)) return 'prompt_inject';
  return 'prompt_inject';
}

function normalizeTags(tags = []) {
  const normalized = [];
  const sourceTags = Array.isArray(tags) ? tags : [];
  for (const tag of sourceTags) {
    const value = String(tag || '').trim();
    if (!value) {
      continue;
    }
    normalized.push(value);
    if (normalized.length >= 8) {
      break;
    }
  }
  return normalized;
}

function normalizeRegexRule(rule = {}, index = 0) {
  rule = objectOrEmpty(rule);
  const flags = normalizeRegexFlags(rule.flags);
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

function normalizeRegexRuleList(rules = []) {
  const normalized = [];
  const sourceRules = Array.isArray(rules) ? rules : [];
  for (let index = 0; index < sourceRules.length; index += 1) {
    const rule = normalizeRegexRule(sourceRules[index], index);
    if (!rule.pattern) {
      continue;
    }
    normalized.push(rule);
  }
  return normalized;
}

function normalizeRenderPlugin(plugin = {}, index = 0) {
  plugin = objectOrEmpty(plugin);
  const flags = normalizeRegexFlags(plugin.flags || 'u').replace(/g/g, '') || 'u';
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

function normalizeRenderPluginList(plugins = [], limit = Infinity) {
  const normalized = [];
  const sourcePlugins = Array.isArray(plugins) ? plugins : [];
  for (let index = 0; index < sourcePlugins.length; index += 1) {
    const plugin = normalizeRenderPlugin(sourcePlugins[index], index);
    if (!plugin.pattern) {
      continue;
    }
    normalized.push(plugin);
    if (normalized.length >= limit) {
      break;
    }
  }
  return normalized;
}

function normalizeModSuggestionList(mods = [], limit = Infinity) {
  const normalized = [];
  const sourceMods = Array.isArray(mods) ? mods : [];
  for (let index = 0; index < sourceMods.length; index += 1) {
    const mod = normalizeModSuggestion(sourceMods[index], index);
    if (!mod.name || !mod.content) {
      continue;
    }
    normalized.push(mod);
    if (normalized.length >= limit) {
      break;
    }
  }
  return normalized;
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

function summarizeDraft(toolCalls = []) {
  if (!toolCalls.length) {
    return '';
  }
  return `已调用 ${toolCalls.length} 次工具完善角色设定。`;
}

function collectReasoning(process = []) {
  return process
    .map((step) => String(step.reasoning || '').trim())
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 8000);
}
