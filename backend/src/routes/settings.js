import { Router } from 'express';
import {
  defaultProviderSettings,
  fetchDeepSeekBalance,
  listProviderModels,
  normalizeProviderExtraBody,
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

export function createSettingsRouter(ctx) {
  const { db, requireAuth, asyncRoute, nowIso } = ctx;
  const router = Router();

  router.get('/provider', requireAuth, (request, response) => {
    response.json(getPublicProviderSettings(request.auth.user.id));
  });

  router.put('/provider', requireAuth, validate(saveProviderSchema), (request, response) => {
    const settings = saveProviderSettings(request.auth.user.id, request.body || {});
    response.json(settings);
  });

  router.get('/settings/provider', requireAuth, (request, response) => {
    response.json(getPublicProviderSettings(request.auth.user.id));
  });

  router.put('/settings/provider', requireAuth, validate(saveProviderSchema), (request, response) => {
    const settings = saveProviderSettings(request.auth.user.id, request.body || {});
    response.json(settings);
  });

  // ── Providers ──

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
    const settings = buildProviderProbeSettings(request.auth.user.id, request.body || {});
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

  function getProviderRow(userId) {
    return db.prepare('SELECT * FROM provider_settings WHERE user_id = ?').get(userId);
  }

  function getPublicProviderSettings(userId) {
    const row = getProviderRow(userId);
    if (row) {
      return normalizeProviderRow(row);
    }
    return saveDefaultProvider(userId);
  }

  function saveDefaultProvider(userId) {
    const preset = defaultProviderSettings();
    const timestamp = nowIso();
    db.prepare(
      `INSERT OR IGNORE INTO provider_settings (
        user_id, provider_type, gateway_name, base_url, model, encrypted_api_key,
        api_key_hint, supports_reasoning, extra_body, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      userId,
      preset.providerType,
      preset.gatewayName,
      preset.baseUrl,
      preset.model,
      null,
      null,
      preset.supportsReasoning ? 1 : 0,
      JSON.stringify(preset.extraBody),
      timestamp
    );
    return getPublicProviderSettings(userId);
  }

  function saveProviderSettings(userId, payload) {
    const preset = providerPresets[payload.providerType] || providerPresets.custom;
    const existing = getProviderRow(userId);
    const existingPublic = existing ? normalizeProviderRow(existing) : null;
    const apiKey = String(payload.apiKey || '').trim();
    const encryptedApiKey = apiKey
      ? encryptSecret(apiKey)
      : payload.clearApiKey || existingPublic?.apiKeyNeedsReset
        ? null
        : existing?.encrypted_api_key || null;

    const settings = {
      providerType: preset.providerType,
      gatewayName: String(payload.gatewayName || preset.gatewayName).trim() || preset.gatewayName,
      baseUrl: String(payload.baseUrl ?? preset.baseUrl).trim(),
      model: String(payload.model ?? preset.model).trim(),
      supportsReasoning: normalizeBoolean(payload.supportsReasoning),
      extraBody: parseExtraBody(payload.extraBody ?? preset.extraBody),
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

    db.prepare(
      `INSERT INTO provider_settings (
        user_id, provider_type, gateway_name, base_url, model, encrypted_api_key,
        api_key_hint, supports_reasoning, extra_body, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        provider_type = excluded.provider_type,
        gateway_name = excluded.gateway_name,
        base_url = excluded.base_url,
        model = excluded.model,
        encrypted_api_key = excluded.encrypted_api_key,
        api_key_hint = excluded.api_key_hint,
        supports_reasoning = excluded.supports_reasoning,
        extra_body = excluded.extra_body,
        updated_at = excluded.updated_at`
    ).run(
      userId,
      settings.providerType,
      settings.gatewayName,
      settings.baseUrl,
      settings.model,
      settings.encryptedApiKey,
      settings.apiKeyHint,
      settings.supportsReasoning ? 1 : 0,
      JSON.stringify(settings.extraBody),
      nowIso()
    );

    return getPublicProviderSettings(userId);
  }

  function buildProviderProbeSettings(userId, payload) {
    const existing = getProviderRow(userId);
    const saved = existing ? providerWithSecret(existing) : {};
    const providerType = payload.providerType || saved.providerType || 'custom';
    const preset = providerPresets[providerType] || providerPresets.custom;
    const apiKey = String(payload.apiKey || '').trim() || saved.apiKey || '';

    return {
      providerType: preset.providerType,
      gatewayName: String(payload.gatewayName || saved.gatewayName || preset.gatewayName).trim() || preset.gatewayName,
      baseUrl: String(payload.baseUrl ?? saved.baseUrl ?? preset.baseUrl).trim(),
      model: String(payload.model ?? saved.model ?? preset.model).trim(),
      supportsReasoning: normalizeBoolean(payload.supportsReasoning, saved.supportsReasoning ?? preset.supportsReasoning),
      extraBody: parseExtraBody(payload.extraBody ?? saved.extraBody ?? preset.extraBody),
      apiKey,
      apiKeyError: apiKey ? null : saved.apiKeyError || null
    };
  }

  function parseExtraBody(value) {
    if (typeof value === 'string') {
      return normalizeProviderExtraBody(parseJson(value, {}));
    }
    return normalizeProviderExtraBody(value);
  }

  return router;
}
