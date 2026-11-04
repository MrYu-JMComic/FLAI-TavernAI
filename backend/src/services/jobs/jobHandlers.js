import { completeWorldBookDraft } from '../worldBookAssistant.js';
import { hasUsableProvider, providerWithSecret } from '../providers.js';
import { recordAutomationAudit } from '../automationAudit.js';
import { executeProviderTask } from '../providerTaskRouter.js';
import { getSelectedProviderProfileRow } from '../../repositories/providerProfileRepository.js';
import { appConfig, withAppConfigDefaults } from '../../config.js';
import { applyProviderNetworkPolicy } from '../providerNetworkPolicy.js';
import { runConversationPostprocessing } from './conversationPostprocessing.js';
import { runMemorySummaryJob, runMemoryIndexJob } from '../conversationMemory/derivedJobs.js';

export function createDefaultJobHandlers(database, options = {}) {
  const config = withAppConfigDefaults(options.config || appConfig);
  return {
    'conversation.postprocess': async (environment) => runConversationPostprocessing(database, environment, {
      config,
      runMemoryAgent:options.runMemoryAgent,runAccessoryAgents:options.runAccessoryAgents,
      settings: options.providerSettings
        ? options.providerSettings(environment.job.userId)
        : providerSettings(database, environment.job.userId, config, { allowUnavailable: true })
    }),
    'memory.extract': async (environment) => runConversationPostprocessing(database,environment,{
      config,onlyMemory:true,runMemoryAgent:options.runMemoryAgent,settings:options.providerSettings
        ? options.providerSettings(environment.job.userId)
        : providerSettings(database,environment.job.userId,config,{allowUnavailable:true})
    }),
    'memory.summarize': async (environment) => runMemorySummaryJob(database,environment,{
      config,settings:options.providerSettings ? options.providerSettings(environment.job.userId)
        : providerSettings(database,environment.job.userId,config,{allowUnavailable:true})
    }),
    'memory.index': async (environment) => runMemoryIndexJob(database,environment,{config}),
    'world-book.assist': async ({ job, payload, signal, progress }) => {
      progress(10, { phase: 'provider' });
      const settings = providerSettings(database, job.userId, config);
      progress(25, { phase: 'generating' });
      const current = payload.current && typeof payload.current === 'object' ? payload.current : {};
      const routed = await executeProviderTask(database, {
        userId: job.userId,
        jobId: job.id,
        taskType: job.type,
        settings,
        routing: payload.routing,
        signal,
        operation: (routeSettings) => completeWorldBookDraft(routeSettings, {
          requirement: String(payload.requirement || ''),
          current,
          database,
          userId: job.userId,
          selectedBookIds: payload.selectedBookIds || (payload.worldBookId ? [payload.worldBookId] : []),
          automatic: payload.automatic,
          workspace: payload.workspace,
          history: payload.history,
          context: payload.context,
          thinkingLevel: payload.thinkingLevel,
          planMode: payload.planMode,
          plan: payload.plan,
          signal
        })
      });
      recordAutomationAudit(database, job.userId, {
        domain: 'world-book',
        operation: 'assist',
        subjectType: 'world-book-draft',
        subjectId: String(payload.worldBookId || ''),
        sourceMessageId: payload.sourceMessageId,
        jobId: job.id,
        providerType: routed.route.providerType,
        model: routed.route.model,
        planSummary: routed.result.summary,
        before: current,
        after: routed.result.workspace
      });
      return { ...routed.result, providerRoute: routed.route };
    }
  };
}

function providerSettings(database, userId, config, options = {}) {
  const row = getSelectedProviderProfileRow(database, userId);
  const settings = providerWithSecret(row);
  if (!hasUsableProvider(settings) || settings.providerType === 'mock') {
    if (options.allowUnavailable) return settings;
    throw jobFailure('A usable non-mock provider is required.', 'JOB_PROVIDER_UNAVAILABLE');
  }
  const user = database.prepare(
    'SELECT id, is_root_admin AS isRootAdmin FROM users WHERE id = ?'
  ).get(userId) || { id: userId };
  return applyProviderNetworkPolicy(settings, config, user);
}

function jobFailure(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
