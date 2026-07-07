import { computed, reactive, ref, watch } from 'vue';
import {
  checkProviderHealth,
  fetchDeepSeekBalance,
  fetchProviderCapabilities,
  getProviderSettings,
  saveProviderSettings
} from '../../api/providers.js';
import {
  areProviderModelListsEqual,
  buildModelSelectOptions,
  readCachedProviderModels,
  refreshProviderModels
} from '../../services/modelCatalog';
import { samePlainValue } from '../../utils/plainValues';
import { isLocalOrPrivateBaseUrl } from '../../../../shared/privateNetwork.js';

const presets = {
  openai: {
    gatewayName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    supportsReasoning: false,
    extraBody: '{}'
  },
  deepseek: {
    gatewayName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    supportsReasoning: true,
    extraBody: '{}'
  },
  gemini: {
    gatewayName: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    supportsReasoning: true,
    extraBody: JSON.stringify(
      {
        extra_body: {
          google: {
            thinking_config: {
              include_thoughts: true
            }
          }
        }
      },
      null,
      2
    )
  },
  anthropic: {
    gatewayName: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-6',
    supportsReasoning: true,
    extraBody: '{}'
  },
  xai: {
    gatewayName: 'xAI',
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-4.1',
    supportsReasoning: true,
    extraBody: '{}'
  },
  mistral: {
    gatewayName: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-medium-3-5',
    supportsReasoning: true,
    extraBody: '{}'
  },
  qwen: {
    gatewayName: 'Qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3-plus',
    supportsReasoning: true,
    extraBody: '{}'
  },
  glm: {
    gatewayName: 'Z.AI GLM',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    model: 'glm-5.1',
    supportsReasoning: true,
    extraBody: '{}'
  },
  kimi: {
    gatewayName: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2.5',
    supportsReasoning: true,
    extraBody: '{}'
  },
  custom: {
    gatewayName: '自定义网关',
    baseUrl: '',
    model: '',
    supportsReasoning: false,
    extraBody: '{}'
  }
};

