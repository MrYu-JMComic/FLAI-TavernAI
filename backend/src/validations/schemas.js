/**
 * 输入验证 Schema（基于 Zod）
 * 为关键 API 端点定义请求体验证规则
 */

import { z } from 'zod';
import { THINKING_LEVELS } from '../../../shared/providerThinking.js';
import { CHARACTER_CONTENT_LIMITS } from '../domain/characters/limits.js';

const STATUS_BLUEPRINT_VARIABLE_LIMIT = 60;
const BACKGROUND_IMAGE_INPUT_MAX_LENGTH = 6_000_000;
const CHAT_IMAGE_INPUT_MAX_LENGTH = 6_000_000;
const ASSET_IMAGE_INPUT_MAX_LENGTH = 8_500_000;
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
const thinkingLevelSchema = z.enum(THINKING_LEVELS);

const accessorySkillConfigSchema = z.object({
  enabled: z.union([z.boolean(), z.literal('auto')]).optional(),
  modelOverride: z.string().max(100).trim().optional().default('')
}).passthrough();

const accessorySkillsSchema = z.object({
  sceneAgent: accessorySkillConfigSchema.optional(),
  statusBarAgent: accessorySkillConfigSchema.optional(),
  economyAgent: accessorySkillConfigSchema.optional(),
  talentPrompt: accessorySkillConfigSchema.optional(),
  cgScene: accessorySkillConfigSchema.optional()
}).partial().optional().default({});

const castTrackingSchema = z.object({
  enabled: booleanLikeSchema.optional().default(false),
}).strict().optional().default({ enabled: false });

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
  customCssEnabled: booleanLikeSchema.optional().default(false),
  customCssRiskAccepted: booleanLikeSchema.optional().default(false),
  customJs: z.string().max(50000).trim().optional().default(''),
  customJsEnabled: booleanLikeSchema.optional().default(false),
  customJsRiskAccepted: booleanLikeSchema.optional().default(false),
  statusBarPrompt: z.string().max(50000).trim().optional().default(''),
  showWorldBookMatches: booleanLikeSchema.optional().default(true),
  castTracking: castTrackingSchema,
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
  background: z.string().max(CHARACTER_CONTENT_LIMITS.background, '背景最多 10000 字').optional().default(''),
  worldview: z.string().max(CHARACTER_CONTENT_LIMITS.worldview, '世界观最多 10000 字').optional().default(''),
  persona: z.string().max(CHARACTER_CONTENT_LIMITS.persona, '人设最多 10000 字').optional().default(''),
  openingMessage: z.string().max(CHARACTER_CONTENT_LIMITS.openingMessage, '开场白最多 5000 字').optional().default(''),
  visibility: z.enum(['public', 'private']).optional().default('private'),
  tags: z.array(z.string().max(30)).max(20).optional().default([]),
  renderPlugins: z.array(z.any()).max(20).optional().default([]),
  regexRules: z.array(z.any()).max(50).optional().default([]),
  authorAdvancedSettings: advancedSettingsSchema,
  worldBookId: nullableOptionalString
});

export const updateCharacterSchema = createCharacterSchema.partial();

// ── 消息相关 ──

const chatImageAttachmentSchema = z.object({
  type: z.literal('image').optional().default('image'),
  dataUrl: z.string().max(CHAT_IMAGE_INPUT_MAX_LENGTH).trim().optional().default(''),
  url: z.string().max(CHAT_IMAGE_INPUT_MAX_LENGTH).trim().optional().default(''),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']).optional(),
  name: z.string().max(120).trim().optional().default(''),
  alt: z.string().max(200).trim().optional().default(''),
  size: z.number().int().min(0).max(4 * 1024 * 1024).optional().default(0)
}).passthrough();

export const sendMessageSchema = z.object({
  content: z.string().max(32000, '消息最多 32000 字').trim().optional().default(''),
  message: z.string().max(32000).trim().optional(),
  attachments: z.array(chatImageAttachmentSchema).max(4).optional().default([]),
  stream: booleanLikeSchema.optional(),
  imageGeneration: booleanLikeSchema.optional(),
  presetId: z.string().optional(),
  thinkingEnabled: booleanLikeSchema.optional(),
  thinkingLevel: thinkingLevelSchema.optional()
});

