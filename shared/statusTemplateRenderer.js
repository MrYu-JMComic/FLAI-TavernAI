import { isStatusTemplateLoopCollection, parseStatusTemplateExpression } from './statusTemplateTokens.js';

// Renders a status template against a variable resolver. Pure string work: no
// DOM, no HTML sanitising — callers escape values through the `escape` option
// and sanitise the produced markup afterwards.
//
// Supported syntax is documented in statusTemplateTokens.js. Collection loops
// run over `variables` (all), `meters` (numeric) or `texts`; loop fields are
// {{@name}} {{@value}} {{@max}} {{@percent}} {{@color}} {{@display}} {{@index}}.
// Looping over a named variable splits its text on , ， 、 ; ； | or newlines.

const MAX_RENDER_DEPTH = 4;
const MAX_TEMPLATE_NODES = 4000;
const MAX_LIST_ITEMS = 60;
const FILTER_ARG_LIMIT = 4;
const LIST_SEPARATOR = /[,，、;；|\n]+/;
// Single-brace tokens stay limited to plain names (optionally ".property") so
// CSS rules such as `.x{color:#fff}` inside <style> are never mistaken for one.
const TOKEN_SOURCE = String.raw`\{\{\s*([^{}]+?)\s*\}\}|\{([\w一-龥 .-]+)\}`;
const NESTED_TOKEN_PATTERN = /\{\{|\{[\w一-龥]/;
const EMPTY_TEXT_VALUES = new Set(['无', '待定', '未知', '暂无', '—', '-', '故事尚未开始', '未开始']);

export function renderStatusTemplate(template, options = {}) {
  const resolveVariable = typeof options.resolveVariable === 'function' ? options.resolveVariable : () => null;
  const listVariables = typeof options.listVariables === 'function' ? options.listVariables : () => [];
  const escape = typeof options.escape === 'function' ? options.escape : (value) => String(value ?? '');
  const depth = Number.isFinite(Number(options.depth)) ? Number(options.depth) : 0;
  const text = String(template ?? '');
  if (!text || depth > MAX_RENDER_DEPTH) {
    return text;
  }
  const nodes = parseTemplate(text);
  const context = { resolveVariable, listVariables, escape, depth, loop: null };
  return renderNodes(nodes, context);
}

// Every variable reference the template makes, in document order, for
// inference and validation. Control tokens and loop fields are skipped.
export function collectStatusTemplateReferences(template) {
  const references = [];
  const text = String(template ?? '');
  const pattern = tokenPattern();
  let match;
  while ((match = pattern.exec(text))) {
    const parsed = parseStatusTemplateExpression(match[1] ?? match[2]);
    if (parsed.kind === 'variable' && parsed.rawName) {
      references.push({ rawName: parsed.rawName, rawProperty: parsed.rawProperty, filters: parsed.filters });
      continue;
    }
    if (parsed.kind !== 'open') {
      continue;
    }
    if (parsed.control === 'each') {
      if (parsed.rawName) references.push({ rawName: parsed.rawName, rawProperty: '', filters: [] });
      continue;
    }
    if (parsed.condition?.left?.rawName) {
      references.push({ rawName: parsed.condition.left.rawName, rawProperty: parsed.condition.left.rawProperty, filters: [] });
    }
    const right = parsed.condition?.right;
    if (right?.type === 'variable' && right.rawName) {
      references.push({ rawName: right.rawName, rawProperty: right.rawProperty, filters: [] });
    }
  }
  return references;
}

// Structural check for editors: returns human-readable Chinese issues about
// unbalanced blocks or unknown control words so authors get feedback before
// the runtime silently drops a broken block.
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
    const raw = match[1] ?? match[2];
    const parsed = parseStatusTemplateExpression(raw);
    if (parsed.kind === 'unknown') {
      issues.push(`不支持的控制标记 {{${raw}}}；只支持 #if、#unless、#each、else 与对应的 /if、/unless、/each。`);
      continue;
    }
    if (parsed.kind === 'open') {
      if (parsed.control === 'each' && !parsed.loopSource) {
        issues.push('{{#each}} 需要指定遍历对象，例如 {{#each meters}} 或 {{#each 随身物品}}。');
      }
      if ((parsed.control === 'if' || parsed.control === 'unless') && !parsed.condition?.left?.rawName) {
        issues.push(`{{#${parsed.control}}} 缺少判断条件，例如 {{#if 体力 > 50}}。`);
      }
      stack.push(parsed.control);
      continue;
    }
    if (parsed.kind === 'else') {
      const current = stack[stack.length - 1];
      if (current !== 'if' && current !== 'unless') {
        issues.push('{{else}} 必须位于 {{#if}} 或 {{#unless}} 块内。');
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
    if (parsed.kind === 'variable') {
      current(stack).push({ type: 'variable', expression: parsed });
    } else if (parsed.kind === 'loop-field') {
      current(stack).push({ type: 'loop-field', field: parsed.loopField });
    } else if (parsed.kind === 'open') {
      const block = { type: 'block', control: parsed.control, expression: parsed, children: [], alternate: [] };
      current(stack).push(block);
      stack.push({ children: block.children, block });
    } else if (parsed.kind === 'else') {
      const frame = stack[stack.length - 1];
      if (frame.block && !frame.inAlternate && (frame.block.control === 'if' || frame.block.control === 'unless')) {
        frame.children = frame.block.alternate;
        frame.inAlternate = true;
      }
    } else if (parsed.kind === 'close') {
      if (stack.length > 1 && stack[stack.length - 1].block?.control === parsed.control) {
        stack.pop();
      }
    }
    // Unknown control words render as nothing.
  }
  if (cursor < text.length) {
    pushText(stack, text.slice(cursor));
  }
  return root;
}

function current(stack) {
  return stack[stack.length - 1].children;
}

function pushText(stack, value) {
  if (value) current(stack).push({ type: 'text', value });
}

function renderNodes(nodes, context) {
  let output = '';
  for (const node of nodes) {
    if (node.type === 'text') {
      output += node.value;
    } else if (node.type === 'variable') {
      output += context.escape(renderVariable(node.expression, context));
    } else if (node.type === 'loop-field') {
      output += context.escape(renderLoopField(node.field, context));
    } else if (node.type === 'block') {
      output += renderBlock(node, context);
    }
  }
  return output;
}

function renderBlock(block, context) {
  if (block.control === 'each') {
    return renderEach(block, context);
  }
  const truthy = evaluateCondition(block.expression.condition, context);
  const branch = (block.control === 'unless' ? !truthy : truthy) ? block.children : block.alternate;
  return renderNodes(branch, context);
}

function renderEach(block, context) {
  const source = String(block.expression.loopSource || '').trim();
  const items = isStatusTemplateLoopCollection(source)
    ? collectLoopVariables(source.toLowerCase(), context)
    : collectListItems(block.expression.rawName, context);
  let output = '';
  for (let index = 0; index < items.length; index += 1) {
    output += renderNodes(block.children, { ...context, loop: { variable: items[index], index } });
  }
  return output;
}

function collectLoopVariables(source, context) {
  const variables = context.listVariables();
  const items = [];
  for (const variable of Array.isArray(variables) ? variables : []) {
    if (!variable) continue;
    if (source === 'meters' && !variable.isMeter) continue;
    if (source === 'texts' && variable.isMeter) continue;
    items.push(variable);
  }
  return items;
}

// A text variable such as "长剑、药水、地图" iterates as three items, each shaped
// like a text variable so every loop field keeps working.
function collectListItems(name, context) {
  const variable = name ? context.resolveVariable(name) : null;
  if (!variable) return [];
  const text = String(readVariableProperty(variable, 'value', context) ?? '');
  const items = [];
  for (const part of text.split(LIST_SEPARATOR)) {
    const value = part.trim();
    if (!isTruthy(value)) continue;
    items.push({
      name: variable.name,
      value,
      displayValue: value,
      isMeter: false,
      max: '',
      percentage: 0,
      color: variable.color
    });
    if (items.length >= MAX_LIST_ITEMS) break;
  }
  return items;
}

function renderLoopField(field, context) {
  const loop = context.loop;
  if (!loop) return '';
  const variable = loop.variable;
  const name = String(field || '').toLowerCase();
  if (name === 'index') return String(loop.index + 1);
  if (name === 'name') return String(variable.name ?? '');
  return String(readVariableProperty(variable, name, context) ?? '');
}

function renderVariable(expression, context) {
  const variable = context.resolveVariable(expression.rawName);
  const property = expression.rawProperty || 'value';
  let value = variable ? readVariableProperty(variable, property, context) : '';
  for (const filter of expression.filters) {
    value = applyFilter(filter, value, variable, context);
  }
  return value === null || value === undefined ? '' : String(value);
}

function readVariableProperty(variable, property, context) {
  const key = String(property || 'value').trim().toLowerCase();
  if (!variable) return '';
  if (key === 'max') return variable.isMeter ? variable.max : '';
  if (key === 'percent') return variable.isMeter ? `${Math.round(variable.percentage)}%` : '';
  if (key === 'percentage' || key === 'ratio') return variable.isMeter ? Math.round(variable.percentage) : '';
  if (key === 'remaining') return variable.isMeter ? formatNumber(Number(variable.max) - Number(variable.value)) : '';
  if (key === 'bar') return variable.isMeter ? textBar(variable.percentage, 10) : '';
  if (key === 'color') return variable.color ?? '';
  if (key === 'name') return variable.name ?? '';
  if (key === 'display' || key === 'displayvalue') {
    return resolveNested(variable.displayValue, context);
  }
  return resolveNested(variable.value, context);
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
    depth: context.depth + 1
  });
}

function applyFilter(filter, value, variable, context) {
  const args = filter.args.slice(0, FILTER_ARG_LIMIT);
  const text = String(value ?? '');
  switch (filter.name) {
    case 'upper':
      return text.toUpperCase();
    case 'lower':
      return text.toLowerCase();
    case 'trim':
      return text.trim();
    case 'default':
      return text.trim() ? text : String(args[0] ?? '');
    case 'prefix':
      return text ? `${args[0] ?? ''}${text}` : text;
    case 'suffix':
      return text ? `${text}${args[0] ?? ''}` : text;
    case 'truncate': {
      const limit = Math.max(1, Math.floor(Number(args[0]) || 24));
      return text.length > limit ? `${text.slice(0, limit)}…` : text;
    }
    case 'replace':
      return args.length >= 2 ? text.split(String(args[0])).join(String(args[1])) : text;
    case 'round': {
      const digits = Math.max(0, Math.min(6, Math.floor(Number(args[0]) || 0)));
      const numeric = Number(text);
      return Number.isFinite(numeric) ? formatNumber(Number(numeric.toFixed(digits))) : text;
    }
    case 'pad': {
      const width = Math.max(0, Math.min(12, Math.floor(Number(args[0]) || 0)));
      return text.padStart(width, String(args[1] ?? '0').slice(0, 1) || '0');
    }
    case 'max':
    case 'percent':
    case 'percentage':
    case 'ratio':
    case 'remaining':
    case 'color':
    case 'display':
      return readVariableProperty(variable, filter.name, context);
    case 'bar': {
      const width = Math.max(1, Math.min(40, Math.floor(Number(args[0]) || 10)));
      if (variable?.isMeter) return textBar(variable.percentage, width, args[1], args[2]);
      const numeric = Number(text.replace('%', ''));
      return Number.isFinite(numeric) ? textBar(numeric, width, args[1], args[2]) : '';
    }
    case 'json':
      try {
        return JSON.stringify(value);
      } catch {
        return text;
      }
    default:
      return text;
  }
}

function textBar(percentage, width, filled = '█', empty = '░') {
  const ratio = Math.max(0, Math.min(100, Number(percentage) || 0)) / 100;
  const fill = Math.round(ratio * width);
  const filledChar = String(filled || '█').slice(0, 1) || '█';
  const emptyChar = String(empty || '░').slice(0, 1) || '░';
  return filledChar.repeat(fill) + emptyChar.repeat(Math.max(0, width - fill));
}

function evaluateCondition(condition, context) {
  if (!condition) return false;
  const left = operandValue({ type: 'variable', ...condition.left }, context);
  let result;
  if (!condition.operator) {
    result = isTruthy(left);
  } else {
    const right = operandValue(condition.right, context);
    result = compare(left, right, condition.operator);
  }
  return condition.negate ? !result : result;
}

function operandValue(operand, context) {
  if (!operand) return '';
  if (operand.type === 'literal') return operand.value;
  const variable = context.resolveVariable(operand.rawName);
  if (!variable) return '';
  return readVariableProperty(variable, operand.rawProperty || 'value', context);
}

function compare(left, right, operator) {
  const leftNumber = toComparableNumber(left);
  const rightNumber = toComparableNumber(right);
  if (leftNumber !== null && rightNumber !== null) {
    switch (operator) {
      case '>': return leftNumber > rightNumber;
      case '<': return leftNumber < rightNumber;
      case '>=': return leftNumber >= rightNumber;
      case '<=': return leftNumber <= rightNumber;
      case '!=': return leftNumber !== rightNumber;
      default: return leftNumber === rightNumber;
    }
  }
  const leftText = String(left ?? '').trim();
  const rightText = String(right ?? '').trim();
  switch (operator) {
    case '!=': return leftText !== rightText;
    case '>': return leftText > rightText;
    case '<': return leftText < rightText;
    case '>=': return leftText >= rightText;
    case '<=': return leftText <= rightText;
    default: return leftText === rightText;
  }
}

function toComparableNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const text = String(value ?? '').trim().replace(/%$/, '');
  if (!text || !/^[-+]?(?:\d+|\d*\.\d+)$/.test(text)) return null;
  return Number(text);
}

// Placeholder texts the app itself seeds ("待定", "无", "故事尚未开始" …) count
// as empty so {{#if 事件}} and list loops skip them.
function isTruthy(value) {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === 'number') return value !== 0;
  const text = String(value).trim();
  if (!text || text === '0' || text === 'false') return false;
  return !EMPTY_TEXT_VALUES.has(text);
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return '';
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}