export function useSettingsProvider({ isPersonalPage, notify, emitProviderSaved } = {}) {
  const form = reactive({
    providerType: 'deepseek',
    gatewayName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    apiKey: '',
    apiKeySet: false,
    apiKeyHint: '',
    apiKeyNeedsReset: false,
    apiKeyError: '',
    clearApiKey: false,
    supportsReasoning: true,
    extraBody: '{}'
  });
  const saving = ref(false);
  const modelLoading = ref(false);
  const modelProbeLoading = ref(false);
  const modelProbeStatus = ref('idle');
  const modelProbeMessage = ref('');
  const balanceLoading = ref(false);
  const modelOptions = ref([]);
  const providerCapabilities = ref([]);
  const providerCapabilityLoadError = ref('');
  const balance = ref(null);
  const settingsModelOptions = computed(() => buildModelSelectOptions(modelOptions.value, form.model));
  const providerControlsBusy = computed(() => saving.value || modelLoading.value || modelProbeLoading.value);
  const currentProviderCapability = computed(() => findCurrentProviderCapability());
  const canCheckBalance = computed(() => form.providerType === 'deepseek' && form.apiKeySet && !form.apiKeyNeedsReset);
  const canFetchModels = computed(() => Boolean(
    form.baseUrl && (form.apiKey || form.apiKeySet || canUseNoAuthProvider())
  ));
  let modelLoadToken = 0;
  let providerSaveToken = 0;
  let balanceLoadToken = 0;

  watch(
    () => [
      form.providerType,
      form.gatewayName,
      form.baseUrl,
      Boolean(form.apiKey || form.apiKeySet),
      form.supportsReasoning,
      form.extraBody
    ],
    ([providerType], [previousProviderType] = []) => {
      syncCachedModelOptions();
      resetProviderProbeStatus();
      if (previousProviderType !== undefined && providerType !== previousProviderType) {
        resetBalanceLoadScope();
        balance.value = null;
      }
    }
  );

  async function loadProviderSettingsBundle() {
    const [settings, capabilityResult] = await Promise.all([
      getProviderSettings(),
      loadProviderCapabilities()
    ]);
    return { settings, capabilityResult };
  }

  function applyProviderSettingsBundle(bundle = {}) {
    applySettings(bundle.settings || {});
    applyProviderCapabilitiesResult(bundle.capabilityResult);
  }

  function applyPreset() {
    const preset = presets[form.providerType] || presets.custom;
    Object.assign(form, {
      gatewayName: preset.gatewayName,
      baseUrl: preset.baseUrl,
      model: preset.model,
      supportsReasoning: preset.supportsReasoning,
      extraBody: preset.extraBody
    });
    syncCachedModelOptions();
  }

  async function loadModels() {
    if (!isProviderPageReady() || providerControlsBusy.value || !canFetchModels.value) {
      return;
    }
    const requestToken = ++modelLoadToken;
    const request = buildProviderModelRequest();
    modelLoading.value = true;
    try {
      const nextOptions = await refreshProviderModels(request, { forceRefresh: true });
      if (!isCurrentModelLoadResult(requestToken, request)) return;
      applyModelOptions(nextOptions);
      if (!nextOptions.length) {
        notify?.info?.('网关没有返回可选模型，请确认 /models 接口可用。');
      } else if (!hasProviderModelOption(nextOptions, form.model)) {
        form.model = nextOptions[0].id;
        notify?.success?.(`已刷新 ${nextOptions.length} 个模型，并自动选择第一个。`);
      } else {
        notify?.success?.(`已刷新 ${nextOptions.length} 个模型。`);
      }
    } catch (err) {
      if (!isCurrentModelLoadResult(requestToken, request)) return;
      notify?.error?.(err.message);
    } finally {
      if (isCurrentModelLoadToken(requestToken)) {
        modelLoading.value = false;
      }
    }
  }

  async function probeProviderConnection() {
    if (!isProviderPageReady() || providerControlsBusy.value || !canFetchModels.value) {
      return;
    }
    const requestToken = ++modelLoadToken;
    const request = buildProviderModelRequest();
    modelProbeLoading.value = true;
    setProviderProbeResult('checking', '正在检测网关健康状态...');
    try {
      const health = await checkProviderHealth(request);
      if (!isCurrentModelLoadResult(requestToken, request)) return;
      applyProviderHealthResult(health);
      const sampleOptions = Array.isArray(health?.sampleModels) ? health.sampleModels : [];
      if (sampleOptions.length) {
        applyModelOptions(sampleOptions);
      }
      reportProviderHealth(health, sampleOptions);
    } catch (err) {
      if (!isCurrentModelLoadResult(requestToken, request)) return;
      const message = err?.message || '连接检测失败';
      setProviderProbeResult('error', message);
      notify?.error?.(`连接检测失败：${message}`);
    } finally {
      if (isCurrentModelLoadToken(requestToken)) {
        modelProbeLoading.value = false;
      }
    }
  }

  async function submit() {
    if (!isProviderPageReady() || providerControlsBusy.value) {
      return;
    }
    const mutationToken = ++providerSaveToken;
    const payload = buildProviderSettingsPayload();
    saving.value = true;
    try {
      const saved = await saveProviderSettings(payload);
      if (!isCurrentProviderSaveResult(mutationToken, payload)) return;
      applySettings(saved);
      notify?.success?.('设置已保存');
      emitProviderSaved?.();
    } catch (err) {
      if (!isCurrentProviderSaveResult(mutationToken, payload)) return;
      notify?.error?.(err.message);
    } finally {
      if (isCurrentProviderSaveToken(mutationToken)) {
        saving.value = false;
      }
    }
  }

  function updateProviderFormField(key, value) {
    if (!Object.prototype.hasOwnProperty.call(form, key)) {
      return;
    }
    form[key] = value;
  }

  async function checkBalance() {
    if (!isProviderPageReady() || providerControlsBusy.value || balanceLoading.value || !canCheckBalance.value) {
      return;
    }
    const requestToken = ++balanceLoadToken;
    balanceLoading.value = true;
    try {
      const nextBalance = await fetchDeepSeekBalance();
      if (!isCurrentBalanceLoadResult(requestToken)) return;
      setBalanceIfChanged(nextBalance);
    } catch (err) {
      if (!isCurrentBalanceLoadResult(requestToken)) return;
      notify?.error?.(err.message);
    } finally {
      if (isCurrentBalanceLoadToken(requestToken)) {
        balanceLoading.value = false;
      }
    }
  }

  function resetProviderAsyncScope() {
    modelLoadToken += 1;
    providerSaveToken += 1;
    resetBalanceLoadScope();
    saving.value = false;
    modelLoading.value = false;
    modelProbeLoading.value = false;
    resetProviderProbeStatus();
  }

  function buildProviderModelRequest() {
    return {
      providerType: form.providerType,
      gatewayName: form.gatewayName,
      baseUrl: form.baseUrl,
      model: form.model,
      apiKey: form.apiKey,
      apiKeySet: form.apiKeySet,
      supportsReasoning: form.supportsReasoning,
      extraBody: form.extraBody
    };
  }

  function hasSameProviderModelRequest(request) {
    return form.providerType === request.providerType
      && form.gatewayName === request.gatewayName
      && form.baseUrl === request.baseUrl
      && form.model === request.model
      && form.apiKey === request.apiKey
      && form.apiKeySet === request.apiKeySet
      && form.supportsReasoning === request.supportsReasoning
      && form.extraBody === request.extraBody;
  }

  function isCurrentModelLoadToken(requestToken) {
    return requestToken === modelLoadToken && isProviderPageReady();
  }

  function isCurrentModelLoadResult(requestToken, request) {
    return isCurrentModelLoadToken(requestToken) && hasSameProviderModelRequest(request);
  }

  function buildProviderSettingsPayload() {
    return {
      providerType: form.providerType,
      gatewayName: form.gatewayName,
      baseUrl: form.baseUrl,
      model: form.model,
      apiKey: form.apiKey,
      clearApiKey: form.clearApiKey,
      supportsReasoning: form.supportsReasoning,
      extraBody: form.extraBody
    };
  }

  function hasSameProviderSettingsPayload(payload) {
    return form.providerType === payload.providerType
      && form.gatewayName === payload.gatewayName
      && form.baseUrl === payload.baseUrl
      && form.model === payload.model
      && form.apiKey === payload.apiKey
      && form.clearApiKey === payload.clearApiKey
      && form.supportsReasoning === payload.supportsReasoning
      && form.extraBody === payload.extraBody;
  }

  function isCurrentProviderSaveToken(mutationToken) {
    return mutationToken === providerSaveToken && isProviderPageReady();
  }

  function isCurrentProviderSaveResult(mutationToken, payload) {
    return isCurrentProviderSaveToken(mutationToken) && hasSameProviderSettingsPayload(payload);
  }

  function isCurrentBalanceLoadToken(requestToken) {
    return requestToken === balanceLoadToken && isProviderPageReady();
  }

  function isCurrentBalanceLoadResult(requestToken) {
    return isCurrentBalanceLoadToken(requestToken) && canCheckBalance.value;
  }

  function resetBalanceLoadScope() {
    balanceLoadToken += 1;
    balanceLoading.value = false;
  }

  function applySettings(settings) {
    Object.assign(form, {
      providerType: settings.providerType,
      gatewayName: settings.gatewayName,
      baseUrl: settings.baseUrl,
      model: settings.model,
      apiKey: '',
      apiKeySet: settings.apiKeySet,
      apiKeyHint: settings.apiKeyHint || '',
      apiKeyNeedsReset: Boolean(settings.apiKeyNeedsReset),
      apiKeyError: settings.apiKeyError || '',
      clearApiKey: false,
      supportsReasoning: settings.supportsReasoning,
      extraBody: JSON.stringify(settings.extraBody || {}, null, 2)
    });
    syncCachedModelOptions();
  }

  async function loadProviderCapabilities() {
    try {
      return { data: await fetchProviderCapabilities() };
    } catch (error) {
      return { error };
    }
  }

  function applyProviderCapabilitiesResult(result = {}) {
    if (result.error) {
      providerCapabilityLoadError.value = result.error?.message || '能力注册表加载失败';
      return;
    }
    providerCapabilityLoadError.value = '';
    applyProviderCapabilities(result.data);
  }

  function applyProviderCapabilities(result = {}) {
    const providers = Array.isArray(result?.providers)
      ? result.providers
      : Array.isArray(result)
        ? result
        : [];
    setProviderListIfChanged(providerCapabilities, providers);
  }

  function applyProviderHealthResult(health = {}) {
    if (health?.capability) {
      upsertProviderCapability(health.capability);
      providerCapabilityLoadError.value = '';
    }
  }

  function upsertProviderCapability(capability) {
    const providerType = String(capability?.providerType || '').trim();
    if (!providerType) {
      return false;
    }
    const nextCapabilities = [];
    let replaced = false;
    for (const current of providerCapabilities.value) {
      if (current?.providerType === providerType) {
        nextCapabilities.push(capability);
        replaced = true;
      } else {
        nextCapabilities.push(current);
      }
    }
    if (!replaced) {
      nextCapabilities.push(capability);
    }
    return setProviderListIfChanged(providerCapabilities, nextCapabilities);
  }

  function findCurrentProviderCapability() {
    const providerType = String(form.providerType || '').trim();
    for (const capability of providerCapabilities.value) {
      if (capability?.providerType === providerType) {
        return capability;
      }
    }
    return {
      providerType: providerType || 'custom',
      gatewayName: form.gatewayName || '自定义网关',
      defaultModel: form.model || '',
      capabilities: {
        streaming: true,
        reasoning: Boolean(form.supportsReasoning),
        tools: true,
        vision: providerType === 'custom',
        imageGeneration: providerType === 'custom',
        usage: providerType !== 'custom'
      }
    };
  }

  function syncCachedModelOptions() {
    applyModelOptions(readCachedProviderModels(form));
  }

  function setProviderProbeResult(status, message) {
    modelProbeStatus.value = status || 'idle';
    modelProbeMessage.value = String(message || '');
  }

  function resetProviderProbeStatus() {
    if (modelProbeStatus.value !== 'idle') {
      modelProbeStatus.value = 'idle';
    }
    if (modelProbeMessage.value) {
      modelProbeMessage.value = '';
    }
  }

  function applyModelOptions(nextOptions) {
    if (areProviderModelListsEqual(modelOptions.value, nextOptions)) {
      return false;
    }
    modelOptions.value = nextOptions;
    return true;
  }

  function hasProviderModelOption(options, modelId) {
    const id = String(modelId || '').trim();
    if (!id) {
      return false;
    }
    for (const model of Array.isArray(options) ? options : []) {
      if (model?.id === id) {
        return true;
      }
    }
    return false;
  }

  function reportProviderHealth(health, sampleOptions) {
    if (!health?.ok) {
      const message = health?.error || '连接检测失败';
      setProviderProbeResult('error', message);
      notify?.error?.(`连接检测失败：${message}`);
    } else if (!Number(health.modelCount)) {
      const message = '连接成功，但网关没有返回模型列表；请确认 /models 接口是否开放。';
      setProviderProbeResult('warning', message);
      notify?.info?.(message);
    } else if (
      sampleOptions.length === Number(health.modelCount)
      && !hasProviderModelOption(sampleOptions, form.model)
    ) {
      const message = `连接成功，返回 ${health.modelCount} 个模型，但当前模型不在列表中。`;
      setProviderProbeResult('warning', message);
      notify?.warning?.(message);
    } else {
      const message = `连接正常，已读取 ${health.modelCount} 个模型。`;
      setProviderProbeResult('success', message);
      notify?.success?.(message);
    }
  }

  function setProviderPlainValueIfChanged(valueRef, nextValue) {
    if (samePlainValue(valueRef.value, nextValue)) {
      return false;
    }
    valueRef.value = nextValue;
    return true;
  }

  function setBalanceIfChanged(nextBalance) {
    return setProviderPlainValueIfChanged(balance, nextBalance);
  }

  function sameProviderListItems(currentList, nextList) {
    if (!Array.isArray(currentList) || !Array.isArray(nextList) || currentList.length !== nextList.length) {
      return false;
    }
    for (let index = 0; index < currentList.length; index += 1) {
      if (!samePlainValue(currentList[index], nextList[index])) {
        return false;
      }
    }
    return true;
  }

  function setProviderListIfChanged(listRef, nextList) {
    const normalizedNextList = Array.isArray(nextList) ? nextList : [];
    if (sameProviderListItems(listRef.value, normalizedNextList)) {
      return false;
    }
    listRef.value = normalizedNextList;
    return true;
  }

  function canUseNoAuthProvider() {
    return form.providerType === 'custom' && isLocalOrPrivateBaseUrl(form.baseUrl);
  }

  function isProviderPageReady() {
    return isPersonalPage?.value !== false;
  }

  return {
    balance,
    balanceLoading,
    canCheckBalance,
    canFetchModels,
    checkBalance,
    currentProviderCapability,
    form,
    loadModels,
    loadProviderSettingsBundle,
    modelLoading,
    modelProbeLoading,
    modelProbeMessage,
    modelProbeStatus,
    probeProviderConnection,
    providerCapabilityLoadError,
    providerControlsBusy,
    resetProviderAsyncScope,
    applyPreset,
    applyProviderSettingsBundle,
    saving,
    settingsModelOptions,
    submit,
    updateProviderFormField
  };
}
