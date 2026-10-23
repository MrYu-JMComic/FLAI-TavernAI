import { computed, onScopeDispose, ref, unref, watch } from 'vue';
import { listProviderProfiles } from '../../api/providers.js';
import { recordFrontendDiagnostic } from '../../diagnostics.js';
import { readCachedProviderModels, refreshProviderModels } from '../../services/modelCatalog.js';
import {
  useAssistantBooleanPreference,
  useAssistantRuntimePreferences
} from '../useAssistantRuntimePreferences';

const ASSISTANT_USE_CURRENT_STORAGE_KEY = 'flai-assistant-use-current-draft';
const CHARACTER_ASSISTANT_STORAGE_PREFIX = 'flai-character-assistant';

export function useCharacterAiPreferences(providerRef, userRef) {
  const storageScope = computed(() => encodeURIComponent(String(
    unref(userRef)?.id || unref(providerRef)?.userId || unref(providerRef)?.id || 'anonymous'
  )));
  const profileStorageKey = computed(() => `${CHARACTER_ASSISTANT_STORAGE_PREFIX}:${storageScope.value}:provider-profile`);
  const assistantProviderProfileId = ref('');
  const assistantProviderProfiles = ref([]);
  const profilesLoading = ref(false);
  const modelsLoading = ref(false);
  const profilesError = ref('');
  const modelsError = ref('');
  const assistantModelsLoading = computed(() => profilesLoading.value || modelsLoading.value);
  const assistantModelsError = computed(() => profilesError.value || modelsError.value);
  const selectedProvider = computed(() => {
    const profileId = assistantProviderProfileId.value;
    const source = profileId
      ? assistantProviderProfiles.value.find(profile => profile.id === profileId) || { id: profileId }
      : unref(providerRef) || {};
    return {
      ...source,
      modelCacheScope: `character-assistant:${storageScope.value}:${profileId || source.id || 'global'}`
    };
  });
  let profilesRequest = null;
  let profilesRequestToken = 0;
  let profilesLoaded = false;
  let modelsRequestToken = 0;
  let disposed = false;

  watch(profileStorageKey, (key) => {
    try { assistantProviderProfileId.value = localStorage.getItem(key) || ''; }
    catch (error) {
      recordFrontendDiagnostic('characterAssistant.providerPreference.load', error, { storageKey: key });
      assistantProviderProfileId.value = '';
    }
  }, { immediate: true, flush: 'sync' });
  watch(assistantProviderProfileId, (value) => {
    try { localStorage.setItem(profileStorageKey.value, String(value || '')); }
    catch (error) {
      recordFrontendDiagnostic('characterAssistant.providerPreference.save', error, { storageKey: profileStorageKey.value });
    }
  }, { flush: 'sync' });

  const runtime = useAssistantRuntimePreferences(selectedProvider, {
    storagePrefix: CHARACTER_ASSISTANT_STORAGE_PREFIX,
    modelStorageKey: computed(() => `${CHARACTER_ASSISTANT_STORAGE_PREFIX}:${storageScope.value}:model`),
    // The assistant UI is an activity stream. Start with provider streaming
    // enabled so the first model decision and tool call are visible while they
    // are happening; users can still turn it off in the session settings.
    defaultStreaming: true
  });
  const assistantProviderSettings = computed(() => ({
    ...selectedProvider.value,
    model: String(runtime.assistantModel.value || selectedProvider.value.model || '').trim()
  }));
  const assistantModelOptions = computed(() => runtime.providerModelOptionsFor(
    runtime.assistantModel.value,
    assistantProviderProfileId.value ? '使用网关默认模型' : '使用全局模型'
  ));
  const aiUseCurrentDraft = useAssistantBooleanPreference(
    ASSISTANT_USE_CURRENT_STORAGE_KEY,
    true,
    'characterForm.aiUseCurrentDraft'
  );

  function selectAssistantProviderProfile(profileId) {
    const nextId = String(profileId || '').trim();
    assistantProviderProfileId.value = nextId;
    runtime.assistantModel.value = nextId ? String(selectedProvider.value.model || '') : '';
  }

  async function loadAssistantProviderProfiles() {
    if (profilesRequest) return profilesRequest;
    const requestToken = ++profilesRequestToken;
    profilesLoading.value = true;
    profilesError.value = '';
    profilesRequest = (async () => {
      try {
        const result = await listProviderProfiles();
        if (disposed || requestToken !== profilesRequestToken) return [];
        assistantProviderProfiles.value = Array.isArray(result.providers) ? result.providers : [];
        profilesLoaded = true;
        return assistantProviderProfiles.value;
      } catch (error) {
        if (!disposed && requestToken === profilesRequestToken) profilesError.value = error.message || '无法加载网关配置。';
        return [];
      } finally {
        if (!disposed && requestToken === profilesRequestToken) {
          profilesLoading.value = false;
          profilesRequest = null;
        }
      }
    })();
    return profilesRequest;
  }

  async function refreshAssistantModels({ forceRefresh = true } = {}) {
    const requestScope = storageScope.value;
    if (profilesError.value || (!profilesLoaded && assistantProviderProfileId.value)) {
      await loadAssistantProviderProfiles();
      if (disposed || requestScope !== storageScope.value || profilesError.value) return [];
    }
    return loadSelectedAssistantModels({ forceRefresh });
  }

  async function loadSelectedAssistantModels({ forceRefresh = false } = {}) {
    const requestToken = ++modelsRequestToken;
    const settings = { ...selectedProvider.value };
    modelsError.value = '';
    if (!settings.baseUrl) {
      modelsLoading.value = false;
      if (assistantProviderProfileId.value && profilesLoaded) modelsError.value = '所选网关配置不存在，请重新选择。';
      return [];
    }
    const cached = readCachedProviderModels(settings);
    if (!forceRefresh && cached.length) {
      modelsLoading.value = false;
      return cached;
    }
    modelsLoading.value = true;
    try {
      return await refreshProviderModels(settings, { forceRefresh });
    } catch (error) {
      if (!disposed && requestToken === modelsRequestToken) modelsError.value = error.message || '无法加载网关模型。';
      return cached;
    } finally {
      if (!disposed && requestToken === modelsRequestToken) modelsLoading.value = false;
    }
  }

  watch(selectedProvider, () => { void loadSelectedAssistantModels(); }, { deep: true, immediate: true });
  watch(storageScope, () => {
    profilesRequestToken += 1;
    profilesRequest = null;
    profilesLoaded = false;
    profilesLoading.value = false;
    assistantProviderProfiles.value = [];
    profilesError.value = '';
    void loadAssistantProviderProfiles();
  }, { flush: 'sync' });
  onScopeDispose(() => { disposed = true; modelsRequestToken += 1; profilesRequestToken += 1; });

  return {
    ...runtime, aiUseCurrentDraft, assistantModelOptions,
    assistantProviderProfileId, assistantProviderProfiles, assistantProviderSettings,
    assistantModelsLoading, assistantModelsError,
    selectAssistantProviderProfile, loadAssistantProviderProfiles, refreshAssistantModels
  };
}
