import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, nextTick, ref } from 'vue';
import { fetchProviderModels, listProviderProfiles } from '../../../api/providers.js';
import { refreshProviderModels } from '../../../services/modelCatalog.js';
import { useCharacterAiPreferences } from '../useCharacterAiPreferences.js';
import { useAssistantRuntimePreferences } from '../../useAssistantRuntimePreferences.js';

vi.mock('../../../api/providers.js', () => ({
  fetchProviderModels: vi.fn(), listProviderProfiles: vi.fn()
}));

const globalProvider = {
  id: 'global', providerType: 'custom', gatewayName: 'Global',
  baseUrl: 'https://global.test/v1', model: 'global-model', apiKeySet: true
};
const profiles = [
  {
    id: 'claude', providerType: 'anthropic', gatewayName: 'Claude',
    baseUrl: 'https://claude.test/v1', model: 'claude-sonnet-4-6', apiKeySet: true,
    supportsReasoning: true
  },
  {
    id: 'other', providerType: 'custom', gatewayName: 'Other',
    baseUrl: 'https://other.test/v1', model: 'other-model', apiKeySet: true
  }
];
const wrappers = [];

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  listProviderProfiles.mockResolvedValue({ providers: profiles });
  fetchProviderModels.mockImplementation(async payload => ({
    models: [{ id: payload.providerId === 'claude' ? 'claude-sonnet-4-6' : `${payload.providerId}-catalog` }]
  }));
});
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); });

function fixture(userId = 'owner') {
  const provider = ref(globalProvider);
  const user = ref({ id: userId });
  let api;
  wrappers.push(mount(defineComponent({
    setup() { api = useCharacterAiPreferences(provider, user); return () => null; }
  })));
  return { api, provider, user };
}

