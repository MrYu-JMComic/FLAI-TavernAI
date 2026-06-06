import { runToolCompletion, streamToolCompletion } from './providers.js';
import { nullToEmptyObject, objectOrEmpty, parseLooseJsonObject } from './assistantUtils.js';

const positionValues = ['at_start', 'before_char', 'after_char', 'at_depth'];

const worldBookTools = [
  {
    type: 'function',
    function: {
      name: 'set_world_book_profile',
      description: 'Set the world book name, description, scan depth, and lorebook context budget.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          scanDepth: { type: 'integer', minimum: 1, maximum: 50 },
          lorebookContextPercent: { type: 'integer', minimum: 1, maximum: 100 }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'replace_world_book_entries',
      description: 'Replace all generated world book entries with normalized triggerable lore entries.',
      parameters: {
        type: 'object',
        properties: {
          entries: {
            type: 'array',
            maxItems: 30,
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                triggerKeys: { type: 'string' },
                content: { type: 'string' },
                position: { type: 'string', enum: positionValues },
                enabled: { type: 'boolean' },
                orderIndex: { type: 'integer' },
                regexMode: { type: 'boolean' },
                alwaysActive: { type: 'boolean' },
                useProbability: { type: 'boolean' },
                probability: { type: 'integer', minimum: 0, maximum: 100 },
                group: { type: 'string', description: 'Mutually exclusive inclusion group name. Only one active entry from the same group should be injected.' },
                groupWeight: { type: 'integer', minimum: 0 },
                depth: { type: 'integer', minimum: 0, maximum: 10 },
                role: { type: 'integer', enum: [0, 1, 2], description: 'For at_depth entries: 0=system, 1=user, 2=assistant.' },
                sticky: { type: ['integer', 'null'], minimum: 0 },
                cooldown: { type: ['integer', 'null'], minimum: 0 },
                delay: { type: ['integer', 'null'], minimum: 0 }
              },
              required: ['name', 'triggerKeys', 'content'],
              additionalProperties: false
            }
          }
        },
        required: ['entries'],
        additionalProperties: false
      }
    }
  }
];

export async function completeWorldBookDraft(settings, request = {}) {
  const { requirement = '', current = {}, signal } = nullToEmptyObject(request);
  const draft = normalizeDraft(current);

  const result = await runToolCompletion(
    settings,
    [
      {
        role: 'system',
        content: [
          'You are a lorebook / world-info architect for FLAI Tavern AI.',
          'You must use tools to create a structured world book draft; do not answer with prose only.',
          'Design entries like SillyTavern World Info: compact facts activated by keywords, with clear trigger keys and concise injected content.',
          'Prefer specific nouns, aliases, locations, factions, rules, items, events, relationships, and recurring secrets as trigger keys.',
          'Keep each entry self-contained and useful when injected into chat context. Avoid dumping the entire setting into every entry.',
          'Use alwaysActive only for global rules that must always be present. Use at_depth only for information that should appear deeper in the prompt.',
          'Use regexMode sparingly; only when a literal keyword list cannot express the trigger safely.',
          'Use probability, sticky, cooldown, delay, and group only when they have a meaningful gameplay or narrative reason.',
          'For Chinese roleplay, write polished Chinese content. Preserve user-provided names and terms.'
        ].join('\n')
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            requirement: String(requirement || '').trim(),
            currentWorldBook: draft
          },
          null,
          2
        )
      }
    ],
    worldBookTools,
    (name, args) => executeWorldBookTool(name, args, draft),
    { maxRounds: 6, thinkingEnabled: false, signal, onNoToolCall: () => worldBookNoToolNudge(draft) }
  );

  if (!result.toolCalls.length && result.content) {
    mergeProfile(draft, parseLooseJsonObject(result.content));
  }

  const normalized = normalizeDraft(draft);
  if (!normalized.entries.length) {
    throw new Error('AI 没有生成有效的世界书条目，请补充更具体的主题、阵营、地点、规则或秘密后重试。');
  }
  if (!normalized.name) {
    normalized.name = inferWorldBookName(requirement, normalized.entries);
  }

  return {
    worldBook: normalized,
    toolCalls: result.toolCalls.map((call) => ({
      name: call.name,
      arguments: call.arguments,
      result: call.result
    })),
    process: result.process || [],
    reasoning: collectReasoning(result.process),
    summary: result.content || `Generated ${normalized.entries.length} world book entries.`,
    usage: result.usage || null
  };
}

export async function streamWorldBookDraft(settings, request = {}) {
  const { requirement = '', current = {}, signal, emit = () => {} } = nullToEmptyObject(request);
  const draft = normalizeDraft(current);

  const result = await streamToolCompletion(
    settings,
    [
      {
        role: 'system',
        content: [
          'You are a lorebook / world-info architect for FLAI Tavern AI.',
          'You must use tools to create a structured world book draft; do not answer with prose only.',
          'Design entries like SillyTavern World Info: compact facts activated by keywords, with clear trigger keys and concise injected content.',
          'Prefer specific nouns, aliases, locations, factions, rules, items, events, relationships, and recurring secrets as trigger keys.',
          'Keep each entry self-contained and useful when injected into chat context. Avoid dumping the entire setting into every entry.',
          'Use alwaysActive only for global rules that must always be present. Use at_depth only for information that should appear deeper in the prompt.',
          'Use regexMode sparingly; only when a literal keyword list cannot express the trigger safely.',
          'Use probability, sticky, cooldown, delay, and group only when they have a meaningful gameplay or narrative reason.',
          'For Chinese roleplay, write polished Chinese content. Preserve user-provided names and terms.'
        ].join('\n')
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            requirement: String(requirement || '').trim(),
            currentWorldBook: draft
          },
          null,
          2
        )
      }
    ],
    worldBookTools,
    (name, args) => executeWorldBookTool(name, args, draft),
    emit,
    signal,
    { maxRounds: 6, thinkingEnabled: false, onNoToolCall: () => worldBookNoToolNudge(draft) }
  );

  if (!result.toolCalls.length && result.content) {
    mergeProfile(draft, parseLooseJsonObject(result.content));
  }

  const normalized = normalizeDraft(draft);
  if (!normalized.entries.length) {
    throw new Error('AI 没有生成有效的世界书条目，请补充更具体的主题、阵营、地点、规则或秘密后重试。');
  }
  if (!normalized.name) {
    normalized.name = inferWorldBookName(requirement, normalized.entries);
  }

  return {
    worldBook: normalized,
    toolCalls: result.toolCalls.map((call) => ({
      name: call.name,
      arguments: call.arguments,
      result: call.result
    })),
    process: result.process || [],
    reasoning: collectReasoning(result.process),
    summary: result.content || `Generated ${normalized.entries.length} world book entries.`,
    usage: result.usage || null
  };
}

