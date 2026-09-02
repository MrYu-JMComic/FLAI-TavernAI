import { Router } from 'express';
import {
  createTown,
  createTownReflection,
  createTownResident,
  deleteTown,
  deleteTownResident,
  evaluateTownReflectionNeed,
  getTown,
  getTownSnapshot,
  getTownSchedule,
  listTownEvents,
  listTownResidents,
  listTowns,
  recordTownEvent,
  recordTownMemory,
  retrieveTownMemories,
  saveTownSchedule,
  updateTownClock
} from '../modules/townSimulation.js';
import { applyTownTurnPlan, buildTownTurnContext } from '../modules/townAiEngine.js';
import {
  applyTownResidentCognitionPlan,
  buildTownResidentCognitionContext,
  getTownResidentCognition
} from '../modules/townCognitionEngine.js';
import { runTownSimulationStep } from '../modules/townEngine.js';
import { generateTownFromBlueprint } from '../modules/townWorldGenerator.js';
import { generateTownResidentCognitionPlan } from '../services/townCognitionAssistant.js';
import { generateTownTurnPlan } from '../services/townTurnAssistant.js';
import { generateTownWorldBlueprint } from '../services/townWorldAssistant.js';
import { sendRouteError } from './errorResponse.js';
import {
  advanceTownSchema,
  createTownEventSchema,
  createTownMemorySchema,
  createTownReflectionSchema,
  createTownResidentSchema,
  createTownSchema,
  generateTownSchema,
  saveTownScheduleSchema,
  updateTownClockSchema,
  validate
} from '../validations/schemas.js';

const DEFAULT_TOWN_WORLD_GENERATION_TIMEOUT_MS = 8 * 60 * 1000;
const TOWN_AI_STEP_TIMEOUT_MS = 3 * 60 * 1000;

