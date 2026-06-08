import { newId, nowIso } from '../security.js';
import { parseJson } from '../utils/json.js';
import { parseStatusTemplateToken } from '../../../shared/statusTemplateTokens.js';

export const STATUS_BAR_VARIABLE_LIMIT = 60;

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
  const template = normalizeTemplate(payload.template);
  const variables = normalizeVariables(payload.variables, template);

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

  const textKey = normalizeVariableKey(text);

  for (const variable of currentVariables) {
    const nameKey = normalizeVariableKey(variable.name);
    if (!nameKey || seen.has(nameKey)) {
      continue;
    }

    // Fast pre-filter: skip regex matching entirely if the variable name
    // doesn't appear anywhere in the text. This avoids running several regex
    // patterns per variable on large texts.
    if (!textKey.includes(nameKey)) {
      continue;
    }

    const varName = variableNamePattern(variable.name);
    if (!varName) {
      continue;
    }
    // Patterns: "Name: value/max", "Name value/max", "Name: value", "Name value"
    // Also supports 【Name】value/max and [Name] value/max
    const patterns = [
      new RegExp(`[\\u3010\\[]${varName}[\\u3011\\]]\\s*(\\d+(?:\\.\\d+)?)\\s*(?:/\\s*(\\d+(?:\\.\\d+)?))?`, 'i'),
      new RegExp(`${varName}\\s*[:\\uFF1A]\\s*(\\d+(?:\\.\\d+)?)\\s*(?:/\\s*(\\d+(?:\\.\\d+)?))?`, 'i'),
      new RegExp(`(?:^|\\s)${varName}\\s+(\\d+(?:\\.\\d+)?)\\s*(?:/\\s*(\\d+(?:\\.\\d+)?))?(?=\\s|$|[,\\uFF0C.\\u3002\\n])`, 'im'),
      // 【Name】value/max or 【Name】value
      new RegExp(`【${varName}】\\s*(\\d+(?:\\.\\d+)?)\\s*(?:/\\s*(\\d+(?:\\.\\d+)?))?`, 'i'),
      // [Name] value/max or [Name] value
      new RegExp(`\\[${varName}\\]\\s*(\\d+(?:\\.\\d+)?)\\s*(?:/\\s*(\\d+(?:\\.\\d+)?))?`, 'i'),
      // Name: value/max or Name: value (with colon)
      new RegExp(`${varName}\\s*[:：]\\s*(\\d+(?:\\.\\d+)?)\\s*(?:/\\s*(\\d+(?:\\.\\d+)?))?`, 'i'),
      // Name value/max or Name value (space separated, word boundary)
      new RegExp(`(?:^|\\s)${varName}\\s+(\\d+(?:\\.\\d+)?)\\s*(?:/\\s*(\\d+(?:\\.\\d+)?))?(?=\\s|$|[，。,.\n])`, 'im')
    ];

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
          seen.add(nameKey);
          break;
        }
      }
    }

    if (!seen.has(nameKey) && isTextVariable(variable)) {
      for (const pattern of textValuePatternsSafe(varName, currentVariables, variable.name)) {
        const match = pattern.exec(text);
        const value = normalizeVariableValue(match?.[1], { emptyText: true });
        if (match && value !== '') {
          updates.push({
            name: variable.name,
            value
          });
          seen.add(nameKey);
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
    updateMap.set(normalizeVariableKey(update.name), update);
  }

  return variables.map((variable) => {
    const update = updateMap.get(normalizeVariableKey(variable.name));
    if (!update) {
      return variable;
    }
    return {
      ...variable,
      value: update.value,
      ...(hasExplicitMax(update) ? { max: Number(update.max) } : {})
    };
  });
}

// ── Helpers ──

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isTextVariable(variable) {
  return !Number.isFinite(Number(variable?.value)) || !hasExplicitMax(variable);
}

function textValuePatternsSafe(varName, variables = [], currentName = '') {
  const currentKey = normalizeVariableKey(currentName);
  const nextNames = variables
    .map((variable) => normalizeTemplateVariableName(variable?.name))
    .filter((name) => name && normalizeVariableKey(name) !== currentKey)
    .map((name) => variableNamePattern(name))
    .filter(Boolean);
  const stopBeforeNextLabel = nextNames.length
    ? `\\s*(?:${nextNames.join('|')})\\s*[:\\uFF1A]|`
    : '';
  const stop = `(?=${stopBeforeNextLabel}[\\n\\r,\\uFF0C;\\uFF1B.\\u3002]|$)`;
  return [
    new RegExp(`${varName}\\s*[:\\uFF1A]\\s*(.{1,120}?)${stop}`, 'i'),
    new RegExp(`[\\u3010\\[]${varName}[\\u3011\\]]\\s*(.{1,120}?)${stop}`, 'i')
  ];
}

function normalizeName(name) {
  const value = String(name || '').trim();
  if (!value) {
    return '状态栏';
  }
  return value.length > 50 ? value.slice(0, 50) : value;
}

function normalizeVariables(variables, template = '') {
  const sourceVariables = Array.isArray(variables) ? variables : [];
  const normalized = sourceVariables
    .map((v) => {
      const hasMax = hasExplicitMax(v);
      const value = normalizeVariableValue(v?.value, { emptyText: !hasMax });
      const max = hasMax
        ? Number(v.max)
        : typeof value === 'number'
          ? 100
          : undefined;
      return {
        name: String(v?.name || '').trim(),
        value,
        ...(max !== undefined ? { max } : {}),
        color: normalizeColor(v?.color)
      };
    })
    .filter((v) => v.name)
    .slice(0, STATUS_BAR_VARIABLE_LIMIT);
  return inferTemplateVariables(template, normalized).slice(0, STATUS_BAR_VARIABLE_LIMIT);
}

function normalizeVariableValue(value, options = {}) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const text = String(value ?? '').trim();
  if (!text) {
    return options.emptyText ? '' : 0;
  }
  const numeric = Number(text);
  if (Number.isFinite(numeric) && /^[-+]?(?:\d+|\d*\.\d+)$/.test(text)) {
    return numeric;
  }
  return text.length > 200 ? text.slice(0, 200) : text;
}

