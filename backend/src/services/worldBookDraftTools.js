import { newId } from '../security.js';
import { normalizeLoreKnowledge } from '../../../shared/loreKnowledge.js';
import {
  WORLD_BOOK_ASSISTANT_ENTRY_LIMIT,
  WORLD_BOOK_ENTRY_LIMITS,
  WORLD_BOOK_LIMITS
} from '../domain/worldBooks/limits.js';
import { objectOrEmpty } from './assistantUtils.js';
import { buildWorldBookMatchPreview } from './worldBooks/worldBookMatchPreview.js';

export const WORLD_BOOK_POSITION_VALUES = Object.freeze(['at_start', 'before_char', 'after_char', 'at_depth']);
export const WORLD_BOOK_MUTATION_TOOL_NAMES = Object.freeze([
  'set_world_book_profile',
  'replace_world_book_entries',
  'upsert_world_book_entry',
  'remove_world_book_entry'
]);

// 中文维护说明：以下 schema description 会直接发送给模型；请用英文描述字段语义，并保持与实际匹配、注入行为一致。
const worldBookEntryProperties = {
  knowledgeVisibility: { type: 'string', enum: ['author', 'public', 'restricted'], description: 'Knowledge scope: author is narrator-only truth; public is common knowledge; restricted is visible only to the portable audienceCastKeys. Defaults to author. Does not itself prove a character learned a story event.' },
  audienceCastKeys: { type: 'array', maxItems: 64, items: { type: 'string', minLength: 1, maxLength: 80 }, description: 'Portable stable cast keys, not conversation-local actor IDs. Used for restricted knowledge scope.' },
  id: {
    type: 'string',
    minLength: 1,
    maxLength: WORLD_BOOK_ENTRY_LIMITS.id,
    description: 'ID of an existing draft entry. Use it only to preserve entry identity during full replacement. Omit it for a new entry; the system will assign an ID.'
  },
  name: {
    type: 'string',
    minLength: 1,
    maxLength: WORLD_BOOK_ENTRY_LIMITS.name,
    description: 'Entry title, 1-100 characters. Used for management and previews; it does not participate in trigger matching.'
  },
  triggerKeys: {
    type: 'string',
    maxLength: WORLD_BOOK_ENTRY_LIMITS.triggerKeys,
    description: 'Primary trigger keys as one string, separated by ASCII commas. Do not use an array, ideographic commas, or semicolons. Required when alwaysActive is false. Matching is case-insensitive. With regexMode=true, each comma-separated segment is a separate regular expression. With regexMode=false, a segment written as /pattern/i is still treated as a regular expression; all other segments use substring matching.'
  },
  content: {
    type: 'string',
    minLength: 1,
    maxLength: WORLD_BOOK_ENTRY_LIMITS.content,
    description: 'Entry body injected into model context when this entry matches, 1-50000 characters. Include facts, constraints, and relationships only. Do not include editing notes.'
  },
  position: {
    type: 'string',
    enum: WORLD_BOOK_POSITION_VALUES,
    description: 'Injection position: at_start inserts at the beginning of context; before_char inserts before character definitions; after_char inserts after character definitions; at_depth inserts at the configured depth and role. Defaults to before_char.'
  },
  enabled: { type: 'boolean', description: 'Whether this entry is enabled. Defaults to true.' },
  orderIndex: { type: 'integer', minimum: 0, description: 'Non-negative ordering index. Entries are saved in array order, so this field can usually be omitted.' },
  regexMode: { type: 'boolean', description: 'Whether primary trigger keys use safe regular-expression matching. Defaults to false.' },
  alwaysActive: { type: 'boolean', description: 'Whether this entry participates in matching without requiring primary trigger keys. Defaults to false.' },
  selective: { type: 'boolean', description: 'Whether secondary-key conditions are enabled. Defaults to false. When true, keysSecondary must be non-empty.' },
  selectiveLogic: {
    type: 'integer',
    enum: [0, 1, 2],
    description: 'Secondary-key logic, evaluated only after a primary key matches: 0 activates only if any secondary key matches; 1 blocks activation if any secondary key matches; 2 blocks activation only if all secondary keys match.'
  },
  keysSecondary: {
    type: 'string',
    maxLength: WORLD_BOOK_ENTRY_LIMITS.keysSecondary,
    description: 'Secondary trigger keys as one string, separated by ASCII commas. Used only when selective=true. Matching is always case-insensitive substring matching; regular expressions are not supported.'
  },
  useProbability: { type: 'boolean', description: 'Whether to apply a probability check after the key conditions pass. Defaults to false.' },
  probability: {
    type: 'integer',
    minimum: 0,
    maximum: WORLD_BOOK_ENTRY_LIMITS.probabilityMax,
    description: 'Activation probability from 0 to 100 percent. Used only when useProbability=true. Defaults to 100.'
  },
  group: {
    type: 'string',
    maxLength: WORLD_BOOK_ENTRY_LIMITS.group,
    description: 'Name of an exclusive group. If multiple entries in the same non-empty group match, only one is selected by groupWeight. The stored field name is group.'
  },
  groupWeight: { type: 'integer', minimum: 0, description: 'Non-negative selection weight within an exclusive group. Higher values are more likely to be selected. A value of 0 is treated as the minimum weight, 1.' },
  depth: {
    type: 'integer',
    minimum: 0,
    maximum: WORLD_BOOK_ENTRY_LIMITS.depthMax,
    description: 'Insertion depth counted backward from the end of context, from 0 to 10. Used only when position=at_depth. Defaults to 0.'
  },
  role: {
    type: 'integer',
    enum: [0, 1, 2],
    description: 'Message role used with position=at_depth: 0=system, 1=user, 2=assistant. The stored value must be an integer.'
  },
  sticky: stateDurationSchema('Additional message turns to keep this entry active after it matches; trigger keys are not required during this period'),
  cooldown: stateDurationSchema('Message turns after deactivation during which this entry cannot activate again'),
  delay: stateDurationSchema('Minimum message turns from the first scan of this entry in the current conversation before it may activate')
};

