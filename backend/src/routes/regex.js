import { Router } from 'express';
import {
  getRegexRulesByGroup,
  testRegexRule,
  toggleRegexRule,
  reorderRegexRules
} from '../modules/characters.js';
import { withSavepoint } from '../modules/savepoint.js';
import { validate } from '../validations/schemas.js';
import { normalizeBoolean } from '../utils/boolean.js';
import { normalizeFiniteNumber } from '../utils/number.js';
import { normalizeRegexFlags } from '../../../shared/regexFlags.js';
import { z } from 'zod';

const reorderRegexSchema = z.object({
  orderedIds: z.array(z.string()).min(1, '请提供排序后的规则 ID 列表').max(500)
});

const testRegexSchema = z.object({
  rule: z.object({
    pattern: z.string().min(1, '请提供匹配模式'),
    mode: z.enum(['contain', 'exact', 'regex', 'preset']).optional().default('regex'),
    flags: z.string().max(10).optional().default('g')
  }),
  text: z.string()
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
    const group = String(request.body?.group || '').trim();
    const changed = reorderRegexRules(db, request.auth.user.id, orderedIds, { group });
    response.json({ ok: true, changed });
  });

  router.post('/test', requireAuth, validate(testRegexSchema), (request, response) => {
    const result = testRegexRule(request.body.rule, request.body.text);
    response.json(result);
  });

  router.post('/import', requireAuth, (request, response) => {
    const items = Array.isArray(request.body?.rules)
      ? request.body.rules
      : Array.isArray(request.body)
        ? request.body
        : [request.body].filter(Boolean);

    // Pre-validate and filter items outside the transaction
    const validItems = [];
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
      validItems.push(rule);
    }

    // Wrap all inserts in a single transaction for atomicity
    let imported = 0;
    if (validItems.length > 0) {
      try {
        withSavepoint(db, 'sp_import_regex', () => {
          const insert = db.prepare(
            `INSERT INTO regex_rules (
              id, user_id, character_id, label, pattern, replacement, flags, scope, enabled, order_index, group_name, priority, script_mode, js_script
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          );
          for (const rule of validItems) {
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
              rule.priority,
              rule.scriptMode ? 1 : 0,
              rule.jsScript || ''
            );
            imported += 1;
          }
        });
      } catch (error) {
        response.status(500).json({ error: '导入失败，已回滚所有变更', imported: 0, skipped });
        return;
      }
    }

    response.status(201).json({ imported, skipped });
  });

  return router;
}

function normalizeImportedRule(item = {}, index = 0) {
  const flags = normalizeRegexFlags(item.flags);
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
    enabled: normalizeBoolean(item.enabled, true),
    order: normalizeNonNegativeInteger(item.order ?? item.orderIndex, index),
    groupName: String(item.groupName || item.group_name || '全局').trim().slice(0, 50) || '全局',
    priority: normalizeNonNegativeInteger(item.priority, index),
    scriptMode: normalizeBoolean(item.scriptMode ?? item.script_mode),
    jsScript: String(item.jsScript || item.js_script || '').slice(0, 10000)
  };
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  return Math.max(0, Math.round(normalizeFiniteNumber(value, fallback)));
}
