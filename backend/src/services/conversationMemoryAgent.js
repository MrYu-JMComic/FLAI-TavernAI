import { MEMORY_AGENT_TOOLS } from '../../../shared/memoryAgentTools.js';
import { normalizeAccessorySkills } from '../modules/advancedSettings.js';
import {
  batchReviewConversationMemories,
  createConversationMemory,
  listConversationMemories,
  mergeConversationMemories,
  pinConversationMemory,
  selectConversationMemoryContext,
  updateConversationMemory
} from '../modules/conversationMemories.js';
import { recordAutomaticConversationMemories } from './conversationMemoryExtraction.js';
import { searchUserContent } from './fullTextSearch.js';
import { hasUsableProvider, runToolCompletion } from './providers.js';
import { resolveAccessorySkillSettings } from './accessorySkillProvider.js';
import { retryProviderCall } from './providerRetry.js';

export const MEMORY_TYPES = Object.freeze(['event', 'relationship', 'location', 'preference', 'fact', 'summary', 'intent', 'hypothesis']);

const OBSERVATION_CHARACTER_LIMIT = 20_000;
const EXISTING_MEMORY_LIMIT = 40;
const MEMORY_CONTENT_LIMIT = 600;
const PARAPHRASE_CONFIDENCE_CAP = 0.6;
const UNSOURCED_CONFIDENCE_CAP = 0.5;
const MAX_ROUNDS = 8;
const AGENT_TIMEOUT_MS = 90_000;

export { MEMORY_AGENT_TOOLS } from '../../../shared/memoryAgentTools.js';

export function createDefaultMemoryAgentTools() {
  const tools = {};
  for (const tool of MEMORY_AGENT_TOOLS) tools[tool.name] = Boolean(tool.enabledByDefault);
  return tools;
}

export function resolveMemoryAgentTools(skill = {}) {
  const requested = skill && typeof skill.tools === 'object' && skill.tools ? skill.tools : {};
  const enabled = [];
  for (const tool of MEMORY_AGENT_TOOLS) {
    const value = Object.prototype.hasOwnProperty.call(requested, tool.name) ? requested[tool.name] : tool.enabledByDefault;
    if (tool.required || value === true) enabled.push(tool.name);
  }
  return enabled;
}

export function describeMemoryAgentTools() {
  return MEMORY_AGENT_TOOLS.map((tool) => ({
    name: tool.name, label: tool.label, effect: tool.effect, description: tool.description,
    enabledByDefault: Boolean(tool.enabledByDefault), required: Boolean(tool.required)
  }));
}

