import { Router } from 'express';
import {
  assignMemoryLayer,
  calculateMemoryImportance,
  createPersonalityAnchor,
  executeHMDTEngine,
  initializeEmotionVector,
  retrieveRelevantMemories,
  validateOOC,
} from '../modules/hmdtEngine.js';
import { CastDomainError } from '../domain/cast/errors.js';
import {
  recordCastOocValidation,
  setCastEmotionState,
  setCastPersonalityAnchor,
} from '../services/cast/commands/runtimeCommands.js';
import {
  getCastCognition,
  getCastEmotionTimeline,
  getCastMemberDetail,
  getCastMemories,
  getCastOocHistory,
} from '../services/cast/castQueryService.js';
import { clampInteger, clampNumber } from '../utils/number.js';
import { listRecentConversationMessageRows } from './helpers.js';

export function createHMDTRouter(ctx) {
  const { db, requireAuth } = ctx;
  const router = Router();

  router.get('/conversations/:conversationId/members/:memberId/personality', requireAuth, (request, response) => {
    runHmdtRequest(response, () => {
      const cognition = getCognition(db, request);
      if (!cognition.personality) return response.status(404).json({ error: '该人物尚未创建人格锚定' });
      response.json(cognition.personality);
    });
  });

  router.put('/conversations/:conversationId/members/:memberId/personality', requireAuth, (request, response) => {
    runHmdtRequest(response, () => {
      const member = getMember(db, request).member;
      const anchor = createPersonalityAnchor({
        ...(request.body || {}),
        characterId: member.id,
        name: request.body?.name || member.canonicalName,
        identity: request.body?.identity || member.customStatus || member.status || '角色',
      });
      response.json(setCastPersonalityAnchor(
        db,
        userId(request),
        request.params.conversationId,
        member.id,
        anchor,
        {
          expectedRevision: request.body?.revision,
          actor: `user:${userId(request)}`,
        }
      ));
    });
  });

  router.post('/conversations/:conversationId/members/:memberId/personality/from-profile', requireAuth, (request, response) => {
    runHmdtRequest(response, () => {
      const member = getMember(db, request).member;
      const anchor = createPersonalityAnchor({
        characterId: member.id,
        name: member.canonicalName,
        identity: member.customStatus || member.status || '角色',
        age: 18,
        traitVector: {
          gentle: 50,
          irritable: 30,
          cautious: 50,
          greedy: 30,
          aloof: 40,
        },
        speechStyle: { formality: 'casual', verbosity: 'moderate', quirks: [] },
        taboos: [],
        coreValues: [],
        backstory: { summary: member.evidence || '', keyEvents: [] },
      });
      response.json(setCastPersonalityAnchor(
        db,
        userId(request),
        request.params.conversationId,
        member.id,
        anchor,
        { actor: `user:${userId(request)}` }
      ));
    });
  });

  router.get('/conversations/:conversationId/members/:memberId/emotion', requireAuth, (request, response) => {
    runHmdtRequest(response, () => {
      const cognition = getCognition(db, request);
      if (cognition.emotion) return response.json(cognition.emotion);
      response.json(setCastEmotionState(
        db,
        userId(request),
        request.params.conversationId,
        request.params.memberId,
        initializeEmotionVector(),
        { actor: 'hmdt:init' }
      ));
    });
  });

  router.post('/conversations/:conversationId/members/:memberId/emotion/reset', requireAuth, (request, response) => {
    runHmdtRequest(response, () => {
      getMember(db, request);
      response.json(setCastEmotionState(
        db,
        userId(request),
        request.params.conversationId,
        request.params.memberId,
        initializeEmotionVector(),
        {
          expectedRevision: request.body?.revision,
          recordHistory: true,
          trigger: 'manual reset',
          actor: `user:${userId(request)}`,
        }
      ));
    });
  });

  router.get('/conversations/:conversationId/members/:memberId/emotion/history', requireAuth, (request, response) => {
    runHmdtRequest(response, () => {
      response.json(getCastEmotionTimeline(
        db,
        userId(request),
        request.params.conversationId,
        request.params.memberId,
        { limit: request.query.limit }
      ));
    });
  });

  router.post('/conversations/:conversationId/members/:memberId/memories/retrieve', requireAuth, (request, response) => {
    runHmdtRequest(response, () => {
      const query = String(request.body?.query || '').trim();
      if (!query) return response.status(400).json({ error: '缺少 query 参数' });
      const memories = getCastMemories(
        db,
        userId(request),
        request.params.conversationId,
        request.params.memberId,
        { limit: 200, includeForgotten: false }
      ).items;
      response.json(retrieveRelevantMemories(memories, query, {
        maxResults: clampInteger(request.body?.maxResults, 1, 30, 8),
        similarityThreshold: clampNumber(request.body?.similarityThreshold, 0, 1, 0.35),
      }));
    });
  });

  router.post('/conversations/:conversationId/members/:memberId/memories/analyze', requireAuth, (request, response) => {
    runHmdtRequest(response, () => {
      getMember(db, request);
      const content = String(request.body?.content || '').trim();
      if (!content) return response.status(400).json({ error: '缺少 content 参数' });
      const score = calculateMemoryImportance({
        memoryType: request.body?.memoryType || 'event',
        content,
        confidence: clampNumber(request.body?.confidence, 0, 1, 0.5) * 100,
        emotionalIntensity: clampNumber(request.body?.emotionalIntensity, 0, 1, 0) * 100,
      });
      response.json({ importance: score / 100, layer: assignMemoryLayer(score) });
    });
  });

  router.post('/conversations/:conversationId/members/:memberId/generate-prompt', requireAuth, (request, response) => {
    runHmdtRequest(response, () => {
      const input = String(request.body?.userInput || '').trim();
      if (!input) return response.status(400).json({ error: '缺少 userInput 参数' });
      const member = getMember(db, request).member;
      const cognition = getCognition(db, request);
      if (!cognition.personality) return response.status(404).json({ error: '该人物尚未创建人格锚定' });
      const currentEmotion = cognition.emotion?.emotion || initializeEmotionVector();
      const memories = getCastMemories(
        db,
        userId(request),
        request.params.conversationId,
        member.id,
        { limit: 200, includeForgotten: false }
      ).items;
      const recentDialogue = listRecentConversationMessageRows(
        db,
        userId(request),
        request.params.conversationId
      ).map((message) => ({
        role: message.role,
        content: message.content,
        timestamp: message.created_at,
      }));
      const result = executeHMDTEngine({
        characterId: member.id,
        personalityAnchor: cognition.personality.anchor,
        currentEmotion,
        memories,
        recentDialogue,
        userInput: input,
      });
      setCastEmotionState(
        db,
        userId(request),
        request.params.conversationId,
        member.id,
        result.metadata.emotionVector,
        {
          expectedRevision: cognition.emotion?.revision,
          recordHistory: true,
          impact: result.metadata.emotionImpact,
          trigger: input.slice(0, 200),
          actor: 'hmdt:inference',
        }
      );
      response.json(result);
    });
  });

  router.post('/conversations/:conversationId/members/:memberId/validate-ooc', requireAuth, (request, response) => {
    runHmdtRequest(response, () => {
      const responseText = String(request.body?.responseText || '').trim();
      if (!responseText) return response.status(400).json({ error: '缺少 responseText 参数' });
      const cognition = getCognition(db, request);
      if (!cognition.personality) return response.status(404).json({ error: '该人物尚未创建人格锚定' });
      const validation = validateOOC(cognition.personality.anchor, responseText);
      recordCastOocValidation(
        db,
        userId(request),
        request.params.conversationId,
        request.params.memberId,
        {
          responseText,
          matchScore: validation.matchScore,
          passed: validation.valid,
          violations: validation.issues,
        }
      );
      response.json(validation);
    });
  });

  router.get('/conversations/:conversationId/ooc-history', requireAuth, (request, response) => {
    runHmdtRequest(response, () => {
      response.json(getCastOocHistory(db, userId(request), request.params.conversationId, {
        memberId: request.query.memberId,
        limit: request.query.limit,
      }));
    });
  });

  router.get('/conversations/:conversationId/members/:memberId/stats', requireAuth, (request, response) => {
    runHmdtRequest(response, () => {
      const memories = getCastMemories(
        db,
        userId(request),
        request.params.conversationId,
        request.params.memberId,
        { limit: 200, includeForgotten: true }
      );
      const memoryLayers = {};
      for (const memory of memories.items) {
        memoryLayers[memory.layer] = (memoryLayers[memory.layer] || 0) + 1;
      }
      const emotionHistory = getCastEmotionTimeline(
        db,
        userId(request),
        request.params.conversationId,
        request.params.memberId,
        { limit: 200 }
      );
      response.json({
        conversationId: request.params.conversationId,
        memberId: request.params.memberId,
        memoryLayers,
        memoryTotal: memories.total,
        emotionHistoryCount: emotionHistory.length,
      });
    });
  });

  return router;
}

function getMember(database, request) {
  return getCastMemberDetail(
    database,
    userId(request),
    request.params.conversationId,
    request.params.memberId
  );
}

function getCognition(database, request) {
  return getCastCognition(
    database,
    userId(request),
    request.params.conversationId,
    request.params.memberId
  );
}

function userId(request) {
  return request.auth.user.id;
}

function runHmdtRequest(response, operation) {
  try {
    return operation();
  } catch (error) {
    if (error instanceof CastDomainError) {
      return response.status(error.statusCode).json({ error: error.message, code: error.code });
    }
    throw error;
  }
}
