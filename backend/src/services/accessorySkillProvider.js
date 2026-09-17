import { appConfig } from '../config.js';
import { getProviderProfileRow } from '../repositories/providerProfileRepository.js';
import { hasUsableProvider, providerWithSecret } from './providers.js';
import { applyProviderNetworkPolicy } from './providerNetworkPolicy.js';

/**
 * Resolve the provider settings an accessory skill should call.
 *
 * A skill either follows the main chat provider (optionally overriding only the
 * model) or names one of the user's saved provider profiles. A missing, unusable
 * or policy-rejected profile falls back to the main settings instead of failing
 * the whole postprocessing step; the reason is reported for the UI.
 */
export function resolveAccessorySkillSettings(database, userId, settings = {}, skill = {}, options = {}) {
  const base = settings && typeof settings === 'object' ? settings : {};
  const profileId = String(skill?.providerProfileId || '').trim();
  const modelOverride = String(skill?.modelOverride || '').trim();
  const withModel = (value) => (modelOverride ? { ...value, model: modelOverride } : value);
  const followMain = (warning = '') => ({
    settings: withModel(base),
    source: 'main',
    profileId,
    ...(warning ? { warning } : {})
  });
  if (!profileId || !database || !userId) {
    return followMain();
  }
  const row = getProviderProfileRow(database, userId, profileId);
  if (!row) {
    return followMain('profile_missing');
  }
  if (base.id && row.id === base.id) {
    return { settings: withModel(base), source: 'main', profileId };
  }
  let resolved = providerWithSecret(row);
  if (!hasUsableProvider(resolved) || resolved.providerType === 'mock') {
    return followMain('profile_unusable');
  }
  try {
    const user = database.prepare('SELECT id, is_root_admin AS isRootAdmin FROM users WHERE id = ?').get(userId) || { id: userId };
    resolved = applyProviderNetworkPolicy(resolved, options.config || appConfig, user);
  } catch (error) {
    return followMain(String(error?.code || 'network_policy'));
  }
  return { settings: withModel(resolved), source: 'profile', profileId };
}

export function describeAccessorySkillSource(skill = {}) {
  const profileId = String(skill?.providerProfileId || '').trim();
  const modelOverride = String(skill?.modelOverride || '').trim();
  if (!profileId && !modelOverride) return 'main';
  return profileId ? 'profile' : 'main-model-override';
}
