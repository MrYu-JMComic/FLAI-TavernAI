import { computed, ref, watch } from 'vue';
import { streamCharacterDraft } from '../../api/characters.js';
import { createMod } from '../../api/mods.js';
import { applyWorldBookChanges, fetchWorldBook } from '../../api/worldBooks.js';
import { appendAiToolList, cloneAiToolList } from '../../utils/aiToolLists';
import { sameListItems } from '../../utils/listReferences';
import { samePlainValue } from '../../utils/plainValues';
import { createWorldBookApplyRequestId, rebaseWorldBookWorkspace, worldBookApplyRequest } from '../../utils/worldBookWorkspace.js';
import { useAiPlanSession } from '../useAiPlanSession';

const AI_DRAFT_SEED_FIELDS = ['name', 'gender', 'age', 'background', 'worldview', 'persona', 'openingMessage'];
const AI_SESSION_STORAGE_PREFIX = 'flai-character-ai-session:';
const AI_SESSION_VERSION = 4;

export function useCharacterAiGeneration({
  canEdit,
  saving,
  form,
  aiOptions,
  aiUseCurrentDraft,
  assistantModel,
  assistantPlanMode,
  assistantStreamingEnabled,
  assistantThinkingLevel,
  buildPayload,
  applyAdvancedSettingsDraft,
  onWorldBookCreated,
  onWorldBookUpdated,
  getSelectedWorldBookIds = () => [],
  getSessionId = () => 'new',
  isDisposed = () => false,
  notify
} = {}) {
  const aiLoading = ref(false);
  const aiRequirement = ref('');
  const aiToolCalls = ref([]);
  const aiProcess = ref([]);
  const aiReasoning = ref('');
  const aiModSuggestions = ref([]);
  const aiWorldBookWorkspace = ref(null);
  const aiWorldBookChanges = ref([]);
  const aiWorldBookTargetOverride = ref(null);
  const aiWorldBookAutomatic = ref(false);
  const aiConversationHistory = ref([]);
  const aiPlanContext = ref(null);
  const aiWorldBookApplyRequest = ref(null);
  const aiCheckpoint = ref(null);
  const aiCheckpointUpdatedAt = ref('');
  const aiStatus = ref('idle');
  const aiStatusMessage = ref('填写任务后即可开始');
  const aiLastError = ref('');
  const aiWarnings = ref([]);
  const suggestedModsCreating = ref(false);
  const aiWorldBookCreating = ref(false);
  const advancedAiLoading = ref(false);
  const advancedAiRequirement = ref('');
  const aiAbortController = ref(null);
  const advancedAiAbortController = ref(null);
  let suggestedModCreateToken = 0;
  let worldBookCreateToken = 0;
  let stopRequestedByUser = false;

  const planSession = useAiPlanSession();

  const aiHasCheckpoint = computed(() => Boolean(aiCheckpoint.value?.character));
  const aiWorldBookSelectedIds = computed(() => aiWorldBookTargetOverride.value ?? getSelectedWorldBookIds());
  const aiWorldBookSourceLabel = computed(() => aiWorldBookTargetOverride.value === null ? '来自角色关联（含未保存选择）' : '本次手动选择');

  const characterAiActionBusy = computed(() => (
    aiLoading.value
    || advancedAiLoading.value
    || aiWorldBookCreating.value
    || Boolean(saving?.value)
    || !canEdit?.value
  ));

  restoreAiSession();

  watch(() => getSessionId(), () => {
    cancelCharacterAiGeneration();
    resetAiSessionState();
    restoreAiSession();
  });

  async function completeWithAi() {
    return runCharacterAi({ resume: false });
  }

  async function resumeCharacterAi() {
    if (!aiHasCheckpoint.value) {
      notify?.warning?.('没有可继续的 AI 阶段结果');
      return;
    }
    return runCharacterAi({ resume: true });
  }

  async function retryCharacterAi() {
    return runCharacterAi({ resume: aiHasCheckpoint.value });
  }

  // Plan mode turns one button into two phases: the first run only plans, the
  // user edits and approves, and the second run executes the approved plan.
  async function executeApprovedPlan() {
    const approvedPlan = planSession.buildApprovedPlan();
    if (!approvedPlan) {
      notify?.warning?.('请至少保留一个计划步骤');
      return;
    }
    return runCharacterAi({ resume: false, approvedPlan });
  }

  async function replanCharacterAi() {
    planSession.resetPlan();
    return runCharacterAi({ resume: false });
  }

  function discardCharacterPlan() {
    if (aiLoading.value) return;
    planSession.resetPlan();
    aiStatus.value = 'idle';
    aiStatusMessage.value = '计划已放弃，可重新开始';
    persistAiSession();
  }

  async function runCharacterAi({ resume = false, approvedPlan = null } = {}) {
    if (characterAiActionBusy.value) return;
    const requirement = aiRequirement.value.trim();
    if (!canRunAiWithContext(requirement, '请先写一点角色要求，或开启“结合当前已填写内容”。')) {
      return;
    }

    // A resumed run continues the execution it was interrupted in, so the
    // approved plan has to travel with it.
    const activePlan = approvedPlan
      || (resume && planSession.planPhase.value === 'executing' ? planSession.buildApprovedPlan() : null);
    const planMode = Boolean(assistantPlanMode?.value);
    const planningPhase = planMode && !activePlan;

    const baseProcess = resume ? cloneProcessList(aiProcess.value) : [];
    const baseReasoning = resume ? String(aiReasoning.value || '') : '';
    const roundOffset = highestProcessRound(baseProcess);
    const sourceCharacter = resume && aiCheckpoint.value?.character
      ? aiCheckpoint.value.character
      : activePlan && aiPlanContext.value
      ? aiPlanContext.value.character
      : getAiCurrentCharacter();
    const worldBookContext = activePlan && aiPlanContext.value
      ? { ...aiPlanContext.value.worldBookContext, ...(resume ? { workspace: aiWorldBookWorkspace.value } : {}) }
      : { selectedBookIds: [...aiWorldBookSelectedIds.value], automatic: aiWorldBookAutomatic.value, workspace: aiWorldBookWorkspace.value };
    if (planningPhase) aiPlanContext.value = JSON.parse(JSON.stringify({ character: sourceCharacter, worldBookContext }));

    aiLoading.value = true;
    stopRequestedByUser = false;
    aiLastError.value = '';
    aiStatus.value = 'running';
    aiStatusMessage.value = planningPhase
      ? '正在规划步骤，本阶段不会修改表单'
      : resume ? '正在衔接阶段结果并继续完善' : '正在分析任务与角色草稿';
    planSession.setPlanPhase(planningPhase ? 'planning' : activePlan ? 'executing' : 'idle');
    setAiWarningsIfChanged([]);
    if (!resume) {
      setAiToolCallsIfChanged([]);
      setAiProcessIfChanged([{ round: 1, reasoning: '', content: '', tools: [], state: 'running' }]);
      aiReasoning.value = '';
      setAiModSuggestionsIfChanged([]);
      if (!activePlan) {
        aiCheckpoint.value = null;
        aiCheckpointUpdatedAt.value = '';
      }
    } else {
      updateAiProcessStep(roundOffset + 1, (target) => ({ ...target, state: 'running' }));
    }
    persistAiSession();
    const abortController = new AbortController();
    aiAbortController.value = abortController;
    try {
      const result = await streamCharacterDraft({
        requirement,
        character: sourceCharacter,
        characterId: getSessionId() === 'new' ? undefined : getSessionId(),
        worldBookContext: aiOptions.worldBook ? worldBookContext : undefined,
        history: aiConversationHistory.value,
        modelOverride: String(assistantModel?.value || '').trim(),
        providerStreaming: Boolean(assistantStreamingEnabled?.value),
        thinkingLevel: String(assistantThinkingLevel?.value || 'off'),
        continuation: resume ? buildContinuationPayload() : undefined,
        ...(planMode ? { planMode: true } : {}),
        ...(activePlan ? { plan: activePlan } : {}),
        options: { ...aiOptions, optimizeExisting: resume || Boolean(aiUseCurrentDraft?.value) }
      }, aiStreamHandlers({
        isCurrent: () => isCurrentCharacterAiRun(abortController),
        roundOffset
      }), abortController.signal);
      if (!isCurrentCharacterAiRun(abortController)) return;
      if (result?.aborted) {
        markAiPaused();
        return;
      }
      setAiToolCallsIfChanged(mergeUniqueToolCallLists(aiToolCalls.value, result.toolCalls));
      // A stream that fell back to stable mode already replayed the earlier
      // rounds into aiProcess, so its rounds continue from there instead of
      // from the pre-run baseline.
      const resultRoundOffset = result.streamRecovered
        ? highestProcessRound(aiProcess.value)
        : roundOffset;
      setAiProcessIfChanged(result.streamRecovered
        ? mergeProcessLists(aiProcess.value, result.process, resultRoundOffset)
        : mergeProcessLists(baseProcess, result.process, resultRoundOffset));
      aiReasoning.value = mergeReasoningText(
        result.streamRecovered ? aiReasoning.value : baseReasoning,
        result.reasoning
      );

      if (result?.phase === 'plan') {
        if (result.worldBookWorkspace && aiPlanContext.value) {
          aiPlanContext.value.worldBookContext.workspace = result.worldBookWorkspace;
        }
        planSession.setPlan(result.plan);
        aiStatus.value = 'review';
        aiStatusMessage.value = planSession.hasPlan.value
          ? '计划已生成，请勾选并确认后执行'
          : '模型没有给出可执行步骤，请补充要求后重试';
        persistAiSession();
        notify?.success?.(`AI 已生成 ${planSession.planSteps.value.length} 步计划，请审批`);
        return;
      }

      applyAiDraft(result.character || {}, {
        enabledSections: { ...aiOptions },
        applyEmptyValues: Boolean(aiUseCurrentDraft?.value)
      });
      setAiModSuggestionsIfChanged(result.character?.modSuggestions);
      updateAiWorldBooks(result.character);
      aiConversationHistory.value = [...aiConversationHistory.value,
        { role: 'user', content: requirement },
        { role: 'assistant', content: String(result.summary || '已完成本轮修改') }
      ].slice(-12);
      planSession.applyPlanProgress(result.planProgress);
      if (activePlan) {
        planSession.resetPlan();
        aiPlanContext.value = null;
      }
      updateAiCheckpoint(result.character, result.checkpoint || {});
      setAiWarningsIfChanged(result.warnings);
      aiStatus.value = 'completed';
      aiStatusMessage.value = result.summary || '已完成并回填到角色草稿';
      aiLastError.value = '';
      persistAiSession();
      notify?.success?.(`AI 已完善设定，调用 ${aiToolCalls.value.length} 次工具`);
    } catch (err) {
      if (!isCurrentCharacterAiRun(abortController)) return;
      if (abortController.signal.aborted || err?.name === 'AbortError') {
        markAiPaused();
        return;
      }
      aiStatus.value = 'failed';
      aiLastError.value = err?.message || 'AI 生成失败';
      aiStatusMessage.value = aiHasCheckpoint.value
        ? '连接已中断，阶段结果已保留，可继续完成'
        : '生成失败，可按原任务重试';
      persistAiSession();
      notify?.error?.(aiLastError.value);
    } finally {
      if (isCurrentCharacterAiRun(abortController)) {
        aiLoading.value = false;
        aiAbortController.value = null;
      }
    }
  }

  function stopCharacterAi() {
    stopRequestedByUser = true;
    aiStatusMessage.value = '正在保存阶段结果并暂停';
    aiAbortController.value?.abort();
  }

  function markAiPaused() {
    aiStatus.value = 'paused';
    aiStatusMessage.value = aiHasCheckpoint.value
      ? '已暂停，阶段结果已保留'
      : '已暂停，可重新开始';
    persistAiSession();
    notify?.info?.(stopRequestedByUser ? 'AI 生成已暂停' : 'AI 连接已中断');
  }

  function isCurrentCharacterAiRun(abortController) {
    return !isDisposed() && aiAbortController.value === abortController;
  }

  async function completeAdvancedSettingsWithAi() {
    if (characterAiActionBusy.value) return;
    const requirement = advancedAiRequirement.value.trim() || aiRequirement.value.trim();
    if (!canRunAiWithContext(requirement, '请先写一点高阶设置目标，或开启“结合当前已填写内容”。')) {
      return;
    }

    advancedAiLoading.value = true;
    setAiProcessIfChanged([{ round: 1, reasoning: '等待模型响应...', content: '', tools: [] }]);
    aiReasoning.value = '';
    setAiToolCallsIfChanged([]);
    const abortController = new AbortController();
    advancedAiAbortController.value = abortController;
    try {
      const result = await streamCharacterDraft({
        requirement,
        character: getAiCurrentCharacter(),
        modelOverride: String(assistantModel?.value || '').trim(),
        providerStreaming: Boolean(assistantStreamingEnabled?.value),
        thinkingLevel: String(assistantThinkingLevel?.value || 'off'),
        options: {
          profile: false,
          background: false,
          worldview: false,
          persona: false,
          openingMessage: false,
          tags: false,
          regexRules: false,
          renderPlugins: false,
          worldBook: false,
          advancedSettings: true,
          modSuggestions: false,
          optimizeExisting: Boolean(aiUseCurrentDraft?.value)
        }
      }, aiStreamHandlers({
        isCurrent: () => isCurrentAdvancedAiRun(abortController),
        persistCheckpoint: false
      }), abortController.signal);
      if (!isCurrentAdvancedAiRun(abortController)) return;
      if (result?.aborted) {
        notify?.info?.('AI 高阶设置生成已暂停');
        return;
      }
      applyAiDraft(result.character || {}, {
        enabledSections: {
          profile: false,
          background: false,
          worldview: false,
          persona: false,
          openingMessage: false,
          tags: false,
          regexRules: false,
          renderPlugins: false,
          worldBook: false,
          advancedSettings: true,
          modSuggestions: false
        },
        applyEmptyValues: Boolean(aiUseCurrentDraft?.value)
      });
      setAiToolCallsIfChanged(result.toolCalls);
      setAiProcessIfChanged(result.process);
      aiReasoning.value = result.reasoning || '';
      notify?.success?.('AI 已完善高阶设置');
    } catch (err) {
      if (!isCurrentAdvancedAiRun(abortController)) return;
      if (abortController.signal.aborted || err?.name === 'AbortError') {
        notify?.info?.('AI 高阶设置生成已暂停');
        return;
      }
      setAiProcessIfChanged([{ round: 1, reasoning: err?.message || 'AI 高阶设置生成失败', content: '', tools: [] }]);
      notify?.error?.(err?.message || 'AI 高阶设置生成失败');
    } finally {
      if (isCurrentAdvancedAiRun(abortController)) {
        advancedAiLoading.value = false;
        advancedAiAbortController.value = null;
      }
    }
  }

  function stopAdvancedAi() {
    advancedAiAbortController.value?.abort();
  }

  function isCurrentAdvancedAiRun(abortController) {
    return !isDisposed() && advancedAiAbortController.value === abortController;
  }

  async function createSuggestedMods() {
    if (isDisposed() || suggestedModsCreating.value) return;
    const sourceSuggestions = aiModSuggestions.value;
    if (!aiModSuggestions.value.length) {
      notify?.warning?.('没有可创建的 AI Mod 建议');
      return;
    }
    const createToken = ++suggestedModCreateToken;
    const suggestions = [];
    for (const mod of sourceSuggestions) {
      suggestions.push(mod);
    }
    suggestedModsCreating.value = true;
    try {
      for (const mod of suggestions) {
        if (!isCurrentSuggestedModCreate(createToken, sourceSuggestions)) return;
        await createMod({
          name: mod.name,
          description: mod.description || '',
          type: normalizeModType(mod.type),
          content: mod.content,
          enabled: mod.enabled !== false
        });
        if (!isCurrentSuggestedModCreate(createToken, sourceSuggestions)) return;
      }
      notify?.success?.(`已创建 ${suggestions.length} 个 Mod`);
      setAiModSuggestionsIfChanged([]);
    } catch (err) {
      if (!isCurrentSuggestedModCreate(createToken, sourceSuggestions)) return;
      notify?.error?.(err?.message || '创建 AI Mod 建议失败');
    } finally {
      if (isActiveSuggestedModCreate(createToken)) {
        suggestedModsCreating.value = false;
      }
    }
  }

  async function applyAiWorldBookChanges(selectedChanges = aiWorldBookChanges.value) {
    if (isDisposed() || characterAiActionBusy.value || aiOptions.worldBook === false) return;
    const changes = (Array.isArray(selectedChanges) ? selectedChanges : []).filter((change) => aiWorldBookChanges.value.some((current) => current.ref === change.ref));
    if (!changes.length) {
      notify?.warning?.('没有待应用的世界书变更');
      return;
    }
    const createToken = ++worldBookCreateToken;
    aiWorldBookCreating.value = true;
    try {
      const payload = worldBookApplyRequest(changes);
      const signature = JSON.stringify(payload);
      if (aiWorldBookApplyRequest.value?.signature !== signature) {
        aiWorldBookApplyRequest.value = { signature, requestId: createWorldBookApplyRequestId() };
      }
      // Save the request identity before sending so a lost response can be retried.
      persistAiSession();
      const result = await applyWorldBookChanges({ requestId: aiWorldBookApplyRequest.value.requestId, changes: payload });
      if (!isActiveWorldBookCreate(createToken)) return;
      for (const item of result.books || []) {
        const change = changes.find((candidate) => candidate.ref === item.ref);
        if (!change) continue;
        if (!change.bookId && change.addToCharacter !== false) {
          onWorldBookCreated?.(item.book);
        } else {
          onWorldBookUpdated?.(item.book);
        }
      }
      const appliedRefs = new Set((result.books || []).map((item) => item.ref));
      aiWorldBookChanges.value = aiWorldBookChanges.value.filter((change) => !appliedRefs.has(change.ref));
      aiWorldBookWorkspace.value = rebaseWorldBookWorkspace(aiWorldBookWorkspace.value, result.books);
      if (aiPlanContext.value?.worldBookContext) {
        aiPlanContext.value.worldBookContext.workspace = rebaseWorldBookWorkspace(aiPlanContext.value.worldBookContext.workspace, result.books);
      }
      syncCheckpointWorldBooks();
      persistAiSession();
      notify?.success?.('世界书变更已保存；新书加入关联列表后，保存角色完成关联');
    } catch (err) {
      if (!isActiveWorldBookCreate(createToken)) return;
      notify?.error?.(err?.message || '应用世界书变更失败');
    } finally {
      if (isActiveWorldBookCreate(createToken)) {
        aiWorldBookCreating.value = false;
      }
    }
  }

  async function reloadAiWorldBook(change) {
    if (isDisposed() || characterAiActionBusy.value || aiOptions.worldBook === false || !change?.bookId) return;
    const createToken = ++worldBookCreateToken;
    aiWorldBookCreating.value = true;
    try {
      const book = await fetchWorldBook(change.bookId);
      if (!isActiveWorldBookCreate(createToken)) return;
      aiWorldBookWorkspace.value = rebaseWorldBookWorkspace(aiWorldBookWorkspace.value, [{ ref: change.ref, book }]);
      aiWorldBookChanges.value = aiWorldBookChanges.value.filter((pending) => pending.ref !== change.ref);
      aiWorldBookApplyRequest.value = null;
      aiPlanContext.value = null;
      planSession.resetPlan();
      syncCheckpointWorldBooks();
      onWorldBookUpdated?.(book);
      persistAiSession();
      notify?.success?.(`已读取“${book.name}”最新内容，可继续对话重新生成修改`);
    } catch (error) {
      if (isActiveWorldBookCreate(createToken)) notify?.error?.(error?.message || '重新读取世界书失败');
    } finally {
      if (isActiveWorldBookCreate(createToken)) aiWorldBookCreating.value = false;
    }
  }

  function discardAiWorldBookChange(change) {
    if (isDisposed() || characterAiActionBusy.value || !change?.ref) return;
    aiWorldBookChanges.value = aiWorldBookChanges.value.filter((pending) => pending.ref !== change.ref);
    if (aiWorldBookWorkspace.value) {
      aiWorldBookWorkspace.value = {
        ...aiWorldBookWorkspace.value,
        targets: (aiWorldBookWorkspace.value.targets || []).filter((target) => target.ref !== change.ref),
        activeRef: aiWorldBookWorkspace.value.activeRef === change.ref ? null : aiWorldBookWorkspace.value.activeRef,
        selectedBookIds: (aiWorldBookWorkspace.value.selectedBookIds || []).filter((bookId) => bookId !== change.bookId)
      };
    }
    if (change.bookId) aiWorldBookTargetOverride.value = aiWorldBookSelectedIds.value.filter((bookId) => bookId !== change.bookId);
    aiWorldBookApplyRequest.value = null;
    aiPlanContext.value = null;
    planSession.resetPlan();
    syncCheckpointWorldBooks();
    persistAiSession();
  }

  function syncCheckpointWorldBooks() {
    if (!aiCheckpoint.value?.character) return;
    aiCheckpoint.value = {
      ...aiCheckpoint.value,
      character: {
        ...aiCheckpoint.value.character,
        worldBookWorkspace: aiWorldBookWorkspace.value,
        worldBookChanges: aiWorldBookChanges.value
      }
    };
  }

  function cancelCharacterAiGeneration() {
    suggestedModCreateToken += 1;
    worldBookCreateToken += 1;
    stopRequestedByUser = false;
    aiAbortController.value?.abort();
    advancedAiAbortController.value?.abort();
    aiAbortController.value = null;
    advancedAiAbortController.value = null;
    aiLoading.value = false;
    advancedAiLoading.value = false;
    suggestedModsCreating.value = false;
    aiWorldBookCreating.value = false;
  }

  function saveAiCheckpoint() {
    if (!aiCheckpoint.value?.character) {
      notify?.warning?.('没有可保存的阶段结果');
      return;
    }
    applyAiDraft(aiCheckpoint.value.character, {
      enabledSections: { ...aiOptions },
      applyEmptyValues: Boolean(aiUseCurrentDraft?.value)
    });
    setAiModSuggestionsIfChanged(aiCheckpoint.value.character.modSuggestions);
    updateAiWorldBooks(aiCheckpoint.value.character);
    aiStatusMessage.value = aiStatus.value === 'completed'
      ? '完成结果已保留在角色草稿中'
      : '阶段结果已保存到角色草稿，可继续完善';
    persistAiSession();
    notify?.success?.('AI 阶段结果已保存到当前角色草稿');
  }

  function discardAiSession() {
    if (aiLoading.value) return;
    resetAiSessionState();
    try {
      localStorage.removeItem(aiSessionStorageKey());
    } catch {
      // Storage is optional; the in-memory session has already been cleared.
    }
  }

  function resetAiSessionState() {
    aiRequirement.value = '';
    aiCheckpoint.value = null;
    aiCheckpointUpdatedAt.value = '';
    aiLastError.value = '';
    setAiWarningsIfChanged([]);
    aiStatus.value = 'idle';
    aiStatusMessage.value = '填写任务后即可开始';
    aiReasoning.value = '';
    planSession.resetPlan();
    setAiToolCallsIfChanged([]);
    setAiProcessIfChanged([]);
    setAiModSuggestionsIfChanged([]);
    aiWorldBookWorkspace.value = null;
    aiWorldBookChanges.value = [];
    aiWorldBookTargetOverride.value = null;
    aiWorldBookAutomatic.value = false;
    aiConversationHistory.value = [];
    aiWorldBookApplyRequest.value = null;
    aiPlanContext.value = null;
  }

  function setAiOptionValue(key, enabled) {
    if (!Object.prototype.hasOwnProperty.call(aiOptions, key)) {
      return;
    }
    aiOptions[key] = Boolean(enabled);
  }

  function setAiToolCallsIfChanged(nextToolCalls) {
    return setAiPlainListIfChanged(aiToolCalls, nextToolCalls);
  }

  function setAiProcessIfChanged(nextProcess) {
    return setAiPlainListIfChanged(aiProcess, nextProcess);
  }

  function setAiModSuggestionsIfChanged(nextSuggestions) {
    return setAiPlainListIfChanged(aiModSuggestions, nextSuggestions);
  }

  function updateAiWorldBooks(character = {}) {
    if (character.worldBookWorkspace) aiWorldBookWorkspace.value = character.worldBookWorkspace;
    if (Array.isArray(character.worldBookChanges)) setAiPlainListIfChanged(aiWorldBookChanges, character.worldBookChanges);
  }

  function setAiWorldBookSelectedIds(ids) {
    aiWorldBookTargetOverride.value = normalizeStringList(ids);
    persistAiSession();
  }

  function setAiWorldBookAutomatic(enabled) {
    aiWorldBookAutomatic.value = Boolean(enabled);
    persistAiSession();
  }

  function requestAiNewWorldBook() {
    aiOptions.worldBook = true;
    const instruction = '请另外创建一本独立的新世界书，保留当前已有书及未应用修改。';
    if (!aiRequirement.value.includes(instruction)) aiRequirement.value = [aiRequirement.value.trim(), instruction].filter(Boolean).join('\n');
    persistAiSession();
  }

  function setAiWarningsIfChanged(nextWarnings) {
    return setAiPlainListIfChanged(aiWarnings, normalizeAiWarnings(nextWarnings));
  }

  function setAiPlainListIfChanged(listRef, nextItems) {
    const normalizedItems = Array.isArray(nextItems) ? nextItems : [];
    if (sameListItems(listRef.value, normalizedItems, samePlainValue)) {
      return false;
    }
    listRef.value = normalizedItems;
    return true;
  }

  function aiStreamHandlers({
    isCurrent = () => !isDisposed(),
    roundOffset = 0,
    persistCheckpoint = true
  } = {}) {
    return {
      step: (step = {}) => {
        if (!isCurrent()) return;
        const round = (step.round || 1) + roundOffset;
        updateAiProcessStep(round, (target) => ({
          ...target,
          ...step,
          round,
          state: 'running',
          content: target.content || step.content || '',
          reasoning: target.reasoning || step.reasoning || '',
          tools: target.tools?.length ? target.tools : cloneAiToolList(step.tools)
        }));
      },
      reasoning: ({ round = 1, text = '' } = {}) => {
        if (!isCurrent()) return;
        updateAiProcessStep(round + roundOffset, (target) => ({
          ...target,
          state: 'running',
          reasoning: `${target.reasoning || ''}${text}`
        }));
        aiReasoning.value += text;
        aiStatusMessage.value = '模型正在推理并规划修改';
      },
      content: ({ round = 1, text = '' } = {}) => {
        if (!isCurrent()) return;
        updateAiProcessStep(round + roundOffset, (target) => ({
          ...target,
          content: `${target.content || ''}${text}`
        }));
      },
      nudge: ({ round = 1, text = '' } = {}) => {
        if (!isCurrent()) return;
        updateAiProcessStep(round + roundOffset, (target) => ({
          ...target,
          content: `${target.content || ''}${target.content ? '\n\n' : ''}系统提醒：${text}`
        }));
      },
      tool: (call = {}) => {
        if (!isCurrent()) return;
        const log = {
          name: call.name,
          arguments: call.arguments,
          ...(call.policy ? { policy: call.policy } : {}),
          result: call.result
        };
        updateAiProcessStep((call.round || 1) + roundOffset, (target) => ({
          ...target,
          state: call.result?.ok === false ? 'warning' : 'complete',
          tools: appendAiToolList(target.tools, log)
        }));
        appendAiToolCall(log);
        aiStatusMessage.value = call.name === 'finish_character_draft'
          ? '正在验收结构化结果'
          : '工具已执行，正在保存阶段结果';
      },
      checkpoint: (checkpoint = {}) => {
        if (!isCurrent() || !persistCheckpoint) return;
        updateAiCheckpoint(checkpoint.character, checkpoint);
        persistAiSession();
      },
      plan: (nextPlan = {}) => {
        if (!isCurrent()) return;
        planSession.setPlan(nextPlan);
      },
      state: (state = {}) => {
        if (!isCurrent()) return;
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

  function updateAiCheckpoint(character, metadata = {}) {
    if (!character || typeof character !== 'object' || Array.isArray(character)) return;
    const updatedAt = String(metadata.updatedAt || new Date().toISOString());
    aiCheckpoint.value = {
      character,
      completedSections: normalizeStringList(metadata.completedSections),
      selectedSections: normalizeStringList(metadata.selectedSections),
      pendingToolNames: normalizeStringList(metadata.pendingToolNames),
      actionHistory: normalizeAiActionHistory(metadata.actionHistory),
      workflow: metadata.workflow && typeof metadata.workflow === 'object' ? metadata.workflow : {},
      lastTool: String(metadata.lastTool || ''),
      summary: String(metadata.summary || ''),
      updatedAt
    };
    aiCheckpointUpdatedAt.value = updatedAt;
    updateAiWorldBooks(character);
  }

  function buildContinuationPayload() {
    const completedCalls = [];
    for (const call of aiToolCalls.value) {
      if (call?.result?.ok === false || call?.result?.skipped === true) continue;
      const name = String(call?.name || '').trim();
      if (name) completedCalls.push(name);
    }
    return {
      enabled: true,
      completedSections: normalizeStringList(aiCheckpoint.value?.completedSections),
      previousToolNames: normalizeStringList(completedCalls).slice(-24),
      pendingToolNames: normalizeStringList(aiCheckpoint.value?.pendingToolNames),
      actionHistory: normalizeAiActionHistory(aiCheckpoint.value?.actionHistory),
      lastSummary: String(aiCheckpoint.value?.summary || aiStatusMessage.value || '').trim().slice(0, 240)
    };
  }

  function aiSessionStorageKey() {
    const sessionId = String(getSessionId?.() || 'new').trim() || 'new';
    return `${AI_SESSION_STORAGE_PREFIX}${sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  }

  function persistAiSession() {
    if (isDisposed()) return;
    const payload = {
      version: AI_SESSION_VERSION,
      requirement: aiRequirement.value,
      options: { ...aiOptions },
      status: aiStatus.value,
      statusMessage: aiStatusMessage.value,
      lastError: aiLastError.value,
      warnings: normalizeAiWarnings(aiWarnings.value),
      checkpoint: aiCheckpoint.value,
      checkpointUpdatedAt: aiCheckpointUpdatedAt.value,
      reasoning: String(aiReasoning.value || '').slice(-32_000),
      process: cloneProcessList(aiProcess.value).slice(-30),
      toolCalls: cloneAiToolList(aiToolCalls.value).slice(-80),
      modSuggestions: Array.isArray(aiModSuggestions.value) ? aiModSuggestions.value.slice(0, 8) : [],
      worldBookWorkspace: aiWorldBookWorkspace.value,
      worldBookChanges: aiWorldBookChanges.value,
      worldBookTargetOverride: aiWorldBookTargetOverride.value,
      worldBookAutomatic: aiWorldBookAutomatic.value,
      worldBookApplyRequest: aiWorldBookApplyRequest.value,
      conversationHistory: aiConversationHistory.value,
      planContext: aiPlanContext.value,
      ...planSession.serializePlanSession()
    };
    try {
      localStorage.setItem(aiSessionStorageKey(), JSON.stringify(payload));
    } catch {
      // Generation remains usable when storage is unavailable or full.
    }
  }

  function restoreAiSession() {
    try {
      const raw = localStorage.getItem(aiSessionStorageKey());
      if (!raw) return;
      const stored = JSON.parse(raw);
      if (stored?.version !== AI_SESSION_VERSION || !stored || typeof stored !== 'object') return;
      aiRequirement.value = String(stored.requirement || '');
      for (const key of Object.keys(aiOptions)) {
        if (Object.prototype.hasOwnProperty.call(stored.options || {}, key)) {
          aiOptions[key] = Boolean(stored.options[key]);
        }
      }
      aiCheckpoint.value = stored.checkpoint?.character ? stored.checkpoint : null;
      aiCheckpointUpdatedAt.value = String(stored.checkpointUpdatedAt || stored.checkpoint?.updatedAt || '');
      aiReasoning.value = String(stored.reasoning || '');
      setAiProcessIfChanged(stored.process);
      setAiToolCallsIfChanged(stored.toolCalls);
      setAiModSuggestionsIfChanged(stored.modSuggestions);
      aiWorldBookWorkspace.value = stored.worldBookWorkspace || stored.checkpoint?.character?.worldBookWorkspace || null;
      setAiPlainListIfChanged(aiWorldBookChanges, stored.worldBookChanges || stored.checkpoint?.character?.worldBookChanges);
      aiWorldBookTargetOverride.value = Array.isArray(stored.worldBookTargetOverride) ? normalizeStringList(stored.worldBookTargetOverride) : null;
      aiWorldBookAutomatic.value = stored.worldBookAutomatic === true;
      aiWorldBookApplyRequest.value = stored.worldBookApplyRequest || null;
      aiConversationHistory.value = Array.isArray(stored.conversationHistory) ? stored.conversationHistory.slice(-12) : [];
      aiPlanContext.value = stored.planContext || null;
      planSession.restorePlanSession(stored);
      if (stored.planPhase === 'executing' && stored.planContext && ['running', 'paused', 'failed'].includes(stored.status)) {
        planSession.setPlanPhase('executing');
      }
      aiLastError.value = String(stored.lastError || '');
      setAiWarningsIfChanged(stored.warnings);
      aiStatus.value = stored.status === 'running' ? 'paused' : normalizeAiStatus(stored.status);
      aiStatusMessage.value = stored.status === 'running'
        ? '上次运行在页面关闭时中断，阶段结果已恢复'
        : String(stored.statusMessage || defaultAiStatusMessage(aiStatus.value));
    } catch {
      // Ignore malformed or inaccessible local sessions.
    }
  }

  function getAiCurrentCharacter() {
    return aiUseCurrentDraft?.value ? getCurrentPayload() : {};
  }

  function canRunAiWithContext(requirement, message) {
    if (requirement) {
      return true;
    }
    if (aiUseCurrentDraft?.value && hasDraftSeed()) {
      return true;
    }
    notify?.warning?.(message);
    return false;
  }

  function applyAiDraft(character = {}, { enabledSections = {}, applyEmptyValues = true } = {}) {
    const fieldSections = {
      name: 'profile',
      avatarUrl: 'profile',
      gender: 'profile',
      age: 'profile',
      visibility: 'profile',
      background: 'background',
      worldview: 'worldview',
      persona: 'persona',
      openingMessage: 'openingMessage'
    };
    for (const key of ['name', 'avatarUrl', 'gender', 'age', 'background', 'worldview', 'persona', 'openingMessage', 'visibility']) {
      const section = fieldSections[key];
      if (
        isAiSectionEnabled(enabledSections, section)
        && Object.prototype.hasOwnProperty.call(character, key)
        && shouldApplyAiValue(character[key], { applyEmptyValues, key })
      ) {
        form[key] = character[key] || '';
      }
    }
    if (isAiSectionEnabled(enabledSections, 'tags') && Array.isArray(character.tags) && (applyEmptyValues || character.tags.length)) {
      form.tagsText = character.tags.join(', ');
    }
    if (isAiSectionEnabled(enabledSections, 'regexRules') && Array.isArray(character.regexRules) && (applyEmptyValues || character.regexRules.length)) {
      form.regexRules = character.regexRules;
    }
    if (isAiSectionEnabled(enabledSections, 'renderPlugins') && Array.isArray(character.renderPlugins) && (applyEmptyValues || character.renderPlugins.length)) {
      form.renderPlugins = character.renderPlugins;
    }
    if (isAiSectionEnabled(enabledSections, 'advancedSettings') && (character.authorAdvancedSettings || character.advancedSettings)) {
      const nextSettings = character.authorAdvancedSettings || character.advancedSettings;
      applyAdvancedSettingsDraft?.(nextSettings, { applyEmptyValues });
    }
  }

  function isAiSectionEnabled(sections = {}, key) {
    return sections[key] !== false;
  }

  function shouldApplyAiValue(value, { applyEmptyValues = true, key = '' } = {}) {
    if (applyEmptyValues) {
      return true;
    }
    if (key === 'visibility') {
      return value === 'public';
    }
    return String(value || '').trim().length > 0;
  }

  function hasDraftSeed() {
    const payload = getCurrentPayload();
    if (hasDraftSeedText(payload)) {
      return true;
    }
    return (Array.isArray(payload.tags) && payload.tags.length > 0)
      || (Array.isArray(payload.regexRules) && payload.regexRules.length > 0);
  }

  function hasDraftSeedText(payload = {}) {
    for (const key of AI_DRAFT_SEED_FIELDS) {
      if (String(payload[key] || '').trim()) {
        return true;
      }
    }
    return false;
  }

  function getCurrentPayload() {
    return typeof buildPayload === 'function' ? buildPayload() : {};
  }

  function isActiveSuggestedModCreate(createToken) {
    return !isDisposed() && createToken === suggestedModCreateToken;
  }

  function isCurrentSuggestedModCreate(createToken, sourceSuggestions) {
    return isActiveSuggestedModCreate(createToken)
      && aiModSuggestions.value === sourceSuggestions;
  }

  function isActiveWorldBookCreate(createToken) {
    return !isDisposed() && createToken === worldBookCreateToken;
  }

  return {
    aiLoading,
    aiCheckpoint,
    aiCheckpointUpdatedAt,
    aiHasCheckpoint,
    aiLastError,
    aiRequirement,
    aiStatus,
    aiStatusMessage,
    aiToolCalls,
    aiWarnings,
    aiProcess,
    aiReasoning,
    aiModSuggestions,
    aiWorldBookChanges,
    aiWorldBookSelectedIds,
    aiWorldBookAutomatic,
    aiWorldBookSourceLabel,
    aiWorldBookCreating,
    suggestedModsCreating,
    advancedAiLoading,
    advancedAiRequirement,
    characterAiActionBusy,
    cancelCharacterAiGeneration,
    completeAdvancedSettingsWithAi,
    completeWithAi,
    createSuggestedMods,
    applyAiWorldBookChanges,
    reloadAiWorldBook,
    discardAiWorldBookChange,
    setAiWorldBookSelectedIds,
    setAiWorldBookAutomatic,
    requestAiNewWorldBook,
    discardAiSession,
    discardCharacterPlan,
    executeApprovedPlan,
    replanCharacterAi,
    resumeCharacterAi,
    retryCharacterAi,
    saveAiCheckpoint,
    setAiOptionValue,
    stopAdvancedAi,
    stopCharacterAi,
    aiPlan: planSession.plan,
    aiPlanExtraRequirement: planSession.planExtraRequirement,
    aiPlanPhase: planSession.planPhase,
    aiPlanStepStatus: planSession.planStepStatus,
    toggleAiPlanStep: planSession.togglePlanStep,
    updateAiPlanStep: planSession.updatePlanStep
  };
}

function normalizeModType(type) {
  if (['prompt_inject', 'style_enhance', 'custom'].includes(type)) return type;
  if (type === 'style') return 'style_enhance';
  return 'prompt_inject';
}

function cloneProcessList(process = []) {
  const cloned = [];
  for (const step of Array.isArray(process) ? process : []) {
    cloned.push({
      ...step,
      tools: cloneAiToolList(step?.tools)
    });
  }
  return cloned;
}

function highestProcessRound(process = []) {
  let highest = 0;
  for (const step of Array.isArray(process) ? process : []) {
    highest = Math.max(highest, Number(step?.round) || 0);
  }
  return highest;
}

function mergeProcessLists(baseProcess = [], nextProcess = [], roundOffset = 0) {
  const merged = cloneProcessList(baseProcess);
  for (const step of Array.isArray(nextProcess) ? nextProcess : []) {
    merged.push({
      ...step,
      round: (Number(step?.round) || 1) + roundOffset,
      state: step?.state || 'complete',
      tools: cloneAiToolList(step?.tools)
    });
  }
  return merged;
}

function mergeUniqueToolCallLists(baseCalls = [], nextCalls = []) {
  const merged = cloneAiToolList(baseCalls);
  for (const call of Array.isArray(nextCalls) ? nextCalls : []) {
    let duplicate = false;
    for (const current of merged) {
      if (samePlainValue(current, call)) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate) merged.push(call);
  }
  return merged;
}

function mergeReasoningText(base, next) {
  const first = String(base || '').trim();
  const second = String(next || '').trim();
  if (!first) return second;
  if (!second) return first;
  return `${first}\n\n${second}`;
}

function normalizeStringList(values = []) {
  const normalized = [];
  for (const value of Array.isArray(values) ? values : []) {
    const text = String(value || '').trim();
    if (text && !normalized.includes(text)) normalized.push(text);
  }
  return normalized;
}

function normalizeAiWarnings(values = []) {
  const warnings = [];
  for (const value of Array.isArray(values) ? values : []) {
    const text = String(value || '').trim().slice(0, 200);
    if (text && !warnings.includes(text)) warnings.push(text);
    if (warnings.length >= 8) break;
  }
  return warnings;
}

function normalizeAiActionHistory(values = []) {
  const normalized = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const tool = String(value.tool || '').trim().slice(0, 80);
    if (!tool) continue;
    normalized.push({
      round: Math.max(1, Number(value.round) || normalized.length + 1),
      tool,
      status: value.status === 'failed' ? 'failed' : 'completed',
      summary: String(value.summary || '').trim().slice(0, 240),
      sections: normalizeStringList(value.sections)
    });
    if (normalized.length >= 24) break;
  }
  return normalized;
}

function normalizeAiStatus(value) {
  return ['idle', 'running', 'paused', 'failed', 'completed', 'review'].includes(value) ? value : 'idle';
}

function defaultAiStatusMessage(status) {
  if (status === 'paused') return '阶段结果已保留，可继续完成';
  if (status === 'failed') return '生成失败，可重试';
  if (status === 'completed') return '结果已完成并回填';
  if (status === 'review') return '计划待审批';
  return '填写任务后即可开始';
}
