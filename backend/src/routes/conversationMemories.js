import { Router } from 'express';
import { z } from 'zod';
import { withAppConfigDefaults } from '../config.js';
import { sendRouteError } from './errorResponse.js';
import { validate } from '../validations/schemas.js';
import { readMemoryWorkbench,requestMemoryReindex,applyAuthorMemoryPacket,listMemoryActors,readMemoryActorDossier,appendMemoryActorRecords,patchMemoryActorRecord } from '../services/conversationMemory/workbench.js';
import { requireMemoryReviewRevision } from '../services/conversationMemory/revisionGuard.js';
import {
  batchReviewConversationMemories,
  confirmConversationMemory,
  createConversationMemory,
  deleteConversationMemory,
  disableConversationMemory,
  listConversationMemoryConflictCandidates,
  listConversationMemories,
  mergeConversationMemories,
  pinConversationMemory,
  rollbackConversationMemory,
  undoConversationMemoryMerge,
  updateConversationMemory
} from '../modules/conversationMemories.js';

const revisionSchema=z.object({revision:z.number().int().positive()}).passthrough();

/** Authenticated memory transport; canonical writes are owned by the memory service. */
export function createConversationMemoriesRouter(ctx) {
  const {db,requireAuth}=ctx;
  const config=withAppConfigDefaults(ctx.config||{});
  const router=Router();
  const expectedRevision=(request,response,next)=>{
    try {
      if(!requireMemoryReviewRevision(db,request.auth.user.id,request.params.id,request.params.memoryId,request.body.revision))
        return response.status(404).json({error:'记忆不存在'});
      next();
    } catch(error) { sendRouteError(response,error,{status:Number(error.status)||409,isProduction:config.isProduction,fallback:'记忆版本已变化'}); }
  };
  router.get('/conversations/:id/memory-state',requireAuth,(request,response)=>{
    response.setHeader('Cache-Control','no-store');
    handleMemoryMutation(response,config,()=>readMemoryWorkbench(db,request.auth.user.id,request.params.id,request.query));
  });
  router.get('/conversations/:id/memory-state/actors',requireAuth,(request,response)=>{
    response.setHeader('Cache-Control','no-store');
    handleMemoryMutation(response,config,()=>listMemoryActors(db,request.auth.user.id,request.params.id,request.query));
  });
  router.get('/conversations/:id/memory-state/actors/:actorId',requireAuth,(request,response)=>{
    response.setHeader('Cache-Control','no-store');
    handleMemoryMutation(response,config,()=>readMemoryActorDossier(db,request.auth.user.id,request.params.id,request.params.actorId,request.query));
  });
  router.post('/conversations/:id/memory-state/actors/:actorId/records/batch',requireAuth,(request,response)=>{
    handleMemoryMutation(response,config,()=>appendMemoryActorRecords(db,request.auth.user.id,request.params.id,request.params.actorId,request.body));
  });
  router.patch('/conversations/:id/memory-state/actors/:actorId/records/:memoryId',requireAuth,(request,response)=>{
    handleMemoryMutation(response,config,()=>patchMemoryActorRecord(db,request.auth.user.id,request.params.id,request.params.actorId,request.params.memoryId,request.body));
  });
  router.post('/conversations/:id/memory-state/reindex',requireAuth,(request,response)=>{
    handleMemoryMutation(response,config,()=>requestMemoryReindex(db,request.auth.user.id,request.params.id,request.body||{}));
  });
  router.post('/conversations/:id/memory-state/packet',requireAuth,
    validate(z.object({expectedRevision:z.number().int().nonnegative(),packet:z.record(z.string(),z.unknown())})),
    (request,response)=>handleMemoryMutation(response,config,()=>applyAuthorMemoryPacket(db,request.auth.user.id,request.params.id,request.body)));
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

  router.get('/conversations/:id/memories/conflicts', requireAuth, (request, response) => {
    const candidates = listConversationMemoryConflictCandidates(db, request.auth.user.id, request.params.id);
    if (!candidates) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    response.json({ candidates });
  });

  router.post('/conversations/:id/memories/batch', requireAuth, (request, response) => {
    handleMemoryMutation(response, config, () => {
      const memories = batchReviewConversationMemories(db, request.auth.user.id, request.params.id, request.body || {});
      return memories ? { memories } : null;
    });
  });

  router.post('/conversations/:id/memories/merge', requireAuth, (request, response) => {
    handleMemoryMutation(response, config, () => mergeConversationMemories(
      db, request.auth.user.id, request.params.id, request.body || {}
    ));
  });

  router.post('/conversations/:id/memories/merges/:operationId/undo', requireAuth, (request, response) => {
    handleMemoryMutation(response, config, () => undoConversationMemoryMerge(
      db, request.auth.user.id, request.params.id, request.params.operationId
    ));
  });

  router.put('/conversations/:id/memories/:memoryId', requireAuth, validate(revisionSchema), expectedRevision, (request, response) => {
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

  router.post('/conversations/:id/memories/:memoryId/confirm', requireAuth, validate(revisionSchema), expectedRevision, (request, response) => {
    const memory = confirmConversationMemory(db, request.auth.user.id, request.params.id, request.params.memoryId);
    if (!memory) {
      response.status(404).json({ error: '记忆不存在' });
      return;
    }
    response.json(memory);
  });

  router.post('/conversations/:id/memories/:memoryId/pin', requireAuth, validate(revisionSchema), expectedRevision, (request, response) => {
    handleMemoryMutation(response, config, () => pinConversationMemory(
      db, request.auth.user.id, request.params.id, request.params.memoryId, request.body || {}
    ));
  });

  router.post('/conversations/:id/memories/:memoryId/disable', requireAuth, validate(revisionSchema), expectedRevision, (request, response) => {
    const memory = disableConversationMemory(db, request.auth.user.id, request.params.id, request.params.memoryId);
    if (!memory) {
      response.status(404).json({ error: '记忆不存在' });
      return;
    }
    response.json(memory);
  });

  router.post('/conversations/:id/memories/:memoryId/rollback', requireAuth, validate(revisionSchema), expectedRevision, (request, response) => {
    const memory = rollbackConversationMemory(db, request.auth.user.id, request.params.id, request.params.memoryId);
    if (!memory) {
      response.status(404).json({ error: '记忆不存在' });
      return;
    }
    response.json(memory);
  });

  router.delete('/conversations/:id/memories/:memoryId', requireAuth, validate(revisionSchema), expectedRevision, (request, response) => {
    if (!deleteConversationMemory(db, request.auth.user.id, request.params.id, request.params.memoryId)) {
      response.status(404).json({ error: '记忆不存在' });
      return;
    }
    response.json({ ok: true });
  });

  return router;
}

function handleMemoryMutation(response, config, operation) {
  try {
    const result = operation();
    if (!result) {
      response.status(404).json({ error: '对话或记忆不存在' });
      return;
    }
    response.json(result);
  } catch (error) {
    sendRouteError(response, error, {
      status: Number(error?.status) || 400,
      isProduction: config.isProduction,
      fallback: '记忆审阅操作失败'
    });
  }
}