const { id: _entryIdSchema, ...worldBookEntryChangeProperties } = worldBookEntryProperties;

export const WORLD_BOOK_ENTRY_SCHEMA = Object.freeze({
  type: 'object',
  properties: worldBookEntryProperties,
  required: ['name', 'triggerKeys', 'content'],
  additionalProperties: false
});

// 中文维护说明：资料字段和条目正文由模型生成；英文描述规则，中文项目的实际内容仍应使用自然中文。
export const WORLD_BOOK_DRAFT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    name: {
      type: 'string',
      minLength: 1,
      maxLength: WORLD_BOOK_LIMITS.name,
      description: 'World-book name, 1-80 characters.'
    },
    description: {
      type: 'string',
      maxLength: WORLD_BOOK_LIMITS.description,
      description: 'Describe the world book purpose and scope, up to 2000 characters. This description is not injected as an entry body.'
    },
    scanDepth: {
      type: 'integer',
      minimum: WORLD_BOOK_LIMITS.scanDepthMin,
      maximum: WORLD_BOOK_LIMITS.scanDepthMax,
      description: `Number of recent messages scanned for trigger matches, from ${WORLD_BOOK_LIMITS.scanDepthMin} to ${WORLD_BOOK_LIMITS.scanDepthMax}. Draft default: 4. This changes only the scan range, not the injected content.`
    },
    lorebookContextPercent: {
      type: 'integer',
      minimum: WORLD_BOOK_LIMITS.contextPercentMin,
      maximum: WORLD_BOOK_LIMITS.contextPercentMax,
      description: `Maximum percentage of the context budget available to matched entries in this world book, from ${WORLD_BOOK_LIMITS.contextPercentMin} to ${WORLD_BOOK_LIMITS.contextPercentMax}. Draft default: 25. If the budget is exceeded, entries are retained in ascending orderIndex.`
    },
    entries: {
      type: 'array',
      minItems: 1,
      maxItems: WORLD_BOOK_ASSISTANT_ENTRY_LIMIT,
      description: `World-book entries that can be saved directly, up to ${WORLD_BOOK_ASSISTANT_ENTRY_LIMIT}, saved in array order. Tool-call arguments have a size limit; use upsert_world_book_entry for long bodies or large batches.`,
      items: WORLD_BOOK_ENTRY_SCHEMA
    }
  },
  required: ['name', 'entries'],
  additionalProperties: false
});