function executeWorldBookTool(name, args, draft) {
  const toolArgs = objectOrEmpty(args);
  if (name === 'set_world_book_profile') {
    return { ok: true, applied: mergeProfile(draft, toolArgs) };
  }
  if (name === 'replace_world_book_entries') {
    draft.entries = Array.isArray(toolArgs.entries)
      ? toolArgs.entries.map((entry, index) => normalizeEntry(entry, index)).filter((entry) => entry.name && entry.content)
      : [];
    return { ok: true, count: draft.entries.length };
  }
  return { ok: false, error: `Unknown tool: ${name}` };
}

function worldBookNoToolNudge(draft) {
  const hasEntries = Array.isArray(draft.entries) && draft.entries.some((entry) => entry.name && entry.content);
  if (hasEntries) {
    return '';
  }

  return [
    'You have not written any usable world book entries yet.',
    'Do not describe what you will do next.',
    'Call the replace_world_book_entries tool now with 8-30 complete entries.',
    'Each entry must include both name and content. Use concise Chinese content and specific triggerKeys unless alwaysActive is true.'
  ].join('\n');
}

function mergeProfile(draft, args = {}) {
  args = objectOrEmpty(args);
  const applied = {};
  if (Object.prototype.hasOwnProperty.call(args, 'name')) {
    draft.name = limitText(args.name, 80);
    applied.name = draft.name;
  }
  if (Object.prototype.hasOwnProperty.call(args, 'description')) {
    draft.description = limitText(args.description, 2000);
    applied.description = draft.description;
  }
  if (Object.prototype.hasOwnProperty.call(args, 'scanDepth')) {
    draft.scanDepth = clampInt(args.scanDepth, 1, 50, 4);
    applied.scanDepth = draft.scanDepth;
  }
  if (Object.prototype.hasOwnProperty.call(args, 'lorebookContextPercent')) {
    draft.lorebookContextPercent = clampInt(args.lorebookContextPercent, 1, 100, 25);
    applied.lorebookContextPercent = draft.lorebookContextPercent;
  }
  if (Array.isArray(args.entries)) {
    draft.entries = args.entries.map((entry, index) => normalizeEntry(entry, index)).filter((entry) => entry.name && entry.content);
    applied.entries = draft.entries;
  }
  return applied;
}

function normalizeDraft(value = {}) {
  const draft = objectOrEmpty(value);
  return {
    name: limitText(draft.name || '', 80),
    description: limitText(draft.description || '', 2000),
    characterId: String(draft.characterId || '').trim(),
    scanDepth: clampInt(draft.scanDepth, 1, 50, 4),
    lorebookContextPercent: clampInt(draft.lorebookContextPercent, 1, 100, 25),
    entries: Array.isArray(draft.entries)
      ? draft.entries.map((entry, index) => normalizeEntry(entry, index)).filter((entry) => entry.name || entry.content)
      : []
  };
}

function normalizeEntry(entry = {}, index = 0) {
  entry = objectOrEmpty(entry);
  const position = positionValues.includes(entry.position) ? entry.position : 'before_char';
  const alwaysActive = Boolean(entry.alwaysActive);
  return {
    name: limitText(entry.name || `条目 ${index + 1}`, 120),
    triggerKeys: alwaysActive ? '' : limitText(entry.triggerKeys || '', 500),
    content: limitText(entry.content || '', 8000),
    position,
    enabled: entry.enabled !== false,
    orderIndex: Number.isFinite(Number(entry.orderIndex)) ? Number(entry.orderIndex) : index,
    regexMode: Boolean(entry.regexMode),
    alwaysActive,
    useProbability: Boolean(entry.useProbability),
    probability: clampInt(entry.probability, 0, 100, 100),
    group: limitText(entry.group || entry.inclusionGroup || '', 80),
    groupWeight: clampInt(entry.groupWeight, 0, 9999, 0),
    depth: position === 'at_depth' ? clampInt(entry.depth, 0, 10, 4) : null,
    role: normalizeRole(entry.role),
    sticky: nullableInt(entry.sticky),
    cooldown: nullableInt(entry.cooldown),
    delay: nullableInt(entry.delay)
  };
}

function nullableInt(value) {
  if (value === null || value === undefined || value === '') return null;
  return Math.max(0, Math.floor(Number(value) || 0));
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

function inferWorldBookName(requirement, entries = []) {
  const text = String(requirement || '').trim();
  if (text) {
    return limitText(text.replace(/\s+/g, ' ').slice(0, 40), 80);
  }
  return limitText(entries[0]?.name ? `${entries[0].name}世界书` : 'AI 世界书', 80);
}

function collectReasoning(process = []) {
  return process
    .map((step) => String(step.reasoning || '').trim())
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 8000);
}
