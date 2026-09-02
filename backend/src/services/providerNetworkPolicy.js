import { appConfig } from '../config.js';
import {
  isPrivateOrSpecialHost,
  parseProviderUrl,
  ProviderUrlError
} from './providerUrlPolicy.js';

/**
 * Resolve the deployment switch once so every provider entry point applies
 * the same production/development semantics.
 */
export function isPrivateProviderNetworkEnabled(config = appConfig) {
  const source = config && typeof config === 'object' ? config : appConfig;
  const production = source.isProduction === true || source.nodeEnv === 'production';
  return production
    ? isEnabledFlag(source.allowPrivateProviderNetwork)
    : isEnabledFlag(source.allowPrivateProviderNetworkInDevelopment);
}

export function providerPrivateNetworkSettingName(config = appConfig) {
  const source = config && typeof config === 'object' ? config : appConfig;
  const production = source.isProduction === true || source.nodeEnv === 'production';
  return production ? 'ALLOW_PRIVATE_PROVIDER_NETWORK' : 'ALLOW_PRIVATE_PROVIDER_NETWORK_DEV';
}

export function providerPrivateNetworkErrorMessage(config = appConfig) {
  const settingName = providerPrivateNetworkSettingName(config);
  return `部署配置未启用本地或私网 Provider，请设置 ${settingName}=true 后重启后端。`;
}

export function isTestMockProviderUrl(value, config = appConfig) {
  const source = config && typeof config === 'object' ? config : appConfig;
  if (source.nodeEnv !== 'test' || !isEnabledFlag(source.mockProviderEnabled)) {
    return false;
  }
  try {
    const parsed = parseProviderUrl(value);
    const loopback = parsed.hostname === '127.0.0.1'
      || parsed.hostname === 'localhost'
      || parsed.hostname === '::1';
    // E2E fixtures may expose an OpenAI-compatible server at /v1; the
    // test-only switch is the boundary, not a particular fixture path.
    return loopback && isPrivateOrSpecialHost(parsed.hostname);
  } catch {
    return false;
  }
}

function isEnabledFlag(value) {
  if (value === true || value === 1) return true;
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

/**
 * Apply the runtime network policy to settings obtained from a request or
 * from persisted storage. Persisted allow flags are intentionally not trusted:
 * root status and the deployment switch are evaluated for every request.
 */
export function evaluateProviderNetworkPolicy(value, config = appConfig, user = {}) {
  const source = config && typeof config === 'object' ? config : appConfig;
  const parsed = parseProviderUrl(value);
  const privateNetwork = isPrivateOrSpecialHost(parsed.hostname);
  const mockProviderUrl = isTestMockProviderUrl(parsed.toString(), source);
  const privateEnabled = isPrivateProviderNetworkEnabled(source);
  const root = user?.isRootAdmin === true || user?.isRootAdmin === 1;

  if (privateNetwork && !mockProviderUrl && !root) {
    throw new ProviderUrlError(
      '只有 root 管理员可以使用本地或私网 Provider。',
      'PROVIDER_PRIVATE_NETWORK_BLOCKED'
    );
  }
  if (privateNetwork && !mockProviderUrl && !privateEnabled) {
    throw new ProviderUrlError(
      providerPrivateNetworkErrorMessage(source),
      'PROVIDER_PRIVATE_NETWORK_BLOCKED'
    );
  }

  return {
    parsed,
    privateNetwork,
    mockProviderUrl,
    privateEnabled,
    allowPrivateNetwork: mockProviderUrl || (root && privateEnabled)
  };
}

export function applyProviderNetworkPolicy(settings = {}, config = appConfig, user = {}) {
  const source = config && typeof config === 'object' ? config : appConfig;
  const policy = evaluateProviderNetworkPolicy(settings.baseUrl, source, user);
  const production = source.isProduction === true || source.nodeEnv === 'production';
  return {
    ...settings,
    baseUrl: policy.parsed.toString(),
    // A hostname that resolves to a private address must use the same
    // root/deployment authorization as a literal private URL.
    allowPrivateNetwork: policy.allowPrivateNetwork,
    privateNetworkErrorMessage: providerPrivateNetworkErrorMessage(source),
    resolveDns: source.providerResolveDns,
    isProduction: production,
    enforcePrivateNetworkPolicy: true
  };
}

export function providerNetworkStatus(config = appConfig) {
  const source = config && typeof config === 'object' ? config : appConfig;
  return {
    enabled: isPrivateProviderNetworkEnabled(source),
    settingName: providerPrivateNetworkSettingName(source),
    environment: source.isProduction === true || source.nodeEnv === 'production'
      ? 'production'
      : 'development',
    requiresRoot: true,
    mockProvider: source.nodeEnv === 'test' && source.mockProviderEnabled === true
  };
}