export async function runConversationMemoryAgent(options = {}) {
  const {
    database, userId, conversation, userMessage, assistantMessage, settings, signal,
    runTools = runToolCompletion, config
  } = options;
  const conversationId = String(conversation?.id || '');
  const skills = normalizeAccessorySkills(conversation?.settings?.accessorySkills || {});
  const skill = skills.memoryAgent || { enabled: 'auto', modelOverride: '', providerProfileId: '', tools: {} };
  const rules = () => recordAutomaticConversationMemories(database, userId, conversationId, { userMessage, assistantMessage }) || [];

  if (skill.enabled === false) {
    return { mode: 'rules', reason: 'agent_disabled', memories: rules() };
  }
  const resolved = resolveAccessorySkillSettings(database, userId, settings, skill, { config });
  if (!hasUsableProvider(resolved.settings) || resolved.settings.providerType === 'mock') {
    return { mode: 'rules', reason: 'provider_unavailable', providerSource: resolved.source, memories: rules() };
  }
  if (!String(assistantMessage?.content || '').trim() && !String(userMessage?.content || '').trim()) {
    return { mode: 'agent', reason: 'empty_turn', memories: [], toolCalls: [] };
  }

  const session = createMemoryAgentSession({ database, userId, conversationId, userMessage, assistantMessage, skill });
  const controller = new AbortController();
  const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(Object.assign(new Error('memory agent timed out'), { code: 'AGENT_TIMEOUT', retryable: true })), AGENT_TIMEOUT_MS);
  try {
    const completion = await retryProviderCall(() => {
      session.refreshSnapshot();
      return runTools(
        resolved.settings,
        buildMemoryAgentMessages(session),
        session.toolDefinitions,
        session.execute,
        {
          maxRounds: MAX_ROUNDS,
          thinkingEnabled: false,
          temperature: 0,
          signal: combinedSignal,
          database,
          userId,
          onNoToolCall: memoryNoToolNudge
        }
      );
    }, { signal: combinedSignal, retryDelaysMs: options.retryDelaysMs });
    if (!session.finished) throw Object.assign(new Error('记忆代理未调用 finish_memory_review，整理未完成'), { code: 'MEMORY_AGENT_INCOMPLETE' });
    return {
      mode: 'agent',
      providerSource: resolved.source,
      providerWarning: resolved.warning || '',
      model: resolved.settings.model || '',
      finished: session.finished,
      summary: session.summary,
      memories: session.created,
      updated: session.updated,
      merged: session.merged,
      invalidated: session.invalidated,
      pinned: session.pinned,
      rejected: session.rejected,
      toolCalls: session.calls,
      usage: completion?.usage || null
    };
  } catch (error) {
    if (signal?.aborted || isTimelineError(error)) throw error;
    // A model or transport failure must not lose the turn: fall back to rule extraction.
    return {
      mode: 'rules',
      fallback: true,
      reason: 'agent_failed',
      error: String(error?.publicMessage || error?.message || 'memory agent failed').slice(0, 300),
      code: String(error?.code || ''),
      providerSource: resolved.source,
      memories: session.created.length ? session.created : rules(),
      updated: session.updated,
      merged: session.merged,
      invalidated: session.invalidated,
      pinned: session.pinned,
      rejected: session.rejected,
      finished: session.finished,
      toolCalls: session.calls
    };
  } finally {
    clearTimeout(timer);
  }
}

function isTimelineError(error) {
  const code = String(error?.code || '');
  return ['CONVERSATION_TIMELINE_CHANGED', 'JOB_CANCELLED', 'JOB_SOURCE_STALE', 'JOB_LEASE_LOST', 'JOB_STEP_SETTLED'].includes(code);
}

