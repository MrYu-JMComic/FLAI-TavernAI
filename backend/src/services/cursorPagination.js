import { createHash } from 'node:crypto';
import { AppError } from '../errors.js';

const CURSOR_VERSION = 1;
const MAX_CURSOR_LENGTH = 2048;
const MAX_CURSOR_VALUES = 4;

export function createCursorScope(namespace, context = {}) {
  const digest = createHash('sha256')
    .update(JSON.stringify(context))
    .digest('base64url')
    .slice(0, 16);
  return `${String(namespace || 'list').slice(0, 80)}:${digest}`;
}

export function encodeCursor(scope, values) {
  const normalizedValues = normalizeValues(values);
  return Buffer.from(JSON.stringify({ v: CURSOR_VERSION, s: scope, p: normalizedValues }), 'utf8')
    .toString('base64url');
}

export function decodeCursor(value, scope, options = {}) {
  if (!value) return null;
  try {
    const source = String(value);
    if (source.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(source)) {
      throw new Error('invalid encoding');
    }
    const parsed = JSON.parse(Buffer.from(source, 'base64url').toString('utf8'));
    const values = normalizeValues(parsed?.p);
    const expectedValues = Number(options.values || 0);
    if (
      parsed?.v !== CURSOR_VERSION
      || parsed?.s !== scope
      || (expectedValues && values.length !== expectedValues)
    ) {
      throw new Error('invalid payload');
    }
    return values;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, 'INVALID_CURSOR', '分页游标无效或已过期', { cause: error });
  }
}

export function normalizeCursorLimit(value, fallback = 50, max = 200) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(max, Math.max(1, Math.trunc(number)))
    : fallback;
}

function normalizeValues(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > MAX_CURSOR_VALUES) {
    throw new Error('invalid cursor values');
  }
  return values.map((value) => {
    if (typeof value === 'string' && value.length <= 1000) return value;
    if (Number.isSafeInteger(value)) return value;
    throw new Error('invalid cursor value');
  });
}
