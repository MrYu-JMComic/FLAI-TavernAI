import { Router } from 'express';
import {
  getRegexRulesByGroup,
  toggleRegexRule,
  reorderRegexRules
} from '../modules/characters.js';
import { validate } from '../validations/schemas.js';
import { z } from 'zod';

const reorderRegexSchema = z.object({
  orderedIds: z.array(z.string()).min(1, '请提供排序后的规则 ID 列表').max(500)
});

export function createRegexRouter(ctx) {
  const { db, requireAuth, newId } = ctx;
  const router = Router();

  router.get('/', requireAuth, (request, response) => {
    const group = String(request.query.group || '').trim();
    const rules = getRegexRulesByGroup(db, request.auth.user.id, group || null);
    response.json(rules);
  });

  router.put('/:id/toggle', requireAuth, (request, response) => {
    const rule = toggleRegexRule(db, request.auth.user.id, request.params.id);
    if (!rule) {
      response.status(404).json({ error: '规则不存在' });
      return;
    }
    response.json(rule);
  });

  router.put('/order', requireAuth, (request, response) => {
    const orderedIds = Array.isArray(request.body?.orderedIds) ? request.body.orderedIds : [];
    if (!orderedIds.length) {
      response.status(400).json({ error: '请提供排序后的规则 ID 列表' });
      return;
    }
    const changed = reorderRegexRules(db, request.auth.user.id, orderedIds);
    response.json({ ok: true, changed });
  });

  router.post('/import', requireAuth, (request, response) => {
    const items = Array.isArray(request.body?.rules)
      ? request.body.rules
      : Array.isArray(request.body)
        ? request.body
        : [request.body].filter(Boolean);
    const insert = db.prepare(
      `INSERT INTO regex_rules (
        id, user_id, character_id, label, pattern, replacement, flags, scope, enabled, order_index, group_name, priority
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    let imported = 0;
    const skipped = [];

    for (const [index, item] of items.entries()) {
      let rule;
      try {
        rule = normalizeImportedRule(item, index);
      } catch (error) {
        skipped.push({ index, reason: error?.message || 'invalid regex rule' });
        continue;
      }
      if (!rule.pattern || !rule.characterId) {
        skipped.push({ index, reason: 'missing characterId or pattern' });
        continue;
      }
      const owned = db
        .prepare('SELECT id FROM characters WHERE id = ? AND user_id = ?')
        .get(rule.characterId, request.auth.user.id);
      if (!owned) {
        skipped.push({ index, reason: 'character not found or not owned' });
        continue;
      }
      insert.run(
        newId(),
        request.auth.user.id,
        rule.characterId,
        rule.label,
        rule.pattern,
        rule.replacement,
        rule.flags,
        rule.scope,
        rule.enabled ? 1 : 0,
        rule.order,
        rule.groupName,
        rule.priority
      );
      imported += 1;
    }

    response.status(201).json({ imported, skipped });
  });

  return router;
}

function normalizeImportedRule(item = {}, index = 0) {
  const flags = normalizeFlags(item.flags);
  const pattern = String(item.pattern || '').trim();
  if (pattern) {
    new RegExp(pattern, flags);
  }
  return {
    characterId: String(item.characterId || item.character_id || '').trim(),
    label: String(item.label || item.name || `Imported rule ${index + 1}`).trim().slice(0, 100),
    pattern,
    replacement: String(item.replacement || '').slice(0, 5000),
    flags,
    scope: ['input', 'output', 'both'].includes(item.scope) ? item.scope : 'input',
    enabled: item.enabled !== false,
    order: Number.isFinite(Number(item.order ?? item.orderIndex)) ? Math.round(Number(item.order ?? item.orderIndex)) : index,
    groupName: String(item.groupName || item.group_name || '全局').trim().slice(0, 50) || '全局',
    priority: Number.isFinite(Number(item.priority)) ? Math.round(Number(item.priority)) : index
  };
}

function normalizeFlags(flags) {
  return [...new Set(String(flags || 'g').replace(/[^dgimsuvy]/g, '').split(''))].join('') || 'g';
}
