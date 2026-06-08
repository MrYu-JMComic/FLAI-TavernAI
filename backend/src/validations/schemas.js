/**
 * 输入验证 Schema（基于 Zod）
 * 为关键 API 端点定义请求体验证规则
 */

import { z } from 'zod';

const STATUS_BLUEPRINT_VARIABLE_LIMIT = 60;
const BACKGROUND_IMAGE_INPUT_MAX_LENGTH = 6_000_000;
const BOOLEAN_STRING_VALUES = new Set(['true', 'false', '1', '0']);
const MOD_CHARACTER_BINDING_LIMIT = 100;

const booleanLikeSchema = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (!BOOLEAN_STRING_VALUES.has(normalized)) {
    return value;
  }

  return normalized === 'true' || normalized === '1';
}, z.boolean());

const accessorySkillConfigSchema = z.object({
  enabled: z.union([z.boolean(), z.literal('auto')]).optional(),
  modelOverride: z.string().max(100).trim().optional().default('')
}).passthrough();

const accessorySkillsSchema = z.object({
  npcAgent: accessorySkillConfigSchema.optional(),
  statusBarAgent: accessorySkillConfigSchema.optional(),
  economyAgent: accessorySkillConfigSchema.optional(),
  talentPrompt: accessorySkillConfigSchema.optional(),
  cgScene: accessorySkillConfigSchema.optional()
}).partial().optional().default({});

const statusBarBlueprintVariableSchema = z.object({
  name: z.string().max(40).trim().optional().default(''),
  value: z.union([z.number(), z.string().max(200).trim()]).optional().default(0),
  max: z.number().optional().default(100),
  color: z.string().max(30).trim().optional().default('')
}).passthrough();

const statusBarBlueprintSchema = z.object({
  name: z.string().max(50).trim().optional().default(''),
  variables: z.array(statusBarBlueprintVariableSchema).max(STATUS_BLUEPRINT_VARIABLE_LIMIT).optional().default([]),
  template: z.string().max(50000).trim().optional().default('')
}).partial().optional().default({});

const advancedSettingsSchema = z.object({
  desktopBackgroundUrl: z.string().max(BACKGROUND_IMAGE_INPUT_MAX_LENGTH).trim().optional().default(''),
  mobileBackgroundUrl: z.string().max(BACKGROUND_IMAGE_INPUT_MAX_LENGTH).trim().optional().default(''),
  customCss: z.string().max(50000).trim().optional().default(''),
  customJs: z.string().max(50000).trim().optional().default(''),
  statusBarPrompt: z.string().max(50000).trim().optional().default(''),
  statusBarBlueprint: statusBarBlueprintSchema,
  accessorySkills: accessorySkillsSchema
}).partial().optional().default({});

// ── 通用验证规则 ──

const nonEmptyString = z.string().min(1, '不能为空').trim();
const optionalString = z.string().optional().default('');
const nullableOptionalString = z.string().nullable().optional();

// ── 认证相关 ──

export const registerSchema = z.object({
  username: z.string()
    .min(3, '用户名至少 3 位')
    .max(32, '用户名最多 32 位')
    .regex(/^[\w\u4e00-\u9fa5.\-]+$/, '用户名可包含中文、字母、数字、下划线、点和横线')
    .trim(),
  password: z.string()
    .min(6, '密码至少 6 位')
    .max(128, '密码最多 128 位')
});

export const loginSchema = registerSchema;

export const updateProfileSchema = z.object({
  displayName: z.string()
    .max(8, '显示名最多 8 位')
    .regex(/^[\p{L}\p{N}_\-]*$/u, '仅支持中文、字母、数字、下划线和短横线')
    .trim()
    .optional()
    .default('')
});

// ── 角色相关 ──

export const createCharacterSchema = z.object({
  name: z.string().min(1, '角色名不能为空').max(50, '角色名最多 50 字').trim(),
  avatarUrl: z.string().optional().default(''),
  gender: z.string().max(20).trim().optional().default(''),
  age: z.string().max(20).trim().optional().default(''),
  background: z.string().max(10000, '背景最多 10000 字').optional().default(''),
  worldview: z.string().max(10000, '世界观最多 10000 字').optional().default(''),
  persona: z.string().max(10000, '人设最多 10000 字').optional().default(''),
  openingMessage: z.string().max(5000, '开场白最多 5000 字').optional().default(''),
  visibility: z.enum(['public', 'private']).optional().default('private'),
  tags: z.array(z.string().max(30)).max(20).optional().default([]),
  renderPlugins: z.array(z.any()).max(20).optional().default([]),
  regexRules: z.array(z.any()).max(50).optional().default([]),
  authorAdvancedSettings: advancedSettingsSchema,
  worldBookId: nullableOptionalString
});

export const updateCharacterSchema = createCharacterSchema.partial();

