import { newId } from '../security.js';
import {
  WORLD_BOOK_ASSISTANT_ENTRY_LIMIT,
  WORLD_BOOK_ENTRY_LIMITS,
  WORLD_BOOK_LIMITS
} from '../domain/worldBooks/limits.js';
import { objectOrEmpty } from './assistantUtils.js';
import { buildWorldBookMatchPreview } from './worldBookMatchPreview.js';

export const WORLD_BOOK_POSITION_VALUES = Object.freeze(['at_start', 'before_char', 'after_char', 'at_depth']);
export const WORLD_BOOK_MUTATION_TOOL_NAMES = Object.freeze([
  'set_world_book_profile',
  'replace_world_book_entries',
  'upsert_world_book_entry',
  'remove_world_book_entry'
]);

const worldBookEntryProperties = {
  id: {
    type: 'string',
    minLength: 1,
    maxLength: WORLD_BOOK_ENTRY_LIMITS.id,
    description: '现有草稿条目的 ID。仅在完整替换时用于保留条目身份；新条目省略，由系统生成。'
  },
  name: {
    type: 'string',
    minLength: 1,
    maxLength: WORLD_BOOK_ENTRY_LIMITS.name,
    description: '条目标题，1-100 字。用于管理和预览，不参与触发。'
  },
  triggerKeys: {
    type: 'string',
    maxLength: WORLD_BOOK_ENTRY_LIMITS.triggerKeys,
    description: '主关键词字符串，多个值必须用英文逗号分隔。alwaysActive=false 时不可为空；regexMode=true 时每个逗号分段都是独立正则。'
  },
  content: {
    type: 'string',
    minLength: 1,
    maxLength: WORLD_BOOK_ENTRY_LIMITS.content,
    description: '条目命中后注入模型上下文的正文，1-50000 字。只写事实、约束和关系，不写编辑说明。'
  },
  position: {
    type: 'string',
    enum: WORLD_BOOK_POSITION_VALUES,
    description: '注入位置：at_start=上下文最前；before_char=角色设定前；after_char=角色设定后；at_depth=按 depth/role 插入。默认 before_char。'
  },
  enabled: { type: 'boolean', description: '是否启用条目，默认 true。' },
  orderIndex: { type: 'integer', minimum: 0, description: '同一本世界书内的非负排序序号；省略时按列表顺序生成。' },
  regexMode: { type: 'boolean', description: '主关键词是否按安全正则表达式匹配，默认 false。' },
  alwaysActive: { type: 'boolean', description: '是否不依赖主关键词而始终参与匹配，默认 false。' },
  selective: { type: 'boolean', description: '是否启用副关键词条件，默认 false；启用时 keysSecondary 必须非空。' },
  selectiveLogic: {
    type: 'integer',
    enum: [0, 1, 2],
    description: '副关键词逻辑：0=任一副关键词命中才激活；1=任一副关键词命中则阻止；2=全部副关键词命中则阻止。'
  },
  keysSecondary: {
    type: 'string',
    maxLength: WORLD_BOOK_ENTRY_LIMITS.keysSecondary,
    description: '副关键词字符串，多个值用英文逗号分隔；仅 selective=true 时使用，按普通文本匹配。'
  },
  useProbability: { type: 'boolean', description: '是否在关键词条件通过后再进行概率判定，默认 false。' },
  probability: {
    type: 'integer',
    minimum: 0,
    maximum: WORLD_BOOK_ENTRY_LIMITS.probabilityMax,
    description: '激活概率百分比 0-100；仅 useProbability=true 时生效，默认 100。'
  },
  group: {
    type: 'string',
    maxLength: WORLD_BOOK_ENTRY_LIMITS.group,
    description: '互斥组名。相同非空组内若多条命中，只按 groupWeight 选一条；实际保存字段名必须是 group。'
  },
  groupWeight: { type: 'integer', minimum: 0, description: '互斥组抽选权重，非负整数；0 在抽选时按最低权重 1 处理。' },
  depth: {
    type: 'integer',
    minimum: 0,
    maximum: WORLD_BOOK_ENTRY_LIMITS.depthMax,
    description: '从上下文末尾向前的插入深度 0-10，仅 position=at_depth 时生效，默认 0。'
  },
  role: {
    type: 'integer',
    enum: [0, 1, 2],
    description: 'at_depth 消息角色：0=system，1=user，2=assistant。实际保存格式只接受整数。'
  },
  sticky: stateDurationSchema('激活后继续保持的消息轮数'),
  cooldown: stateDurationSchema('失活后禁止再次激活的消息轮数'),
  delay: stateDurationSchema('首次满足条件后延迟激活的消息轮数')
};

