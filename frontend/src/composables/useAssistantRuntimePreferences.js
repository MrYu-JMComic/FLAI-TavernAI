import { computed, ref, watch } from 'vue';
import { recordFrontendDiagnostic } from '../diagnostics.js';
import { useProviderModels } from './useProviderModels';
import { resolveProviderModelCapabilities } from '../../../shared/providerCapabilities.js';
import {
  listThinkingPreferenceLevels,
  resolveThinkingPreferenceLevel
} from '../../../shared/providerThinking.js';

// The assistant model is deliberately one shared preference: the character and
// world book workbenches have always pointed at the same stored model, and
// splitting it now would silently reset one of them.
const ASSISTANT_MODEL_STORAGE_KEY = 'flai-assistant-model';

const THINKING_LEVEL_LABELS = Object.freeze({
  off: '关闭',
  minimal: '最低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最大'
});

/**
 * Model / thinking / streaming / plan-mode preferences shared by the structured
 * AI workbenches. `storagePrefix` keeps each workbench's toggles separate while
 * the model selection stays global.
 */
export function useAssistantRuntimePreferences(providerRef, {
  storagePrefix,
  defaultThinkingLevel = 'medium',
  defaultStreaming = false,
  defaultPlanMode = false
} = {}) {
  const prefix = String(storagePrefix || 'flai-assistant');
  const assistantModel = readStoredRef(ASSISTANT_MODEL_STORAGE_KEY, '', (raw) => raw || '');
  const requestedThinkingLevel = readStoredRef(`${prefix}-thinking-level`, defaultThinkingLevel, (raw) => raw || defaultThinkingLevel);
  const assistantStreamingEnabled = readStoredRef(`${prefix}-streaming`, defaultStreaming, (raw) => raw === 'true');
  const assistantPlanMode = readStoredRef(`${prefix}-plan-mode`, defaultPlanMode, (raw) => raw === 'true');

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

  persistRef(assistantModel, ASSISTANT_MODEL_STORAGE_KEY, (value) => String(value || '').trim());
  persistRef(requestedThinkingLevel, `${prefix}-thinking-level`, (value) => String(value || 'off'));
  persistRef(assistantStreamingEnabled, `${prefix}-streaming`, (value) => (value ? 'true' : 'false'));
  persistRef(assistantPlanMode, `${prefix}-plan-mode`, (value) => (value ? 'true' : 'false'));

  return {
    assistantModel,
    assistantModelOptions,
    assistantPlanMode,
    assistantStreamingEnabled,
    assistantThinkingLevel,
    assistantThinkingOptions,
    assistantThinkingSupported,
    providerModelOptionsFor
  };
}

export function useAssistantBooleanPreference(storageKey, defaultValue, diagnosticKey) {
  const stored = readStoredRef(storageKey, defaultValue, (raw) => (raw === null ? defaultValue : raw !== 'false'), diagnosticKey);
  persistRef(stored, storageKey, (value) => (value ? 'true' : 'false'), diagnosticKey);
  return stored;
}

function readStoredRef(storageKey, fallback, parse, diagnosticKey = '') {
  try {
    return ref(parse(localStorage.getItem(storageKey)));
  } catch (error) {
    recordFrontendDiagnostic(`${diagnosticKey || 'assistantPreferences'}.load`, error, { storageKey });
    return ref(fallback);
  }
}

function persistRef(valueRef, storageKey, serialize, diagnosticKey = '') {
  watch(valueRef, (value) => {
    try {
      localStorage.setItem(storageKey, serialize(value));
    } catch (error) {
      recordFrontendDiagnostic(`${diagnosticKey || 'assistantPreferences'}.save`, error, { storageKey });
    }
  });
}