export const continueMessageSchema = z.object({
  stream: booleanLikeSchema.optional(),
  presetId: z.string().optional(),
  thinkingEnabled: booleanLikeSchema.optional(),
  thinkingLevel: thinkingLevelSchema.optional()
});

export const updateMessageSchema = z.object({
  content: z.string().min(1, '消息内容不能为空').max(32000).trim()
});

export const createSwipeSchema = z.object({
  content: z.string().min(1, 'content is required').max(64000, '候选内容过长'),
  reasoning: z.string().max(64000).optional().default(''),
  usage: z.record(z.any()).nullable().optional().default(null)
});

export const setActiveSwipeSchema = z.object({
  swipeId: z.string().min(1, 'swipeId is required').max(160)
});

export const createAssetSchema = z.object({
  dataUrl: z.string().max(ASSET_IMAGE_INPUT_MAX_LENGTH).trim().optional().default(''),
  url: z.string().max(ASSET_IMAGE_INPUT_MAX_LENGTH).trim().optional().default(''),
  ownerType: z.string().max(80).trim().optional().default(''),
  ownerId: z.string().max(160).trim().optional().default(''),
  kind: z.string().max(60).trim().optional().default('generic'),
  name: z.string().max(160).trim().optional().default(''),
  alt: z.string().max(240).trim().optional().default(''),
  metadata: z.record(z.any()).optional().default({})
}).refine((value) => value.dataUrl || value.url, {
  path: ['dataUrl'],
  message: '资产数据不能为空'
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
  allowPrivateNetwork: z.boolean().optional().default(false),
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
  customCssEnabled: booleanLikeSchema.optional().default(false),
  customCssRiskAccepted: booleanLikeSchema.optional().default(false),
  customJs: z.string().max(50000).trim().optional().default(''),
  customJsEnabled: booleanLikeSchema.optional().default(false),
  customJsRiskAccepted: booleanLikeSchema.optional().default(false),
  statusBarPrompt: z.string().max(50000).trim().optional().default(''),
  showWorldBookMatches: booleanLikeSchema.optional().default(true),
  castTracking: castTrackingSchema,
  chatLorebookId: z.string().max(200).trim().nullable().optional(),
  accessorySkills: accessorySkillsSchema
});

// ── 会话相关 ──

export const createConversationSchema = z.object({
  characterId: z.string().min(1, '角色 ID 不能为空')
});

const cursorSchema = z.string().max(2048).trim().optional();
const cursorLimitSchema = z.coerce.number().int().min(1).max(200).optional();

export const characterListQuerySchema = z.object({
  search: z.string().max(500).trim().optional(),
  sort: z.enum(['created', 'used', 'name']).optional(),
  tag: z.string().max(120).trim().optional(),
  pagination: z.enum(['cursor']).optional(),
  limit: cursorLimitSchema,
  cursor: cursorSchema
});

export const conversationListQuerySchema = z.object({
  characterId: z.string().max(120).trim().optional(),
  pagination: z.enum(['cursor']).optional(),
  limit: cursorLimitSchema,
  cursor: cursorSchema
});

export const messageListQuerySchema = z.object({
  limit: cursorLimitSchema,
  cursor: cursorSchema
});