const { id: _entryIdSchema, ...worldBookEntryChangeProperties } = worldBookEntryProperties;

export const WORLD_BOOK_ENTRY_SCHEMA = Object.freeze({
  type: 'object',
  properties: worldBookEntryProperties,
  required: ['name', 'triggerKeys', 'content'],
  additionalProperties: false
});

export const WORLD_BOOK_DRAFT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    name: {
      type: 'string',
      minLength: 1,
      maxLength: WORLD_BOOK_LIMITS.name,
      description: '世界书名称，1-80 字。'
    },
    description: {
      type: 'string',
      maxLength: WORLD_BOOK_LIMITS.description,
      description: '世界书用途与覆盖范围说明，最多 2000 字；不会作为条目正文注入。'
    },
    scanDepth: {
      type: 'integer',
      minimum: WORLD_BOOK_LIMITS.scanDepthMin,
      maximum: WORLD_BOOK_LIMITS.scanDepthMax,
      description: '每次匹配向前扫描的消息条数，1-50。默认 4。'
    },
    lorebookContextPercent: {
      type: 'integer',
      minimum: WORLD_BOOK_LIMITS.contextPercentMin,
      maximum: WORLD_BOOK_LIMITS.contextPercentMax,
      description: '世界书最多占上下文预算的百分比，1-100。默认 25。'
    },
    entries: {
      type: 'array',
      minItems: 1,
      maxItems: WORLD_BOOK_ASSISTANT_ENTRY_LIMIT,
      description: '可直接保存的世界书条目，按 orderIndex 与数组顺序排列。',
      items: WORLD_BOOK_ENTRY_SCHEMA
    }
  },
  required: ['name', 'entries'],
  additionalProperties: false
});

const { entries: _worldBookEntriesSchema, ...worldBookProfileProperties } = WORLD_BOOK_DRAFT_SCHEMA.properties;

