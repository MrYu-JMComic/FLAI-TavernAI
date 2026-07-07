import { providerAllowsNoAuth } from './providerHttp.js';

export function hasUsableProvider(settings) {
  return Boolean(
    settings?.baseUrl &&
      settings?.model &&
      !settings?.apiKeyError &&
      (settings?.apiKey || providerAllowsNoAuth(settings))
  );
}
