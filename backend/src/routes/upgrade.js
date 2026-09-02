import { Router } from 'express';
import { appConfig, withAppConfigDefaults } from '../config.js';
import { createAsset, deleteAsset, getAssetForViewer, listAssets } from '../modules/assets.js';
import {
  confirmConversationMemory,
  createConversationMemory,
  deleteConversationMemory,
  disableConversationMemory,
  listConversationMemories,
  rollbackConversationMemory,
  updateConversationMemory
} from '../modules/conversationMemories.js';
import { getConversationBranchTree } from '../modules/branches.js';
import { getWorldBook } from '../modules/worldBooks.js';
import { buildConversationContextPreview } from '../services/contextPreview.js';
import { buildDiagnosticsExport } from '../services/diagnosticsExport.js';
import { buildExportEnvelope, importExportEnvelope } from '../services/exportEnvelopes.js';
import { buildProjectSnapshot } from '../services/projectSnapshot.js';
import { describeProviderCapabilities, listProviderCapabilities, probeProviderHealth } from '../services/providerCapabilities.js';
import { providerWithSecret } from '../services/providers.js';
import { buildWorldBookMatchPreview } from '../services/worldBookMatchPreview.js';
import { createAssetSchema, validate } from '../validations/schemas.js';
import { applyProviderNetworkPolicy } from '../services/providerNetworkPolicy.js';
import { sendRouteError } from './errorResponse.js';