function normalizeColor(color) {
  const value = String(color || '').trim();
  // Allow 3-8 hex digits (including alpha channel) to match tags.js behavior
  if (/^#[0-9a-fA-F]{3,8}$/.test(value)) {
    return value;
  }
  return '';
}

function normalizeTemplate(template) {
  const value = String(template || '').trim();
  return value.length > 50000 ? value.slice(0, 50000) : value;
}

function inferTemplateVariables(template, variables = []) {
  const inferred = [...variables];
  const seen = collectVariableKeys(inferred);
  const raw = String(template || '');
  if (!raw) {
    return inferred;
  }

  for (const item of extractTemplateRowVariables(raw)) {
    const key = normalizeVariableKey(item.name);
    if (!seen.has(key)) {
      inferred.push(item);
      seen.add(key);
    }
  }

  const placeholderPattern = /\{\{\s*([^{}]+?)\s*\}\}|\{([\w\u4e00-\u9fa5 ._-]+)\}/g;
  let match;
  while ((match = placeholderPattern.exec(raw))) {
    const token = String(match[1] || match[2] || '').trim();
    const { rawName, rawProperty } = parseStatusTemplateToken(token);
    const name = normalizeTemplateVariableName(rawName);
    const key = normalizeVariableKey(name);
    if (!name || seen.has(key)) {
      continue;
    }
    inferred.push(isMeterTemplateProperty(rawProperty)
      ? { name: name.slice(0, 40), value: 0, max: 100, color: '' }
      : { name: name.slice(0, 40), value: '', color: '' });
    seen.add(key);
    if (inferred.length >= STATUS_BAR_VARIABLE_LIMIT) {
      break;
    }
  }

  return inferred;
}

function collectVariableKeys(variables = []) {
  const keys = new Set();
  for (const item of Array.isArray(variables) ? variables : []) {
    keys.add(normalizeVariableKey(item?.name));
  }
  return keys;
}

function extractTemplateRowVariables(template) {
  const rows = [];
  const seen = new Set();
  const addRow = (rawName, rawValue) => {
    const name = normalizeTemplateVariableName(rawName);
    const key = normalizeVariableKey(name);
    if (!name || !key || seen.has(key)) {
      return;
    }
    if (hasTemplatePlaceholder(rawValue)) {
      return;
    }
    const value = normalizeVariableValue(normalizeHtmlText(rawValue), { emptyText: true });
    rows.push({ name, value, color: '' });
    seen.add(key);
  };

  const pairPattern = /<[^>]+\bclass\s*=\s*(['"])[^'"]*\bsb-label\b[^'"]*\1[^>]*>([\s\S]*?)<\/[^>]+>[\s\S]{0,160}?<[^>]+\bclass\s*=\s*(['"])[^'"]*\bsb-val\b[^'"]*\3[^>]*>([\s\S]*?)<\/[^>]+>/gi;
  let match;
  while ((match = pairPattern.exec(template))) {
    addRow(match[2], match[4]);
  }

  const inlineValuePattern = /(?:^|>|\n)([^<>\n]{1,40}?)[\s:\uFF1A]+<[^>]+\bclass\s*=\s*(['"])[^'"]*\bsb-val\b[^'"]*\2[^>]*>([\s\S]*?)<\/[^>]+>/gi;
  while ((match = inlineValuePattern.exec(template))) {
    addRow(match[1], match[3]);
  }
  return rows;
}

function hasTemplatePlaceholder(value) {
  return /\{\{\s*[^{}]+?\s*\}\}|\{[\w\u4e00-\u9fa5 ._-]+\}/.test(String(value || ''));
}

function normalizeHtmlText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTemplateVariableName(value) {
  return normalizeHtmlText(value)
    .replace(/^[\s\u3000:\uFF1A;\uFF1B,\uFF0C.\u3002]+|[\s\u3000:\uFF1A;\uFF1B,\uFF0C.\u3002]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 40);
}

function normalizeVariableKey(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\s\u3000:\uFF1A;\uFF1B,\uFF0C.\u3002\u3001/\\|()[\]{}"'`~!@#$%^&*_+=?<>-]+/g, '')
    .trim()
    .toLowerCase();
}

function variableNamePattern(value) {
  const name = normalizeTemplateVariableName(value);
  return Array.from(name).map((char) => escapeRegex(char)).join('\\s*');
}

function hasExplicitMax(variable) {
  return String(variable?.max ?? '').trim() !== '' && Number.isFinite(Number(variable?.max));
}

function isMeterTemplateProperty(property = '') {
  return ['max', 'percent', 'percentage', 'color', 'display', 'displayValue'].includes(String(property || '').trim());
}

function toStatusBar(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    name: row.name,
    variables: normalizeVariables(parseJson(row.variables, []), row.template || ''),
    template: row.template || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
