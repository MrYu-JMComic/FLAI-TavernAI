import { computed, ref, watch } from 'vue';
import { recordFrontendDiagnostic } from '../../diagnostics.js';
import { useProviderModels } from '../useProviderModels';
import { resolveProviderModelCapabilities } from '../../../../shared/providerCapabilities.js';
import {
  listThinkingPreferenceLevels,
  resolveThinkingPreferenceLevel
} from '../../../../shared/providerThinking.js';

const ASSISTANT_MODEL_STORAGE_KEY = 'flai-assistant-model';
const ASSISTANT_USE_CURRENT_STORAGE_KEY = 'flai-assistant-use-current-draft';
const ASSISTANT_THINKING_STORAGE_KEY = 'flai-character-assistant-thinking-level';
const ASSISTANT_STREAMING_STORAGE_KEY = 'flai-character-assistant-streaming';
const THINKING_LEVEL_LABELS = Object.freeze({
  off: '关闭',
  minimal: '最低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最大'
});

export function useCharacterAiPreferences(providerRef) {
  const assistantModel = ref(loadAssistantModel());
  const aiUseCurrentDraft = ref(loadAiUseCurrentDraft());
  const requestedThinkingLevel = ref(loadAssistantThinkingLevel());
  const assistantStreamingEnabled = ref(loadAssistantStreamingEnabled());
  const { providerModelOptionsFor } = useProviderModels(providerRef);
  const assistantModelOptions = computed(() => providerModelOptionsFor(assistantModel.value, '使用全局模型'));
  const assistantProviderSettings = computed(() => ({
    ...(providerRef?.value || {}),
    model: String(assistantModel.value || providerRef?.value?.model || '').trim()
  }));
  const assistantThinkingControl = computed(() => (
    resolveProviderModelCapabilities(assistantProviderSettings.value).thinking || {}
  ));
  const assistantThinkingLevel = computed({
    get() {
      const control = assistantThinkingControl.value;
      return resolveThinkingPreferenceLevel(
        requestedThinkingLevel.value,
        control,
        control.defaultLevel
      ) || 'off';
    },
    set(value) {
      requestedThinkingLevel.value = String(value || 'off');
    }
  });
  const assistantThinkingOptions = computed(() => {
    const control = assistantThinkingControl.value;
    const nativeMinimumLevel = (control.levels || [])[0];
    return listThinkingPreferenceLevels(control).map((value) => ({
      value,
      label: !control.canDisable && value === nativeMinimumLevel && value !== 'minimal'
        ? `${THINKING_LEVEL_LABELS[value] || value}（最低）`
        : THINKING_LEVEL_LABELS[value] || value
    }));
  });
  const assistantThinkingSupported = computed(() => Boolean(
    assistantThinkingControl.value.supported && assistantThinkingOptions.value.length
  ));

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

  watch(requestedThinkingLevel, (value) => {
    try {
      localStorage.setItem(ASSISTANT_THINKING_STORAGE_KEY, String(value || 'off'));
    } catch (error) {
      recordFrontendDiagnostic('characterForm.assistantThinking.save', error, { storageKey: ASSISTANT_THINKING_STORAGE_KEY });
    }
  });

  watch(assistantStreamingEnabled, (value) => {
    try {
      localStorage.setItem(ASSISTANT_STREAMING_STORAGE_KEY, value ? 'true' : 'false');
    } catch (error) {
      recordFrontendDiagnostic('characterForm.assistantStreaming.save', error, { storageKey: ASSISTANT_STREAMING_STORAGE_KEY });
    }
  });

  return {
    aiUseCurrentDraft,
    assistantModel,
    assistantModelOptions,
    assistantStreamingEnabled,
    assistantThinkingLevel,
    assistantThinkingOptions,
    assistantThinkingSupported,
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

function loadAssistantThinkingLevel() {
  try {
    return localStorage.getItem(ASSISTANT_THINKING_STORAGE_KEY) || 'medium';
  } catch (error) {
    recordFrontendDiagnostic('characterForm.assistantThinking.load', error, { storageKey: ASSISTANT_THINKING_STORAGE_KEY });
    return 'medium';
  }
}

function loadAssistantStreamingEnabled() {
  try {
    return localStorage.getItem(ASSISTANT_STREAMING_STORAGE_KEY) === 'true';
  } catch (error) {
    recordFrontendDiagnostic('characterForm.assistantStreaming.load', error, { storageKey: ASSISTANT_STREAMING_STORAGE_KEY });
    return false;
  }
}
