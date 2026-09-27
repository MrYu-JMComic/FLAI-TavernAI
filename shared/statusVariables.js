import {
  formatStatusNumber,
  splitStatusListItems,
  toStatusNumber
} from './statusTemplateExpression.js';

// Status variable model shared by the backend normalisers, the editors and the
// renderer. The stored shape is the legacy { name, value, max, color } plus
// optional fields:
//
//   type  'meter'  numeric value with a bar between min and max (default)
//         'number' numeric counter without a bar, e.g. 金币 1250
//         'text'   free text
//         'list'   items separated by 、 , ; | or newlines, shown as chips
//   min   lower bound of a meter (default 0), e.g. 好感 -100 … 100
//   unit  short suffix shown after numbers, e.g. "G" "kg" "%" "点"
//
// Without `type`, a numeric value with a max is a meter and anything else is
// text, exactly as before these fields existed.

export const STATUS_VARIABLE_LIMIT = 60;
export const STATUS_VARIABLE_NAME_LIMIT = 40;
export const STATUS_VARIABLE_TEXT_LIMIT = 200;
export const STATUS_VARIABLE_UNIT_LIMIT = 12;
export const STATUS_VARIABLE_TYPES = Object.freeze(['meter', 'number', 'text', 'list']);
export const STATUS_VARIABLE_TYPE_LABELS = Object.freeze({
  meter: '数值条',
  number: '计数',
  text: '文本',
  list: '列表'
});

const TYPE_SET = new Set(STATUS_VARIABLE_TYPES);

export function normalizeStatusVariableType(value) {
  const type = String(value ?? '').trim().toLowerCase();
  return TYPE_SET.has(type) ? type : '';
}

// Only keys that carry information are returned, so stored JSON stays compact
// and variables without the new fields round-trip unchanged.
export function normalizeStatusVariableExtras(variable = {}) {
  const source = variable && typeof variable === 'object' ? variable : {};
  const extras = {};
  const type = normalizeStatusVariableType(source.type);
  if (type) extras.type = type;
  const min = toStatusNumber(source.min);
  const max = toStatusNumber(source.max);
  if (min !== null && min !== 0 && (max === null || min < max)) extras.min = min;
  const unit = String(source.unit ?? '').replace(/\s+/g, ' ').trim().slice(0, STATUS_VARIABLE_UNIT_LIMIT);
  if (unit) extras.unit = unit;
  return extras;
}

// Numbers stay numbers for meters and counters; text and list variables keep
// their text even when it looks numeric ("007", "1、2").
export function normalizeStatusVariableValueForType(value, type = '', options = {}) {
  const kind = normalizeStatusVariableType(type);
  if (kind === 'text' || kind === 'list') {
    const text = Array.isArray(value) ? value.join('、') : String(value ?? '').trim();
    return text.slice(0, STATUS_VARIABLE_TEXT_LIMIT);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const text = String(value ?? '').trim();
  if (!text) {
    return options.emptyText && kind !== 'meter' && kind !== 'number' ? '' : 0;
  }
  const numeric = Number(text);
  if (Number.isFinite(numeric) && /^[-+]?(?:\d+|\d*\.\d+)$/.test(text)) {
    return numeric;
  }
  if (kind === 'meter' || kind === 'number') {
    return 0;
  }
  return text.slice(0, STATUS_VARIABLE_TEXT_LIMIT);
}

// The kind a variable renders as. Explicit types win; otherwise the legacy
// rule applies (numeric value + positive max → meter).
export function resolveStatusVariableKind(variable = {}) {
  const type = normalizeStatusVariableType(variable?.type);
  const numeric = toStatusNumber(variable?.value);
  if (type === 'text' || type === 'list') return type;
  if (type === 'number') return numeric === null ? 'text' : 'number';
  if (type === 'meter') return numeric === null ? 'text' : 'meter';
  const max = toStatusNumber(variable?.max);
  const min = toStatusNumber(variable?.min) ?? 0;
  if (numeric !== null && max !== null && max > min) return 'meter';
  if (numeric !== null && typeof variable?.value === 'number') return 'number';
  return 'text';
}

export function formatStatusUnit(text, unit) {
  const value = String(text ?? '');
  const suffix = String(unit ?? '').trim();
  if (!value || !suffix) return value;
  return /^[A-Za-z]/.test(suffix) ? `${value} ${suffix}` : `${value}${suffix}`;
}

// Everything the renderer, the built-in view and scripts read about one
// variable. `value` is a number for meters and counters, text otherwise.
export function buildStatusDisplayVariable(variable = {}, fallbackColor = '') {
  const source = variable && typeof variable === 'object' ? variable : {};
  const kind = resolveStatusVariableKind(source);
  const unit = String(source.unit ?? '').trim().slice(0, STATUS_VARIABLE_UNIT_LIMIT);
  const color = String(source.color || '').trim() || fallbackColor;
  const name = String(source.name || '').trim() || '?';
  if (kind === 'meter' || kind === 'number') {
    const value = toStatusNumber(source.value) ?? 0;
    if (kind === 'number') {
      return {
        name, kind, type: kind, value, min: '', max: '', unit, color,
        isMeter: false, percentage: 0, items: [],
        displayValue: formatStatusUnit(formatStatusNumber(value), unit)
      };
    }
    const min = toStatusNumber(source.min) ?? 0;
    const rawMax = toStatusNumber(source.max);
    const max = rawMax !== null && rawMax > min ? rawMax : Math.max(min + 1, 100);
    const percentage = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
    return {
      name, kind, type: kind, value, min, max, unit, color,
      isMeter: true, percentage, items: [],
      displayValue: formatStatusUnit(`${formatStatusNumber(value)}/${formatStatusNumber(max)}`, unit)
    };
  }
  const text = String(source.value ?? '').trim();
  const items = kind === 'list' ? splitStatusListItems(text) : [];
  return {
    name, kind, type: kind, value: text, min: '', max: '', unit, color,
    isMeter: false, percentage: 0, items,
    displayValue: kind === 'list' ? (items.join('、') || '—') : (text || '—')
  };
}

// Matching key used by every variable lookup: punctuation, spaces and case do
// not distinguish two variables.
export function normalizeStatusVariableKey(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\s　:：;；,，.。、/\\|()[\]{}"'`~!@#$%^&*_+=?<>-]+/g, '')
    .trim()
    .toLowerCase();
}

// Next value for the declarative `adjust` / `cycle` actions and for scripts,
// clamped to the meter range.
export function adjustStatusVariableValue(variable = {}, delta = 0) {
  const kind = resolveStatusVariableKind(variable);
  const current = toStatusNumber(variable?.value) ?? 0;
  const step = toStatusNumber(delta) ?? 0;
  let next = current + step;
  if (kind === 'meter') {
    const min = toStatusNumber(variable?.min) ?? 0;
    const max = toStatusNumber(variable?.max);
    if (max !== null && max > min) next = Math.min(max, next);
    next = Math.max(min, next);
  }
  return Number(next.toFixed(4));
}

// Options keep placeholder words such as "无" or "否": they are real choices.
export function cycleStatusVariableValue(variable = {}, options = []) {
  const source = Array.isArray(options) ? options.join('|') : String(options ?? '');
  const choices = [];
  for (const part of source.split(/[|,，、;；]/)) {
    const choice = part.trim();
    if (choice && !choices.includes(choice)) choices.push(choice);
  }
  if (!choices.length) return variable?.value ?? '';
  const current = String(variable?.value ?? '').trim();
  const index = choices.indexOf(current);
  return choices[(index + 1) % choices.length];
}
