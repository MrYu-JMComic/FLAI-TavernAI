import { computed, ref } from 'vue';
import { streamCharacterDraft } from '../../api/characters.js';
import { createMod } from '../../api/mods.js';
import { appendAiToolList, cloneAiToolList } from '../../utils/aiToolLists';
import { sameListItems } from '../../utils/listReferences';
import { samePlainValue } from '../../utils/plainValues';

const AI_DRAFT_SEED_FIELDS = ['name', 'gender', 'age', 'background', 'worldview', 'persona', 'openingMessage'];

export function useCharacterAiGeneration({
  canEdit,
  saving,
  form,
  aiOptions,
  aiUseCurrentDraft,
  assistantModel,
  buildPayload,
  applyAdvancedSettingsDraft,
  isDisposed = () => false,
  notify
} = {}) {
  const aiLoading = ref(false);
  const aiRequirement = ref('');
  const aiToolCalls = ref([]);
  const aiProcess = ref([]);
  const aiReasoning = ref('');
  const aiModSuggestions = ref([]);
  const suggestedModsCreating = ref(false);
  const advancedAiLoading = ref(false);
  const advancedAiRequirement = ref('');
  const aiAbortController = ref(null);
  const advancedAiAbortController = ref(null);
  let suggestedModCreateToken = 0;

  const characterAiActionBusy = computed(() => (
    aiLoading.value
    || advancedAiLoading.value
    || Boolean(saving?.value)
    || !canEdit?.value
  ));

  async function completeWithAi() {
    if (characterAiActionBusy.value) return;
    const requirement = aiRequirement.value.trim();
    if (!canRunAiWithContext(requirement, '请先写一点角色要求，或开启“结合当前已填写内容”。')) {
      return;
    }

    aiLoading.value = true;
    setAiToolCallsIfChanged([]);
    setAiProcessIfChanged([{ round: 1, reasoning: '等待模型响应...', content: '', tools: [] }]);
    aiReasoning.value = '';
    setAiModSuggestionsIfChanged([]);
    const abortController = new AbortController();
    aiAbortController.value = abortController;
    try {
      const result = await streamCharacterDraft({
        requirement,
        character: getAiCurrentCharacter(),
        modelOverride: String(assistantModel?.value || '').trim(),
        options: { ...aiOptions, optimizeExisting: Boolean(aiUseCurrentDraft?.value) }
      }, aiStreamHandlers(() => isCurrentCharacterAiRun(abortController)), abortController.signal);
      if (!isCurrentCharacterAiRun(abortController)) return;
      if (result?.aborted) {
        notify?.info?.('AI 生成已暂停');
        return;
      }
      applyAiDraft(result.character || {}, {
        enabledSections: { ...aiOptions },
        applyEmptyValues: Boolean(aiUseCurrentDraft?.value)
      });
      setAiModSuggestionsIfChanged(result.character?.modSuggestions);
      setAiToolCallsIfChanged(result.toolCalls);
      setAiProcessIfChanged(result.process);
      aiReasoning.value = result.reasoning || '';
      notify?.success?.(`AI 已完善设定，调用 ${aiToolCalls.value.length} 次工具`);
    } catch (err) {
      if (!isCurrentCharacterAiRun(abortController)) return;
      if (abortController.signal.aborted || err?.name === 'AbortError') {
        notify?.info?.('AI 生成已暂停');
        return;
      }
      setAiProcessIfChanged([{ round: 1, reasoning: err?.message || 'AI 生成失败', content: '', tools: [] }]);
      notify?.error?.(err?.message || 'AI 生成失败');
    } finally {
      if (isCurrentCharacterAiRun(abortController)) {
        aiLoading.value = false;
        aiAbortController.value = null;
      }
    }
  }

  function stopCharacterAi() {
    aiAbortController.value?.abort();
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
        options: {
          profile: false,
          background: false,
          worldview: false,
          persona: false,
          openingMessage: false,
          tags: false,
          regexRules: false,
          renderPlugins: false,
          worldBookSuggestion: false,
          advancedSettings: true,
          modSuggestions: false,
          optimizeExisting: Boolean(aiUseCurrentDraft?.value)
        }
      }, aiStreamHandlers(() => isCurrentAdvancedAiRun(abortController)), abortController.signal);
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
          worldBookSuggestion: false,
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

  function cancelCharacterAiGeneration() {
    suggestedModCreateToken += 1;
    aiAbortController.value?.abort();
    advancedAiAbortController.value?.abort();
    aiAbortController.value = null;
    advancedAiAbortController.value = null;
    aiLoading.value = false;
    advancedAiLoading.value = false;
    suggestedModsCreating.value = false;
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

  function setAiPlainListIfChanged(listRef, nextItems) {
    const normalizedItems = Array.isArray(nextItems) ? nextItems : [];
    if (sameListItems(listRef.value, normalizedItems, samePlainValue)) {
      return false;
    }
    listRef.value = normalizedItems;
    return true;
  }

  function aiStreamHandlers(isCurrent = () => !isDisposed()) {
    return {
      step: (step = {}) => {
        if (!isCurrent()) return;
        updateAiProcessStep(step.round || 1, (target) => ({
          ...target,
          ...step,
          content: target.content || step.content || '',
          reasoning: target.reasoning === '等待模型响应...' ? step.reasoning || '' : target.reasoning || step.reasoning || '',
          tools: target.tools?.length ? target.tools : cloneAiToolList(step.tools)
        }));
      },
      reasoning: ({ round = 1, text = '' } = {}) => {
        if (!isCurrent()) return;
        updateAiProcessStep(round, (target) => ({
          ...target,
          reasoning: `${target.reasoning === '等待模型响应...' ? '' : target.reasoning || ''}${text}`
        }));
        aiReasoning.value += text;
      },
      content: ({ round = 1, text = '' } = {}) => {
        if (!isCurrent()) return;
        updateAiProcessStep(round, (target) => ({
          ...target,
          content: `${target.content || ''}${text}`
        }));
      },
      nudge: ({ round = 1, text = '' } = {}) => {
        if (!isCurrent()) return;
        updateAiProcessStep(round, (target) => ({
          ...target,
          content: `${target.content || ''}${target.content ? '\n\n' : ''}系统提醒：${text}`
        }));
      },
      tool: (call = {}) => {
        if (!isCurrent()) return;
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

  return {
    aiLoading,
    aiRequirement,
    aiToolCalls,
    aiProcess,
    aiReasoning,
    aiModSuggestions,
    suggestedModsCreating,
    advancedAiLoading,
    advancedAiRequirement,
    characterAiActionBusy,
    cancelCharacterAiGeneration,
    completeAdvancedSettingsWithAi,
    completeWithAi,
    createSuggestedMods,
    setAiOptionValue,
    stopAdvancedAi,
    stopCharacterAi
  };
}

function normalizeModType(type) {
  if (['prompt_inject', 'style_enhance', 'custom'].includes(type)) return type;
  if (type === 'style') return 'style_enhance';
  return 'prompt_inject';
}