const { entries: _worldBookEntriesSchema, ...worldBookProfileProperties } = WORLD_BOOK_DRAFT_SCHEMA.properties;

// 中文维护说明：工具名称和字段名是程序接口；description 是给模型的操作契约，不是用户界面文案。
export const WORLD_BOOK_DRAFT_TOOLS = Object.freeze([
  {
    type: 'function',
    function: {
      name: 'set_world_book_profile',
      description: 'Update world-book profile fields. Send only fields that must change. This tool does not accept entries. An empty string overwrites the existing text.',
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
      description: 'Replace every entry in the current draft with entries. Use only for initial batch creation or an explicitly requested rebuild. When editing an existing world book, preserve every still-valid entry and its id; omitted entries will be deleted. The entire batch is rejected if any entry lacks name, content, or required triggerKeys; partial writes are not performed.',
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
      description: 'Create an entry, or partially update an existing entry by entryId. Omitted fields remain unchanged during an update. For a new entry, provide name, content, and triggerKeys unless alwaysActive=true.',
      parameters: {
        type: 'object',
        properties: {
          entryId: {
            type: 'string',
            minLength: 1,
            maxLength: WORLD_BOOK_ENTRY_LIMITS.id,
            description: 'ID of the existing entry to update. Omit when creating a new entry.'
          },
          changes: {
            type: 'object',
            properties: worldBookEntryChangeProperties,
            minProperties: 1,
            additionalProperties: false,
            description: 'Fields to write. Do not include fields whose values are unchanged.'
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
      description: 'Remove one entry from the current draft by entryId. Use only when the edit request explicitly requires removing that entry. This does not delete the world book from the database.',
      parameters: {
        type: 'object',
        properties: {
          entryId: { type: 'string', minLength: 1, maxLength: WORLD_BOOK_ENTRY_LIMITS.id, description: 'ID of an entry in the current draft.' }
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
      description: 'Read-only check of primary keys, secondary keys, and exclusive-group matches in the current draft using example text. Use it to validate trigger conditions. This does not modify the draft, run probability sampling (entries with useProbability are marked as pending), or advance sticky, cooldown, or delay state.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', maxLength: 8_000, description: 'Example conversation text for testing trigger matches.' }
        },
        required: ['text'],
        additionalProperties: false
      }
    }
  }
]);

// 中文维护说明：这些质量规则直接进入模型提示词；内容语言由调用方提示，规则文本保持英文。
export const WORLD_BOOK_QUALITY_INSTRUCTIONS = Object.freeze([
  'Split the setting into atomic entries. Each entry should describe only one person, place, faction, item, rule, event, relationship, or secret. Do not combine unrelated topics.',
  'triggerKeys and keysSecondary must each be a single string with values separated by ASCII commas. Do not use arrays, ideographic commas, or semicolons. Use specific names, aliases, places, factions, items, or event terms as ordinary keys. Avoid generic keys such as "he", "here", or "event".',
  'The stored field name is group, not inclusionGroup. role must be the integer 0, 1, or 2; do not use the strings system, user, or assistant. If sticky, cooldown, or delay is unused, omit it or set it to null; do not use placeholder values.',
  'Choose the injection position for its purpose: use before_char for stable facts, after_char for current-scene pressure, at_start only for rules that must apply globally, and at_depth only when depth and role are needed.',
  'Write content as facts, constraints, and relationships needed when the topic is triggered. Do not repeat the entire setting or include meta-instructions to the model, such as requests to generate text or ignore prior instructions, unless the entry itself is an explicitly requested global rule.',
  'alwaysActive, regexMode, selective, useProbability, sticky, cooldown, delay, and group change matching behavior. Use them only when the requirement calls for them and their purpose is clear; reflect that purpose in the name or content.',
  'knowledgeVisibility and audienceCastKeys control strict single-actor access across conversations. Keep unclassified secrets author-only; use public for common knowledge and restricted with stable portable cast keys only when the requirement establishes the audience. Never turn author plans into already-known history.',
  'Every entry must have a non-empty name and content. triggerKeys must be non-empty when alwaysActive=false. keysSecondary must be non-empty when selective=true. Entries that fail these requirements are discarded.',
  `Each tool call has a total argument-size limit. For many entries or long bodies, write entries in batches with upsert_world_book_entry instead of placing ${WORLD_BOOK_ASSISTANT_ENTRY_LIMIT} long entries in one replace_world_book_entries call.`
]);

export function createCharacterWorldBookTool() {
  return {
    type: 'function',
    function: {
      name: 'create_character_world_book',
      description: `Create a saveable world-book draft for the current character, including its name and entries. Use the same schema as the standalone world-book creator. This tool creates a draft for confirmation and does not write to the database. Use it only when the request explicitly needs separate world setting, place, faction, rule, or secret entries. For many entries or long bodies, create the core entries here and add the rest with upsert_world_book_entry, up to ${WORLD_BOOK_ASSISTANT_ENTRY_LIMIT} entries total.`,
      parameters: WORLD_BOOK_DRAFT_SCHEMA
    }
  };
}

// The character assistant edits its world-book draft with the same tools and
// the same executor as the standalone assistant, so both produce identical
// structures; only the entry point differs.
export const CHARACTER_WORLD_BOOK_PATCH_TOOL_NAMES = Object.freeze([
  'upsert_world_book_entry',
  'remove_world_book_entry'
]);
export const CHARACTER_WORLD_BOOK_READ_TOOL_NAMES = Object.freeze(['preview_world_book_entries']);

export function createCharacterWorldBookTools() {
  const shared = new Set([...CHARACTER_WORLD_BOOK_PATCH_TOOL_NAMES, ...CHARACTER_WORLD_BOOK_READ_TOOL_NAMES]);
  const tools = [createCharacterWorldBookTool()];
  for (const tool of WORLD_BOOK_DRAFT_TOOLS) {
    if (shared.has(tool.function?.name)) tools.push(tool);
  }
  return tools;
}

// Entries that cannot be saved are dropped by normalisation; the caller reports
// how many so the model can fix them instead of silently shipping fewer.
export function normalizeWorldBookDraftInput(value = {}) {
  const requestedEntries = Array.isArray(objectOrEmpty(value).entries) ? objectOrEmpty(value).entries.length : 0;
  const draft = normalizeUsableWorldBookDraft(value);
  return {
    draft,
    requestedEntries,
    droppedEntries: Math.max(0, requestedEntries - draft.entries.length)
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

// 中文维护说明：这里生成的状态轮数说明会嵌入工具字段描述，因此调用方传入英文语义。
function stateDurationSchema(label) {
  return {
    type: ['integer', 'null'],
    minimum: 0,
    maximum: WORLD_BOOK_ENTRY_LIMITS.stateDurationMax,
    description: `${label}, from 0 to ${WORLD_BOOK_ENTRY_LIMITS.stateDurationMax}. Omit when unused or set to null.`
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

export function normalizeWorldBookEntry(value = {}, index = 0) {
  const entry = objectOrEmpty(value);
  const position = WORLD_BOOK_POSITION_VALUES.includes(entry.position) ? entry.position : 'before_char';
  return {
    ...normalizeLoreKnowledge(entry),
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

export function isUsableWorldBookEntry(entry = {}) {
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
