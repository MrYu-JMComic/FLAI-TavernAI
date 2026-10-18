import {
  useAssistantBooleanPreference,
  useAssistantRuntimePreferences
} from '../useAssistantRuntimePreferences';

const ASSISTANT_USE_CURRENT_STORAGE_KEY = 'flai-assistant-use-current-draft';
const CHARACTER_ASSISTANT_STORAGE_PREFIX = 'flai-character-assistant';

export function useCharacterAiPreferences(providerRef) {
  const runtime = useAssistantRuntimePreferences(providerRef, {
    storagePrefix: CHARACTER_ASSISTANT_STORAGE_PREFIX
  });
  const aiUseCurrentDraft = useAssistantBooleanPreference(
    ASSISTANT_USE_CURRENT_STORAGE_KEY,
    true,
    'characterForm.aiUseCurrentDraft'
  );

  return { ...runtime, aiUseCurrentDraft };
}
