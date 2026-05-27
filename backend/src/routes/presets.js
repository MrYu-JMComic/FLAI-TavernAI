import { Router } from 'express';
import {
  createPreset,
  deletePreset,
  getDefaultPreset,
  getPreset,
  listPresets,
  setDefaultPreset,
  updatePreset
} from '../modules/presets.js';
import { createPresetSchema, updatePresetSchema, validate } from '../validations/schemas.js';

export function createPresetsRouter(ctx) {
  const { db, requireAuth, withListCache } = ctx;
  const router = Router();

  router.get('/', requireAuth, (request, response) => {
    withListCache(request, response, listPresets(db, request.auth.user.id));
  });

  router.post('/', requireAuth, validate(createPresetSchema), (request, response) => {
    const preset = createPreset(db, request.auth.user.id, request.body);
    response.status(201).json(preset);
  });

  router.get('/:id', requireAuth, (request, response) => {
    const preset = getPreset(db, request.auth.user.id, request.params.id);
    if (!preset) {
      response.status(404).json({ error: '预设不存在' });
      return;
    }
    response.json(preset);
  });

  router.put('/:id', requireAuth, validate(updatePresetSchema), (request, response) => {
    const preset = updatePreset(db, request.auth.user.id, request.params.id, request.body);
    if (!preset) {
      response.status(404).json({ error: '预设不存在' });
      return;
    }
    response.json(preset);
  });

  router.delete('/:id', requireAuth, (request, response) => {
    if (!deletePreset(db, request.auth.user.id, request.params.id)) {
      response.status(404).json({ error: '预设不存在' });
      return;
    }
    response.json({ ok: true });
  });

  router.post('/:id/set-default', requireAuth, (request, response) => {
    const preset = setDefaultPreset(db, request.auth.user.id, request.params.id);
    if (!preset) {
      response.status(404).json({ error: '预设不存在' });
      return;
    }
    response.json(preset);
  });

  return router;
}
