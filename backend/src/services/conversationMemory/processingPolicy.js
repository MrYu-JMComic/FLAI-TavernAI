import { normalizeMemoryPolicy } from '../../../../shared/memoryPolicy.js';
import { getAccessorySkillsPayload } from '../accessoryAgents.js';
import { getStatusBar } from '../../modules/statusBars.js';
import { hasUsableProvider, providerWithSecret } from '../providers.js';
import { getSelectedProviderProfileRow } from '../../repositories/providerProfileRepository.js';
import { resolveAccessorySkillSettings } from '../accessorySkillProvider.js';
import { getConversationProcessingSummary } from '../jobs/jobQueue.js';
import { readMemoryShortTerm } from './shortTerm.js';

/** Resolve effective required work without starting providers or creating jobs. */
export function resolveMemoryProcessingPolicy(database, userId, conversation, options = {}) {
  const { skills, active } = getAccessorySkillsPayload(conversation, getStatusBar(database, userId, conversation.id));
  const skill = skills.memoryAgent || {};
  const policy = normalizeMemoryPolicy(skill.memoryPolicy);
  const main = options.settings || providerWithSecret(getSelectedProviderProfileRow(database, userId) || {});
  if(policy.isolation==='actor')assertActorProviderIsolation(main);
  const resolved = resolveAccessorySkillSettings(database, userId, main, skill, options);
  const available = hasUsableProvider(resolved.settings) && resolved.settings.providerType !== 'mock';
  const explicit = skill.enabled === true;
  const structured = skill.enabled !== false && policy.mode !== 'raw' && available;
  const configurationError = explicit && policy.mode !== 'raw' && (!available || Boolean(resolved.warning));
  const requiredStages = Object.entries(active).filter(([name, enabled]) => enabled &&
    ['statusBarAgent', 'economyAgent', 'cgScene', 'sceneAgent', 'worldDirector'].includes(name)).map(([name]) => name);
  if (structured) requiredStages.unshift('memory');
  return { policy, skill, mode: structured ? 'structured' : 'raw', requiredStages,
    configurationError, reason: skill.enabled === false ? 'disabled' : policy.mode === 'raw' ? 'explicit_raw' : available ? '' : 'provider_unavailable' };
}

/** Inherited provider context and arbitrary injected tools have no actor audience metadata. */
export function assertActorProviderIsolation(settings={}) {
  const safe=new Set(['temperature','top_p','top_k','max_tokens','max_completion_tokens','max_output_tokens',
    'presence_penalty','frequency_penalty','seed','enable_thinking','stream','thinking_budget']);
  for(const [key,value] of Object.entries(settings.extraBody||{})) {
    if(!safe.has(key)||!['number','boolean'].includes(typeof value))
      throw preparationError('严格角色视角不能使用未标注受众的供应商附加指令、工具或继承上下文，请清除该附加配置。','MEMORY_ACTOR_PROVIDER_CONTEXT',400);
  }
}

/** Background cast mode bridges uncovered turns; explicit blocking and strict actor modes wait before locking. */
export async function prepareMemoryGeneration(database, userId, getConversation, options = {}) {
  const started = Date.now();
  for (;;) {
    options.signal?.throwIfAborted();
    const conversation = getConversation();
    if (!conversation) throw preparationError('对话不存在', 'CONVERSATION_NOT_FOUND', 404);
    const effective = resolveMemoryProcessingPolicy(database, userId, conversation, options);
    if (effective.configurationError) throw preparationError('记忆模型配置不可用，请修复供应商配置或切换为原文模式。', 'MEMORY_CONFIGURATION_REQUIRED', 400);
    const summary = getConversationProcessingSummary(database, userId, conversation.id);
    if (!effective.requiredStages.length || !summary || summary.coreReady) {
      return { conversation, effective, timelineRevision: conversation.timelineRevision, summary };
    }
    if (effective.policy.syncMode === 'background' && effective.policy.isolation !== 'actor') {
      if (['needs_rebuild', 'stale', 'legacy_partial'].includes(conversation.stateStatus))
        throw preparationError('剧情历史已修改，请先重建状态或明确接受当前状态。', 'CONVERSATION_STATE_REBUILD_REQUIRED');
      const shortTerm = readMemoryShortTerm(database, userId, conversation.id, { policy: effective.policy, enabled: effective.requiredStages.length > 0 });
      if (shortTerm.overflow) throw preparationError('后台记忆积压已超过短期记忆容量，请在记忆页面重试失败任务或等待处理完成。', 'MEMORY_SHORT_TERM_CAPACITY');
      return { conversation, effective, timelineRevision: conversation.timelineRevision, summary, shortTerm };
    }
    if (summary.coreFailedCount) throw Object.assign(preparationError('上一轮核心状态同步失败，请重试同步或明确接受当前状态。', 'MEMORY_CORE_FAILED'), { jobId: summary.id });
    if (!summary.corePendingCount) throw preparationError('剧情状态已失效，请重建状态或明确接受当前状态后继续。', 'CONVERSATION_STATE_REBUILD_REQUIRED');
    if (Date.now() - started >= effective.policy.coreWaitMs) throw Object.assign(preparationError('核心状态仍在同步，可保留草稿稍后重试。', 'MEMORY_CORE_PENDING'), { jobId: summary.id });
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

function preparationError(message, code, status = 409) {
  return Object.assign(new Error(message), { code, status, publicMessage: message, accepted: false });
}
