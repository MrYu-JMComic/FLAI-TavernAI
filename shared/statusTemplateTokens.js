// Shared status-template token grammar. Both the backend (variable inference,
// runtime agent hints) and the frontend (renderer, editors, validators) parse
// placeholders through here so they never disagree about what a token means.
//
//   {{HP}}                     variable value (single-brace {HP} also works)
//   {{HP.max}} {{HP.percent}}  variable property
//   {{HP | percent}}           filter pipeline (":"-separated args)
//   {{#if HP > 50}} … {{else}} … {{/if}}
//   {{#unless 事件}} … {{/unless}}
//   {{#each meters}} {{@name}} {{@percent}} {{/each}}   variables | meters | texts
//   {{#each 随身物品}} {{@value}} {{/each}}               items of a list variable
//   {{@name}}                  loop field (never a variable)

const BLOCK_KEYWORDS = new Set(['if', 'unless', 'each']);
const LOOP_COLLECTIONS = new Set(['variables', 'meters', 'texts']);
const METER_FILTERS = new Set(['max', 'percent', 'percentage', 'ratio', 'remaining', 'bar']);
const COMPARISON_PATTERN = /^(.*?)\s*(>=|<=|!=|==|>|<|=)\s*(.*)$/;

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
    loopField: ''
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
        result.rawName = splitProperty(body).rawName;
      }
      return result;
    }
    const condition = parseCondition(body);
    result.condition = condition;
    result.rawName = condition.left.rawName;
    result.rawProperty = condition.left.rawProperty;
    return result;
  }
  if (text[0] === '@') {
    result.kind = 'loop-field';
    result.loopField = text.slice(1).trim();
    return result;
  }

  const { subject, filters } = splitFilters(text);
  const parsed = splitProperty(subject);
  result.rawName = parsed.rawName;
  result.rawProperty = parsed.rawProperty;
  result.filters = filters;
  // A meter-style filter marks the variable as numeric for inference just like
  // the equivalent property suffix would.
  if (!result.rawProperty) {
    for (const filter of filters) {
      if (METER_FILTERS.has(filter.name)) {
        result.rawProperty = filter.name;
        break;
      }
    }
  }
  return result;
}

// Backwards-compatible view: only the variable reference. Control tokens and
// loop fields resolve to an empty name so inference ignores them.
export function parseStatusTemplateToken(token) {
  const parsed = parseStatusTemplateExpression(token);
  if (parsed.kind === 'variable' || parsed.kind === 'open') {
    return { rawName: parsed.rawName, rawProperty: parsed.rawProperty };
  }
  return { rawName: '', rawProperty: '' };
}

export function isStatusTemplateMeterProperty(property) {
  return METER_FILTERS.has(String(property || '').trim());
}

export function isStatusTemplateLoopCollection(source) {
  return LOOP_COLLECTIONS.has(String(source || '').trim().toLowerCase());
}

function splitProperty(subject) {
  const text = String(subject || '').trim();
  const separatorIndex = text.indexOf('.');
  if (separatorIndex < 0) {
    return { rawName: text, rawProperty: '' };
  }
  return {
    rawName: text.slice(0, separatorIndex).trim(),
    rawProperty: text.slice(separatorIndex + 1).trim()
  };
}

function splitFilters(text) {
  const segments = splitUnquoted(text, '|');
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

function parseCondition(body) {
  const text = String(body || '').trim();
  let negate = false;
  let expression = text;
  if (expression[0] === '!') {
    negate = true;
    expression = expression.slice(1).trim();
  }
  const match = COMPARISON_PATTERN.exec(expression);
  if (!match || !match[1].trim()) {
    return { negate, left: splitProperty(expression), operator: '', right: null };
  }
  const operator = match[2] === '=' ? '==' : match[2];
  return {
    negate,
    left: splitProperty(match[1]),
    operator,
    right: parseOperand(match[3])
  };
}

function parseOperand(text) {
  const raw = String(text || '').trim();
  if (!raw) {
    return { type: 'literal', value: '' };
  }
  if ((raw[0] === '"' && raw.at(-1) === '"') || (raw[0] === "'" && raw.at(-1) === "'")) {
    return { type: 'literal', value: raw.slice(1, -1) };
  }
  if (/^[-+]?(?:\d+|\d*\.\d+)$/.test(raw)) {
    return { type: 'literal', value: Number(raw) };
  }
  if (raw === 'true' || raw === 'false') {
    return { type: 'literal', value: raw === 'true' };
  }
  return { type: 'variable', ...splitProperty(raw) };
}

function splitUnquoted(text, separator) {
  const parts = [];
  let current = '';
  let quote = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      current += char;
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
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
  if (raw.length >= 2 && ((raw[0] === '"' && raw.at(-1) === '"') || (raw[0] === "'" && raw.at(-1) === "'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}