export function createTownsRouter(ctx) {
  const { db, requireAuth, withListCache, getChatProviderSettings } = ctx;
  const config = ctx.config || {};
  const asyncHandler = ctx.asyncRoute || ((handler) => (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  });
  const generateBlueprint = ctx.generateTownWorldBlueprint || generateTownWorldBlueprint;
  const generateTurn = ctx.generateTownTurnPlan || generateTownTurnPlan;
  const generateCognition = ctx.generateTownResidentCognitionPlan || generateTownResidentCognitionPlan;
  const worldGenerationTimeoutMs = readRouteTimeout(
    ctx.townWorldGenerationTimeoutMs,
    DEFAULT_TOWN_WORLD_GENERATION_TIMEOUT_MS
  );
  const router = Router();

  router.get('/', requireAuth, (request, response) => {
    withListCache(request, response, listTowns(db, request.auth.user.id));
  });

  router.post('/', requireAuth, validate(createTownSchema), (request, response) => {
    response.status(201).json(createTown(db, request.auth.user.id, request.body));
  });

  router.post('/generate', requireAuth, validate(generateTownSchema), asyncHandler(async (request, response) => {
    const settings = readTownAiSettings(getChatProviderSettings, request.auth.user.id, 'AI 世界生成');
    if (!settings.ok) {
      response.status(400).json({ error: settings.error });
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(createTimeoutError('AI 世界生成', worldGenerationTimeoutMs)),
      worldGenerationTimeoutMs
    );
    const abortOnDisconnect = () => controller.abort(new Error('客户端已取消世界生成。'));
    request.once('aborted', abortOnDisconnect);
    try {
      const generated = await generateBlueprint(settings.value, request.body.prompt, {
        signal: controller.signal,
        database: db,
        userId: request.auth.user.id
      });
      const snapshot = generateTownFromBlueprint(db, request.auth.user.id, {
        prompt: request.body.prompt,
        blueprint: generated.blueprint,
        simulationStatus: request.body.simulationStatus
      });
      response.status(201).json({
        ...snapshot,
        generation: {
          mode: 'ai',
          provider: generated.provider,
          providerType: generated.providerType,
          model: generated.model,
          usage: generated.usage
        }
      });
    } catch (error) {
      if (!request.aborted && !response.destroyed) {
        const status = controller.signal.aborted ? 504 : Number(error?.status) === 429 ? 429 : 400;
        const abortedMessage = controller.signal.aborted
          ? controller.signal.reason?.message || 'AI 世界生成已中断。'
          : '';
        sendRouteError(response, error, {
          status,
          isProduction: config.isProduction,
          publicMessage: abortedMessage || undefined,
          fallback: abortedMessage || 'AI 世界生成失败。'
        });
      }
    } finally {
      clearTimeout(timeout);
      request.off('aborted', abortOnDisconnect);
    }
  }));

  router.get('/:townId', requireAuth, (request, response) => {
    const town = getTown(db, request.auth.user.id, request.params.townId);
    if (!town) return notFound(response, '小镇不存在');
    response.json(town);
  });

  router.delete('/:townId', requireAuth, (request, response) => {
    const result = deleteTown(db, request.auth.user.id, request.params.townId);
    if (!result) return notFound(response, '小镇不存在');
    response.json(result);
  });

  router.get('/:townId/snapshot', requireAuth, (request, response) => {
    const snapshot = getTownSnapshot(db, request.auth.user.id, request.params.townId, {
      eventLimit: request.query.eventLimit
    });
    if (!snapshot) return notFound(response, '小镇不存在');
    response.json(snapshot);
  });

  router.post('/:townId/advance', requireAuth, validate(advanceTownSchema), (request, response) => {
    let result = null;
    for (let index = 0; index < request.body.steps; index += 1) {
      result = runTownSimulationStep(db, request.auth.user.id, request.params.townId);
      if (!result || !result.advanced) break;
    }
    if (!result) return notFound(response, '小镇不存在');
    response.json(result);
  });

  router.post('/:townId/advance-ai', requireAuth, asyncHandler(async (request, response) => {
    const context = buildTownTurnContext(db, request.auth.user.id, request.params.townId);
    if (!context) return notFound(response, '小镇不存在');
    if (context.time.simulationStatus !== 'paused') {
      response.status(409).json({ error: '请先暂停世界，再进行 AI 推演。' });
      return;
    }
    const settings = readTownAiSettings(getChatProviderSettings, request.auth.user.id, 'AI 世界推演');
    if (!settings.ok) {
      response.status(400).json({ error: settings.error });
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error('AI 世界推演超时，请稍后重试。')),
      TOWN_AI_STEP_TIMEOUT_MS
    );
    const abortOnDisconnect = () => controller.abort(new Error('客户端已取消 AI 世界推演。'));
    request.once('aborted', abortOnDisconnect);
    try {
      const generated = await generateTurn(settings.value, context, {
        signal: controller.signal,
        database: db,
        userId: request.auth.user.id
      });
      const result = applyTownTurnPlan(db, request.auth.user.id, request.params.townId, generated.plan, {
        expectedTick: context.version.tick
      });
      response.json({
        ...result,
        generation: {
          mode: 'ai-step',
          provider: generated.provider,
          providerType: generated.providerType,
          model: generated.model,
          usage: generated.usage
        }
      });
    } catch (error) {
      if (!request.aborted && !response.destroyed) {
        const aborted = controller.signal.aborted;
        const status = aborted ? 504 : Number(error?.status) === 429 ? 429 : error.code === 'TOWN_AI_STEP_CONFLICT' ? 409 : 400;
        const abortedMessage = aborted
          ? controller.signal.reason?.message || 'AI 世界推演已中断。'
          : '';
        sendRouteError(response, error, {
          status,
          isProduction: config.isProduction,
          publicMessage: abortedMessage || undefined,
          fallback: abortedMessage || 'AI 世界推演失败。'
        });
      }
    } finally {
      clearTimeout(timeout);
      request.off('aborted', abortOnDisconnect);
    }
  }));

  router.patch('/:townId/clock', requireAuth, validate(updateTownClockSchema), (request, response) => {
    const town = updateTownClock(db, request.auth.user.id, request.params.townId, request.body);
    if (!town) return notFound(response, '小镇不存在');
    response.json(town);
  });

  router.get('/:townId/residents', requireAuth, (request, response) => {
    const residents = listTownResidents(db, request.auth.user.id, request.params.townId);
    if (!residents) return notFound(response, '小镇不存在');
    response.json(residents);
  });

  router.post('/:townId/residents', requireAuth, validate(createTownResidentSchema), (request, response) => {
    const resident = createTownResident(db, request.auth.user.id, request.params.townId, request.body);
    if (!resident) return notFound(response, '小镇不存在');
    response.status(201).json(resident);
  });

  router.delete('/:townId/residents/:residentId', requireAuth, (request, response) => {
    const result = deleteTownResident(
      db,
      request.auth.user.id,
      request.params.townId,
      request.params.residentId
    );
    if (!result) return notFound(response, '居民不存在');
    response.json(result);
  });

  router.get('/:townId/residents/:residentId/cognition', requireAuth, (request, response) => {
    const cognition = getTownResidentCognition(
      db,
      request.auth.user.id,
      request.params.townId,
      request.params.residentId
    );
    if (!cognition) return notFound(response, '小镇或居民不存在');
    response.json(cognition);
  });

  router.post('/:townId/residents/:residentId/cognition-ai', requireAuth, asyncHandler(async (request, response) => {
    const context = buildTownResidentCognitionContext(
      db,
      request.auth.user.id,
      request.params.townId,
      request.params.residentId
    );
    if (!context) return notFound(response, '小镇或居民不存在');
    if (context.time.simulationStatus !== 'paused') {
      response.status(409).json({ error: '请先暂停世界，再让居民进行 AI 反思与规划。' });
      return;
    }
    const settings = readTownAiSettings(getChatProviderSettings, request.auth.user.id, 'AI 居民反思与规划');
    if (!settings.ok) {
      response.status(400).json({ error: settings.error });
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error('AI 居民反思与规划超时，请稍后重试。')),
      TOWN_AI_STEP_TIMEOUT_MS
    );
    const abortOnDisconnect = () => controller.abort(new Error('客户端已取消 AI 居民反思与规划。'));
    request.once('aborted', abortOnDisconnect);
    try {
      const generated = await generateCognition(settings.value, context, {
        signal: controller.signal,
        database: db,
        userId: request.auth.user.id
      });
      const result = applyTownResidentCognitionPlan(
        db,
        request.auth.user.id,
        request.params.townId,
        request.params.residentId,
        generated.plan,
        { expectedVersion: context.version }
      );
      response.json({
        ...result,
        generation: {
          mode: 'ai-cognition',
          provider: generated.provider,
          providerType: generated.providerType,
          model: generated.model,
          usage: generated.usage
        }
      });
    } catch (error) {
      if (!request.aborted && !response.destroyed) {
        const aborted = controller.signal.aborted;
        const status = aborted ? 504 : Number(error?.status) === 429 ? 429 : error.code === 'TOWN_AI_COGNITION_CONFLICT' ? 409 : 400;
        const abortedMessage = aborted
          ? controller.signal.reason?.message || 'AI 居民反思与规划已中断。'
          : '';
        sendRouteError(response, error, {
          status,
          isProduction: config.isProduction,
          publicMessage: abortedMessage || undefined,
          fallback: abortedMessage || 'AI 居民反思与规划失败。'
        });
      }
    } finally {
      clearTimeout(timeout);
      request.off('aborted', abortOnDisconnect);
    }
  }));

  router.get('/:townId/events', requireAuth, (request, response) => {
    const events = listTownEvents(db, request.auth.user.id, request.params.townId, {
      limit: request.query.limit
    });
    if (!events) return notFound(response, '小镇不存在');
    response.json(events);
  });

  router.post('/:townId/events', requireAuth, validate(createTownEventSchema), (request, response) => {
    const event = recordTownEvent(db, request.auth.user.id, request.params.townId, request.body);
    if (!event) return notFound(response, '小镇不存在');
    response.status(201).json(event);
  });

  router.post(
    '/:townId/residents/:residentId/memories',
    requireAuth,
    validate(createTownMemorySchema),
    (request, response) => {
      const memory = recordTownMemory(
        db,
        request.auth.user.id,
        request.params.townId,
        request.params.residentId,
        request.body
      );
      if (!memory) return notFound(response, '小镇或居民不存在');
      response.status(201).json(memory);
    }
  );

  router.get('/:townId/residents/:residentId/memories/recall', requireAuth, (request, response) => {
    const memories = retrieveTownMemories(
      db,
      request.auth.user.id,
      request.params.townId,
      request.params.residentId,
      request.query.query,
      { limit: request.query.limit }
    );
    if (!memories) return notFound(response, '小镇或居民不存在');
    response.json(memories);
  });

  router.get('/:townId/residents/:residentId/reflection-status', requireAuth, (request, response) => {
    const status = evaluateTownReflectionNeed(
      db,
      request.auth.user.id,
      request.params.townId,
      request.params.residentId
    );
    if (!status) return notFound(response, '小镇或居民不存在');
    response.json(status);
  });

  router.post(
    '/:townId/residents/:residentId/reflections',
    requireAuth,
    validate(createTownReflectionSchema),
    (request, response) => {
      const reflection = createTownReflection(
        db,
        request.auth.user.id,
        request.params.townId,
        request.params.residentId,
        request.body
      );
      if (!reflection) return notFound(response, '小镇或居民不存在');
      response.status(201).json(reflection);
    }
  );

  router.get('/:townId/residents/:residentId/schedules/:day', requireAuth, (request, response) => {
    const schedule = getTownSchedule(
      db,
      request.auth.user.id,
      request.params.townId,
      request.params.residentId,
      request.params.day
    );
    if (!schedule) return notFound(response, '日程不存在');
    response.json(schedule);
  });

  router.put(
    '/:townId/residents/:residentId/schedules/:day',
    requireAuth,
    validate(saveTownScheduleSchema),
    (request, response) => {
      const schedule = saveTownSchedule(
        db,
        request.auth.user.id,
        request.params.townId,
        request.params.residentId,
        { ...request.body, day: Number(request.params.day) }
      );
      if (!schedule) return notFound(response, '小镇或居民不存在');
      response.json(schedule);
    }
  );

  return router;
}

