import { hasUsableProvider, listProviderModels } from './providers.js';
import { providerPresets } from './providerRegistry.js';
import { buildProviderCapabilitySummary } from '../../../shared/providerCapabilities.js';

export function listProviderCapabilities() {
  const providers = [];
  for (const providerType of Object.keys(providerPresets)) {
    providers.push(describeProviderCapabilities(providerType));
  }
  return providers;
}

export function describeProviderCapabilities(providerType, settings = {}) {
  const summary = buildProviderCapabilitySummary(providerType, settings);
  const type = summary.providerType;
  const preset = providerPresets[type] || providerPresets.custom;
  return {
    providerType: type,
    gatewayName: settings.gatewayName || preset.gatewayName,
    defaultModel: preset.model,
    capabilities: summary.capabilities,
    modelCapabilities: summary.modelCapabilities
  };
}

export async function probeProviderHealth(settings = {}) {
  const capability = describeProviderCapabilities(settings.providerType, settings);
  const readiness = {
    configured: Boolean(settings.baseUrl && settings.model),
    usable: hasUsableProvider(settings),
    apiKeySet: Boolean(settings.apiKeySet || settings.apiKey),
    apiKeyNeedsReset: Boolean(settings.apiKeyNeedsReset),
    apiKeyError: settings.apiKeyError || null
  };

  if (!readiness.configured || !readiness.usable) {
    return {
      ok: false,
      readiness,
      capability,
      error: readiness.apiKeyError || 'Provider is not fully configured.'
    };
  }

  try {
    const models = await listProviderModels(settings, { forceRefresh: true });
    return {
      ok: true,
      readiness,
      capability,
      modelCount: models.length,
      sampleModels: models.slice(0, 8)
    };
  } catch (error) {
    return {
      ok: false,
      readiness,
      capability,
      error: error?.message || 'Provider health check failed.'
    };
  }
}