function createMemoryAgentSession({ database, userId, conversationId, userMessage, assistantMessage, skill }) {
  const observation = [userMessage, assistantMessage]
    .filter((message) => message && message.id)
    .map((message) => ({
      id: String(message.id),
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: String(message.content || '').slice(0, OBSERVATION_CHARACTER_LIMIT)
    }));
  const observationById = new Map(observation.map((message) => [message.id, message]));
  const enabledTools = resolveMemoryAgentTools(skill);
  const existing = listConversationMemories(database, userId, conversationId, { includeArchived: true }) || [];
  const dedupeKeys = new Set(existing.map(memoryDedupeKey).filter(Boolean));
  const counts = {};
  const session = {
    observation,
    enabledTools,
    existingMemories: buildExistingMemorySummary(database, userId, conversationId, existing, observation),
    toolDefinitions: buildMemoryAgentToolDefinitions(enabledTools),
    created: [],
    updated: [],
    merged: [],
    invalidated: [],
    pinned: [],
    rejected: [],
    calls: [],
    finished: false,
    summary: ''
  };
  session.refreshSnapshot = () => {
    session.existingMemories = buildExistingMemorySummary(database, userId, conversationId, existing, observation);
  };

  const budget = (name) => {
    const tool = MEMORY_AGENT_TOOLS.find((entry) => entry.name === name);
    counts[name] = (counts[name] || 0) + 1;
    if (tool && counts[name] > tool.limit) {
      return { ok: false, error: `${name} 本轮调用次数已达上限（${tool.limit}）`, stop: name === 'finish_memory_review' };
    }
    return null;
  };

  const handlers = {
    search_memories(args) {
      const query = String(args?.query || '').trim().slice(0, 200);
      const limit = clampInteger(args?.limit, 1, 20, 8);
      const memoryType = normalizeOptionalType(args?.memoryType);
      const includeArchived = args?.includeArchived === true;
      const hits = new Map();
      if (query) {
        for (const result of searchUserContent(database, userId, query, { conversationId, types: ['memory'], limit: 40, includeUnreviewedAutomatic: true }).results) {
          hits.set(result.id, true);
        }
      }
      const items = [];
      for (const memory of existing) {
        if (!includeArchived && memory.archived) continue;
        if (memoryType && memory.memoryType !== memoryType) continue;
        const text = `${memory.subject} ${memory.content}`.toLowerCase();
        if (query && !hits.has(memory.id) && !text.includes(query.toLowerCase())) continue;
        items.push(summarizeMemory(memory, true));
      }
      return { ok: true, memories: items.slice(0, limit), total: items.length };
    },
    search_history(args) {
      const query = String(args?.query || '').trim().slice(0, 200);
      if (!query) return { ok: false, error: 'query 不能为空' };
      const limit = clampInteger(args?.limit, 1, 10, 5);
      const results = searchUserContent(database, userId, query, { conversationId, types: ['message'], limit: limit + observationById.size }).results
        .filter((result) => !observationById.has(result.id))
        .slice(0, limit)
        .map((result) => ({ messageId: result.id, role: result.role || '', snippet: String(result.excerpt || '').slice(0, 400) }));
      return { ok: true, messages: results };
    },
    record_memory(args) {
      const memoryType = normalizeOptionalType(args?.memoryType);
      if (!memoryType) return { ok: false, error: `memoryType 必须是 ${MEMORY_TYPES.join('/')} 之一` };
      const content = String(args?.content || '').replace(/\s+/g, ' ').trim().slice(0, MEMORY_CONTENT_LIMIT);
      if (!content) return { ok: false, error: 'content 不能为空' };
      const evidence = resolveEvidence(observationById, args);
      if (!evidence.ok) return evidence;
      const candidate = {
        memoryType,
        subject: String(args?.subject || '').trim().slice(0, 160),
        content,
        confidence: Math.min(clampNumber(args?.confidence, 0, 1, 0.8), evidence.confidenceCap),
        sourceMessageId: evidence.sourceMessageId,
        sourceKind: 'auto',
        sourceExcerpt: evidence.excerpt,
        enabled: true
      };
      const key = memoryDedupeKey(candidate);
      if (dedupeKeys.has(key)) return { ok: false, error: '已存在内容相同的记忆，请改用 update_memory 或跳过', duplicate: true };
      const memory = createConversationMemory(database, userId, conversationId, candidate);
      if (!memory) return { ok: false, error: '会话不存在' };
      dedupeKeys.add(key);
      existing.push(memory);
      session.created.push(memory);
      return { ok: true, memory: summarizeMemory(memory), evidence: evidence.kind };
    },
    update_memory(args) {
      const target = requireTarget(args?.memoryId, args?.revision);
      if (!target.ok) return target;
      const memory = target.memory;
      if (memory.pinned) return { ok: false, error: '置顶记忆由用户维护，不能由记忆整理修改' };
      if (memory.archived) return { ok: false, error: '已归档或失效的记忆不能修改' };
      const nextType = args?.memoryType === undefined ? memory.memoryType : normalizeOptionalType(args.memoryType);
      if (!nextType) return { ok: false, error: `memoryType 必须是 ${MEMORY_TYPES.join('/')} 之一` };
      const payload = {
        ...memory,
        memoryType: nextType,
        subject: args?.subject === undefined ? memory.subject : String(args.subject || '').trim().slice(0, 160),
        content: args?.content === undefined ? memory.content : String(args.content || '').replace(/\s+/g, ' ').trim().slice(0, MEMORY_CONTENT_LIMIT),
        confidence: args?.confidence === undefined ? memory.confidence : clampNumber(args.confidence, 0, 1, memory.confidence),
        revision: memory.revision
      };
      if (!payload.content) return { ok: false, error: 'content 不能为空' };
      if (payload.content !== memory.content || args?.sourceMessageId !== undefined || args?.quote !== undefined) {
        const evidence = resolveEvidence(observationById, args);
        if (!evidence.ok) return evidence;
        payload.sourceMessageId = evidence.sourceMessageId;
        payload.sourceExcerpt = evidence.excerpt;
        payload.confidence = Math.min(payload.confidence, evidence.confidenceCap);
      } else if (args?.confidence !== undefined) {
        const source = observationById.get(memory.sourceMessageId)
          || database.prepare('SELECT content FROM messages WHERE id = ? AND user_id = ? AND conversation_id = ?')
            .get(memory.sourceMessageId, userId, conversationId);
        const cap = !memory.sourceExcerpt ? UNSOURCED_CONFIDENCE_CAP
          : source?.content.replace(/\s+/g, ' ').includes(memory.sourceExcerpt) ? 1 : PARAPHRASE_CONFIDENCE_CAP;
        payload.confidence = Math.min(payload.confidence, cap);
      }
      if (['memoryType', 'subject', 'content', 'confidence', 'sourceMessageId', 'sourceExcerpt'].every(key => payload[key] === memory[key])) {
        return { ok: true, unchanged: true, memory: summarizeMemory(memory, true) };
      }
      const updated = updateConversationMemory(database, userId, conversationId, memory.id, payload);
      replaceExisting(updated);
      session.updated.push(updated);
      return { ok: true, memory: summarizeMemory(updated) };
    },
    merge_memories(args) {
      const target = requireTarget(args?.targetId, args?.targetRevision);
      if (!target.ok) return target;
      if (target.memory.pinned) return { ok: false, error: '置顶记忆不能作为合并目标' };
      if (target.memory.archived) return { ok: false, error: '已归档或失效的记忆不能作为合并目标' };
      const sourceItems = Array.isArray(args?.sourceItems) ? args.sourceItems : [];
      if (sourceItems.length < 1 || sourceItems.length > 8 || new Set(sourceItems.map(item => item.id)).size !== sourceItems.length
        || sourceItems.some(item => item.id === target.memory.id)) return { ok: false, error: 'sourceItems 需要 1～8 条唯一来源，且不能包含目标' };
      for (const item of sourceItems) {
        const source = requireTarget(item?.id, item?.revision);
        if (!source.ok) return source;
        if (source.memory.pinned) return { ok: false, error: '置顶记忆不能作为合并来源' };
        if (source.memory.archived) return { ok: false, error: '已归档或失效的记忆不能作为合并来源' };
      }
      const result = mergeConversationMemories(database, userId, conversationId, {
        targetId: target.memory.id,
        targetRevision: target.memory.revision,
        sourceItems: sourceItems.map((item) => ({ id: String(item.id), revision: Number(item.revision) })),
        ...(args?.content !== undefined ? { content: String(args.content || '').replace(/\s+/g, ' ').trim().slice(0, MEMORY_CONTENT_LIMIT) } : {}),
        ...(args?.subject !== undefined ? { subject: String(args.subject || '').trim().slice(0, 160) } : {})
      });
      replaceExisting(result.memory);
      for (const sourceId of result.sourceIds) {
        const index = existing.findIndex((memory) => memory.id === sourceId);
        if (index >= 0) existing[index] = { ...existing[index], archived: true, enabled: false, mergedIntoId: result.memory.id, revision: existing[index].revision + 1 };
      }
      session.merged.push({ operationId: result.operationId, targetId: result.memory.id, sourceIds: result.sourceIds });
      return { ok: true, memory: summarizeMemory(result.memory), operationId: result.operationId, archivedSourceIds: result.sourceIds };
    },
    invalidate_memory(args) {
      const target = requireTarget(args?.memoryId, args?.revision);
      if (!target.ok) return target;
      if (target.memory.pinned) return { ok: false, error: '置顶记忆不能标记失效' };
      if (target.memory.archived) return { ok: false, error: '已归档或失效的记忆无需再次标记失效' };
      const reason = String(args?.reason || '').trim().slice(0, 300);
      if (!reason) return { ok: false, error: '请提供 reason，说明本轮哪条证据否定了这条记忆' };
      const evidence = resolveEvidence(observationById, args);
      if (!evidence.ok) return evidence;
      const [updated] = batchReviewConversationMemories(database, userId, conversationId, {
        action: 'invalidate', items: [{ id: target.memory.id, revision: target.memory.revision }]
      });
      replaceExisting(updated);
      session.invalidated.push({ id: updated.id, reason, sourceMessageId: evidence.sourceMessageId, quote: evidence.excerpt });
      return { ok: true, memory: summarizeMemory(updated) };
    },
    pin_memory(args) {
      const target = requireTarget(args?.memoryId, args?.revision);
      if (!target.ok) return target;
      if (target.memory.archived) return { ok: false, error: '已归档或失效的记忆不能置顶或取消置顶' };
      const updated = pinConversationMemory(database, userId, conversationId, target.memory.id, {
        pinned: args?.pinned !== false, revision: target.memory.revision
      });
      replaceExisting(updated);
      session.pinned.push({ id: updated.id, pinned: updated.pinned });
      return { ok: true, memory: summarizeMemory(updated) };
    },
    finish_memory_review(args) {
      session.finished = true;
      session.summary = String(args?.summary || '').trim().slice(0, 300);
      return { ok: true, stop: true, summary: session.summary };
    }
  };

  function requireTarget(memoryId, revision) {
    const id = String(memoryId || '').trim();
    const memory = existing.find((entry) => entry.id === id);
    if (!id || !memory) return { ok: false, error: 'memoryId 不存在或不属于当前会话，请先用 search_memories 确认' };
    const expected = Number(revision);
    if (!Number.isInteger(expected) || expected !== memory.revision) {
      return { ok: false, error: `revision 不匹配，当前版本为 ${memory.revision}`, currentRevision: memory.revision };
    }
    return { ok: true, memory };
  }

  function replaceExisting(memory) {
    if (!memory) return;
    const index = existing.findIndex((entry) => entry.id === memory.id);
    if (index >= 0) existing[index] = memory;
    else existing.push(memory);
    dedupeKeys.clear();
    for (const entry of existing) dedupeKeys.add(memoryDedupeKey(entry));
  }

  session.execute = async (toolName, args) => {
    const name = String(toolName || '');
    const call = { tool: name, ok: false };
    session.calls.push(call);
    if (!enabledTools.includes(name) || typeof handlers[name] !== 'function') {
      call.error = 'tool_disabled';
      return { ok: false, error: `工具 ${name} 未启用` };
    }
    const exhausted = budget(name);
    if (exhausted) {
      call.error = 'limit';
      return exhausted;
    }
    try {
      const result = handlers[name](args && typeof args === 'object' ? args : {});
      call.ok = result?.ok !== false;
      if (!call.ok) {
        call.error = String(result?.error || '').slice(0, 200);
        session.rejected.push({ tool: name, error: call.error });
      }
      return result;
    } catch (error) {
      if (isTimelineError(error)) throw error;
      call.error = String(error?.message || 'tool failed').slice(0, 200);
      session.rejected.push({ tool: name, error: call.error });
      return { ok: false, error: call.error };
    }
  };

  return session;
}

