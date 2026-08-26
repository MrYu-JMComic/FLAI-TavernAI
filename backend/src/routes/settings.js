import { Router } from 'express';
import {
  defaultProviderSettings,
  fetchDeepSeekBalance,
  listProviderModels,
  normalizeProviderBaseUrl,
  normalizeProviderExtraBody,
  normalizeProviderRequestExtraBody,
  normalizeProviderRow,
  providerPresets,
  providerWithSecret
} from '../services/providers.js';
import { encryptSecret, apiKeyHint } from '../security.js';
import { CURRENCY_TYPES } from '../modules/economy.js';
import { saveAvatarInput } from '../services/avatars.js';
import { normalizeBoolean } from '../utils/boolean.js';
import { parseJson } from '../utils/json.js';
import { saveProviderSchema, updateProfileSchema, validate } from '../validations/schemas.js';
import { appConfig } from '../config.js';
import { isPrivateOrSpecialHost, parseProviderUrl, ProviderUrlError } from '../services/providerUrlPolicy.js';
import {
  createProviderProfile,
  deleteProviderProfile,
  ensureSelectedProviderProfile,
  getProviderProfileRow,
  listProviderProfileRows,
  requireProviderProfileRow,
  selectProviderProfile,
  updateProviderProfile
} from '../repositories/providerProfileRepository.js';

