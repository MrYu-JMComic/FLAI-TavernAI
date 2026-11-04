import { ref } from 'vue';
import { applyWorldBookChanges, fetchWorldBook, streamWorldBookDraft } from '../../api/worldBooks.js';
import { createWorldBookApplyRequestId, rebaseWorldBookWorkspace, worldBookApplyRequest } from '../../utils/worldBookWorkspace.js';
import { useAiPlanSession } from '../useAiPlanSession';
import { useAssistantRuntimePreferences } from '../useAssistantRuntimePreferences';
import { appendAiToolList, cloneAiToolList } from '../../utils/aiToolLists';
import { samePlainValue } from '../../utils/plainValues';
import { recordFrontendDiagnostic } from '../../diagnostics.js';

const WORLD_BOOK_ASSISTANT_STORAGE_PREFIX = 'flai-worldbook-assistant';
const WORLD_BOOK_CONTEXT_STORAGE_KEY = 'flai-worldbook-assistant-context';
const WORLD_BOOK_DEFAULT_CONTEXT = Object.freeze({ maxRounds: 100, entryLimit: 30 });

/**
 * Runtime state for the world book AI workbench: model / thinking / streaming /
 * context settings, the plan approval gate, and the live process monitor.
 * Changes remain in the shared workspace until the user applies them.
 */