function resolveEvidence(observationById, args = {}) {
  const sourceMessageId = String(args.sourceMessageId || '').trim();
  const source = observationById.get(sourceMessageId);
  if (!source) {
    return { ok: false, error: `sourceMessageId 必须是本轮消息之一：${[...observationById.keys()].join(', ')}` };
  }
  const quote = String(args.quote || '').replace(/\s+/g, ' ').trim().slice(0, 1000);
  if (!quote) {
    return { ok: true, sourceMessageId, excerpt: '', kind: 'unsourced', confidenceCap: UNSOURCED_CONFIDENCE_CAP };
  }
  const normalizedSource = source.content.replace(/\s+/g, ' ');
  if (normalizedSource.includes(quote)) {
    return { ok: true, sourceMessageId, excerpt: quote, kind: 'quote', confidenceCap: 1 };
  }
  return { ok: true, sourceMessageId, excerpt: quote, kind: 'paraphrase', confidenceCap: PARAPHRASE_CONFIDENCE_CAP };
}

function buildExistingMemorySummary(database, userId, conversationId, existing, observation) {
  const query = observation.map((message) => message.content).join('\n').slice(0, 4_000);
  const relevant = selectConversationMemoryContext(database, userId, conversationId, { query, budgetCharacters: 6_000 });
  const relevantIds = new Set(relevant.entries.map((entry) => entry.id));
  const items = [];
  const seen = new Set();
  const push = (memory) => {
    if (!memory || seen.has(memory.id) || items.length >= EXISTING_MEMORY_LIMIT) return;
    seen.add(memory.id);
    items.push(summarizeMemory(memory));
  };
  for (const memory of existing) if (relevantIds.has(memory.id)) push(memory);
  for (const memory of existing) if (!memory.archived) push(memory);
  return items;
}