export function createSettingsRouter(ctx) {
  const { db, requireAuth, asyncRoute, nowIso } = ctx;
  const router = Router();

  router.get('/provider', requireAuth, (request, response) => {
    response.json(getPublicProviderSettings(request.auth.user.id));
  });

  router.put('/provider', requireAuth, validate(saveProviderSchema), (request, response) => {
    const settings = saveProviderSettings(request.auth.user.id, request.body || {}, request.auth.user);
    response.json(settings);
  });

  router.get('/settings/provider', requireAuth, (request, response) => {
    response.json(getPublicProviderSettings(request.auth.user.id));
  });

  router.put('/settings/provider', requireAuth, validate(saveProviderSchema), (request, response) => {
    const settings = saveProviderSettings(request.auth.user.id, request.body || {}, request.auth.user);
    response.json(settings);
  });

  // ── Providers ──

  router.get('/providers', requireAuth, (request, response) => {
    response.json(getProviderBundle(request.auth.user.id));
  });

  router.post('/providers', requireAuth, validate(saveProviderSchema), (request, response) => {
    const provider = createProviderSettings(request.auth.user.id, request.body || {}, request.auth.user);
    response.status(201).json({ ...getProviderBundle(request.auth.user.id), provider });
  });

  router.put('/providers/:providerId', requireAuth, validate(saveProviderSchema), (request, response) => {
    const settings = saveProviderSettings(
      request.auth.user.id,
      request.body || {},
      request.auth.user,
      request.params.providerId
    );
    response.json(settings);
  });

  router.post('/providers/:providerId/select', requireAuth, (request, response) => {
    selectProviderProfile(db, request.auth.user.id, request.params.providerId, { timestamp: nowIso() });
    response.json(getProviderBundle(request.auth.user.id));
  });

  router.delete('/providers/:providerId', requireAuth, (request, response) => {
    deleteProviderProfile(db, request.auth.user.id, request.params.providerId, { timestamp: nowIso() });
    response.json(getProviderBundle(request.auth.user.id));
  });

  router.get('/providers/deepseek/balance', requireAuth, asyncRoute(async (request, response) => {
    const row = getProviderRow(request.auth.user.id);
    const settings = providerWithSecret(row);
    if (settings.providerType !== 'deepseek') {
      response.status(400).json({ error: '当前供应商不是 DeepSeek' });
      return;
    }
    response.json(await fetchDeepSeekBalance(settings));
  }));

  router.get('/providers/models', requireAuth, asyncRoute(async (request, response) => {
    const settings = providerWithSecret(getProviderRow(request.auth.user.id));
    response.json({ models: await listProviderModels(settings, { forceRefresh: request.query.force === '1' }) });
  }));

  router.post('/providers/models', requireAuth, asyncRoute(async (request, response) => {
    const settings = buildProviderProbeSettings(request.auth.user.id, request.body || {}, request.auth.user);
    response.json({ models: await listProviderModels(settings, { forceRefresh: normalizeBoolean(request.body?.forceRefresh) }) });
  }));

  // ── Economy currencies ──

  router.get('/economy/currencies', requireAuth, (_request, response) => {
    response.json({ currencies: CURRENCY_TYPES });
  });

  // ── User avatar ──

  router.get('/users/me/profile', requireAuth, (request, response) => {
    response.json(ctx.getUserProfile(request.auth.user.id));
  });

  router.put('/users/me/profile', requireAuth, validate(updateProfileSchema), (request, response) => {
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(
      request.body.displayName || '',
      request.auth.user.id
    );
    response.json(ctx.getUserProfile(request.auth.user.id));
  });

  router.put('/users/me/avatar', requireAuth, (request, response) => {
    const avatarUrl = saveAvatarInput(db, {
      userId: request.auth.user.id,
      ownerType: 'user',
      ownerId: request.auth.user.id,
      value: request.body?.avatarDataUrl || request.body?.avatarUrl || ''
    });
    response.json({
      user: {
        ...request.auth.user,
        avatarUrl
      }
    });
  });

  // ── Internal helpers ──

  function getProviderRow(userId, providerId = '') {
    return getProviderProfileRow(db, userId, providerId);
  }

  function getPublicProviderSettings(userId) {
    return normalizeProviderRow(ensureProviderProfile(userId));
  }

  function ensureProviderProfile(userId) {
    return ensureSelectedProviderProfile(db, userId, {
      defaultSettings: defaultProviderSettings(),
      timestamp: nowIso()
    });
  }

  function getProviderBundle(userId) {
    ensureProviderProfile(userId);
    const providers = listProviderProfileRows(db, userId).map((row) => ({
      ...normalizeProviderRow(row),
      selected: Boolean(row.is_selected)
    }));
    return {
      providers,
      selectedProviderId: providers.find((provider) => provider.selected)?.id || ''
    };
  }

  function createProviderSettings(userId, payload, user = {}) {
    const values = buildProviderSettingsValues(null, payload, user);
    const row = createProviderProfile(db, userId, values, { select: true, timestamp: nowIso() });
    return normalizeProviderRow(row);
  }

  function saveProviderSettings(userId, payload, user = {}, providerId = '') {
    let existing = providerId
      ? requireProviderProfileRow(db, userId, providerId)
      : getProviderRow(userId);
    const values = buildProviderSettingsValues(existing, payload, user);
    if (!existing) {
      const created = createProviderProfile(db, userId, values, { select: true, timestamp: nowIso() });
      return normalizeProviderRow(created);
    }
    if (!existing.id) {
      existing = ensureProviderProfile(userId);
    }
    const row = updateProviderProfile(db, userId, existing?.id || providerId, values, { timestamp: nowIso() });
    return normalizeProviderRow(row);
  }

  function buildProviderSettingsValues(existing, payload, user = {}) {
    const existingPublic = existing ? normalizeProviderRow(existing) : null;
    const providerType = payload.providerType || existingPublic?.providerType || 'deepseek';
    const preset = providerPresets[providerType] || providerPresets.custom;
    const apiKey = String(payload.apiKey || '').trim();
    const encryptedApiKey = apiKey
      ? encryptSecret(apiKey)
      : payload.clearApiKey || existingPublic?.apiKeyNeedsReset
        ? null
        : existing?.encrypted_api_key || null;

    const settings = {
      providerType: preset.providerType,
      gatewayName: String(payload.gatewayName || existingPublic?.gatewayName || preset.gatewayName).trim() || preset.gatewayName,
      baseUrl: normalizeProviderBaseUrl(preset.providerType, payload.baseUrl ?? existingPublic?.baseUrl ?? preset.baseUrl),
      model: String(payload.model ?? existingPublic?.model ?? preset.model).trim(),
      supportsReasoning: normalizeBoolean(payload.supportsReasoning, existingPublic?.supportsReasoning ?? preset.supportsReasoning),
      allowPrivateNetwork: normalizeBoolean(payload.allowPrivateNetwork, existingPublic?.allowPrivateNetwork ?? false)
        && Boolean(user.isRootAdmin)
        && privateProviderNetworkEnabled(),
      extraBody: parseProviderExtraBody(preset.providerType, payload.extraBody ?? existingPublic?.extraBody ?? preset.extraBody),
      encryptedApiKey,
      apiKeyHint: apiKey
        ? apiKeyHint(apiKey)
        : payload.clearApiKey || existingPublic?.apiKeyNeedsReset
          ? null
          : existing?.api_key_hint || null
    };

    if (!settings.baseUrl || !settings.model) {
      throw new Error('请填写网关地址和模型名');
    }
    validateProviderSettingsUrl(settings.baseUrl, user);
    return settings;
  }

  function buildProviderProbeSettings(userId, payload, user = {}) {
    const providerId = String(payload.providerId || '').trim();
    const existing = providerId
      ? requireProviderProfileRow(db, userId, providerId)
      : getProviderRow(userId);
    const saved = existing ? providerWithSecret(existing) : {};
    const providerType = payload.providerType || saved.providerType || 'custom';
    const preset = providerPresets[providerType] || providerPresets.custom;
    const apiKey = String(payload.apiKey || '').trim() || saved.apiKey || '';

    const settings = {
      providerType: preset.providerType,
      gatewayName: String(payload.gatewayName || saved.gatewayName || preset.gatewayName).trim() || preset.gatewayName,
      baseUrl: normalizeProviderBaseUrl(preset.providerType, payload.baseUrl ?? saved.baseUrl ?? preset.baseUrl),
      model: String(payload.model ?? saved.model ?? preset.model).trim(),
      supportsReasoning: normalizeBoolean(payload.supportsReasoning, saved.supportsReasoning ?? preset.supportsReasoning),
      allowPrivateNetwork: normalizeBoolean(payload.allowPrivateNetwork, saved.allowPrivateNetwork ?? false)
        && Boolean(user.isRootAdmin)
        && privateProviderNetworkEnabled(),
      extraBody: parseProviderExtraBody(preset.providerType, payload.extraBody ?? saved.extraBody ?? preset.extraBody),
      apiKey,
      apiKeyError: apiKey ? null : saved.apiKeyError || null
    };
    validateProviderSettingsUrl(settings.baseUrl, user);
    return settings;
  }

  function validateProviderSettingsUrl(value, user = {}) {
    const parsed = parseProviderUrl(value);
    const privateNetwork = isPrivateOrSpecialHost(parsed.hostname);
    if (privateNetwork && !user.isRootAdmin) {
      throw new ProviderUrlError('只有 root 管理员可以使用本地或私网 Provider。', 'PROVIDER_PRIVATE_NETWORK_BLOCKED');
    }
    if (privateNetwork && !privateProviderNetworkEnabled()) {
      throw new ProviderUrlError('部署配置未启用本地或私网 Provider。', 'PROVIDER_PRIVATE_NETWORK_BLOCKED');
    }
  }

  function privateProviderNetworkEnabled() {
    return appConfig.isProduction
      ? appConfig.allowPrivateProviderNetwork
      : appConfig.allowPrivateProviderNetworkInDevelopment;
  }

  function parseProviderExtraBody(providerType, value) {
    return normalizeProviderRequestExtraBody(providerType, parseExtraBody(value));
  }

  function parseExtraBody(value) {
    if (typeof value === 'string') {
      return normalizeProviderExtraBody(parseJson(value, {}));
    }
    return normalizeProviderExtraBody(value);
  }

  return router;
}