export function createUpgradeRouter(ctx) {
  const { db, requireAuth, asyncRoute } = ctx;
  const config = withAppConfigDefaults(ctx.config || appConfig);
  const router = Router();

  router.get('/app/bootstrap', requireAuth, (request, response) => {
    const providerRow = ctx.getProviderRow(request.auth.user.id);
    const provider = providerRow ? ctx.providerWithSecret(providerRow) : null;
    response.json({
      app: {
        serviceName: config.serviceName,
        version: config.version
      },
      user: request.auth.user,
      profile: ctx.getUserProfile(request.auth.user.id),
      provider: provider ? stripProviderSecret(provider) : null,
      providerCapability: provider ? describeProviderCapabilities(provider.providerType, provider) : null,
      features: {
        promptPipelinePreview: true,
        conversationMemories: true,
        genericAssets: true,
        diagnosticsExport: true,
        providerCapabilities: true
      }
    });
  });

  router.get('/providers/capabilities', requireAuth, (_request, response) => {
    response.json({ providers: listProviderCapabilities() });
  });

  router.post('/providers/health', requireAuth, asyncRoute(async (request, response) => {
    const settings = buildProviderHealthSettings(ctx, request.auth.user.id, request.body || {}, request.auth.user);
    response.json(await probeProviderHealth(settings));
  }));

  router.get('/assets', requireAuth, (request, response) => {
    response.json({ assets: listAssets(db, request.auth.user.id, { kind: request.query.kind }) });
  });

  router.post('/assets', requireAuth, validate(createAssetSchema), (request, response) => {
    try {
      const asset = createAsset(db, request.auth.user.id, request.body || {});
      const { base64Data: _base64Data, dataUrl: _dataUrl, ...summary } = asset;
      response.status(201).json(summary);
    } catch (error) {
      sendRouteError(response, error, { status: 400, isProduction: config.isProduction, fallback: '资产保存失败' });
    }
  });

  router.get('/assets/:id', requireAuth, (request, response) => {
    const asset = getAssetForViewer(db, request.auth.user.id, request.params.id);
    if (!asset) {
      response.status(404).json({ error: '资产不存在' });
      return;
    }
    response.setHeader('Content-Type', asset.mimeType);
    response.setHeader('Cache-Control', 'private, max-age=3600');
    response.send(Buffer.from(asset.base64Data, 'base64'));
  });

  router.delete('/assets/:id', requireAuth, (request, response) => {
    if (!deleteAsset(db, request.auth.user.id, request.params.id)) {
      response.status(404).json({ error: '资产不存在' });
      return;
    }
    response.json({ ok: true });
  });

  router.post('/conversations/:id/context/preview', requireAuth, (request, response) => {
    const preview = buildConversationContextPreview(db, request.auth.user, request.params.id, request.body || {});
    if (!preview) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    response.json(preview);
  });

  router.get('/conversations/:id/memories', requireAuth, (request, response) => {
    const memories = listConversationMemories(db, request.auth.user.id, request.params.id, {
      includeArchived: request.query.includeArchived === '1'
    });
    if (!memories) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    response.json({ memories });
  });

  router.post('/conversations/:id/memories', requireAuth, (request, response) => {
    try {
      const memory = createConversationMemory(db, request.auth.user.id, request.params.id, request.body || {});
      if (!memory) {
        response.status(404).json({ error: '对话不存在' });
        return;
      }
      response.status(201).json(memory);
    } catch (error) {
      sendRouteError(response, error, { status: 400, isProduction: config.isProduction, fallback: '记忆保存失败' });
    }
  });

  router.put('/conversations/:id/memories/:memoryId', requireAuth, (request, response) => {
    try {
      const memory = updateConversationMemory(
        db,
        request.auth.user.id,
        request.params.id,
        request.params.memoryId,
        request.body || {}
      );
      if (!memory) {
        response.status(404).json({ error: '记忆不存在' });
        return;
      }
      response.json(memory);
    } catch (error) {
      sendRouteError(response, error, { status: 400, isProduction: config.isProduction, fallback: '记忆更新失败' });
    }
  });

  router.post('/conversations/:id/memories/:memoryId/confirm', requireAuth, (request, response) => {
    const memory = confirmConversationMemory(db, request.auth.user.id, request.params.id, request.params.memoryId);
    if (!memory) {
      response.status(404).json({ error: '记忆不存在' });
      return;
    }
    response.json(memory);
  });

  router.post('/conversations/:id/memories/:memoryId/disable', requireAuth, (request, response) => {
    const memory = disableConversationMemory(db, request.auth.user.id, request.params.id, request.params.memoryId);
    if (!memory) {
      response.status(404).json({ error: '记忆不存在' });
      return;
    }
    response.json(memory);
  });

  router.post('/conversations/:id/memories/:memoryId/rollback', requireAuth, (request, response) => {
    const memory = rollbackConversationMemory(db, request.auth.user.id, request.params.id, request.params.memoryId);
    if (!memory) {
      response.status(404).json({ error: '记忆不存在' });
      return;
    }
    response.json(memory);
  });

  router.delete('/conversations/:id/memories/:memoryId', requireAuth, (request, response) => {
    if (!deleteConversationMemory(db, request.auth.user.id, request.params.id, request.params.memoryId)) {
      response.status(404).json({ error: '记忆不存在' });
      return;
    }
    response.json({ ok: true });
  });

  router.get('/conversations/:id/branches/tree', requireAuth, (request, response) => {
    const branchTree = getConversationBranchTree(db, request.auth.user.id, request.params.id);
    if (!branchTree) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    response.json(branchTree);
  });

  router.post('/world-books/:id/match-preview', requireAuth, (request, response) => {
    const book = getWorldBook(db, request.auth.user.id, request.params.id);
    if (!book) {
      response.status(404).json({ error: '世界书不存在' });
      return;
    }
    response.json(buildWorldBookMatchPreview(book, request.body || {}));
  });

  router.get('/diagnostics/export', requireAuth, (request, response) => {
    response.json(buildDiagnosticsExport(db, request.auth.user.id));
  });

  router.get('/project/snapshot', requireAuth, (request, response) => {
    response.json(buildProjectSnapshot(db, request.auth.user.id));
  });

  router.get('/envelopes/:kind', requireAuth, (request, response) => {
    const envelope = buildExportEnvelope(db, request.auth.user.id, request.params.kind, request.query || {});
    if (!envelope) {
      response.status(404).json({ error: '不支持的导出类型' });
      return;
    }
    response.json(envelope);
  });

  router.post('/envelopes/:kind/import', requireAuth, (request, response) => {
    try {
      const result = importExportEnvelope(db, request.auth.user.id, request.params.kind, request.body || {});
      if (!result) {
        response.status(404).json({ error: '不支持的导入类型' });
        return;
      }
      response.status(result.dryRun ? 200 : 201).json(result);
    } catch (error) {
      sendRouteError(response, error, { status: 400, isProduction: config.isProduction, fallback: '导入失败' });
    }
  });

  return router;
}

function buildProviderHealthSettings(ctx, userId, payload = {}, user = {}) {
  const config = withAppConfigDefaults(ctx.config || appConfig);
  if (!Object.keys(payload).length) {
    const saved = providerWithSecret(ctx.getProviderRow(userId));
    return applyProviderNetworkPolicy(saved, config, user);
  }
  const providerId = String(payload.providerId || '').trim();
  const row = ctx.getProviderRow(userId, providerId);
  if (providerId && !row) {
    const error = new Error('AI 供应商不存在');
    error.status = 404;
    throw error;
  }
  const saved = providerWithSecret(row);
  return applyProviderNetworkPolicy({
    ...saved,
    providerType: payload.providerType || saved.providerType,
    gatewayName: payload.gatewayName || saved.gatewayName,
    baseUrl: payload.baseUrl ?? saved.baseUrl,
    model: payload.model ?? saved.model,
    supportsReasoning: payload.supportsReasoning ?? saved.supportsReasoning,
    extraBody: payload.extraBody ?? saved.extraBody,
    apiKey: String(payload.apiKey || '').trim() || saved.apiKey,
    apiKeySet: Boolean(payload.apiKey || saved.apiKeySet)
  }, config, user);
}

function stripProviderSecret(provider = {}) {
  const { apiKey: _apiKey, ...publicProvider } = provider;
  return publicProvider;
}