function summarizeMemory(memory, fullContent = false) {
  const content = String(memory.content || '');
  return {
    id: memory.id,
    revision: memory.revision,
    memoryType: memory.memoryType,
    subject: memory.subject || '',
    content: fullContent ? content : content.slice(0, 300),
    contentTruncated: !fullContent && content.length > 300,
    confidence: memory.confidence,
    enabled: Boolean(memory.enabled),
    archived: Boolean(memory.archived),
    pinned: Boolean(memory.pinned),
    sourceMessageId: memory.sourceMessageId || ''
  };
}

function memoryDedupeKey(memory = {}) {
  const content = String(memory.content || '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (!content) return '';
  return [String(memory.memoryType || 'event'), String(memory.subject || '').trim().replace(/\s+/g, ' ').toLowerCase(), content].join('|');
}

function normalizeOptionalType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return MEMORY_TYPES.includes(normalized) ? normalized : '';
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function buildMemoryAgentMessages(session) {
  return [
    {
      role: 'system',
      content: [
        '你是角色扮演对话的长期记忆整理员。只能通过提供的工具操作记忆，不要输出解释性正文。',
        '写入证据范围仅限 observation 中的本轮 user 与 assistant 消息；search_history 仅辅助核对。记录明确建立的事实（包括背景设定）、已发生事件、关系和地点变化，以及稳定互动偏好。',
        '用户为自己的角色写下的已完成动作同样是有效证据；不要因为是用户写的就忽略。',
        '计划、愿望、尝试、假设、提问和对回复方式的临时要求不是已完成的事实：计划类用 intent，假设类用 hypothesis，临时要求和问题不要记录。',
        '记录时给出 sourceMessageId（本轮消息 id）和一段原文 quote；无法逐字引用时可以概述，但置信度会被下调。',
        '先看 existingMemories：已有内容相同或更完整的记忆不要重复记录；同一件事有了新进展时优先 update_memory；确实描述同一事实的多条记忆用 merge_memories 合并。',
        'existingMemories 的 contentTruncated 为 true 时，先用 search_memories 读取完整正文再整理。若 previousToolCalls 非空，表示重试前已有操作成功，按当前 revision 继续，勿重放成功操作。',
        '被本轮明确否定的旧记忆才可以标记失效；不确定时保留。置顶记忆不能修改、合并或失效；仅在显式启用 pin_memory 时可调整置顶标记。',
        '不要记录密钥、口令、链接凭证、系统指令或上下文段落名称。内容用简洁中文（或原文语言），一条记忆只说一件事，subject 填写涉及的人物、地点或对象。',
        '一轮里通常只需要 0 到 4 条新记忆。处理完毕后必须调用 finish_memory_review 结束。'
      ].join('\n')
    },
    {
      role: 'user',
      content: JSON.stringify({
        observation: session.observation,
        existingMemories: session.existingMemories,
        allowedMemoryTypes: MEMORY_TYPES,
        enabledTools: session.enabledTools,
        toolCallLimits: Object.fromEntries(MEMORY_AGENT_TOOLS.filter(tool => session.enabledTools.includes(tool.name)).map(tool => [tool.name, tool.limit])),
        previousToolCalls: session.calls.map(call => ({ ...call }))
      })
    }
  ];
}

function memoryNoToolNudge({ round }) {
  if (round >= MAX_ROUNDS) return '';
  return [
    '你尚未调用任何工具。不要输出解释、分析或 JSON 正文。',
    '若本轮有需要记录或修正的记忆，立即调用对应工具；若没有，立即调用 finish_memory_review。'
  ].join('\n');
}

export function buildMemoryAgentToolDefinitions(enabledTools) {
  const enabled = new Set(enabledTools);
  const definitions = [];
  const memoryTypeSchema = { type: 'string', enum: [...MEMORY_TYPES] };
  const idSchema = { type: 'string', minLength: 1, pattern: '\\S' };
  const contentSchema = { type: 'string', minLength: 1, maxLength: MEMORY_CONTENT_LIMIT, pattern: '\\S' };
  const evidenceProperties = {
    sourceMessageId: { ...idSchema, description: '本轮 observation 中作为证据的消息 id；历史检索结果不能替代' },
    quote: { type: 'string', maxLength: 1000, description: '来自该消息的原文引用；无法逐字引用时写概述' }
  };
  const add = (name, properties, required = []) => {
    if (!enabled.has(name)) return;
    definitions.push({
      type: 'function',
      function: { name, description: MEMORY_AGENT_TOOLS.find(tool => tool.name === name).description,
        parameters: { type: 'object', properties, required } }
    });
  };
  add('search_memories', {
    query: { type: 'string', maxLength: 200 },
    memoryType: memoryTypeSchema,
    includeArchived: { type: 'boolean' },
    limit: { type: 'integer', minimum: 1, maximum: 20 }
  });
  add('search_history', {
    query: { ...idSchema, maxLength: 200 },
    limit: { type: 'integer', minimum: 1, maximum: 10 }
  }, ['query']);
  add('record_memory', {
    memoryType: memoryTypeSchema,
    subject: { type: 'string', maxLength: 160, description: '涉及的人物、地点或对象' },
    content: { ...contentSchema, description: '一句话，只说一件事' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    ...evidenceProperties
  }, ['memoryType', 'content', 'sourceMessageId']);
  add('update_memory', {
    memoryId: idSchema,
    revision: { type: 'integer', minimum: 1, description: 'existingMemories 或 search_memories 返回的 revision' },
    memoryType: memoryTypeSchema,
    subject: { type: 'string', maxLength: 160 },
    content: { ...contentSchema, description: '修改正文需提供本轮 sourceMessageId；省略则保留' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    ...evidenceProperties
  }, ['memoryId', 'revision']);
  add('merge_memories', {
    targetId: idSchema,
    targetRevision: { type: 'integer', minimum: 1 },
    sourceItems: {
      type: 'array', minItems: 1, maxItems: 8,
      items: { type: 'object', properties: { id: idSchema, revision: { type: 'integer', minimum: 1 } }, required: ['id', 'revision'] }
    },
    subject: { type: 'string', maxLength: 160 },
    content: { ...contentSchema, description: '合并后的内容；省略则保留目标记忆内容' }
  }, ['targetId', 'targetRevision', 'sourceItems']);
  add('invalidate_memory', {
    memoryId: idSchema,
    revision: { type: 'integer', minimum: 1 },
    reason: { ...idSchema, maxLength: 300, description: '本轮哪条证据否定了它' },
    ...evidenceProperties
  }, ['memoryId', 'revision', 'reason', 'sourceMessageId']);
  add('pin_memory', {
    memoryId: idSchema,
    revision: { type: 'integer', minimum: 1 },
    pinned: { type: 'boolean' }
  }, ['memoryId', 'revision']);
  add('finish_memory_review', {
    summary: { type: 'string', maxLength: 300 }
  });
  return definitions;
}