export function useWorldBookAi({ providerRef, isCurrentRun = () => true, onApplied, notify } = {}) {
  const aiLoading = ref(false);
  const aiRequirement = ref('');
  const aiWorkspace = ref(null);
  const aiChanges = ref([]);
  const aiHistory = ref([]);
  const aiSelectedBookIds = ref([]);
  const aiAutomatic = ref(true);
  const aiSaving = ref(false);
  let planContext = null;
  let applyAttempt = null;
  const aiToolCalls = ref([]);
  const aiProcess = ref([]);
  const aiReasoning = ref('');
  const aiStatus = ref('idle');
  const aiStatusMessage = ref('填写世界书需求后即可开始');
  const aiAbortController = ref(null);
  const aiContext = ref(loadWorldBookAiContext());

  const preferences = useAssistantRuntimePreferences(providerRef, {
    storagePrefix: WORLD_BOOK_ASSISTANT_STORAGE_PREFIX
  });
  const planSession = useAiPlanSession();

  async function completeWorldBookWithAi({ approvedPlan = null } = {}) {
    if (aiLoading.value) return;
    const requirement = aiRequirement.value.trim();
    if (!requirement && !approvedPlan) {
      notify?.warning?.('请先描述要查阅、更新或创建的世界书内容。');
      return;
    }

    const planMode = Boolean(preferences.assistantPlanMode.value);
    const planningPhase = planMode && !approvedPlan;
    if (!approvedPlan) {
      planSession.resetPlan();
      planContext = null;
    }
    const abortController = new AbortController();
    aiLoading.value = true;
    aiStatus.value = 'running';
    aiStatusMessage.value = planningPhase ? '正在规划步骤，本阶段不会生成条目' : '正在分析世界书需求';
    planSession.setPlanPhase(planningPhase ? 'planning' : approvedPlan ? 'executing' : 'idle');
    setAiToolCallsIfChanged([]);
    setAiProcessIfChanged([{ round: 1, reasoning: '等待模型响应...', content: '', tools: [] }]);
    aiReasoning.value = '';
    aiAbortController.value = abortController;
    try {
      const result = await streamWorldBookDraft({
        requirement,
        selectedBookIds: approvedPlan && planContext ? planContext.selectedBookIds : [...aiSelectedBookIds.value],
        automatic: approvedPlan && planContext ? planContext.automatic : aiAutomatic.value,
        workspace: approvedPlan && planContext ? planContext.workspace : aiWorkspace.value,
        history: aiHistory.value.slice(-20),
        modelOverride: String(preferences.assistantModel.value || '').trim(),
        providerStreaming: Boolean(preferences.assistantStreamingEnabled.value),
        thinkingLevel: String(preferences.assistantThinkingLevel.value || 'off'),
        context: { ...aiContext.value },
        ...(planMode ? { planMode: true } : {}),
        ...(approvedPlan ? { plan: approvedPlan } : {})
      }, aiStreamHandlers(abortController), abortController.signal);
      if (!isCurrentWorldBookAiRun(abortController)) return;
      if (result?.aborted) {
        clearExecutedPlan(approvedPlan);
        aiStatus.value = 'paused';
        aiStatusMessage.value = '已暂停，可重新开始';
        notify?.info?.('AI 世界书生成已暂停');
        return;
      }

      setAiToolCallsIfChanged(result.toolCalls);
      setAiProcessIfChanged(result.process);
      aiReasoning.value = result.reasoning || '';
      if (result.workspace) aiWorkspace.value = result.workspace;
      if (Array.isArray(result.changes)) aiChanges.value = result.changes;

      if (result?.phase === 'plan') {
        planContext = { selectedBookIds: [...aiSelectedBookIds.value], automatic: aiAutomatic.value, workspace: JSON.parse(JSON.stringify(aiWorkspace.value)) };
        planSession.setPlan(result.plan);
        aiStatus.value = 'review';
        aiStatusMessage.value = planSession.hasPlan.value
          ? '计划已生成，请勾选并确认后执行'
          : '模型没有给出可执行步骤，请补充需求后重试';
        notify?.success?.(`AI 已生成 ${planSession.planSteps.value.length} 步计划，请审批`);
        return;
      }

      clearExecutedPlan(approvedPlan);
      const reply = result.reply || result.summary || (aiChanges.value.length ? `已整理 ${aiChanges.value.length} 本世界书的变更，请查看后应用。` : '已完成查阅，可以继续补充要求。');
      aiHistory.value = [...aiHistory.value, { role: 'user', content: requirement }, { role: 'assistant', content: reply }].slice(-40);
      aiRequirement.value = '';
      aiStatus.value = 'completed';
      aiStatusMessage.value = reply;
    } catch (err) {
      if (!isCurrentWorldBookAiRun(abortController)) return;
      clearExecutedPlan(approvedPlan);
      if (abortController.signal.aborted || err.name === 'AbortError') {
        aiStatus.value = 'paused';
        aiStatusMessage.value = '已暂停，可重新开始';
        notify?.info?.('AI 世界书生成已暂停');
        return;
      }
      setAiProcessIfChanged([{ round: 1, reasoning: err.message, content: '', tools: [] }]);
      aiStatus.value = 'failed';
      aiStatusMessage.value = err.message;
      notify?.error?.(err.message);
    } finally {
      if (isCurrentWorldBookAiRun(abortController)) {
        aiLoading.value = false;
        aiAbortController.value = null;
      }
    }
  }

  function clearExecutedPlan(approvedPlan) {
    if (!approvedPlan) return;
    planSession.resetPlan();
    planContext = null;
  }

  async function executeWorldBookPlan() {
    const approvedPlan = planSession.buildApprovedPlan();
    if (!approvedPlan) {
      notify?.warning?.('请至少保留一个计划步骤');
      return;
    }
    return completeWorldBookWithAi({ approvedPlan });
  }

  async function replanWorldBookAi() {
    planSession.resetPlan();
    return completeWorldBookWithAi();
  }

  function discardWorldBookPlan() {
    if (aiLoading.value) return;
    planSession.resetPlan();
    planContext = null;
    aiStatus.value = 'idle';
    aiStatusMessage.value = '计划已放弃，可重新开始';
  }

  function stopWorldBookAi() {
    aiAbortController.value?.abort();
  }

  function cancelWorldBookAi() {
    const abortController = aiAbortController.value;
    if (!abortController) return;
    abortController.abort();
    aiLoading.value = false;
    aiAbortController.value = null;
    aiStatus.value = 'paused';
    aiStatusMessage.value = '已暂停，可重新开始';
  }

  function setSelectedBookIds(ids) {
    aiSelectedBookIds.value = [...new Set(Array.isArray(ids) ? ids : [])];
    if (aiWorkspace.value) {
      const ref = aiSelectedBookIds.value.length === 1 ? `existing:${aiSelectedBookIds.value[0]}` : null;
      aiWorkspace.value = { ...aiWorkspace.value, selectedBookIds: [...aiSelectedBookIds.value], activeRef: ref };
    }
    planSession.resetPlan();
    planContext = null;
  }

  function setAutomatic(value) {
    aiAutomatic.value = Boolean(value);
    planSession.resetPlan();
    planContext = null;
  }

  function prepareNewWorldBook() {
    aiRequirement.value = `${aiRequirement.value.trim()}${aiRequirement.value.trim() ? '\n' : ''}另外创建一本独立世界书，主题是：`;
  }

  async function applyAiWorldBookChanges(selectedChanges) {
    if (aiLoading.value || aiSaving.value || !selectedChanges?.length) return;
    aiSaving.value = true;
    try {
      const changes = worldBookApplyRequest(selectedChanges);
      const signature = JSON.stringify(changes);
      if (!applyAttempt || applyAttempt.signature !== signature) applyAttempt = { signature, requestId: createWorldBookApplyRequestId() };
      const result = await applyWorldBookChanges({ requestId: applyAttempt.requestId, changes });
      aiWorkspace.value = rebaseWorldBookWorkspace(aiWorkspace.value, result.books);
      const refs = new Set((result.books || []).map(item => item.ref));
      aiChanges.value = aiChanges.value.filter(change => !refs.has(change.ref));
      applyAttempt = null;
      planSession.resetPlan();
      planContext = null;
      aiStatusMessage.value = '世界书变更已保存，可以继续对话。';
      await onApplied?.(result.books || []);
      notify?.success?.('世界书变更已应用');
      return result;
    } catch (error) {
      notify?.error?.(error?.message || '应用世界书变更失败');
    } finally {
      aiSaving.value = false;
    }
  }

  async function reloadAiWorldBook(change) {
    if (aiLoading.value || aiSaving.value || !change?.bookId) return;
    aiSaving.value = true;
    try {
      const book = await fetchWorldBook(change.bookId);
      aiWorkspace.value = rebaseWorldBookWorkspace(aiWorkspace.value, [{ ref: change.ref, book }]);
      aiChanges.value = aiChanges.value.filter(item => item.ref !== change.ref);
      applyAttempt = null;
      planSession.resetPlan();
      planContext = null;
      await onApplied?.([{ ref: change.ref, book }]);
      notify?.success?.('已读取最新内容，可以重新描述这本书的修改要求。');
    } catch (error) {
      notify?.error?.(error.message);
    } finally {
      aiSaving.value = false;
    }
  }

  function discardAiWorldBook(change) {
    if (aiLoading.value || aiSaving.value || !change?.ref) return;
    if (aiWorkspace.value) {
      aiWorkspace.value = {
        ...aiWorkspace.value,
        activeRef: aiWorkspace.value.activeRef === change.ref ? null : aiWorkspace.value.activeRef,
        targets: aiWorkspace.value.targets.filter(target => target.ref !== change.ref)
      };
    }
    aiChanges.value = aiChanges.value.filter(item => item.ref !== change.ref);
    setSelectedBookIds(aiSelectedBookIds.value.filter(id => id !== change.bookId));
    applyAttempt = null;
  }

  function setAiContextValue(key, value) {
    if (!Object.hasOwn(WORLD_BOOK_DEFAULT_CONTEXT, key)) return;
    const next = { ...aiContext.value, [key]: normalizeContextValue(key, value) };
    aiContext.value = next;
    try {
      localStorage.setItem(WORLD_BOOK_CONTEXT_STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      recordFrontendDiagnostic('worldBook.aiContext.save', error, { storageKey: WORLD_BOOK_CONTEXT_STORAGE_KEY });
    }
  }

  function isCurrentWorldBookAiRun(abortController) {
    return isCurrentRun() && aiAbortController.value === abortController;
  }

  function setAiToolCallsIfChanged(nextToolCalls) {
    return setAiPlainListIfChanged(aiToolCalls, nextToolCalls);
  }

  function setAiProcessIfChanged(nextProcess) {
    return setAiPlainListIfChanged(aiProcess, nextProcess);
  }

  function setAiPlainListIfChanged(listRef, nextItems) {
    const normalizedItems = Array.isArray(nextItems) ? nextItems : [];
    return setAiPlainRefIfChanged(listRef, normalizedItems);
  }

  function setAiPlainRefIfChanged(valueRef, nextValue) {
    if (samePlainValue(valueRef.value, nextValue)) {
      return false;
    }
    valueRef.value = nextValue;
    return true;
  }

  function aiStreamHandlers(abortController) {
    return {
      workspace: (state = {}) => {
        if (!isCurrentWorldBookAiRun(abortController)) return;
        if (state.workspace) aiWorkspace.value = state.workspace;
        if (Array.isArray(state.changes)) aiChanges.value = state.changes;
      },
      step: (step = {}) => {
        if (!isCurrentWorldBookAiRun(abortController)) return;
        updateAiProcessStep(step.round || 1, (target) => ({
          ...target,
          ...step,
          content: target.content || step.content || '',
          reasoning: target.reasoning === '等待模型响应...' ? step.reasoning || '' : target.reasoning || step.reasoning || '',
          tools: target.tools?.length ? target.tools : cloneAiToolList(step.tools)
        }));
      },
      reasoning: ({ round = 1, text = '' } = {}) => {
        if (!isCurrentWorldBookAiRun(abortController)) return;
        updateAiProcessStep(round, (target) => ({
          ...target,
          reasoning: `${target.reasoning === '等待模型响应...' ? '' : target.reasoning || ''}${text}`
        }));
        aiReasoning.value += text;
      },
      content: ({ round = 1, text = '' } = {}) => {
        if (!isCurrentWorldBookAiRun(abortController)) return;
        updateAiProcessStep(round, (target) => ({
          ...target,
          content: `${target.content || ''}${text}`
        }));
      },
      nudge: ({ round = 1, text = '' } = {}) => {
        if (!isCurrentWorldBookAiRun(abortController)) return;
        updateAiProcessStep(round, (target) => ({
          ...target,
          content: `${target.content || ''}${target.content ? '\n\n' : ''}系统提醒：${text}`
        }));
      },
      tool: (call = {}) => {
        if (!isCurrentWorldBookAiRun(abortController)) return;
        const log = {
          name: call.name,
          arguments: call.arguments,
          result: call.result
        };
        updateAiProcessStep(call.round || 1, (target) => ({
          ...target,
          tools: appendAiToolList(target.tools, log)
        }));
        appendAiToolCall(log);
      },
      plan: (nextPlan = {}) => {
        if (!isCurrentWorldBookAiRun(abortController)) return;
        planSession.setPlan(nextPlan);
      },
      state: (state = {}) => {
        if (!isCurrentWorldBookAiRun(abortController)) return;
        if (state.message) aiStatusMessage.value = String(state.message);
      }
    };
  }

  function updateAiProcessStep(round = 1, updateStep) {
    const currentProcess = Array.isArray(aiProcess.value) ? aiProcess.value : [];
    let stepIndex = -1;
    for (let index = 0; index < currentProcess.length; index += 1) {
      if (currentProcess[index]?.round === round) {
        stepIndex = index;
        break;
      }
    }
    const currentStep = stepIndex >= 0
      ? currentProcess[stepIndex]
      : { round, reasoning: '', content: '', tools: [] };
    const nextStep = updateStep({
      ...currentStep,
      tools: cloneAiToolList(currentStep.tools)
    });
    const nextProcess = [];
    for (let index = 0; index < currentProcess.length; index += 1) {
      nextProcess.push(index === stepIndex ? nextStep : currentProcess[index]);
    }
    if (stepIndex < 0) {
      nextProcess.push(nextStep);
    }
    setAiProcessIfChanged(nextProcess);
  }

  function appendAiToolCall(log) {
    const currentToolCalls = Array.isArray(aiToolCalls.value) ? aiToolCalls.value : [];
    const nextToolCalls = [];
    for (const toolCall of currentToolCalls) {
      nextToolCalls.push(toolCall);
    }
    nextToolCalls.push(log);
    setAiToolCallsIfChanged(nextToolCalls);
  }

  return {
    ...preferences,
    aiContext,
    aiWorkspace,
    aiChanges,
    aiHistory,
    aiSelectedBookIds,
    aiAutomatic,
    aiSaving,
    aiLoading,
    aiPlan: planSession.plan,
    aiPlanExtraRequirement: planSession.planExtraRequirement,
    aiPlanPhase: planSession.planPhase,
    aiPlanStepStatus: planSession.planStepStatus,
    aiProcess,
    aiReasoning,
    aiRequirement,
    aiStatus,
    aiStatusMessage,
    aiToolCalls,
    cancelWorldBookAi,
    completeWorldBookWithAi,
    discardWorldBookPlan,
    executeWorldBookPlan,
    replanWorldBookAi,
    setAiContextValue,
    stopWorldBookAi,
    applyAiWorldBookChanges,
    reloadAiWorldBook,
    discardAiWorldBook,
    setSelectedBookIds,
    setAutomatic,
    prepareNewWorldBook,
    toggleAiPlanStep: planSession.togglePlanStep,
    updateAiPlanStep: planSession.updatePlanStep
  };
}

function loadWorldBookAiContext() {
  try {
    const raw = localStorage.getItem(WORLD_BOOK_CONTEXT_STORAGE_KEY);
    if (!raw) return { ...WORLD_BOOK_DEFAULT_CONTEXT };
    const stored = JSON.parse(raw);
    const context = { ...WORLD_BOOK_DEFAULT_CONTEXT };
    for (const key of Object.keys(WORLD_BOOK_DEFAULT_CONTEXT)) {
      if (Object.hasOwn(stored || {}, key)) context[key] = normalizeContextValue(key, stored[key]);
    }
    return context;
  } catch (error) {
    recordFrontendDiagnostic('worldBook.aiContext.load', error, { storageKey: WORLD_BOOK_CONTEXT_STORAGE_KEY });
    return { ...WORLD_BOOK_DEFAULT_CONTEXT };
  }
}

function normalizeContextValue(key, value) {
  if (key === 'useCurrent') return value !== false;
  const number = Number(value);
  if (!Number.isFinite(number)) return WORLD_BOOK_DEFAULT_CONTEXT[key];
  const max = key === 'maxRounds' ? 100 : 30;
  return Math.max(1, Math.min(max, Math.floor(number)));
}
