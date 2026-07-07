import { newId, nowIso } from '../security.js';
import { parseJson } from '../utils/json.js';
import { normalizeStatusBarPayload } from './statusBars.js';

export function listStatusBarTemplates(database, userId) {
  return database
    .prepare(
      `SELECT id, name, variables, template, created_at, updated_at
       FROM status_bar_templates
       WHERE user_id = ?
       ORDER BY updated_at DESC, rowid DESC`
    )
    .all(userId)
    .map(toStatusBarTemplate);
}

export function createStatusBarTemplate(database, userId, payload = {}) {
  const id = newId();
  const timestamp = nowIso();
  const normalized = normalizeStatusBarPayload({
    name: payload.name || '状态栏模板',
    variables: payload.variables,
    template: payload.template
  });

  database
    .prepare(
      `INSERT INTO status_bar_templates (id, user_id, name, variables, template, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      userId,
      normalized.name,
      JSON.stringify(normalized.variables),
      normalized.template,
      timestamp,
      timestamp
    );

  return getStatusBarTemplate(database, userId, id);
}

export function getStatusBarTemplate(database, userId, templateId) {
  const row = database
    .prepare(
      `SELECT id, name, variables, template, created_at, updated_at
       FROM status_bar_templates
       WHERE id = ? AND user_id = ?`
    )
    .get(templateId, userId);
  return row ? toStatusBarTemplate(row) : null;
}

function toStatusBarTemplate(row) {
  return {
    id: row.id,
    name: row.name || '状态栏模板',
    variables: parseJson(row.variables, []),
    template: row.template || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
