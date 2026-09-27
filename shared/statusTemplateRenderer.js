import {
  collectStatusTokenReferences,
  isStatusTemplateLoopCollection,
  parseStatusTemplateExpression
} from './statusTemplateTokens.js';
import {
  collectStatusExpressionCalls,
  evaluateStatusExpression,
  formatStatusExpressionValue,
  formatStatusNumber,
  isStatusValueTruthy,
  splitStatusListItems,
  toStatusNumber
} from './statusTemplateExpression.js';

// Renders a status template against a variable resolver. Pure string work: no
// DOM, no HTML sanitising — callers escape values through the `escape` option
// and sanitise the produced markup afterwards.
//
// Supported syntax is documented in statusTemplateTokens.js and, for users and
// AI tool prompts, in statusTemplateSyntax.js. Collection loops run over
// `variables`, `meters`, `numbers`, `texts` or `lists`; looping over a named
// variable splits its text on , ， 、 ; ； | or newlines.
//
// options.resolveVariable(name) -> display variable or null
// options.listVariables()        -> display variables
// options.escape(text)           -> escaped text for every inserted value
// options.context                -> { user, char, now } for built-in values

const MAX_RENDER_DEPTH = 4;
const MAX_TEMPLATE_NODES = 4000;
const MAX_LIST_ITEMS = 60;
const FILTER_ARG_LIMIT = 4;
const MAX_REPEAT = 50;
// Single-brace tokens stay limited to plain names (optionally ".property") so
// CSS rules such as `.x{color:#fff}` inside <style> are never mistaken for one.
const TOKEN_SOURCE = String.raw`\{\{\s*([^{}]+?)\s*\}\}|\{(\s*[\w一-龥][\w一-龥 .-]*)\}`;
const NESTED_TOKEN_PATTERN = /\{\{|\{\s*[\w一-龥]/;
const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

// Every filter the renderer implements; shared/statusTemplateSyntax.js must
// document exactly this set (checked by a backend test).
export const STATUS_TEMPLATE_FILTER_NAMES = Object.freeze([
  'default', 'upper', 'lower', 'trim', 'prefix', 'suffix', 'truncate', 'slice', 'replace',
  'round', 'fixed', 'number', 'pad', 'abs', 'plus', 'minus', 'times', 'divide', 'clamp', 'sign',
  'max', 'min', 'percent', 'percentage', 'ratio', 'remaining', 'color', 'display', 'unit', 'name', 'type',
  'bar', 'stars', 'repeat', 'tier', 'map', 'if', 'join', 'first', 'last', 'count', 'json'
]);
const FILTER_SET = new Set(STATUS_TEMPLATE_FILTER_NAMES);
const VARIABLE_PROPERTY_FILTERS = new Set(['max', 'min', 'percent', 'percentage', 'ratio', 'remaining', 'color', 'display', 'name', 'type']);

export function renderStatusTemplate(template, options = {}) {
  const depth = Number.isFinite(Number(options.depth)) ? Number(options.depth) : 0;
  const text = String(template ?? '');
  if (!text || depth > MAX_RENDER_DEPTH) {
    return text;
  }
  const context = {
    resolveVariable: typeof options.resolveVariable === 'function' ? options.resolveVariable : () => null,
    listVariables: typeof options.listVariables === 'function' ? options.listVariables : () => [],
    escape: typeof options.escape === 'function' ? options.escape : (value) => String(value ?? ''),
    builtins: options.context && typeof options.context === 'object' ? options.context : {},
    depth,
    loop: null
  };
  return renderNodes(parseTemplate(text), context);
}

// Every variable reference the template makes, in document order, for
// inference and validation. Control tokens, loop fields and built-ins are
// skipped; conditions and expressions contribute every variable they name.
export function collectStatusTemplateReferences(template) {
  const references = [];
  const text = String(template ?? '');
  const pattern = tokenPattern();
  let match;
  while ((match = pattern.exec(text))) {
    const parsed = parseStatusTemplateExpression(match[1] ?? match[2]);
    const filters = parsed.kind === 'variable' ? parsed.filters : [];
    for (const reference of collectStatusTokenReferences(parsed)) {
      if (reference.rawName) {
        references.push({ rawName: reference.rawName, rawProperty: reference.rawProperty, filters });
      }
    }
  }
  return references;
}

// Structural check for editors: returns human-readable Chinese issues about
// unbalanced blocks, unknown control words, filters or helper functions and
// unparsable expressions, so authors get feedback before the runtime silently
// drops a broken block.
export function validateStatusTemplateSyntax(template) {
  const issues = [];
  const stack = [];
  const text = String(template ?? '');
  const pattern = tokenPattern();
  let match;
  let tokenCount = 0;
  while ((match = pattern.exec(text))) {
    tokenCount += 1;
    if (tokenCount > MAX_TEMPLATE_NODES) {
      issues.push(`模板占位符超过 ${MAX_TEMPLATE_NODES} 个，请精简。`);
      break;
    }
    const raw = String(match[1] ?? match[2]).trim();
    const parsed = parseStatusTemplateExpression(raw);
    if (parsed.kind === 'unknown') {
      issues.push(`不支持的控制标记 {{${raw}}}；只支持 #if、#unless、#each、else、else if 与对应的 /if、/unless、/each。`);
      continue;
    }
    for (const filter of parsed.filters) {
      if (!FILTER_SET.has(filter.name)) {
        issues.push(`未知过滤器“${filter.name}”（{{${raw}}}），它会被忽略。`);
      }
    }
    if (parsed.kind === 'expression' && parsed.error) {
      issues.push(`表达式 {{${raw}}} 无法解析：${parsed.error}。`);
      continue;
    }
    if (parsed.kind === 'open') {
      if (parsed.control === 'each' && !parsed.loopSource) {
        issues.push('{{#each}} 需要指定遍历对象，例如 {{#each meters}} 或 {{#each 随身物品}}。');
      }
      if ((parsed.control === 'if' || parsed.control === 'unless') && !parsed.condition?.ast) {
        issues.push(parsed.condition?.error && parsed.condition.source
          ? `{{#${parsed.control}}} 的条件无法解析：${parsed.condition.error}。`
          : `{{#${parsed.control}}} 缺少判断条件，例如 {{#if 体力 > 50}}。`);
      }
      stack.push(parsed.control);
      continue;
    }
    if (parsed.kind === 'else' || parsed.kind === 'else-if') {
      const current = stack[stack.length - 1];
      if (current !== 'if' && current !== 'unless') {
        issues.push(`{{${raw}}} 必须位于 {{#if}} 或 {{#unless}} 块内。`);
      } else if (parsed.kind === 'else-if' && !parsed.condition?.ast) {
        issues.push(`{{${raw}}} 的条件无法解析：${parsed.condition?.error || '缺少判断条件'}。`);
      }
      continue;
    }
    if (parsed.kind === 'close') {
      const expected = stack.pop();
      if (!expected) {
        issues.push(`多余的 {{/${parsed.control}}}，前面没有对应的开始块。`);
      } else if (expected !== parsed.control) {
        issues.push(`块闭合顺序不正确：{{#${expected}}} 需要用 {{/${expected}}} 关闭，但遇到了 {{/${parsed.control}}}。`);
      }
      continue;
    }
    if (parsed.kind === 'loop-field' && !stack.includes('each')) {
      issues.push(`{{@${parsed.loopField}}} 只能在 {{#each}} 块内使用。`);
    }
  }
  if (stack.length) {
    issues.push(`块未闭合：{{#${stack[stack.length - 1]}}} 缺少对应的结束标记。`);
  }
  return issues;
}

// Helper names used inside {{= …}} expressions and conditions; the expression
// parser already rejects unknown ones, so this is only used for statistics.
export function collectStatusTemplateFunctionCalls(template) {
  const calls = [];
  const text = String(template ?? '');
  const pattern = tokenPattern();
  let match;
  while ((match = pattern.exec(text))) {
    const parsed = parseStatusTemplateExpression(match[1] ?? match[2]);
    collectStatusExpressionCalls(parsed.expression || parsed.condition?.ast, calls);
  }
  return calls;
}

function tokenPattern() {
  return new RegExp(TOKEN_SOURCE, 'g');
}

function parseTemplate(text) {
  const root = [];
  const stack = [{ children: root }];
  const pattern = tokenPattern();
  let cursor = 0;
  let match;
  let nodeCount = 0;
  while ((match = pattern.exec(text))) {
    nodeCount += 1;
    if (nodeCount > MAX_TEMPLATE_NODES) {
      break;
    }
    if (match.index > cursor) {
      pushText(stack, text.slice(cursor, match.index));
    }
    cursor = match.index + match[0].length;
    const parsed = parseStatusTemplateExpression(match[1] ?? match[2]);
    const frame = stack[stack.length - 1];
    if (parsed.kind === 'open') {
      const block = parsed.control === 'each'
        ? { type: 'each', expression: parsed, children: [] }
        : { type: 'if', control: parsed.control, branches: [{ condition: parsed.condition, children: [] }], alternate: [] };
      frame.children.push(block);
      stack.push({ children: block.type === 'each' ? block.children : block.branches[0].children, block });
    } else if (parsed.kind === 'else-if') {
      if (frame.block?.type === 'if' && !frame.inAlternate) {
        const branch = { condition: parsed.condition, children: [] };
        frame.block.branches.push(branch);
        frame.children = branch.children;
      }
    } else if (parsed.kind === 'else') {
      if (frame.block?.type === 'if' && !frame.inAlternate) {
        frame.children = frame.block.alternate;
        frame.inAlternate = true;
      }
    } else if (parsed.kind === 'close') {
      const expectedType = parsed.control === 'each' ? 'each' : 'if';
      if (stack.length > 1 && frame.block?.type === expectedType
        && (expectedType === 'each' || frame.block.control === parsed.control)) {
        stack.pop();
      }
    } else if (parsed.kind !== 'unknown') {
      frame.children.push({ type: 'value', parsed });
    }
    // Unknown control words render as nothing.
  }
  if (cursor < text.length) {
    pushText(stack, text.slice(cursor));
  }
  return root;
}

function pushText(stack, value) {
  if (value) stack[stack.length - 1].children.push({ type: 'text', value });
}

function renderNodes(nodes, context) {
  let output = '';
  for (const node of nodes) {
    if (node.type === 'text') {
      output += node.value;
    } else if (node.type === 'value') {
      output += context.escape(renderValue(node.parsed, context));
    } else if (node.type === 'each') {
      output += renderEach(node, context);
    } else if (node.type === 'if') {
      output += renderIf(node, context);
    }
  }
  return output;
}

function renderIf(block, context) {
  for (let index = 0; index < block.branches.length; index += 1) {
    const branch = block.branches[index];
    let truthy = evaluateCondition(branch.condition, context);
    if (index === 0 && block.control === 'unless') truthy = !truthy;
    if (truthy) return renderNodes(branch.children, context);
  }
  return renderNodes(block.alternate, context);
}

function renderEach(block, context) {
  const source = String(block.expression.loopSource || '').trim();
  const items = isStatusTemplateLoopCollection(source)
    ? collectLoopVariables(source.toLowerCase(), context)
    : collectListItems(block.expression.rawName, context);
  let output = '';
  for (let index = 0; index < items.length; index += 1) {
    output += renderNodes(block.children, { ...context, loop: { variable: items[index], index, count: items.length } });
  }
  return output;
}

function collectLoopVariables(source, context) {
  const variables = context.listVariables();
  const items = [];
  for (const variable of Array.isArray(variables) ? variables : []) {
    if (!variable) continue;
    const kind = variableKind(variable);
    if (source === 'meters' && kind !== 'meter') continue;
    if (source === 'numbers' && kind !== 'number') continue;
    if (source === 'lists' && kind !== 'list') continue;
    if (source === 'texts' && kind === 'meter') continue;
    items.push(variable);
  }
  return items;
}

// A text variable such as "长剑、药水、地图" iterates as three items, each shaped
// like a text variable so every loop field keeps working.
function collectListItems(name, context) {
  const variable = name ? resolveReference(name, '', context).variable : null;
  if (!variable) return [];
  const items = [];
  for (const value of splitStatusListItems(readVariableProperty(variable, 'value', context))) {
    items.push({
      name: variable.name,
      value,
      displayValue: value,
      isMeter: false,
      kind: 'text',
      max: '',
      percentage: 0,
      color: variable.color,
      unit: variable.unit || ''
    });
    if (items.length >= MAX_LIST_ITEMS) break;
  }
  return items;
}

function renderValue(parsed, context) {
  let value = '';
  let variable = null;
  if (parsed.kind === 'variable') {
    const resolved = resolveReference(parsed.rawName, parsed.rawProperty, context);
    variable = resolved.variable;
    value = variable ? readVariableProperty(variable, resolved.property || 'value', context) : '';
  } else if (parsed.kind === 'expression') {
    value = parsed.expression ? evaluateStatusExpression(parsed.expression, expressionScope(context)) : '';
  } else if (parsed.kind === 'builtin') {
    value = readBuiltin(parsed.builtin, context);
  } else if (parsed.kind === 'loop-field') {
    value = readLoopField(parsed.loopField, context);
    variable = context.loop?.variable || null;
  }
  for (const filter of parsed.filters) {
    value = applyFilter(filter, value, variable, context);
  }
  return formatStatusExpressionValue(value);
}

// Exact (possibly dotted) name first; `{{角色.姓名}}` written before dotted
// names existed still reads the value of `角色`.
function resolveReference(rawName, rawProperty, context) {
  const name = String(rawName || '').trim();
  if (!name) return { variable: null, property: rawProperty };
  const variable = context.resolveVariable(name);
  if (variable) return { variable, property: rawProperty };
  const dot = name.indexOf('.');
  if (dot > 0) {
    const base = context.resolveVariable(name.slice(0, dot));
    if (base) return { variable: base, property: rawProperty || 'value' };
  }
  return { variable: null, property: rawProperty };
}

function expressionScope(context) {
  return {
    reference: (rawName, rawProperty) => {
      const resolved = resolveReference(rawName, rawProperty, context);
      return resolved.variable ? readVariableProperty(resolved.variable, resolved.property || 'value', context) : '';
    },
    loopField: (field) => readLoopField(field, context),
    builtin: (name) => readBuiltin(name, context)
  };
}

function readLoopField(field, context) {
  const loop = context.loop;
  if (!loop) return '';
  const name = String(field || '').toLowerCase();
  if (name === 'index') return loop.index + 1;
  if (name === 'index0') return loop.index;
  if (name === 'first') return loop.index === 0;
  if (name === 'last') return loop.index === loop.count - 1;
  if (name === 'total') return loop.count;
  if (name === 'name') return String(loop.variable?.name ?? '');
  return readVariableProperty(loop.variable, name, context);
}

function readBuiltin(name, context) {
  const builtins = context.builtins || {};
  if (name === 'user') return String(builtins.user ?? '');
  if (name === 'char') return String(builtins.char ?? '');
  const now = builtins.now instanceof Date ? builtins.now : new Date(Number.isFinite(builtins.now) ? builtins.now : Date.now());
  const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const time = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  if (name === 'date') return date;
  if (name === 'time') return time;
  if (name === 'weekday') return WEEKDAYS[now.getDay()];
  if (name === 'datetime') return `${date} ${time}`;
  return '';
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function variableKind(variable) {
  if (!variable) return 'text';
  if (variable.kind) return variable.kind;
  if (variable.isMeter) return 'meter';
  return typeof variable.value === 'number' ? 'number' : 'text';
}

function readVariableProperty(variable, property, context) {
  const key = String(property || 'value').trim().toLowerCase();
  if (!variable) return '';
  const isMeter = Boolean(variable.isMeter);
  const percentage = Number(variable.percentage) || 0;
  switch (key) {
    case 'max': return isMeter ? variable.max : '';
    case 'min': return isMeter ? (toStatusNumber(variable.min) ?? 0) : '';
    case 'percent': return isMeter ? `${Math.round(percentage)}%` : '';
    case 'percentage':
    case 'ratio': return isMeter ? Math.round(percentage) : '';
    case 'remaining': return isMeter ? formatStatusNumber(Number(variable.max) - Number(variable.value)) : '';
    case 'bar': return isMeter ? textBar(percentage, 10) : '';
    case 'color': return variable.color ?? '';
    case 'name': return variable.name ?? '';
    case 'unit': return variable.unit ?? '';
    case 'type': return variableKind(variable);
    case 'count': return listItems(variable, context).length;
    case 'first': return listItems(variable, context)[0] ?? '';
    case 'last': return listItems(variable, context).at(-1) ?? '';
    case 'display':
    case 'displayvalue': return resolveNested(variable.displayValue, context);
    default:
      return typeof variable.value === 'number' ? variable.value : resolveNested(variable.value, context);
  }
}

function listItems(variable, context) {
  if (Array.isArray(variable.items)) return variable.items;
  return splitStatusListItems(resolveNested(variable.value, context));
}

// Variable values may themselves contain placeholders; resolve them one level
// deeper with the same context so the depth guard still applies.
function resolveNested(value, context) {
  const text = String(value ?? '');
  if (!NESTED_TOKEN_PATTERN.test(text)) {
    return text;
  }
  return renderStatusTemplate(text, {
    resolveVariable: context.resolveVariable,
    listVariables: context.listVariables,
    context: context.builtins,
    depth: context.depth + 1
  });
}

function applyFilter(filter, value, variable, context) {
  const args = filter.args.slice(0, FILTER_ARG_LIMIT);
  const text = formatStatusExpressionValue(value);
  const numeric = toStatusNumber(value);
  switch (filter.name) {
    case 'upper':
      return text.toUpperCase();
    case 'lower':
      return text.toLowerCase();
    case 'trim':
      return text.trim();
    case 'default':
      return text.trim() ? value : String(args[0] ?? '');
    case 'prefix':
      return text ? `${args[0] ?? ''}${text}` : text;
    case 'suffix':
      return text ? `${text}${args[0] ?? ''}` : text;
    case 'truncate': {
      const limit = Math.max(1, Math.floor(Number(args[0]) || 24));
      const chars = [...text];
      return chars.length > limit ? `${chars.slice(0, limit).join('')}…` : text;
    }
    case 'slice': {
      const chars = [...text];
      const start = Math.floor(Number(args[0]) || 0);
      const end = args[1] === undefined || args[1] === '' ? undefined : Math.floor(Number(args[1]) || 0);
      return chars.slice(start, end).join('');
    }
    case 'replace':
      return args.length >= 2 ? text.split(String(args[0])).join(String(args[1])) : text;
    case 'round': {
      const digits = clampDigits(args[0]);
      return numeric === null ? text : Number(numeric.toFixed(digits));
    }
    case 'fixed':
      return numeric === null ? text : numeric.toFixed(clampDigits(args[0], 2));
    case 'number':
      return numeric === null ? text : groupThousands(numeric, args[0]);
    case 'pad': {
      const width = Math.max(0, Math.min(12, Math.floor(Number(args[0]) || 0)));
      return text.padStart(width, String(args[1] ?? '0').slice(0, 1) || '0');
    }
    case 'abs':
      return numeric === null ? text : Math.abs(numeric);
    case 'plus':
    case 'minus':
    case 'times':
    case 'divide': {
      const operand = toStatusNumber(args[0]);
      if (numeric === null || operand === null) return text;
      if (filter.name === 'plus') return numeric + operand;
      if (filter.name === 'minus') return numeric - operand;
      if (filter.name === 'times') return numeric * operand;
      return operand === 0 ? text : numeric / operand;
    }
    case 'clamp': {
      if (numeric === null) return text;
      const low = toStatusNumber(args[0]);
      const high = toStatusNumber(args[1]);
      return Math.min(high ?? numeric, Math.max(low ?? numeric, numeric));
    }
    case 'sign':
      return numeric === null ? text : numeric > 0 ? `+${formatStatusNumber(numeric)}` : formatStatusNumber(numeric);
    case 'max':
    case 'min':
    case 'percent':
    case 'percentage':
    case 'ratio':
    case 'remaining':
    case 'color':
    case 'display':
    case 'name':
    case 'type':
      return VARIABLE_PROPERTY_FILTERS.has(filter.name) ? readVariableProperty(variable, filter.name, context) : text;
    case 'unit': {
      const unit = String(args[0] ?? variable?.unit ?? '').trim();
      if (!text || !unit) return text;
      return /^[A-Za-z]/.test(unit) ? `${text} ${unit}` : `${text}${unit}`;
    }
    case 'bar': {
      const width = Math.max(1, Math.min(40, Math.floor(Number(args[0]) || 10)));
      if (variable?.isMeter && value === variable.value) return textBar(variable.percentage, width, args[1], args[2]);
      return numeric === null ? '' : textBar(numeric, width, args[1], args[2]);
    }
    case 'stars': {
      const count = Math.max(1, Math.min(10, Math.floor(Number(args[0]) || 5)));
      const ratio = variable?.isMeter && value === variable.value
        ? (Number(variable.percentage) || 0) / 100
        : numeric === null ? 0 : numeric / count;
      const filled = Math.max(0, Math.min(count, Math.round(ratio * count)));
      const full = firstChar(args[1], '★');
      const empty = firstChar(args[2], '☆');
      return full.repeat(filled) + empty.repeat(count - filled);
    }
    case 'repeat': {
      if (numeric === null) return '';
      const times = Math.max(0, Math.min(Math.floor(Number(args[1]) || MAX_REPEAT), MAX_REPEAT, Math.round(numeric)));
      return String(args[0] ?? '●').slice(0, 4).repeat(times);
    }
    case 'tier': {
      const labels = splitStatusListItems(String(args[0] ?? '低,中,高').replace(/\|/g, ','));
      if (!labels.length) return text;
      const percent = variable?.isMeter && value === variable.value ? Number(variable.percentage) || 0 : numeric;
      if (percent === null) return text;
      const index = Math.min(labels.length - 1, Math.max(0, Math.floor((percent / 100) * labels.length)));
      return labels[index];
    }
    case 'map':
      return mapValue(text, args[0]);
    case 'if':
      return isStatusValueTruthy(value) ? String(args[0] ?? '是') : String(args[1] ?? '否');
    case 'join':
      return splitStatusListItems(value).join(args.length ? String(args[0]) : '、');
    case 'first':
      return splitStatusListItems(value)[0] ?? '';
    case 'last':
      return splitStatusListItems(value).at(-1) ?? '';
    case 'count':
      return splitStatusListItems(value).length;
    case 'json':
      try {
        return JSON.stringify(value);
      } catch {
        return text;
      }
    default:
      return value;
  }
}

function clampDigits(value, fallback = 0) {
  const digits = Math.floor(Number(value));
  return Math.max(0, Math.min(6, Number.isFinite(digits) ? digits : fallback));
}

function groupThousands(value, digitsArg) {
  const digits = digitsArg === undefined || digitsArg === '' ? null : clampDigits(digitsArg);
  const fixed = digits === null ? formatStatusNumber(value) : value.toFixed(digits);
  const [integer, fraction] = fixed.split('.');
  const sign = integer.startsWith('-') ? '-' : '';
  const grouped = integer.replace('-', '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${grouped}${fraction ? `.${fraction}` : ''}`;
}

// "a=甲;b=乙;*=其他" (also "a:甲,b:乙"): exact text match, `*` as fallback.
function mapValue(text, spec) {
  const key = String(text ?? '').trim();
  let fallback = null;
  for (const pair of String(spec ?? '').split(/[;；,，]/)) {
    const separator = pair.search(/[=：:]/);
    if (separator < 0) continue;
    const from = pair.slice(0, separator).trim();
    const to = pair.slice(separator + 1).trim();
    if (from === '*') {
      fallback = to;
      continue;
    }
    if (from === key) return to;
  }
  return fallback ?? key;
}

function firstChar(value, fallback) {
  const chars = [...String(value ?? '')];
  return chars[0] || fallback;
}

function textBar(percentage, width, filled = '█', empty = '░') {
  const ratio = Math.max(0, Math.min(100, Number(percentage) || 0)) / 100;
  const fill = Math.round(ratio * width);
  return firstChar(filled, '█').repeat(fill) + firstChar(empty, '░').repeat(Math.max(0, width - fill));
}

function evaluateCondition(condition, context) {
  if (!condition?.ast) return false;
  return isStatusValueTruthy(evaluateStatusExpression(condition.ast, expressionScope(context)));
}
