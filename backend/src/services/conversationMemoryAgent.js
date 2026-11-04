import { z } from 'zod';
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
import { searchUserContent } from './fullTextSearch.js';
import { hasUsableProvider, runToolCompletion } from './providers.js';
import { accessorySkillThinkingOptions,resolveAccessorySkillSettings } from './accessorySkillProvider.js';
import { retryProviderCall } from './providerRetry.js';
import { newId, nowIso } from '../security.js';
import { assertMemoryEventRevisionTargets, commitMemoryPacket, getMemoryProcessingState } from './conversationMemory/commit.js';
import { getCurrentMemoryEvent, getMemoryMessage, listMemoryEntities } from '../repositories/conversationMemoryRepository.js';
import { memoryHash, normalizeMemoryPacket } from '../domain/conversationMemory/contracts.js';
import { buildMemoryExtractionPacketSchema } from '../domain/conversationMemory/extractionSchema.js';
import { normalizeMemoryPolicy } from '../../../shared/memoryPolicy.js';
import { getStatusBar } from '../modules/statusBars.js';

export const MEMORY_TYPES = Object.freeze(['event', 'relationship', 'location', 'preference', 'fact', 'summary', 'intent', 'hypothesis']);

const OBSERVATION_CHARACTER_LIMIT = 20_000;
const EXISTING_MEMORY_LIMIT = 40;
const MEMORY_CONTENT_LIMIT = 600;
const PARAPHRASE_CONFIDENCE_CAP = 0.6;
const UNSOURCED_CONFIDENCE_CAP = 0.5;
const MAX_ROUNDS = 8;
const AGENT_TIMEOUT_MS = 90_000;
const extractionPacketSchema = buildMemoryExtractionPacketSchema();
const extractionPacketValidator = z.fromJSONSchema(extractionPacketSchema);

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
    if (tool.name === 'merge_memories' && !normalizeMemoryPolicy(skill.memoryPolicy).autoConsolidate) continue;
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
  const baseState = getMemoryProcessingState(database, userId, conversationId);
  const sourceVersions = [userMessage, assistantMessage].filter(message => message?.id).map(message => {
    const live = getMemoryMessage(database, userId, conversationId, message.id);
    return live ? { messageId:live.id, revision:live.revision, contentHash:memoryHash({role:live.role,content:live.content,attachments:JSON.parse(live.attachments_json||'[]')}) } : null;
  }).filter(Boolean);

  if (skill.enabled === false || skill.memoryPolicy?.mode === 'raw') {
    return { mode: 'raw', reason: 'agent_disabled', memories: [], requiredStages:[] };
  }
  const resolved = resolveAccessorySkillSettings(database, userId, settings, skill, { config });
  if (!hasUsableProvider(resolved.settings) || resolved.settings.providerType === 'mock') {
    if (skill.enabled === true) throw Object.assign(new Error('记忆整理已开启，但未配置可用模型；请修复配置或切换原文模式'), { code:'MEMORY_PROVIDER_UNAVAILABLE', status:409, accepted:false });
    return { mode: 'raw', reason: 'provider_unavailable', providerSource: resolved.source, memories: [], requiredStages:[] };
  }
  if (!String(assistantMessage?.content || '').trim() && !String(userMessage?.content || '').trim()) {
    return { mode: 'agent', reason: 'empty_turn', memories: [], toolCalls: [] };
  }

  const packetContext = {
    sources: sourceVersions,
    messageId: assistantMessage?.id || userMessage?.id || '',
    idempotencyKey: options.idempotencyKey || `turn:${assistantMessage?.id || userMessage?.id}:${baseState.timelineRevision}:${sourceVersions.map(source => source.revision).join(':')}`
  };
  const session = createMemoryAgentSession({ database, userId, conversationId, userMessage, assistantMessage, skill, packetContext });
  const controller = new AbortController();
  const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(Object.assign(new Error('memory agent timed out'), { code: 'AGENT_TIMEOUT', retryable: true })), AGENT_TIMEOUT_MS);
  try {
    const completion = await retryProviderCall(() => {
      if (session.finished) return {};
      session.refreshSnapshot();
      return runTools(
        resolved.settings,
        buildMemoryAgentMessages(session),
        session.toolDefinitions,
        session.execute,
        {
          maxRounds: MAX_ROUNDS,
          ...accessorySkillThinkingOptions(resolved.settings,skill),
          temperature: 0,
          signal: combinedSignal,
          database,
          userId,
          onNoToolCall: memoryNoToolNudge
        }
      );
    }, { signal: combinedSignal, retryDelaysMs: options.retryDelaysMs });
    if (!session.finished) throw session.packetError || Object.assign(new Error('记忆代理未调用 finish_memory_review，整理未完成'), { code: 'MEMORY_AGENT_INCOMPLETE' });
    // Finish validated the complete packet, including generated projections, before any domain planning.
    const packet = normalizeMemoryPacket(session.packet);
    const projectedEventKeys = session.projectedEventKeys;
    const commit = ({applyDomainPlan,enqueueDerived=options.enqueueDerived,guard=options.guard}={}) => commitMemoryPacket(database,userId,conversationId,packet,{
      expectedTimelineRevision:baseState.timelineRevision, expectedRevision:baseState.revision, guard,
      enqueueDerived, enforceOrder:options.enforceOrder,
      mergeProvenance: session.merged,
      projectedEventKeys,
      applyActions:() => {
        for (const proposal of session.proposals) {
          if (proposal.type==='create') createConversationMemory(database,userId,conversationId,{...proposal.payload,_stagedId:proposal.id});
          if (proposal.type==='update') updateConversationMemory(database,userId,conversationId,proposal.id,proposal.payload);
          if (proposal.type==='merge') {
            const result=mergeConversationMemories(database,userId,conversationId,proposal.payload);
            const staged=session.merged.find(item=>item.operationId===proposal.operationId);
            if (staged) staged.operationId=result.operationId;
          }
          if (proposal.type==='review') batchReviewConversationMemories(database,userId,conversationId,proposal.payload);
          if (proposal.type==='pin') pinConversationMemory(database,userId,conversationId,proposal.id,proposal.payload);
        }
        const domainResult=applyDomainPlan?.();
        if (domainResult && typeof domainResult.then==='function') throw new Error('Domain plan application must be synchronous');
        const ids = stagedMemoryIds(session.proposals);
        return {memories:(listConversationMemories(database,userId,conversationId,{includeArchived:true})||[]).filter(memory=>ids.has(memory.id))};
      }
    });
    if (options.prepareOnly) return {mode:'prepared',packet,commit,providerSource:resolved.source,model:resolved.settings.model||'',usage:completion?.usage||null};
    const receipt=commit();
    return {
      mode: 'agent',
      receipt,
      packet:receipt.packet,
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
    // Failed extraction leaves staged operations uncommitted; the durable core job can retry safely.
    error.code ||= 'MEMORY_EXTRACTION_FAILED';
    error.retryable = true;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function isTimelineError(error) {
  const code = String(error?.code || '');
  return ['CONVERSATION_TIMELINE_CHANGED', 'JOB_CANCELLED', 'JOB_SOURCE_STALE', 'JOB_LEASE_LOST', 'JOB_STEP_SETTLED'].includes(code);
}

function createMemoryAgentSession({ database, userId, conversationId, userMessage, assistantMessage, skill, packetContext }) {
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
    summary: '',
    proposals: [],
    packet: {},
    packetError: null,
    projectedEventKeys: new Set()
  };
  session.policy = normalizeMemoryPolicy(skill.memoryPolicy);
  const statusBar = session.policy.statusLink ? getStatusBar(database, userId, conversationId) : null;
  session.statusContext = statusBar ? { id: statusBar.id, name: statusBar.name, variables: statusBar.variables } : null;
  session.workspace=existing;
  // Keep the database resolver server-side; model messages contain only the explicit observation/read-model fields.
  session.validateRevisionTargets=(events,projectedMemoryIds)=>assertMemoryEventRevisionTargets(database,userId,conversationId,events,{projectedMemoryIds});
  session.entities=listMemoryEntities(database,userId,conversationId).slice(0,80).map(entity=>({id:entity.id,name:entity.name,kind:entity.kind,castKey:entity.cast_key}));
  const card = database.prepare(`SELECT c.name FROM characters c JOIN conversations v ON v.character_id=c.id
    WHERE v.id=? AND v.user_id=?`).get(conversationId, userId);
  session.cardActor = card && !session.entities.some(entity => entity.castKey === 'main-character')
    ? { key: 'card-main', name: card.name, kind: 'actor', castKey: 'main-character' } : null;
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
      const memory = stageCreate(candidate);
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
      if (args?.search !== undefined || args?.replacement !== undefined) {
        if (args.content !== undefined || typeof args.search !== 'string' || !args.search || typeof args.replacement !== 'string')
          return { ok: false, error: '精确修改需要 search 和 replacement，不能同时提供 content' };
        const expected = args.expectedOccurrences ?? 1;
        const occurrences = memory.content.split(args.search).length - 1;
        if (!Number.isInteger(expected) || expected < 1 || expected > 20 || occurrences !== expected)
          return { ok: false, error: '精确修改匹配次数不符，请先检索完整记忆后重试', occurrences, expectedOccurrences: expected };
        payload.content = memory.content.split(args.search).join(args.replacement).trim();
        if (payload.content.length > MEMORY_CONTENT_LIMIT) return { ok: false, error: '修改后记忆超过 600 字限制' };
      }
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
      const updated = stageUpdate(memory.id, payload);
      replaceExisting(updated);
      session.updated.push(updated);
      return { ok: true, memory: summarizeMemory(updated) };
    },
    merge_memories(args) {
      const target = requireTarget(args?.targetId, args?.targetRevision);
      if (!target.ok) return target;
      if (target.memory.pinned) return { ok: false, error: '置顶记忆不能作为合并目标' };
      if (target.memory.archived) return { ok: false, error: '已归档或失效的记忆不能作为合并目标' };
      if (args?.subject !== undefined && String(args.subject).trim().normalize('NFKC') !== String(target.memory.subject || '').trim().normalize('NFKC'))
        return { ok: false, error: '自动合并不能改变角色主体，请通过单条修改或结构化修订更正主体' };
      const sourceItems = Array.isArray(args?.sourceItems) ? args.sourceItems : [];
      if (sourceItems.length < 1 || sourceItems.length > 8 || new Set(sourceItems.map(item => item.id)).size !== sourceItems.length
        || sourceItems.some(item => item.id === target.memory.id)) return { ok: false, error: 'sourceItems 需要 1～8 条唯一来源，且不能包含目标' };
      const targetEvent = getCurrentMemoryEvent(database, userId, conversationId, target.memory.id);
      for (const item of sourceItems) {
        const source = requireTarget(item?.id, item?.revision);
        if (!source.ok) return source;
        if (source.memory.pinned) return { ok: false, error: '置顶记忆不能作为合并来源' };
        if (source.memory.archived) return { ok: false, error: '已归档或失效的记忆不能作为合并来源' };
        const sourceEvent = getCurrentMemoryEvent(database, userId, conversationId, source.memory.id);
        if (!compatibleConsolidation(target.memory, source.memory, targetEvent, sourceEvent)) return { ok: false, error: '自动合并需要相同角色主体、类型、受众、真假和语义范围，请保留独立记忆' };
      }
      if ([target.memory, ...sourceItems.map(item => existing.find(memory => memory.id === item.id))].some(hasStructuredDependents))
        return { ok: false, error: '包含结构化关系、知情、剧情线或领域引用的记忆需要保留独立来源，请使用派生摘要压缩' };
      const result = stageMerge({
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
      session.merged.push({ operationId: result.operationId, targetId: result.memory.id, sourceIds: result.sourceIds, content: result.memory.content });
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
      const [updated] = stageReview({
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
      const updated = stagePin(target.memory.id, {
        pinned: args?.pinned !== false, revision: target.memory.revision
      });
      replaceExisting(updated);
      session.pinned.push({ id: updated.id, pinned: updated.pinned });
      return { ok: true, memory: summarizeMemory(updated) };
    },
    async batch_memory_changes(args) {
      if (!Array.isArray(args?.changes) || !args.changes.length || args.changes.length > 12)
        return { ok: false, error: 'changes 需要 1～12 条变更' };
      const allowed = new Set(['record_memory', 'update_memory', 'merge_memories', 'invalidate_memory', 'pin_memory']);
      const results = [];
      for (const [index, change] of args.changes.entries()) {
        const result = allowed.has(change?.tool) ? await session.execute(change.tool, change.args)
          : { ok: false, error: '批量变更仅接受记忆写工具，不允许嵌套批量或结束调用' };
        results.push({ index, tool: change?.tool, ...result });
      }
      return { ok: results.every(result => result.ok), results, staged: results.filter(result => result.ok).length,
        error: results.some(result => !result.ok) ? '部分提案未通过，成功项仍在工作区；按各项结果修正后再结束整理' : undefined };
    },
    finish_memory_review(args) {
      // Reject malformed model output before sealing; the bounded loop can submit a corrected packet.
      const proposed = args?.packet === undefined ? {} : args.packet;
      const validation = extractionPacketValidator.safeParse(proposed);
      if (!validation.success) {
        const issue = validation.error.issues[0];
        throw Object.assign(new Error(`记忆提取包格式无效（${['packet', ...issue.path].join('.')}）：${issue.message}`), { code: 'MEMORY_PACKET_INVALID' });
      }
      const summary = String(args?.summary || '').trim().slice(0, 300);
      const prepared = prepareMemoryAgentPacket(session, proposed, summary, packetContext);
      session.packet = prepared.packet;
      session.projectedEventKeys = prepared.projectedEventKeys;
      session.summary = summary;
      session.packetError = null;
      session.finished = true;
      return { ok: true, stop: true, summary: session.summary };
    }
  };

  // Tools modify this isolated proposal workspace. Only finish + validated commit may touch canonical storage.
  function stageCreate(payload) {
    const id=newId();
    session.proposals.push({type:'create',id,payload});
    return {...payload,id,revision:1,archived:false,pinned:false,lifecycle:payload.enabled?'active':'candidate',createdAt:nowIso(),updatedAt:nowIso()};
  }
  function stageUpdate(id,payload) {
    const memory=existing.find(item=>item.id===id);
    session.proposals.push({type:'update',id,payload});
    return {...memory,...payload,id,revision:memory.revision+1,updatedAt:nowIso()};
  }
  function stageMerge(payload) {
    const operationId=newId();
    session.proposals.push({type:'merge',operationId,payload});
    const memory=existing.find(item=>item.id===payload.targetId);
    return {operationId,memory:{...memory,subject:payload.subject??memory.subject,content:payload.content??memory.content,revision:memory.revision+1,enabled:true,archived:false},sourceIds:payload.sourceItems.map(item=>item.id)};
  }
  function stageReview(payload) {
    session.proposals.push({type:'review',payload});
    return payload.items.map(item=>{const memory=existing.find(entry=>entry.id===item.id);return {...memory,enabled:payload.action==='confirm',archived:payload.action==='invalidate',revision:memory.revision+1};});
  }
  function stagePin(id,payload) {
    session.proposals.push({type:'pin',id,payload});
    const memory=existing.find(item=>item.id===id);
    return {...memory,pinned:payload.pinned,revision:memory.revision+1};
  }

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

  // Structured graph records carry distinct temporal/epistemic meaning and cannot be replaced by a text merge.
  function hasStructuredDependents(memory) {
    const event = getCurrentMemoryEvent(database, userId, conversationId, memory.id);
    if (!event) return false;
    return ['memory_claims', 'memory_actor_knowledge', 'memory_plot_threads', 'memory_domain_refs'].some(table =>
      Boolean(database.prepare(`SELECT 1 FROM ${table} WHERE event_id=? LIMIT 1`).get(event.id)));
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
    if (session.finished) return {ok:false,error:'本轮提案已封存，不能在 finish_memory_review 之后继续修改'};
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
      const result = await handlers[name](args && typeof args === 'object' ? args : {});
      call.ok = result?.ok !== false;
      if (!call.ok) {
        call.error = String(result?.error || '').slice(0, 200);
        session.rejected.push({ tool: name, error: call.error });
      }
      return result;
    } catch (error) {
      if (isTimelineError(error)) throw error;
      if (name === 'finish_memory_review') {
        error.code ||= 'MEMORY_PACKET_INVALID';
        session.packetError = error;
      }
      call.error = String(error?.message || 'tool failed').slice(0, 200);
      session.rejected.push({ tool: name, error: call.error });
      const remainingAttempts = name === 'finish_memory_review'
        ? Math.max(0, MEMORY_AGENT_TOOLS.find(tool => tool.name === name).limit - counts[name]) : undefined;
      return { ok: false, error: call.error, ...(remainingAttempts === undefined ? {} : {
        code: error.code || 'MEMORY_PACKET_INVALID', remainingAttempts, stop: remainingAttempts === 0
      }) };
    }
  };

  return session;
}

/** Assemble model proposals with trusted turn metadata and text-tool projections before accepting finish. */
function prepareMemoryAgentPacket(session, proposed, summary, packetContext) {
  const projectedEventKeys = new Set();
  const observationIds = stagedMemoryIds(session.proposals);
  session.validateRevisionTargets(proposed.events || [], observationIds);
  const observations = session.workspace
    .filter(memory => observationIds.has(memory.id))
    .map(memory => {
      const key = `projection:${memory.id}`;
      projectedEventKeys.add(key);
      return {
        key, kind: memory.memoryType, content: memory.content, confidence: memory.confidence,
        truthStatus: memory.truthStatus || 'unverified', visibility: memory.visibility || 'public', actorIds: memory.actorIds || [],
        lifecycle: memory.enabled && !memory.archived ? 'active' : memory.archived ? 'rejected' : 'candidate',
        layer: memory.pinned ? 'canon' : 'history',
        evidence: memory.sourceMessageId ? [{ messageId: memory.sourceMessageId, quote: memory.sourceExcerpt }] : []
      };
    });
  const packet = normalizeMemoryPacket({
    ...proposed, ...packetContext, version: 1,
    entities: [...(proposed.entities || []), ...(session.cardActor && !(proposed.entities || []).some(entity => entity.castKey === 'main-character') ? [session.cardActor] : [])],
    events: [...(proposed.events || []), ...observations], actions: session.proposals, summary
  });
  return { packet, projectedEventKeys };
}

/** Includes all final text projections, including metadata, merge sources and invalidations, exactly once. */
function stagedMemoryIds(proposals) {
  return new Set(proposals.flatMap(proposal => [
    proposal.id, proposal.payload?.targetId,
    ...(proposal.payload?.sourceItems || []).map(item => item.id),
    ...(proposal.payload?.items || []).map(item => item.id)
  ]).filter(Boolean));
}

/** Compare editable scope and canonical identities/time/participants before staging an automatic text merge. */
function compatibleConsolidation(target, source, targetEvent, sourceEvent) {
  const audience = memory => JSON.stringify([...(memory.actorIds || [])].sort());
  const editableScopeMatches = target.memoryType === source.memoryType && String(target.subject || '').trim().normalize('NFKC') === String(source.subject || '').trim().normalize('NFKC')
    && (target.visibility || 'public') === (source.visibility || 'public')
    && (target.truthStatus || 'unverified') === (source.truthStatus || 'unverified') && audience(target) === audience(source);
  if (!editableScopeMatches) return false;
  // Two new text proposals have no canonical identity yet; never treat one missing side as an established match.
  if (!targetEvent || !sourceEvent) return !targetEvent && !sourceEvent;
  if (!['subject_entity_id', 'kind', 'narrative_time', 'location_entity_id', 'visibility', 'truth_status']
    .every(field => (targetEvent[field] || '') === (sourceEvent[field] || ''))) return false;
  const identifiers = value => {
    try {
      const items = JSON.parse(value || '[]');
      return Array.isArray(items) && items.every(item => typeof item === 'string')
        ? JSON.stringify([...new Set(items)].sort()) : null;
    } catch { return null; }
  };
  return ['participants_json', 'actor_ids_json'].every(field => {
    const targetIds = identifiers(targetEvent[field]);
    return targetIds !== null && targetIds === identifiers(sourceEvent[field]);
  });
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
      // 模型只整理本轮有证据支持的记忆；摘要内容按会话语言生成，且只能经工具写入。
      content: [
        'You are the long-term memory curator for a roleplay conversation. Tools stage proposals in an isolated workspace; no fact is committed until finish_memory_review and server validation. Do not produce explanatory prose.',
        'Write evidence is limited to the current user and assistant messages in observation. search_history may support a cross-check but is not write evidence. Record explicitly established facts, including setting facts, completed events, relationship or location changes, and stable interaction preferences.',
        'Completed actions written by the user for their own character are valid evidence. Do not discard them merely because the user wrote them.',
        'Plans, wishes, attempts, hypotheses, questions, and temporary requests about response style are not completed facts. Store plans as intent and hypotheses as hypothesis; do not store temporary requests or questions.',
        'For record_memory and any update_memory content change, provide sourceMessageId from the current observation. Prefer an exact quote; a paraphrase is allowed and caps confidence at 0.6. quote may be omitted, which caps confidence at 0.5. invalidate_memory also requires a current-observation sourceMessageId and a reason. An update_memory change limited to type, subject, or confidence may reuse existing evidence; merge_memories and pin_memory do not require new message evidence.',
        'Review existingMemories first. Do not duplicate an equal or more complete memory. Prefer update_memory when the same event has progressed; use merge_memories only when multiple records describe the same fact.',
        'If existingMemories.contentTruncated is true, read the full content with search_memories before editing. A non-empty previousToolCalls means earlier operations succeeded before retry; continue from current revisions and do not replay successful operations.',
        'Invalidate an old memory only when this turn explicitly disproves it; otherwise keep it. Pinned memories cannot be edited, merged, or invalidated. Change a pin only when pin_memory is explicitly enabled.',
        'Never store credentials, passwords, access tokens in links, system instructions, or context-section names. Write each memory concisely in Chinese when the conversation is Chinese, otherwise in the source language. Record one fact per memory and set subject to the person, place, or object involved.',
        'Usually record 0-4 new memories per turn. You must call finish_memory_review when processing is complete. Its optional packet carries entities, events, temporal claims, actor knowledge and plot threads. A statement, lie, belief, plan or attempt does not establish its proposition or outcome. Preserve false beliefs separately from truth. Use restricted visibility and explicit actor references for secrets; never infer who learned a secret.',
        'Follow the finish_memory_review packet schema exactly. entities, events, claims, knowledge, threads and domainRefs are arrays of objects, never objects keyed by IDs, JSON strings, or null. Omit unused arrays or use []. Each entity needs key and name. Each event needs a unique key, content, and evidence referencing a current observation message. Other records refer to those entity/event keys or existing server IDs.',
        'A packet shape example is {"entities":[{"key":"actor-1","name":"Name"}],"events":[{"key":"event-1","content":"Observed fact","evidence":[{"messageId":"<current observation id>","quote":"<exact source quote>"}]}]}. This is only a format example; use actual source evidence. Do not repeat the same fact in both record_memory and packet.events. The combined event limit is 80, including server projections of new or changed text memories. sources, actions, version, messageId and idempotencyKey are server-owned and must be omitted from packet.',
        'If finish_memory_review returns a validation error, the proposal is not sealed or committed. Correct the indicated field and call finish_memory_review again within the advertised call limit. Do not discard supported facts merely to hide a format error. Only a successful finish ends the review.',
        'Revise each existing memory through only one path per turn: memory tools or one packet.events entry with supersedesId; never use both paths for the same memory or submit multiple event revisions for it.',
        'Track every newly encountered named story actor using packet.entities, even when they have no character card. Reuse an unambiguous existing entity ID or castKey; never merge two same-name actors without evidence. Associate each packet event with subjectKey/participants and each character knowledge record with actorKey. Model possessions as object entities plus explicit ownership claims (owns, holds, carries); an item merely mentioned near a character is not ownership. Give every claim a supporting eventKey. For text memories, use the exact actor name as subject so the server can resolve it to the packet entity.',
        'Only the actual primary character card may use castKey="main-character". New story actors should omit castKey unless reusing a supplied canonical castKey. mainCharacter, when provided, is a server-supplied identity reference, not a new story event; the server enrolls it with the accepted packet if needed.',
        session.policy?.autoConsolidate
          ? 'Automatic consolidation is enabled. During this review, proactively search and merge genuinely redundant text memories for the same actor and fact, keeping all supported details and evidence. Prefer exact update_memory search/replacement for small corrections and batch_memory_changes for independent ordered writes. Never collapse different times, truths, audiences, beliefs or structured graph facts; keep those sources and let derived summaries compress them.'
          : 'Automatic consolidation is disabled. Do not merge or rewrite multiple old memories to compress them. Record the new evidence and only correct a single existing fact when this turn changes it.',
        'When statusContext is supplied, status cooperation is enabled. It is the authoritative pre-update status, provided only to understand tracking context; it is not evidence that anything changed. Extract this turn once with explicit evidence and uncertainty. The status agent consumes the same extraction and alone validates status mutations; do not copy balances or quantities into a competing ledger.',
        'Domain state is owned by server services: balances, inventory, quests, checks, travel and scene objects may only be referenced after authoritative mutation. Do not create parallel state. An unresolved attempt may request a server skill check; only the trusted server result establishes its outcome.'
      ].join('\n')
    },
    {
      role: 'user',
      content: JSON.stringify({
        observation: session.observation,
        entities:session.entities,
        mainCharacter: session.cardActor,
        statusContext: session.statusContext,
        memoryWorkflow: { autoConsolidate: session.policy?.autoConsolidate, statusLink: session.policy?.statusLink },
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
  // 无工具响应时给模型一个简短的内部续行指令，不把它显示为用户提示。
  return [
    'No tool has been called yet. Do not output explanations, analysis, or JSON text.',
    'If this turn requires a memory to be recorded or corrected, call the relevant tool now. Otherwise, call finish_memory_review now.'
  ].join('\n');
}

export function buildMemoryAgentToolDefinitions(enabledTools) {
  const enabled = new Set(enabledTools);
  const definitions = [];
  const memoryTypeSchema = { type: 'string', enum: [...MEMORY_TYPES] };
  const idSchema = { type: 'string', minLength: 1, pattern: '\\S' };
  const contentSchema = { type: 'string', minLength: 1, maxLength: MEMORY_CONTENT_LIMIT, pattern: '\\S' };
  // 这些 JSON Schema 描述会直接随工具定义发送给模型，因此使用英文。
  const evidenceProperties = {
    sourceMessageId: { ...idSchema, description: 'ID of the current-turn observation message used as evidence. A historical search result cannot replace it.' },
    quote: { type: 'string', maxLength: 1000, description: 'Exact quotation from that message. If exact quotation is impossible, provide a paraphrase.' }
  };
  const add = (name, properties, required = []) => {
    if (!enabled.has(name)) return;
    definitions.push({
      type: 'function',
      function: { name, description: MEMORY_AGENT_TOOLS.find(tool => tool.name === name).modelDescription,
        parameters: { type: 'object', properties, required, additionalProperties: false } }
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
    subject: { type: 'string', maxLength: 160, description: 'Person, place, or object involved.' },
    content: { ...contentSchema, description: 'One concise sentence describing one fact.' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    ...evidenceProperties
  }, ['memoryType', 'content', 'sourceMessageId']);
  add('update_memory', {
    memoryId: idSchema,
    revision: { type: 'integer', minimum: 1, description: 'Revision returned by existingMemories or search_memories.' },
    memoryType: memoryTypeSchema,
    subject: { type: 'string', maxLength: 160 },
    content: { ...contentSchema, description: 'Changing content requires a sourceMessageId from the current turn; omit to preserve the existing content.' },
    search: { type: 'string', minLength: 1, maxLength: MEMORY_CONTENT_LIMIT, description: 'Exact literal fragment to replace; use instead of content for a precise edit.' },
    replacement: { type: 'string', maxLength: MEMORY_CONTENT_LIMIT, description: 'Replacement for search. Requires search; cannot accompany content.' },
    expectedOccurrences: { type: 'integer', minimum: 1, maximum: 20, description: 'Exact expected search match count; defaults to 1. No proposal is made on mismatch.' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    ...evidenceProperties
  }, ['memoryId', 'revision']);
  const updateDefinition = definitions.find(tool => tool.function.name === 'update_memory')?.function;
  if (updateDefinition) {
    const base = updateDefinition.parameters;
    const { search, replacement, expectedOccurrences, content, ...common } = base.properties;
    updateDefinition.parameters = { ...base, anyOf: [
      { ...base, properties: { ...common, content } },
      { ...base, properties: { ...common, search, replacement, expectedOccurrences }, required: ['memoryId', 'revision', 'search', 'replacement', 'sourceMessageId'] }
    ] };
  }
  add('merge_memories', {
    targetId: idSchema,
    targetRevision: { type: 'integer', minimum: 1 },
    sourceItems: {
      type: 'array', minItems: 1, maxItems: 8,
      items: { type: 'object', properties: { id: idSchema, revision: { type: 'integer', minimum: 1 } }, required: ['id', 'revision'], additionalProperties: false }
    },
    subject: { type: 'string', maxLength: 160 },
    content: { ...contentSchema, description: 'Merged content. Omit to preserve the target memory content.' }
  }, ['targetId', 'targetRevision', 'sourceItems']);
  add('invalidate_memory', {
    memoryId: idSchema,
    revision: { type: 'integer', minimum: 1 },
    reason: { ...idSchema, maxLength: 300, description: 'Evidence from this turn that disproves the memory.' },
    ...evidenceProperties
  }, ['memoryId', 'revision', 'reason', 'sourceMessageId']);
  add('pin_memory', {
    memoryId: idSchema,
    revision: { type: 'integer', minimum: 1 },
    pinned: { type: 'boolean' }
  }, ['memoryId', 'revision']);
  const childNames = new Set(['record_memory', 'update_memory', 'merge_memories', 'invalidate_memory', 'pin_memory']);
  const childSchemas = definitions.filter(tool => childNames.has(tool.function.name)).map(tool => ({
    type: 'object', properties: { tool: { type: 'string', enum: [tool.function.name] }, args: tool.function.parameters },
    required: ['tool', 'args'], additionalProperties: false
  }));
  if (childSchemas.length) add('batch_memory_changes', {
    changes: { type: 'array', minItems: 1, maxItems: 12, items: { anyOf: childSchemas } }
  }, ['changes']);
  add('finish_memory_review', {
    packet: extractionPacketSchema,
    summary: { type: 'string', maxLength: 300 }
  });
  return definitions;
}