function notFound(response, message) {
  response.status(404).json({ error: message });
}

function readTownAiSettings(getSettings, userId, featureLabel) {
  if (typeof getSettings !== 'function') {
    return { ok: false, error: `${featureLabel}需要先配置可用的模型。` };
  }
  const settings = getSettings(userId);
  if (!settings.ok) {
    return { ok: false, error: `${featureLabel}需要可用模型：${settings.error}` };
  }
  if (settings.value?.providerType === 'mock') {
    return { ok: false, error: `${featureLabel}需要真实可用的模型，不能使用本地模拟结果。` };
  }
  return settings;
}

function readRouteTimeout(value, fallback) {
  const timeoutMs = Number(value);
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : fallback;
}

function createTimeoutError(stage, timeoutMs) {
  return new Error(`${stage}阶段在${formatTimeoutDuration(timeoutMs)}内未完成，请稍后重试。`);
}

function formatTimeoutDuration(timeoutMs) {
  if (timeoutMs >= 60 * 1000 && timeoutMs % (60 * 1000) === 0) {
    return `${timeoutMs / (60 * 1000)} 分钟`;
  }
  if (timeoutMs >= 1000 && timeoutMs % 1000 === 0) {
    return `${timeoutMs / 1000} 秒`;
  }
  return `${timeoutMs} 毫秒`;
}