describe('character assistant gateway preferences', () => {
  it('selects an independent saved gateway, its default model and thinking capabilities', async () => {
    localStorage.setItem('flai-assistant-model', 'worldbook-model');
    const { api } = fixture();
    await api.loadAssistantProviderProfiles();
    api.selectAssistantProviderProfile('claude');
    await flushPromises();

    expect(api.assistantProviderProfileId.value).toBe('claude');
    expect(api.assistantModel.value).toBe('claude-sonnet-4-6');
    expect(api.assistantProviderSettings.value).toMatchObject({ id: 'claude', providerType: 'anthropic', model: 'claude-sonnet-4-6' });
    expect(api.assistantThinkingSupported.value).toBe(true);
    expect(fetchProviderModels).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'claude' }), { forceRefresh: false });
    expect(api.assistantModelOptions.value.some(option => option.id === 'claude-sonnet-4-6')).toBe(true);
    expect(localStorage.getItem('flai-assistant-model')).toBe('worldbook-model');
    expect(localStorage.getItem('flai-character-assistant:owner:provider-profile')).toBe('claude');

    api.selectAssistantProviderProfile('');
    await nextTick();
    expect(api.assistantModel.value).toBe('');
    expect(api.assistantProviderSettings.value.model).toBe('global-model');
  });

  it('preserves a restored session model while saved profiles load asynchronously', async () => {
    let resolveProfiles;
    listProviderProfiles.mockReturnValueOnce(new Promise(resolve => { resolveProfiles = resolve; }));
    const { api } = fixture();
    const loading = api.loadAssistantProviderProfiles();
    api.assistantProviderProfileId.value = 'claude';
    api.assistantModel.value = 'claude-custom-session-model';
    await nextTick();
    resolveProfiles({ providers: profiles });
    await loading;
    await flushPromises();

    expect(api.assistantProviderProfileId.value).toBe('claude');
    expect(api.assistantModel.value).toBe('claude-custom-session-model');
    expect(api.assistantModelOptions.value).toContainEqual(expect.objectContaining({ id: 'claude-custom-session-model', current: true }));
    expect(api.assistantModelsError.value).toBe('');
  });

  it('uses the selected gateway cache and sends an explicit refresh to the same profile', async () => {
    await refreshProviderModels({ ...profiles[0], modelCacheScope: 'character-assistant:owner:claude' }, { forceRefresh: true });
    fetchProviderModels.mockClear();
    localStorage.setItem('flai-character-assistant:owner:provider-profile', 'claude');
    const { api } = fixture();
    await api.loadAssistantProviderProfiles();
    await flushPromises();
    expect(fetchProviderModels).not.toHaveBeenCalled();
    expect(api.assistantModelOptions.value).toContainEqual(expect.objectContaining({ id: 'claude-sonnet-4-6' }));

    await api.refreshAssistantModels();
    expect(fetchProviderModels).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'claude' }), { forceRefresh: true });
    expect(api.assistantModelsLoading.value).toBe(false);
  });

  it('retries a failed gateway list before refreshing a restored profile catalog', async () => {
    localStorage.setItem('flai-character-assistant:owner:provider-profile', 'claude');
    localStorage.setItem('flai-character-assistant:owner:model', 'restored-session-model');
    listProviderProfiles.mockRejectedValueOnce(new Error('Gateway list unavailable'));
    const { api } = fixture();
    await api.loadAssistantProviderProfiles();
    expect(api.assistantModelsError.value).toBe('Gateway list unavailable');
    expect(fetchProviderModels).not.toHaveBeenCalled();

    await api.refreshAssistantModels();
    await flushPromises();

    expect(listProviderProfiles).toHaveBeenCalledTimes(2);
    expect(api.assistantProviderProfileId.value).toBe('claude');
    expect(api.assistantModel.value).toBe('restored-session-model');
    expect(api.assistantModelsError.value).toBe('');
    expect(api.assistantModelsLoading.value).toBe(false);
    expect(api.assistantModelOptions.value).toContainEqual(expect.objectContaining({ id: 'claude-sonnet-4-6' }));
    expect(fetchProviderModels).toHaveBeenLastCalledWith(expect.objectContaining({ providerId: 'claude' }), { forceRefresh: true });
  });

  it('does not surface an old gateway failure after switching to another gateway', async () => {
    let rejectOld;
    fetchProviderModels.mockImplementation(async payload => {
      if (payload.providerId === 'claude') return new Promise((_resolve, reject) => { rejectOld = reject; });
      return { models: [{ id: 'other-model' }] };
    });
    const { api } = fixture();
    await api.loadAssistantProviderProfiles();
    api.selectAssistantProviderProfile('claude');
    await nextTick();
    expect(api.assistantModelsLoading.value).toBe(true);
    api.selectAssistantProviderProfile('other');
    await flushPromises();
    rejectOld(new Error('Old gateway failed'));
    await flushPromises();

    expect(api.assistantModelsError.value).toBe('');
    expect(api.assistantModelsLoading.value).toBe(false);
    expect(api.assistantModelOptions.value.some(option => option.id === 'other-model')).toBe(true);
    expect(api.assistantModelOptions.value.some(option => option.id === 'claude-sonnet-4-6')).toBe(false);
  });

  it('keeps gateway and model preferences separate between users', async () => {
    const { api, user } = fixture();
    await api.loadAssistantProviderProfiles();
    api.selectAssistantProviderProfile('claude');
    await nextTick();
    user.value = { id: 'second-user' };
    await flushPromises();
    expect(api.assistantProviderProfileId.value).toBe('');
    expect(api.assistantModel.value).toBe('');
    api.selectAssistantProviderProfile('other');
    await nextTick();
    user.value = { id: 'owner' };
    await flushPromises();
    expect(api.assistantProviderProfileId.value).toBe('claude');
    expect(api.assistantModel.value).toBe('claude-sonnet-4-6');
  });

  it('isolates cached catalogs for users sharing the same gateway configuration', async () => {
    const { api, user } = fixture();
    await api.loadAssistantProviderProfiles();
    api.selectAssistantProviderProfile('claude');
    await flushPromises();
    fetchProviderModels.mockClear();
    user.value = { id: 'second-user' };
    await flushPromises();
    api.selectAssistantProviderProfile('claude');
    await flushPromises();
    expect(fetchProviderModels).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'claude' }), { forceRefresh: false });
  });

  it('preserves the shared workbench model storage by default', async () => {
    localStorage.setItem('flai-assistant-model', 'worldbook-model');
    let shared;
    wrappers.push(mount(defineComponent({
      setup() {
        shared = useAssistantRuntimePreferences(ref(globalProvider), { storagePrefix: 'flai-worldbook-assistant' });
        return () => null;
      }
    })));
    expect(shared.assistantModel.value).toBe('worldbook-model');
    shared.assistantModel.value = 'next-worldbook-model';
    await nextTick();
    expect(localStorage.getItem('flai-assistant-model')).toBe('next-worldbook-model');
  });
});
