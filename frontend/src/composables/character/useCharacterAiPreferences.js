import { computed, ref, watch } from 'vue';
import { recordFrontendDiagnostic } from '../../diagnostics.js';
import { useProviderModels } from '../useProviderModels';

const ASSISTANT_MODEL_STORAGE_KEY = 'flai-assistant-model';
const ASSISTANT_USE_CURRENT_STORAGE_KEY = 'flai-assistant-use-current-draft';

export function useCharacterAiPreferences(providerRef) {
  const assistantModel = ref(loadAssistantModel());
  const aiUseCurrentDraft = ref(loadAiUseCurrentDraft());
  const { providerModelOptionsFor } = useProviderModels(providerRef);
  const assistantModelOptions = computed(() => providerModelOptionsFor(assistantModel.value, '使用全局模型'));

  watch(assistantModel, (value) => {
    try {
      localStorage.setItem(ASSISTANT_MODEL_STORAGE_KEY, String(value || '').trim());
    } catch (error) {
      recordFrontendDiagnostic('characterForm.assistantModel.save', error, { storageKey: ASSISTANT_MODEL_STORAGE_KEY });
    }
  });

  watch(aiUseCurrentDraft, (value) => {
    try {
      localStorage.setItem(ASSISTANT_USE_CURRENT_STORAGE_KEY, value ? 'true' : 'false');
    } catch (error) {
      recordFrontendDiagnostic('characterForm.aiUseCurrentDraft.save', error, { storageKey: ASSISTANT_USE_CURRENT_STORAGE_KEY });
    }
  });

  return {
    aiUseCurrentDraft,
    assistantModel,
    assistantModelOptions,
    providerModelOptionsFor
  };
}

function loadAssistantModel() {
  try {
    return localStorage.getItem(ASSISTANT_MODEL_STORAGE_KEY) || '';
  } catch (error) {
    recordFrontendDiagnostic('characterForm.assistantModel.load', error, { storageKey: ASSISTANT_MODEL_STORAGE_KEY });
    return '';
  }
}

function loadAiUseCurrentDraft() {
  try {
    const raw = localStorage.getItem(ASSISTANT_USE_CURRENT_STORAGE_KEY);
    return raw === null ? true : raw !== 'false';
  } catch (error) {
    recordFrontendDiagnostic('characterForm.aiUseCurrentDraft.load', error, { storageKey: ASSISTANT_USE_CURRENT_STORAGE_KEY });
    return true;
  }
}