export const WORLD_BOOK_DRAFT_TOOLS = Object.freeze([
  {
    type: 'function',
    function: {
      name: 'set_world_book_profile',
      description: '设置世界书资料。只传实际需要修改的字段；此工具不接收 entries，空字符串会覆盖已有文本。',
      parameters: {
        type: 'object',
        properties: worldBookProfileProperties,
        additionalProperties: false,
        minProperties: 1
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'replace_world_book_entries',
      description: '用 entries 完整替换当前草稿的全部条目。仅用于首次成批创建或明确重建；编辑现有世界书时必须保留所有仍有效条目及其 id。任一条目不完整时整批拒绝。',
      parameters: {
        type: 'object',
        properties: { entries: WORLD_BOOK_DRAFT_SCHEMA.properties.entries },
        required: ['entries'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'upsert_world_book_entry',
      description: '创建一个条目，或用 entryId 局部修改现有条目。更新时省略的字段与其他条目保持不变；创建时必须提供 name、content，以及非常驻条目的 triggerKeys。',
      parameters: {
        type: 'object',
        properties: {
          entryId: {
            type: 'string',
            minLength: 1,
            maxLength: WORLD_BOOK_ENTRY_LIMITS.id,
            description: '要修改的现有条目 ID；创建新条目时省略。'
          },
          changes: {
            type: 'object',
            properties: worldBookEntryChangeProperties,
            minProperties: 1,
            additionalProperties: false,
            description: '要写入的新值；不要重复提交未变化字段。'
          }
        },
        required: ['changes'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'remove_world_book_entry',
      description: '按 entryId 从当前草稿移除一个条目。只有编辑要求明确删除该条目时使用；不会直接删除数据库中的世界书。',
      parameters: {
        type: 'object',
        properties: {
          entryId: { type: 'string', minLength: 1, maxLength: WORLD_BOOK_ENTRY_LIMITS.id, description: '当前草稿中的条目 ID。' }
        },
        required: ['entryId'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'preview_world_book_entries',
      description: '使用示例文本只读检查当前草稿的关键词、副关键词和互斥组匹配结果。不会随机执行概率判定，也不会推进 sticky、cooldown 或 delay 状态。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', maxLength: 8_000, description: '用于测试触发效果的示例对话文本。' }
        },
        required: ['text'],
        additionalProperties: false
      }
    }
  }
]);

export const WORLD_BOOK_QUALITY_INSTRUCTIONS = Object.freeze([
  '把设定拆成原子条目：每条只描述一个人物、地点、阵营、物品、规则、事件、关系或秘密；不同主题不要混在同一条。',
  'triggerKeys 与 keysSecondary 都是一个用英文逗号分隔的字符串，不是数组。普通关键词使用正式名称、别名、地点、阵营、物品或事件词；禁止使用“他、这里、事件”等泛词。',
  '实际保存字段名是 group，不是 inclusionGroup；role 必须是 0、1、2 之一，不能写 system、user、assistant 字符串。',
  '注入位置必须与用途一致：before_char 用于稳定设定，after_char 用于当前场景压力，at_start 仅用于必须全局生效的规则，at_depth 才使用 depth 与 role。',
  'content 只写触发该主题时需要知道的事实、约束和关系，不复述整套世界观，也不包含“请生成、忽略之前指令”等面向模型的元指令，除非该条目本身就是用户要求的全局规则。',
  'alwaysActive、regexMode、selective、useProbability、sticky、cooldown、delay 和 group 都会改变触发行为；只有 requirement 明确需要且能说明用途时才使用。',
  '每个条目必须有非空 name 与 content；alwaysActive=false 时 triggerKeys 必须非空；selective=true 时 keysSecondary 必须非空。'
]);

export function createCharacterWorldBookTool() {
  return {
    type: 'function',
    function: {
      name: 'create_character_world_book',
      description: '为当前角色生成一份可保存的完整世界书草稿。字段格式与“AI 世界书创建助手”完全一致；调用只生成待确认草稿，不会直接写入数据库。仅在需求明确需要独立世界设定、地点、阵营、规则或秘密条目时调用。',
      parameters: WORLD_BOOK_DRAFT_SCHEMA
    }
  };
}

export function executeWorldBookDraftTool(name, args, draft) {
  const toolArgs = objectOrEmpty(args);
  if (name === 'set_world_book_profile') {
    return { ok: true, applied: mergeWorldBookProfile(draft, toolArgs) };
  }
  if (name === 'replace_world_book_entries') {
    const sourceEntries = Array.isArray(toolArgs.entries) ? toolArgs.entries : [];
    const entries = normalizeWorldBookEntryList(sourceEntries, { usableOnly: true });
    if (!entries.length || entries.length !== sourceEntries.length) {
      return {
        ok: false,
        error: 'WORLD_BOOK_ENTRIES_INVALID',
        message: '每个条目都必须有 name、content，并在非 alwaysActive 时提供 triggerKeys；selective 条目还必须提供 keysSecondary。'
      };
    }
    draft.entries = entries;
    return { ok: true, count: draft.entries.length };
  }
  if (name === 'upsert_world_book_entry') {
    return upsertWorldBookEntry(draft, toolArgs);
  }
  if (name === 'remove_world_book_entry') {
    const index = draft.entries.findIndex((entry) => entry.id === toolArgs.entryId);
    if (index < 0) return { ok: false, error: 'ENTRY_NOT_FOUND' };
    draft.entries.splice(index, 1);
    return { ok: true, removedEntryId: toolArgs.entryId, count: draft.entries.length };
  }
  if (name === 'preview_world_book_entries') {
    const preview = buildWorldBookMatchPreview(draft, { text: toolArgs.text });
    return {
      ok: true,
      matchCount: preview.matchCount,
      matches: preview.matches.slice(0, WORLD_BOOK_ASSISTANT_ENTRY_LIMIT),
      explanations: preview.explanations.slice(0, WORLD_BOOK_ASSISTANT_ENTRY_LIMIT),
      groups: preview.groups.slice(0, WORLD_BOOK_ASSISTANT_ENTRY_LIMIT),
      truncated: preview.explanations.length > WORLD_BOOK_ASSISTANT_ENTRY_LIMIT
    };
  }
  return { ok: false, error: `Unknown world book tool: ${name}` };
}

export function normalizeWorldBookDraft(value = {}) {
  const draft = objectOrEmpty(value);
  return {
    name: limitText(draft.name, WORLD_BOOK_LIMITS.name),
    description: limitText(draft.description, WORLD_BOOK_LIMITS.description),
    characterId: String(draft.characterId || '').trim(),
    scanDepth: clampInt(draft.scanDepth, WORLD_BOOK_LIMITS.scanDepthMin, WORLD_BOOK_LIMITS.scanDepthMax, 4),
    lorebookContextPercent: clampInt(
      draft.lorebookContextPercent,
      WORLD_BOOK_LIMITS.contextPercentMin,
      WORLD_BOOK_LIMITS.contextPercentMax,
      25
    ),
    entries: normalizeWorldBookEntryList(draft.entries)
  };
}

export function normalizeUsableWorldBookDraft(value = {}) {
  const draft = normalizeWorldBookDraft(value);
  draft.entries = draft.entries.filter(isUsableWorldBookEntry);
  return draft;
}

export function hasUsableWorldBookDraft(value = {}) {
  const draft = normalizeUsableWorldBookDraft(value);
  return Boolean(draft.name && draft.entries.length);
}

export function mergeWorldBookProfile(draft, args = {}, includeEntries = false) {
  args = objectOrEmpty(args);
  const applied = {};
  if (Object.hasOwn(args, 'name')) {
    draft.name = limitText(args.name, WORLD_BOOK_LIMITS.name);
    applied.name = draft.name;
  }
  if (Object.hasOwn(args, 'description')) {
    draft.description = limitText(args.description, WORLD_BOOK_LIMITS.description);
    applied.description = draft.description;
  }
  if (Object.hasOwn(args, 'scanDepth')) {
    draft.scanDepth = clampInt(args.scanDepth, WORLD_BOOK_LIMITS.scanDepthMin, WORLD_BOOK_LIMITS.scanDepthMax, 4);
    applied.scanDepth = draft.scanDepth;
  }
  if (Object.hasOwn(args, 'lorebookContextPercent')) {
    draft.lorebookContextPercent = clampInt(
      args.lorebookContextPercent,
      WORLD_BOOK_LIMITS.contextPercentMin,
      WORLD_BOOK_LIMITS.contextPercentMax,
      25
    );
    applied.lorebookContextPercent = draft.lorebookContextPercent;
  }
  if (includeEntries && Array.isArray(args.entries)) {
    draft.entries = normalizeWorldBookEntryList(args.entries, { usableOnly: true });
    applied.entries = draft.entries;
  }
  return applied;
}

export function inferWorldBookName(requirement, entries = []) {
  const text = String(requirement || '').trim();
  if (text) return limitText(text.replace(/\s+/g, ' ').slice(0, 40), WORLD_BOOK_LIMITS.name);
  return limitText(entries[0]?.name ? `${entries[0].name}世界书` : 'AI 世界书', WORLD_BOOK_LIMITS.name);
}

function stateDurationSchema(label) {
  return {
    type: ['integer', 'null'],
    minimum: 0,
    maximum: WORLD_BOOK_ENTRY_LIMITS.stateDurationMax,
    description: `${label}，0-${WORLD_BOOK_ENTRY_LIMITS.stateDurationMax}；不使用时省略或设为 null。`
  };
}

function upsertWorldBookEntry(draft, toolArgs) {
  const changes = objectOrEmpty(toolArgs.changes);
  const index = toolArgs.entryId ? draft.entries.findIndex((entry) => entry.id === toolArgs.entryId) : -1;
  if (toolArgs.entryId && index < 0) return { ok: false, error: 'ENTRY_NOT_FOUND' };
  if (index < 0 && draft.entries.length >= WORLD_BOOK_ASSISTANT_ENTRY_LIMIT) {
    return { ok: false, error: 'ENTRY_LIMIT' };
  }
  const existing = index >= 0 ? draft.entries[index] : {};
  const next = normalizeWorldBookEntry(
    { ...existing, ...changes, id: existing.id || newId() },
    index < 0 ? draft.entries.length : index
  );
  if (!isUsableWorldBookEntry(next)) {
    return {
      ok: false,
      error: 'WORLD_BOOK_ENTRY_INVALID',
      message: '条目必须有 name、content，并在非 alwaysActive 时提供 triggerKeys；selective 条目还必须提供 keysSecondary。'
    };
  }
  if (index < 0) draft.entries.push(next);
  else draft.entries[index] = next;
  return { ok: true, entry: next, count: draft.entries.length };
}

function normalizeWorldBookEntryList(entries = [], options = {}) {
  if (!Array.isArray(entries)) return [];
  const normalized = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = normalizeWorldBookEntry(entries[index], index);
    const keep = options.usableOnly
      ? isUsableWorldBookEntry(entry)
      : Boolean(entry.name || entry.content);
    if (keep) normalized.push(entry);
    if (normalized.length >= WORLD_BOOK_ASSISTANT_ENTRY_LIMIT) break;
  }
  return normalized;
}

function normalizeWorldBookEntry(value = {}, index = 0) {
  const entry = objectOrEmpty(value);
  const position = WORLD_BOOK_POSITION_VALUES.includes(entry.position) ? entry.position : 'before_char';
  return {
    id: limitText(entry.id || newId(), WORLD_BOOK_ENTRY_LIMITS.id),
    name: limitText(entry.name, WORLD_BOOK_ENTRY_LIMITS.name),
    triggerKeys: limitText(entry.triggerKeys, WORLD_BOOK_ENTRY_LIMITS.triggerKeys),
    content: limitText(entry.content, WORLD_BOOK_ENTRY_LIMITS.content),
    position,
    enabled: entry.enabled !== false,
    orderIndex: clampInt(entry.orderIndex, 0, Number.MAX_SAFE_INTEGER, index),
    regexMode: Boolean(entry.regexMode),
    alwaysActive: Boolean(entry.alwaysActive),
    selective: Boolean(entry.selective),
    selectiveLogic: clampInt(entry.selectiveLogic, 0, 2, 0),
    keysSecondary: limitText(entry.keysSecondary, WORLD_BOOK_ENTRY_LIMITS.keysSecondary),
    useProbability: Boolean(entry.useProbability),
    probability: clampInt(entry.probability, 0, WORLD_BOOK_ENTRY_LIMITS.probabilityMax, 100),
    group: limitText(entry.group || entry.inclusionGroup, WORLD_BOOK_ENTRY_LIMITS.group),
    groupWeight: clampInt(entry.groupWeight, 0, Number.MAX_SAFE_INTEGER, 0),
    depth: position === 'at_depth' ? clampInt(entry.depth, 0, WORLD_BOOK_ENTRY_LIMITS.depthMax, 0) : 0,
    role: normalizeRole(entry.role),
    sticky: nullableInt(entry.sticky),
    cooldown: nullableInt(entry.cooldown),
    delay: nullableInt(entry.delay)
  };
}

function isUsableWorldBookEntry(entry = {}) {
  return Boolean(
    entry.name
    && entry.content
    && (entry.alwaysActive || entry.triggerKeys)
    && (!entry.selective || entry.keysSecondary)
  );
}

function nullableInt(value) {
  if (value === null || value === undefined || value === '') return null;
  return clampInt(value, 0, WORLD_BOOK_ENTRY_LIMITS.stateDurationMax, 0);
}

function normalizeRole(value) {
  if ([0, 1, 2].includes(Number(value))) return Number(value);
  if (value === 'user') return 1;
  if (value === 'assistant') return 2;
  return 0;
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function limitText(value, max) {
  return String(value || '').trim().slice(0, max);
}