export const importCharacterSchema = z.object({
  _flai_export_version: z.number().optional(),
  character: z.object({
    name: z.string().min(1).max(50).trim(),
    gender: z.string().max(20).optional().default(''),
    age: z.string().max(20).optional().default(''),
    background: z.string().max(10000).optional().default(''),
    worldview: z.string().max(10000).optional().default(''),
    persona: z.string().max(10000).optional().default(''),
    openingMessage: z.string().max(5000).optional().default(''),
    visibility: z.enum(['public', 'private']).optional().default('private'),
    renderPlugins: z.array(z.any()).optional().default([])
  }),
  regex_rules: z.array(z.any()).optional().default([]),
  tags: z.array(z.string()).optional().default([]),
  world_book: z.object({
    name: z.string(),
    description: z.string().optional().default(''),
    entries: z.array(z.any()).optional().default([])
  }).nullable().optional()
});

// ── 消息相关 ──

export const sendMessageSchema = z.object({
  content: z.string().min(1, '消息不能为空').max(32000, '消息最多 32000 字').trim(),
  message: z.string().max(32000).trim().optional(),
  stream: booleanLikeSchema.optional(),
  presetId: z.string().optional(),
  thinkingEnabled: booleanLikeSchema.optional()
});

export const updateMessageSchema = z.object({
  content: z.string().min(1, '消息内容不能为空').max(32000).trim()
});

// ── 世界书相关 ──

export const createWorldBookSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(80, '名称最多 80 字').trim(),
  description: z.string().max(2000).trim().optional().default(''),
  characterId: nullableOptionalString,
  scanDepth: z.number().int().min(1).max(50).optional().default(1),
  lorebookContextPercent: z.number().int().min(1).max(100).optional().default(25)
});

export const updateWorldBookSchema = createWorldBookSchema.partial();

export const createWorldBookEntrySchema = z.object({
  name: z.string().max(100).trim().optional().default(''),
  triggerKeys: z.string().max(2000).trim().optional().default(''),
  content: z.string().max(50000).trim().optional().default(''),
  position: z.enum(['before_char', 'after_char', 'at_start', 'at_depth']).optional().default('before_char'),
  enabled: z.boolean().optional().default(true),
  regexMode: z.boolean().optional().default(false),
  alwaysActive: z.boolean().optional().default(false),
  depth: z.number().int().min(0).max(10).optional().default(0),
  role: z.number().int().min(0).max(2).optional().default(0),
  sticky: z.number().int().min(0).max(9999).nullable().optional(),
  cooldown: z.number().int().min(0).max(9999).nullable().optional(),
  delay: z.number().int().min(0).max(9999).nullable().optional(),
  selective: z.boolean().optional().default(false),
  selectiveLogic: z.number().int().min(0).max(2).optional().default(0),
  keysSecondary: z.string().max(2000).trim().optional().default(''),
  probability: z.number().int().min(0).max(100).optional().default(100),
  useProbability: z.boolean().optional().default(false),
  group: z.string().max(100).trim().optional().default(''),
  groupWeight: z.number().int().min(0).optional().default(0),
  orderIndex: z.number().int().optional()
});

export const updateWorldBookEntrySchema = createWorldBookEntrySchema.partial();

// ── 预设相关 ──

export const createPresetSchema = z.object({
  name: z.string().max(100).trim().optional().default('未命名预设'),
  systemPrompt: z.string().max(50000).trim().optional().default(''),
  temperature: z.number().min(0).max(2).optional().default(1.0),
  maxTokens: z.number().int().min(1).max(128000).optional().default(4096),
  topP: z.number().min(0).max(1).optional().default(1.0),
  frequencyPenalty: z.number().min(-2).max(2).optional().default(0),
  presencePenalty: z.number().min(-2).max(2).optional().default(0),
  isDefault: z.boolean().optional().default(false)
});

export const updatePresetSchema = createPresetSchema.partial();

// ── Mod 相关 ──

export const createModSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(100).trim(),
  description: z.string().max(1000).trim().optional().default(''),
  type: z.enum(['prompt_inject', 'style_enhance', 'custom']).optional().default('prompt_inject'),
  content: z.string().max(50000).trim().optional().default(''),
  enabled: z.boolean().optional().default(true),
  scope: z.enum(['global', 'all_characters', 'characters']).optional(),
  characterIds: z.array(z.string().max(120).trim()).max(MOD_CHARACTER_BINDING_LIMIT).optional(),
  character_ids: z.array(z.string().max(120).trim()).max(MOD_CHARACTER_BINDING_LIMIT).optional()
});

export const updateModSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(100).trim().optional(),
  description: z.string().max(1000).trim().optional(),
  type: z.enum(['prompt_inject', 'style_enhance', 'custom']).optional(),
  content: z.string().max(50000).trim().optional(),
  enabled: z.boolean().optional(),
  scope: z.enum(['global', 'all_characters', 'characters']).optional(),
  characterIds: z.array(z.string().max(120).trim()).max(MOD_CHARACTER_BINDING_LIMIT).optional(),
  character_ids: z.array(z.string().max(120).trim()).max(MOD_CHARACTER_BINDING_LIMIT).optional()
});

// ── 标签相关 ──

export const createTagSchema = z.object({
  name: z.string().min(1, '标签名不能为空').max(30, '标签名最多 30 字').trim(),
  color: z.string().max(20).trim().optional().default('')
});

