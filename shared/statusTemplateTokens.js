import {
  collectStatusExpressionReferences,
  isStatusTemplateBuiltin,
  parseStatusExpression,
  splitStatusReference
} from './statusTemplateExpression.js';

// Shared status-template token grammar. Both the backend (variable inference,
// runtime agent hints) and the frontend (renderer, editors, validators) parse
// placeholders through here so they never disagree about what a token means.
// The user-facing reference lives in shared/statusTemplateSyntax.js.
//
//   {{HP}}  {HP}  {{getvar::HP}}   variable value
//   {{HP.max}} {{HP.percent}}      variable property (only when the last
//                                  segment is a known property, so dotted
//                                  names such as {{角色A.好感}} stay whole)
//   {{HP | percent | suffix:"%"}}  filter pipeline (":"-separated args)
//   {{= HP * 2 + 1}}               safe expression (statusTemplateExpression.js)
//   {{user}} {{char}} {{date}}     built-in context values, never variables
//   {{#if HP > 50 && 心情 == "好"}} … {{else if HP > 20}} … {{else}} … {{/if}}
//   {{#unless 事件}} … {{/unless}}
//   {{#each meters}} {{@name}} {{@percent}} {{/each}}
//   {{#each 随身物品}} {{@value}}{{#unless @last}}、{{/unless}} {{/each}}

const BLOCK_KEYWORDS = new Set(['if', 'unless', 'each']);
export const STATUS_TEMPLATE_LOOP_COLLECTIONS = Object.freeze(['variables', 'meters', 'numbers', 'texts', 'lists']);
const LOOP_COLLECTIONS = new Set(STATUS_TEMPLATE_LOOP_COLLECTIONS);
// Properties / filters that only make sense for a numeric meter; referencing
// one marks the variable as a meter during inference.
const METER_FILTERS = new Set(['max', 'min', 'percent', 'percentage', 'ratio', 'remaining', 'bar', 'stars']);
const QUOTE_PAIRS = new Map([['"', '"'], ["'", "'"], ['“', '”'], ['‘', '’'], ['「', '」']]);
const GETVAR_PREFIX = /^(?:getvar|getglobalvar)::/i;
const LEGACY_COMPARISON = /^(.*?)\s*(>=|<=|!=|==|>|<|=)\s*(.*)$/;