export const economyHistoryQuerySchema = z.object({
  currencyType: z.enum(['gold', 'silver', 'copper', 'gem', 'credit']).optional(),
  pagination: z.enum(['cursor']).optional(),
  limit: cursorLimitSchema,
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
  cursor: cursorSchema
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

export const sceneNodeSchema = z.object({
  id: z.string().max(100).trim().optional(),
  parentId: z.string().max(100).trim().optional().default(''),
  parentName: z.string().max(160).trim().optional().default(''),
  nodeType: z.enum(['main_scene', 'map', 'building', 'room', 'area']).optional().default('room'),
  name: z.string().min(1).max(160).trim(),
  description: z.string().max(10000).trim().optional().default(''),
  layout: z.record(z.any()).optional().default({}),
  tags: z.array(z.string().max(60).trim()).max(50).optional().default([]),
  permanent: z.boolean().optional().default(true)
});

export const sceneRouteSchema = z.object({
  id: z.string().max(100).trim().optional(),
  fromNodeId: z.string().min(1).max(100).trim(),
  toNodeId: z.string().min(1).max(100).trim(),
  label: z.string().max(160).trim().optional().default(''),
  description: z.string().max(2000).trim().optional().default(''),
  bidirectional: z.boolean().optional().default(true)
});

export const sceneOrganizerSchema = z.object({
  requirement: z.string().max(4000).trim().optional().default(''),
  modelOverride: z.string().max(120).trim().optional().default(''),
  stream: z.boolean().optional().default(false)
});

export const sceneItemSchema = z.object({
  id: z.string().max(160).trim().optional(),
  nodeId: z.string().min(1).max(160).trim(),
  itemCode: z.string().max(120).trim().optional(),
  name: z.string().min(1).max(500).trim(),
  description: z.string().max(8000).trim().optional().default(''),
  state: z.record(z.any()).optional().default({}),
  position: z.record(z.any()).optional().default({}),
  movable: z.boolean().optional().default(true),
  itemKind: z.string().max(80).trim().optional().default('item'),
  quantity: z.number().int().min(0).max(1_000_000).optional().default(1),
  clothingSlot: z.string().max(80).trim().optional().default(''),
  coverage: z.array(z.string().max(120).trim()).max(32).optional().default([]),
  iconKey: z.string().max(120).trim().optional().default(''),
  revision: z.number().int().min(1).max(2_147_483_647).optional(),
});

const castIdSchema = z.string().trim().min(1).max(160);
const castRevisionSchema = z.number().int().min(1).max(2_147_483_647);
const castUnitNumberSchema = z.number().finite().min(0).max(1);

export const castMemberCreateSchema = z.object({
  canonicalName: z.string().trim().min(1).max(120),
  aliases: z.array(z.string().trim().min(1).max(120)).max(24).optional(),
  status: z.string().max(80).optional(),
  customStatus: z.string().max(500).optional(),
  relationship: z.string().max(1000).optional(),
  currentLocationLabel: z.string().max(500).optional(),
  currentSceneNodeId: castIdSchema.nullable().optional(),
  memorySealed: z.boolean().optional(),
  visibility: z.enum(['visible', 'hidden']).optional(),
}).strict();

export const castMemberUpdateSchema = castMemberCreateSchema.partial().extend({
  confidence: castUnitNumberSchema.optional(),
  revision: castRevisionSchema,
}).strict().refine(
  (value) => Object.keys(value).some((key) => key !== 'revision'),
  { message: '人物更新必须包含至少一个变更字段' }
);

export const castMemoryCreateSchema = z.object({
  memoryType: z.string().max(80).optional(),
  content: z.string().trim().min(1).max(20_000),
  layer: z.string().max(80).optional(),
  importance: castUnitNumberSchema.optional(),
  emotionalIntensity: castUnitNumberSchema.optional(),
  decayRate: castUnitNumberSchema.optional(),
  lastReinforcedAt: z.string().max(80).nullable().optional(),
  reinforcementCount: z.number().int().min(0).max(1_000_000).optional(),
  forgottenAt: z.string().max(80).nullable().optional(),
  linkedMemoryIds: z.array(castIdSchema).max(32).optional(),
  sharedMemberIds: z.array(castIdSchema).max(32).optional(),
}).strict();

export const castMemoryUpdateSchema = castMemoryCreateSchema.partial().extend({
  revision: castRevisionSchema,
}).strict().refine(
  (value) => Object.keys(value).some((key) => key !== 'revision'),
  { message: '记忆更新必须包含至少一个变更字段' }
);

export const castBehaviorCreateSchema = z.object({
  behaviorType: z.string().max(80).optional(),
  triggerCondition: z.string().max(2_000).optional(),
  action: z.string().trim().min(1).max(4_000),
  priority: z.number().int().min(-1_000).max(1_000).optional(),
  enabled: z.boolean().optional(),
}).strict();

export const castBehaviorUpdateSchema = castBehaviorCreateSchema.partial().extend({
  revision: castRevisionSchema,
}).strict().refine(
  (value) => Object.keys(value).some((key) => key !== 'revision'),
  { message: '行为更新必须包含至少一个变更字段' }
);

export const castItemCreateSchema = z.object({
  itemCode: z.string().max(120).optional(),
  name: z.string().trim().min(1).max(500),
  description: z.string().max(8_000).optional(),
  state: z.record(z.string(), z.unknown()).optional(),
  position: z.record(z.string(), z.unknown()).optional(),
  movable: z.boolean().optional(),
  itemKind: z.string().max(80).optional(),
  quantity: z.number().int().min(0).max(1_000_000).optional(),
  clothingSlot: z.string().max(80).optional(),
  equipped: z.boolean().optional(),
  coverage: z.array(z.string().max(120)).max(32).optional(),
  iconKey: z.string().max(120).optional(),
}).strict();

export const castItemUpdateSchema = castItemCreateSchema.partial().extend({
  revision: castRevisionSchema,
}).strict().refine(
  (value) => Object.keys(value).some((key) => key !== 'revision'),
  { message: '物品更新必须包含至少一个变更字段' }
);

export const castItemTransferSchema = z.object({
  memberId: castIdSchema.optional(),
  nodeId: castIdSchema.optional(),
  revision: castRevisionSchema,
}).strict().refine((value) => Boolean(value.memberId) !== Boolean(value.nodeId), {
  message: 'memberId 与 nodeId 必须且只能提供一个',
});

export const castAppearanceUpdateSchema = z.object({
  summary: z.string().max(8_000).optional(),
  outfit: z.string().max(4_000).optional(),
  injuries: z.array(z.unknown()).max(64).optional(),
  transformations: z.array(z.unknown()).max(64).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  revision: castRevisionSchema.optional(),
}).strict().refine(
  (value) => Object.keys(value).some((key) => key !== 'revision'),
  { message: '外貌更新必须包含至少一个变更字段' }
);

export const castRevisionBodySchema = z.object({
  revision: castRevisionSchema,
}).strict();

export const castCleanupSchema = z.object({}).strict();

export const castOrganizerSchema = z.object({
  scope: z.enum(['member', 'conversation']).default('member'),
  memberId: castIdSchema.optional(),
  requirement: z.string().max(2_000).optional().default(''),
}).strict().refine(
  (value) => value.scope === 'conversation' ? !value.memberId : Boolean(value.memberId),
  { message: '单人物整理必须提供 memberId，全对话整理不能提供 memberId' }
);

const castQueryIntegerSchema = (minimum, maximum) => z.string()
  .regex(/^\d+$/, '必须为非负整数')
  .transform(Number)
  .pipe(z.number().int().min(minimum).max(maximum));

const castQueryBooleanSchema = z.enum(['true', 'false']).transform((value) => value === 'true');

export const castRosterQuerySchema = z.object({
  includeHidden: castQueryBooleanSchema.optional(),
}).strict();

export const castMemoryListQuerySchema = z.object({
  limit: castQueryIntegerSchema(1, 200).optional(),
  offset: castQueryIntegerSchema(0, 100_000).optional(),
  includeForgotten: castQueryBooleanSchema.optional(),
}).strict();

export const castItemListQuerySchema = z.object({
  limit: castQueryIntegerSchema(1, 300).optional(),
  offset: castQueryIntegerSchema(0, 100_000).optional(),
}).strict();

export const castAuditListQuerySchema = z.object({
  limit: castQueryIntegerSchema(1, 100).optional(),
  beforeCreatedAt: z.string().datetime({ offset: true }).max(80).optional(),
  beforeId: castIdSchema.optional(),
}).strict().refine(
  (value) => Boolean(value.beforeCreatedAt) === Boolean(value.beforeId),
  { message: '审计游标必须同时提供 beforeCreatedAt 与 beforeId' }
);

// ── 存档相关 ──

export const createSaveSchema = z.object({
  name: z.string().max(100).trim().optional().default('')
});

export const renameSaveSchema = z.object({
  name: z.string().max(100).trim(),
  conversationId: z.string().trim().min(1)
});

// ── AI 虚拟小镇 ──

export const createTownSchema = z.object({
  name: z.string().min(1, '小镇名称不能为空').max(120).trim(),
  description: z.string().max(2000).trim().optional().default(''),
  creationPrompt: z.string().max(20000).trim().optional().default(''),
  mapConfig: z.record(z.string(), z.any()).optional().default({}),
  simulationStatus: z.enum(['paused', 'running']).optional().default('paused'),
  currentDay: z.number().int().min(1).max(1000000).optional().default(1),
  minuteOfDay: z.number().int().min(0).max(1439).optional().default(480),
  settings: z.record(z.string(), z.any()).optional().default({})
});

export const generateTownSchema = z.object({
  prompt: z.string().min(1, '请输入你的世界构想').max(20000).trim(),
  simulationStatus: z.enum(['paused', 'running']).optional().default('paused')
});

export const updateTownClockSchema = z.object({
  currentDay: z.number().int().min(1).max(1000000).optional(),
  minuteOfDay: z.number().int().min(0).max(1439).optional(),
  simulationStatus: z.enum(['paused', 'running']).optional()
}).refine((value) => Object.keys(value).length > 0, '至少提供一个时钟字段');

export const advanceTownSchema = z.object({
  steps: z.number().int().min(1).max(12).optional().default(1)
});

export const createTownResidentSchema = z.object({
  name: z.string().min(1, '居民姓名不能为空').max(120).trim(),
  role: z.string().max(160).trim().optional().default(''),
  profile: z.record(z.string(), z.any()).optional().default({}),
  state: z.record(z.string(), z.any()).optional().default({}),
  currentLocation: z.string().max(200).trim().optional().default(''),
  reflectionThreshold: z.number().min(1).max(100).optional().default(15)
});

export const createTownEventSchema = z.object({
  residentId: z.string().max(160).trim().optional().default(''),
  eventType: z.string().max(80).trim().optional().default('world.changed'),
  source: z.string().max(40).trim().optional().default('simulation'),
  title: z.string().max(200).trim().optional().default(''),
  detail: z.string().max(4000).trim().optional().default(''),
  payload: z.record(z.string(), z.any()).optional().default({}),
  occurredTick: z.number().int().min(0).optional()
});

export const createTownMemorySchema = z.object({
  memoryType: z.enum(['observation', 'event', 'relationship', 'plan', 'reflection']).optional().default('observation'),
  content: z.string().min(1, '记忆内容不能为空').max(8000).trim(),
  importance: z.number().min(1).max(10).optional().default(5),
  keywords: z.array(z.string().max(80).trim()).max(80).optional().default([]),
  sourceEventId: z.string().max(160).trim().optional().default(''),
  sourceKind: z.string().max(40).trim().optional().default('simulation'),
  occurredTick: z.number().int().min(0).optional()
});

export const createTownReflectionSchema = z.object({
  content: z.string().min(1, '反思内容不能为空').max(8000).trim(),
  memoryIds: z.array(z.string().min(1).max(160).trim()).max(100).optional().default([]),
  importance: z.number().min(1).max(10).optional().default(5),
  keywords: z.array(z.string().max(80).trim()).max(80).optional().default([])
});

const townScheduleItemSchema = z.object({
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
  activity: z.string().min(1, '日程活动不能为空').max(300).trim(),
  location: z.string().max(200).trim().optional().default(''),
  intention: z.string().max(1000).trim().optional().default(''),
  status: z.enum(['planned', 'active', 'completed', 'skipped']).optional().default('planned')
});

export const saveTownScheduleSchema = z.object({
  day: z.number().int().min(1).max(1000000).optional(),
  goal: z.string().max(1000).trim().optional().default(''),
  status: z.enum(['planned', 'active', 'completed', 'cancelled']).optional().default('planned'),
  items: z.array(townScheduleItemSchema).max(96)
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
    if (source === 'query') {
      request.validatedQuery = result.data;
    } else {
      request[source] = result.data;
    }
    next();
  };
}

const requestParamBoundarySchema = z.record(z.string(), z.string().max(500));
const requestQueryBoundarySchema = z.record(
  z.string(),
  z.union([
    z.string().max(20_000),
    z.array(z.string().max(20_000)).max(100)
  ])
).superRefine((value, context) => {
  if (Object.keys(value).length > 100) {
    context.addIssue({ code: 'custom', message: '查询参数过多' });
  }
});
const jsonBoundarySchema = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(jsonBoundarySchema).max(10_000),
  z.record(z.string(), jsonBoundarySchema)
]));

export function validateAuthenticatedRequestBoundary(request, response, next) {
  const result = z.object({
    params: requestParamBoundarySchema,
    query: requestQueryBoundarySchema,
    body: jsonBoundarySchema.optional()
  }).safeParse({ params: request.params || {}, query: request.query || {}, body: request.body });
  if (!result.success) {
    const message = result.error.issues.map((issue) => issue.message).join('; ');
    response.status(400).json({ error: message || '请求参数无效' });
    return;
  }
  next();
}