// ── Provider 设置 ──

export const saveProviderSchema = z.object({
  providerType: z.enum(['deepseek', 'openai', 'gemini', 'anthropic', 'xai', 'mistral', 'qwen', 'glm', 'kimi', 'custom']).optional(),
  gatewayName: z.string().max(50).trim().optional().default(''),
  baseUrl: z.string().url().max(500).trim().optional().or(z.literal('')),
  model: z.string().max(100).trim().optional().default(''),
  apiKey: z.string().max(500).optional(),
  clearApiKey: z.boolean().optional().default(false),
  supportsReasoning: z.boolean().optional(),
  extraBody: z.union([z.record(z.any()), z.string().max(50000)]).optional()
});

// ── 状态栏相关 ──

export const saveStatusBarSchema = z.object({
  name: z.string().max(50).trim().optional().default('状态栏'),
  variables: z.array(z.object({
    name: z.string().min(1).max(40).trim(),
    value: z.union([z.number(), z.string().max(200).trim()]),
    max: z.number().optional(),
    color: z.string().max(20).trim().optional().default('')
  })).max(20).optional().default([]),
  template: z.string().max(50000).trim().optional().default('')
});

// ── 对话设置 ──

export const saveConversationSettingsSchema = z.object({
  desktopBackgroundUrl: z.string().max(BACKGROUND_IMAGE_INPUT_MAX_LENGTH).trim().optional().default(''),
  mobileBackgroundUrl: z.string().max(BACKGROUND_IMAGE_INPUT_MAX_LENGTH).trim().optional().default(''),
  customCss: z.string().max(50000).trim().optional().default(''),
  customJs: z.string().max(50000).trim().optional().default(''),
  statusBarPrompt: z.string().max(50000).trim().optional().default(''),
  chatLorebookId: z.string().max(200).trim().nullable().optional(),
  accessorySkills: accessorySkillsSchema
});

// ── 会话相关 ──

export const createConversationSchema = z.object({
  characterId: z.string().min(1, '角色 ID 不能为空')
});

export const bulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, '请选择要删除的会话').max(100)
});

// ── 经济系统 ──

export const economyTransactionSchema = z.object({
  amount: z.number().finite(),
  type: z.string().max(50).trim(),
  description: z.string().max(500).trim().optional().default(''),
  currencyType: z.string().max(50).trim().optional().default('gold'),
  relatedNpc: z.string().max(100).trim().optional().default('')
});

// ── 天赋相关 ──

export const createTalentPoolSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(80).trim(),
  description: z.string().max(2000).trim().optional().default(''),
  talents: z.array(z.object({
    name: z.string().min(1).max(50).trim(),
    description: z.string().max(500).trim().optional().default(''),
    rarity: z.enum(['common', 'rare', 'epic', 'legendary']).optional().default('common'),
    effect: z.string().max(500).trim().optional().default('')
  })).max(200).optional().default([])
});

export const updateTalentPoolSchema = createTalentPoolSchema.partial();

// ── NPC 相关 ──

export const addNpcMemorySchema = z.object({
  memoryType: z.enum(['event', 'preference', 'relationship', 'custom']).optional().default('event'),
  content: z.string().min(1).max(5000).trim()
});

export const addNpcBehaviorSchema = z.object({
  behaviorType: z.enum(['reaction', 'routine', 'dialogue', 'custom']).optional().default('reaction'),
  triggerCondition: z.string().max(2000).trim().optional().default(''),
  action: z.string().max(5000).trim().optional().default(''),
  priority: z.number().int().min(0).max(100).optional().default(0),
  enabled: z.boolean().optional().default(true)
});

export const updateNpcBehaviorSchema = addNpcBehaviorSchema.partial();

export const updateNpcSchema = z.object({
  status: z.enum(['active', 'left', 'permanently_left', 'dead', 'on_mission', 'following', 'custom']).optional(),
  customStatus: z.string().max(80).trim().optional(),
  aliases: z.array(z.string().max(80).trim()).max(20).optional(),
  aliasesText: z.string().max(1000).trim().optional(),
  memorySealed: booleanLikeSchema.optional()
});

// ── 存档相关 ──

export const createSaveSchema = z.object({
  name: z.string().max(100).trim().optional().default('')
});

export const renameSaveSchema = z.object({
  name: z.string().max(100).trim(),
  conversationId: z.string().trim().min(1)
});

// ── 验证中间件工厂 ──

/**
 * 创建 Express 中间件，使用 Zod schema 校验请求体
 * @param {z.ZodSchema} schema - Zod schema
 * @param {'body' | 'query' | 'params'} source - 数据来源
 */
export function validate(schema, source = 'body') {
  return (request, response, next) => {
    const result = schema.safeParse(request[source]);
    if (!result.success) {
      const errors = result.error.issues.map(issue => {
        const path = issue.path.join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
      });
      response.status(400).json({ error: errors.join('; ') });
      return;
    }
    request[source] = result.data;
    next();
  };
}