export function parseStatusTemplateExpression(token) {
  const text = String(token || '').trim();
  const result = {
    kind: 'variable',
    rawName: '',
    rawProperty: '',
    filters: [],
    control: '',
    condition: null,
    loopSource: '',
    loopField: '',
    expression: null,
    builtin: '',
    // Meter-style filter on a plain variable ({{HP | percent}}): an inference
    // hint only, the rendered property stays rawProperty.
    meterHint: '',
    error: ''
  };
  if (!text) {
    return result;
  }

  if (text[0] === '/') {
    const keyword = text.slice(1).trim().toLowerCase();
    result.kind = BLOCK_KEYWORDS.has(keyword) ? 'close' : 'unknown';
    result.control = keyword;
    return result;
  }
  if (text.toLowerCase() === 'else') {
    result.kind = 'else';
    result.control = 'else';
    return result;
  }
  const elseIf = /^else\s*if(?:\s+|(?=\())([\s\S]*)$/i.exec(text);
  if (elseIf) {
    result.kind = 'else-if';
    result.control = 'else';
    result.condition = parseCondition(elseIf[1]);
    assignFirstReference(result, conditionReferences(result.condition));
    return result;
  }
  if (text[0] === '#') {
    const spaceIndex = text.search(/\s/);
    const keyword = (spaceIndex < 0 ? text.slice(1) : text.slice(1, spaceIndex)).trim().toLowerCase();
    const body = spaceIndex < 0 ? '' : text.slice(spaceIndex + 1).trim();
    result.control = keyword;
    if (!BLOCK_KEYWORDS.has(keyword)) {
      result.kind = 'unknown';
      return result;
    }
    result.kind = 'open';
    if (keyword === 'each') {
      result.loopSource = body;
      // Iterating a named variable counts as a reference to it, so inference
      // creates the list variable just like {{随身物品}} would.
      if (body && !isStatusTemplateLoopCollection(body)) {
        result.rawName = splitStatusReference(body.replace(GETVAR_PREFIX, '')).rawName;
      }
      return result;
    }
    result.condition = parseCondition(body);
    assignFirstReference(result, conditionReferences(result.condition));
    return result;
  }

  const { subject, filters } = splitFilters(text);
  result.filters = filters;

  if (subject[0] === '=') {
    result.kind = 'expression';
    const parsed = parseStatusExpression(subject.slice(1));
    if (parsed.ok) {
      result.expression = parsed.ast;
      assignFirstReference(result, collectStatusExpressionReferences(parsed.ast));
    } else {
      result.error = parsed.error;
    }
    return result;
  }
  if (subject[0] === '@') {
    result.kind = 'loop-field';
    result.loopField = subject.slice(1).trim();
    return result;
  }
  const name = subject.replace(GETVAR_PREFIX, '').trim();
  if (isStatusTemplateBuiltin(name)) {
    result.kind = 'builtin';
    result.builtin = name.toLowerCase();
    return result;
  }
  const parsed = splitStatusReference(name);
  result.rawName = parsed.rawName;
  result.rawProperty = parsed.rawProperty;
  // A meter-style filter marks the variable as numeric for inference just like
  // the equivalent property suffix would.
  if (!result.rawProperty) {
    for (const filter of filters) {
      if (METER_FILTERS.has(filter.name)) {
        result.meterHint = filter.name;
        break;
      }
    }
  }
  return result;
}

// Backwards-compatible view: the first variable the token refers to. Control
// tokens, loop fields and built-ins resolve to an empty name so inference
// ignores them.
export function parseStatusTemplateToken(token) {
  const parsed = parseStatusTemplateExpression(token);
  if (['variable', 'open', 'else-if', 'expression'].includes(parsed.kind)) {
    return { rawName: parsed.rawName, rawProperty: parsed.rawProperty || parsed.meterHint };
  }
  return { rawName: '', rawProperty: '' };
}

// Every variable a parsed token refers to (conditions and expressions can name
// several), in document order.
export function collectStatusTokenReferences(parsed) {
  if (!parsed) return [];
  if (parsed.kind === 'variable') {
    return parsed.rawName ? [{ rawName: parsed.rawName, rawProperty: parsed.rawProperty || parsed.meterHint }] : [];
  }
  if (parsed.kind === 'expression') {
    return collectStatusExpressionReferences(parsed.expression);
  }
  if (parsed.kind === 'open' && parsed.control === 'each') {
    return parsed.rawName ? [{ rawName: parsed.rawName, rawProperty: '' }] : [];
  }
  if (parsed.kind === 'open' || parsed.kind === 'else-if') {
    return conditionReferences(parsed.condition);
  }
  return [];
}

export function isStatusTemplateMeterProperty(property) {
  return METER_FILTERS.has(String(property || '').trim().toLowerCase());
}

export function isStatusTemplateLoopCollection(source) {
  return LOOP_COLLECTIONS.has(String(source || '').trim().toLowerCase());
}

function assignFirstReference(result, references) {
  const first = references.find((item) => item.rawName);
  if (first) {
    result.rawName = first.rawName;
    result.rawProperty = first.rawProperty;
  }
}

function conditionReferences(condition) {
  return condition?.ast ? collectStatusExpressionReferences(condition.ast) : [];
}

// Conditions use the expression language; the old single-comparison grammar
// (which allowed spaces inside names) stays as a fallback.
function parseCondition(body) {
  const source = String(body || '').trim();
  if (!source) {
    return { ast: null, source, error: '缺少判断条件' };
  }
  const parsed = parseStatusExpression(source);
  if (parsed.ok) {
    return { ast: parsed.ast, source, error: '' };
  }
  const legacy = parseLegacyCondition(source);
  return legacy
    ? { ast: legacy, source, error: '' }
    : { ast: null, source, error: parsed.error };
}

function parseLegacyCondition(text) {
  let expression = text;
  let negate = false;
  if (expression[0] === '!') {
    negate = true;
    expression = expression.slice(1).trim();
  }
  const match = LEGACY_COMPARISON.exec(expression);
  let ast;
  if (!match || !match[1].trim()) {
    const reference = splitStatusReference(expression);
    if (!reference.rawName || /["'“”‘’()]/.test(reference.rawName)) return null;
    ast = { type: 'ref', ...reference };
  } else {
    const left = splitStatusReference(match[1]);
    if (!left.rawName) return null;
    ast = {
      type: 'binary',
      operator: match[2] === '=' ? '==' : match[2],
      left: { type: 'ref', ...left },
      right: parseLegacyOperand(match[3])
    };
  }
  return negate ? { type: 'unary', operator: '!', argument: ast } : ast;
}

function parseLegacyOperand(text) {
  const raw = String(text || '').trim();
  if (!raw) return { type: 'literal', value: '' };
  const quoted = unquote(raw);
  if (quoted !== raw) return { type: 'literal', value: quoted };
  if (/^[-+]?(?:\d+|\d*\.\d+)$/.test(raw)) return { type: 'literal', value: Number(raw) };
  if (raw === 'true' || raw === 'false') return { type: 'literal', value: raw === 'true' };
  return { type: 'ref', ...splitStatusReference(raw) };
}

// Filters are separated by a single "|"; "||" belongs to the expression.
function splitFilters(text) {
  const segments = splitFilterSegments(text);
  const subject = segments.shift() || '';
  const filters = [];
  for (const segment of segments) {
    const parts = splitUnquoted(segment, ':');
    const name = String(parts.shift() || '').trim().toLowerCase();
    if (!name) continue;
    const args = [];
    for (const part of parts) {
      args.push(unquote(part));
    }
    filters.push({ name, args });
  }
  return { subject: subject.trim(), filters };
}

function splitFilterSegments(text) {
  const parts = [];
  let current = '';
  let closing = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (closing) {
      current += char;
      if (char === closing) closing = '';
      continue;
    }
    if (QUOTE_PAIRS.has(char)) {
      closing = QUOTE_PAIRS.get(char);
      current += char;
      continue;
    }
    if (char === '|') {
      if (text[index + 1] === '|') {
        current += '||';
        index += 1;
        continue;
      }
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

function splitUnquoted(text, separator) {
  const parts = [];
  let current = '';
  let closing = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (closing) {
      current += char;
      if (char === closing) closing = '';
      continue;
    }
    if (QUOTE_PAIRS.has(char)) {
      closing = QUOTE_PAIRS.get(char);
      current += char;
      continue;
    }
    if (char === separator) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

function unquote(text) {
  const raw = String(text || '').trim();
  if (raw.length >= 2 && QUOTE_PAIRS.get(raw[0]) === raw.at(-1)) {
    return raw.slice(1, -1);
  }
  return raw;
}
