import { Router } from 'express';
import { z } from 'zod';
import {
  buildAdminOverview,
  getAdminUserUsage,
  listAdminJobs,
  listAdminProviderSettings,
  listAdminSessions,
  listAdminUsers,
  revokeAdminSession
} from '../services/adminOperations.js';
import { listAutomationAudit } from '../services/automationAudit.js';
import { performanceMetricsSnapshot } from '../services/performanceMetrics.js';
import { providerResilienceSnapshot } from '../services/providerResilience.js';
import { listProviderRouteEvents } from '../services/providerTaskRouter.js';
import { updateUserQuota } from '../services/quotas.js';
import { validate } from '../validations/schemas.js';

const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  cursor: z.string().max(1000).optional().default('')
});
const idParams = z.object({ id: z.string().min(1).max(200) });
const jobsQuery = pageQuery.extend({
  userId: z.string().max(200).optional().default(''),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']).optional()
});
const auditQuery = pageQuery.extend({
  domain: z.string().max(80).optional().default(''),
  userId: z.string().max(200).optional().default('')
});
const routeQuery = z.object({
  userId: z.string().max(200).optional().default(''),
  jobId: z.string().max(200).optional().default(''),
  afterId: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100)
});
const quotaBody = z.object({
  maxConcurrentAiJobs: z.number().int().min(1).max(32).optional(),
  maxUploadBytes: z.number().int().min(1024).max(10 * 1024 ** 3).optional(),
  maxStructuredStorageBytes: z.number().int().min(1024).max(10 * 1024 ** 3).optional(),
  maxDailyRequests: z.number().int().min(1).max(10_000_000).optional(),
  maxDailyCostMicros: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional()
}).strict();
const backupParams = z.object({ filename: z.string().min(1).max(255) });

export function createAdminRouter(ctx) {
  const router = Router();
  router.use(ctx.requireAuth, ctx.requireRootAdmin);
  router.get('/overview', (_request, response) => response.json(buildAdminOverview(ctx.db)));
  router.get('/users', validate(pageQuery, 'query'), (request, response) => {
    response.json(listAdminUsers(ctx.db, request.validatedQuery));
  });
  router.get('/users/:id/usage', validate(idParams, 'params'), (request, response) => {
    const result = getAdminUserUsage(ctx.db, request.params.id);
    if (!result) return response.status(404).json({ error: 'User not found.' });
    return response.json(result);
  });
  router.put(
    '/users/:id/quota',
    validate(idParams, 'params'),
    validate(quotaBody),
    (request, response) => {
      if (!getAdminUserUsage(ctx.db, request.params.id)) {
        return response.status(404).json({ error: 'User not found.' });
      }
      return response.json(updateUserQuota(ctx.db, request.params.id, request.body));
    }
  );
  router.get('/sessions', validate(pageQuery, 'query'), (request, response) => {
    response.json(listAdminSessions(ctx.db, {
      limit: request.validatedQuery.limit,
      cursor: request.validatedQuery.cursor
    }));
  });
  router.delete('/sessions/:id', validate(idParams, 'params'), (request, response) => {
    if (!revokeAdminSession(ctx.db, request.params.id)) {
      return response.status(404).json({ error: 'Session not found.' });
    }
    return response.json({ ok: true });
  });
  router.get('/jobs', validate(jobsQuery, 'query'), (request, response) => {
    response.json(listAdminJobs(ctx.db, request.validatedQuery));
  });
  router.get('/providers', (_request, response) => response.json({
    settings: listAdminProviderSettings(ctx.db),
    resilience: providerResilienceSnapshot()
  }));
  router.get('/provider-routes', validate(routeQuery, 'query'), (request, response) => {
    response.json({ events: listProviderRouteEvents(ctx.db, request.validatedQuery) });
  });
  router.get('/audit', validate(auditQuery, 'query'), (request, response) => {
    response.json(listAutomationAudit(ctx.db, request.validatedQuery.userId, request.validatedQuery));
  });
  router.get('/diagnostics/performance', (_request, response) => {
    response.json({ operations: performanceMetricsSnapshot() });
  });
  router.get('/backups/:filename/preflight', validate(backupParams, 'params'), (request, response) => {
    if (!ctx.backupService?.preflight) {
      return response.status(503).json({ error: 'Backup restore preflight is unavailable.' });
    }
    return response.json(ctx.backupService.preflight(request.params.filename));
  });
  return router;
}
