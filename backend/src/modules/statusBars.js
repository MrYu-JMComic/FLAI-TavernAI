import { newId, nowIso } from '../security.js';

// ── Status Bar CRUD ──

export function getStatusBar(database, userId, conversationId) {
  const row = database
    .prepare(
      `SELECT status_bars.*
       FROM status_bars
       JOIN conversations ON conversations.id = status_bars.conversation_id
       WHERE status_bars.conversation_id = ? AND conversations.user_id = ?`
    )
    .get(conversationId, userId);
  return row ? toStatusBar(row) : null;
}

export function upsertStatusBar(database, userId, conversationId, payload) {
  // Verify conversation belongs to user
  const conversation = database
    .prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?')
    .get(conversationId, userId);
  if (!conversation) {
    return null;
  }

  const existing = database
    .prepare('SELECT id FROM status_bars WHERE conversation_id = ?')
    .get(conversationId);

  const timestamp = nowIso();
  const name = normalizeName(payload.name);
  const variables = normalizeVariables(payload.variables);
  const template = normalizeTemplate(payload.template);

  if (existing) {
    database
      .prepare(
        `UPDATE status_bars
         SET name = ?, variables = ?, template = ?, updated_at = ?
         WHERE conversation_id = ?`
      )
      .run(name, JSON.stringify(variables), template, timestamp, conversationId);
  } else {
    const id = newId();
    database
      .prepare(
        `INSERT INTO status_bars (id, conversation_id, name, variables, template, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, conversationId, name, JSON.stringify(variables), template, timestamp, timestamp);
  }

  return getStatusBar(database, userId, conversationId);
}

export function deleteStatusBar(database, userId, conversationId) {
  // Verify conversation belongs to user
  const conversation = database
    .prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?')
    .get(conversationId, userId);
  if (!conversation) {
    return false;
  }

  const result = database
    .prepare('DELETE FROM status_bars WHERE conversation_id = ?')
    .run(conversationId);
  return result.changes > 0;
}

// ── Variable Extraction ──

/**
 * Extract variable updates from AI reply text.
 * Matches patterns like:
 *   HP: 85/100, HP 85/100
 *   HP: 85, HP 85
 *   好感度: 75/100, 好感度 75
 *   【HP】85/100
 *   [HP] 85/100
 */
export function extractVariablesFromText(text, currentVariables = []) {
  if (!text || !Array.isArray(currentVariables) || currentVariables.length === 0) {
    return [];
  }

  const updates = [];
  const seen = new Set();

  for (const variable of currentVariables) {
    const varName = escapeRegex(variable.name);
    // Patterns: "Name: value/max", "Name value/max", "Name: value", "Name value"
    // Also supports 【Name】value/max and [Name] value/max
    const patterns = [
      // 【Name】value/max or 【Name】value
      new RegExp(`【${varName}】\\s*(\\d+(?:\\.\\d+)?)\\s*(?:/\\s*(\\d+(?:\\.\\d+)?))?`, 'i'),
      // [Name] value/max or [Name] value
      new RegExp(`\\[${varName}\\]\\s*(\\d+(?:\\.\\d+)?)\\s*(?:/\\s*(\\d+(?:\\.\\d+)?))?`, 'i'),
      // Name: value/max or Name: value (with colon)
      new RegExp(`${varName}\\s*[:：]\\s*(\\d+(?:\\.\\d+)?)\\s*(?:/\\s*(\\d+(?:\\.\\d+)?))?`, 'i'),
      // Name value/max or Name value (space separated, word boundary)
      new RegExp(`(?:^|\\s)${varName}\\s+(\\d+(?:\\.\\d+)?)\\s*(?:/\\s*(\\d+(?:\\.\\d+)?))?(?=\\s|$|[，。,.\n])`, 'im')
    ];

    if (seen.has(variable.name.toLowerCase())) {
      continue;
    }

    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (match) {
        const value = parseFloat(match[1]);
        const max = match[2] !== undefined ? parseFloat(match[2]) : undefined;
        if (!Number.isNaN(value)) {
          updates.push({
            name: variable.name,
            value,
            ...(max !== undefined && !Number.isNaN(max) ? { max } : {})
          });
          seen.add(variable.name.toLowerCase());
          break;
        }
      }
    }
  }

  return updates;
}

/**
 * Apply extracted variable updates to a variables array.
 * Returns a new array with updated values.
 */
export function applyVariableUpdates(variables, updates) {
  if (!Array.isArray(variables) || !Array.isArray(updates) || updates.length === 0) {
    return variables;
  }

  const updateMap = new Map();
  for (const update of updates) {
    updateMap.set(update.name.toLowerCase(), update);
  }

  return variables.map((variable) => {
    const update = updateMap.get(variable.name.toLowerCase());
    if (!update) {
      return variable;
    }
    return {
      ...variable,
      value: update.value,
      ...(update.max !== undefined ? { max: update.max } : {})
    };
  });
}

// ── Helpers ──

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeName(name) {
  const value = String(name || '').trim();
  if (!value) {
    return '状态栏';
  }
  return value.length > 50 ? value.slice(0, 50) : value;
}

function normalizeVariables(variables) {
  if (!Array.isArray(variables)) {
    return [];
  }
  return variables
    .map((v) => ({
      name: String(v?.name || '').trim(),
      value: Number.isFinite(Number(v?.value)) ? Number(v.value) : 0,
      max: Number.isFinite(Number(v?.max)) ? Number(v.max) : 100,
      color: normalizeColor(v?.color)
    }))
    .filter((v) => v.name)
    .slice(0, 20);
}

function normalizeColor(color) {
  const value = String(color || '').trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) {
    return value;
  }
  return '';
}

function normalizeTemplate(template) {
  const value = String(template || '').trim();
  return value.length > 5000 ? value.slice(0, 5000) : value;
}

function toStatusBar(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    name: row.name,
    variables: parseJson(row.variables, []),
    template: row.template || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || '');
  } catch {
    return fallback;
  }
}
