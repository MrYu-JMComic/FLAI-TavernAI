// Safe expression language for status templates: `{{= 体力 * 2}}` and the
// conditions of `{{#if}}` / `{{else if}}` blocks. It is parsed into a small
// AST and evaluated here — never through eval or Function — so authors get
// JavaScript-like arithmetic, comparisons and helper calls without any access
// to the page.
//
//   literals     12  3.5  "文本"  '文本'  “文本”  true  false  null
//   references   体力  体力.max  角色A.好感  @value (inside #each)  user  char
//   operators    + - * / %   == != > < >= <=   && || !   and or not
//                a contains b   cond ? a : b   ( … )
//   functions    listed in STATUS_EXPRESSION_FUNCTIONS below

export const STATUS_EXPRESSION_LIMITS = Object.freeze({
  sourceLength: 1_000,
  nodes: 200,
  depth: 24,
  outputLength: 2_000
});

// Documented in shared/statusTemplateSyntax.js; keep both lists aligned (a
// backend test compares them).
export const STATUS_EXPRESSION_FUNCTIONS = Object.freeze([
  'min', 'max', 'round', 'floor', 'ceil', 'abs', 'clamp', 'percent', 'fixed',
  'number', 'text', 'len', 'count', 'contains', 'upper', 'lower', 'trim',
  'if', 'default', 'join', 'item', 'var'
]);

// Names resolved from the render context instead of status variables.
export const STATUS_TEMPLATE_BUILTINS = Object.freeze(['user', 'char', 'date', 'time', 'weekday', 'datetime']);

const FUNCTION_SET = new Set(STATUS_EXPRESSION_FUNCTIONS);
const BUILTIN_SET = new Set(STATUS_TEMPLATE_BUILTINS);
const KEYWORD_LITERALS = new Map([['true', true], ['false', false], ['null', null]]);
const WORD_OPERATORS = new Map([['and', '&&'], ['or', '||'], ['not', '!'], ['contains', 'contains']]);
const STRING_DELIMITERS = new Map([['"', '"'], ["'", "'"], ['“', '”'], ['‘', '’'], ['「', '」']]);
const SYMBOL_OPERATORS = ['===', '!==', '==', '!=', '>=', '<=', '&&', '||', '>', '<', '=', '!', '+', '-', '*', '/', '%', '?', ':', '(', ')', ','];
const IDENTIFIER_START = /[\p{L}_$@]/u;
const IDENTIFIER_PART = /[\p{L}\p{M}\p{N}_$.·]/u;
const NUMBER_PATTERN = /^(?:\d+(?:\.\d+)?|\.\d+)/;
const LIST_SEPARATOR = /[,，、;；|\n]+/;
const EMPTY_TEXT_VALUES = new Set(['无', '待定', '未知', '暂无', '—', '-', '故事尚未开始', '未开始', '否', '没有', 'none', 'null', 'no', 'off']);

export class StatusExpressionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StatusExpressionError';
  }
}

// Returns { ok: true, ast } or { ok: false, error }. Never throws.
export function parseStatusExpression(source) {
  const text = String(source ?? '').trim();
  if (!text) {
    return { ok: false, error: '表达式为空' };
  }
  if (text.length > STATUS_EXPRESSION_LIMITS.sourceLength) {
    return { ok: false, error: `表达式超过 ${STATUS_EXPRESSION_LIMITS.sourceLength} 个字符` };
  }
  try {
    const parser = createParser(tokenize(text));
    const ast = parser.parseExpression(0);
    if (!parser.done()) {
      throw new StatusExpressionError(`无法识别“${parser.peekText()}”附近的内容`);
    }
    return { ok: true, ast };
  } catch (error) {
    return { ok: false, error: error instanceof StatusExpressionError ? error.message : '表达式无法解析' };
  }
}

// Every variable reference in document order; built-ins, loop fields and
// literals are skipped so inference never invents variables for them.
export function collectStatusExpressionReferences(ast, output = []) {
  if (!ast || typeof ast !== 'object') return output;
  switch (ast.type) {
    case 'ref':
      output.push({ rawName: ast.rawName, rawProperty: ast.rawProperty });
      break;
    case 'unary':
      collectStatusExpressionReferences(ast.argument, output);
      break;
    case 'binary':
    case 'logical':
      collectStatusExpressionReferences(ast.left, output);
      collectStatusExpressionReferences(ast.right, output);
      break;
    case 'conditional':
      collectStatusExpressionReferences(ast.test, output);
      collectStatusExpressionReferences(ast.consequent, output);
      collectStatusExpressionReferences(ast.alternate, output);
      break;
    case 'call':
      if (ast.name === 'var' && ast.args[0]?.type === 'literal') {
        output.push(splitStatusReference(String(ast.args[0].value ?? '')));
      }
      for (const arg of ast.args) collectStatusExpressionReferences(arg, output);
      break;
    default:
      break;
  }
  return output;
}

// Unknown helper names found while parsing, for editor warnings.
export function collectStatusExpressionCalls(ast, output = []) {
  if (!ast || typeof ast !== 'object') return output;
  if (ast.type === 'call') output.push(ast.name);
  for (const key of ['argument', 'left', 'right', 'test', 'consequent', 'alternate']) {
    if (ast[key]) collectStatusExpressionCalls(ast[key], output);
  }
  if (Array.isArray(ast.args)) {
    for (const arg of ast.args) collectStatusExpressionCalls(arg, output);
  }
  return output;
}

// scope.reference(rawName, rawProperty) -> value
// scope.loopField(name) -> value
// scope.builtin(name) -> value
export function evaluateStatusExpression(ast, scope = {}) {
  const state = { steps: 0 };
  try {
    return evaluateNode(ast, scope, state, 0);
  } catch {
    return '';
  }
}

export function isStatusValueTruthy(value) {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (Array.isArray(value)) return value.length > 0;
  const text = String(value).trim();
  if (!text || text === '0' || text.toLowerCase() === 'false') return false;
  return !EMPTY_TEXT_VALUES.has(text.toLowerCase());
}

export function toStatusNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const text = String(value ?? '').trim().replace(/%$/, '');
  if (!text || !/^[-+]?(?:\d+|\d*\.\d+)$/.test(text)) return null;
  return Number(text);
}

export function formatStatusNumber(value) {
  if (!Number.isFinite(value)) return '';
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

export function formatStatusExpressionValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return formatStatusNumber(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return value.map(formatStatusExpressionValue).join('、');
  return String(value).slice(0, STATUS_EXPRESSION_LIMITS.outputLength);
}

export function splitStatusListItems(value) {
  if (Array.isArray(value)) return value.map((item) => String(item ?? '').trim()).filter(isStatusValueTruthy);
  const items = [];
  for (const part of String(value ?? '').split(LIST_SEPARATOR)) {
    const item = part.trim();
    if (isStatusValueTruthy(item)) items.push(item);
  }
  return items;
}

// Splits `名称.属性` only when the final segment is a known property, so
// dotted names such as `角色A.好感` stay whole. Shared with the token parser.
const KNOWN_PROPERTIES = new Set([
  'value', 'max', 'min', 'percent', 'percentage', 'ratio', 'remaining', 'bar',
  'color', 'display', 'displayvalue', 'name', 'unit', 'type', 'count', 'first', 'last'
]);

export function isStatusTemplateProperty(property) {
  return KNOWN_PROPERTIES.has(String(property || '').trim().toLowerCase());
}

export function splitStatusReference(subject) {
  const text = String(subject || '').trim();
  const lastDot = text.lastIndexOf('.');
  if (lastDot > 0 && lastDot < text.length - 1) {
    const suffix = text.slice(lastDot + 1).trim();
    if (isStatusTemplateProperty(suffix)) {
      return { rawName: text.slice(0, lastDot).trim(), rawProperty: suffix };
    }
  }
  return { rawName: text, rawProperty: '' };
}

export function isStatusTemplateBuiltin(name) {
  return BUILTIN_SET.has(String(name || '').trim().toLowerCase());
}

function tokenize(text) {
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (STRING_DELIMITERS.has(char)) {
      const closing = STRING_DELIMITERS.get(char);
      let value = '';
      let cursor = index + 1;
      let closed = false;
      while (cursor < text.length) {
        const next = text[cursor];
        if (next === '\\' && cursor + 1 < text.length) {
          value += text[cursor + 1];
          cursor += 2;
          continue;
        }
        if (next === closing) {
          closed = true;
          break;
        }
        value += next;
        cursor += 1;
      }
      if (!closed) throw new StatusExpressionError('字符串缺少结束引号');
      tokens.push({ type: 'string', value, text: text.slice(index, cursor + 1) });
      index = cursor + 1;
      continue;
    }
    const numberMatch = NUMBER_PATTERN.exec(text.slice(index));
    if (numberMatch && !(char === '.' && IDENTIFIER_PART.test(text[index - 1] || ''))) {
      tokens.push({ type: 'number', value: Number(numberMatch[0]), text: numberMatch[0] });
      index += numberMatch[0].length;
      continue;
    }
    if (IDENTIFIER_START.test(char)) {
      let cursor = index + 1;
      while (cursor < text.length && IDENTIFIER_PART.test(text[cursor])) cursor += 1;
      // A trailing dot belongs to nothing; leave it for the error message.
      while (cursor > index + 1 && text[cursor - 1] === '.') cursor -= 1;
      const word = text.slice(index, cursor);
      const lower = word.toLowerCase();
      // `contains(a, b)` is the helper function; bare `contains` the operator.
      const isCall = lower === 'contains' && /^\s*\(/.test(text.slice(cursor));
      if (WORD_OPERATORS.has(lower) && !isCall) {
        tokens.push({ type: 'operator', value: WORD_OPERATORS.get(lower), text: word });
      } else {
        tokens.push({ type: 'identifier', value: word, text: word });
      }
      index = cursor;
      continue;
    }
    const operator = SYMBOL_OPERATORS.find((candidate) => text.startsWith(candidate, index));
    if (operator) {
      tokens.push({ type: 'operator', value: normalizeOperator(operator), text: operator });
      index += operator.length;
      continue;
    }
    throw new StatusExpressionError(`不支持的字符“${char}”`);
  }
  return tokens;
}

function normalizeOperator(operator) {
  if (operator === '===' || operator === '=') return '==';
  if (operator === '!==') return '!=';
  return operator;
}

const BINARY_PRECEDENCE = new Map([
  ['||', 1],
  ['&&', 2],
  ['==', 3], ['!=', 3],
  ['<', 4], ['<=', 4], ['>', 4], ['>=', 4], ['contains', 4],
  ['+', 5], ['-', 5],
  ['*', 6], ['/', 6], ['%', 6]
]);

function createParser(tokens) {
  let position = 0;
  let nodes = 0;

  function node(value) {
    nodes += 1;
    if (nodes > STATUS_EXPRESSION_LIMITS.nodes) {
      throw new StatusExpressionError(`表达式过长（超过 ${STATUS_EXPRESSION_LIMITS.nodes} 个节点）`);
    }
    return value;
  }

  function peek() {
    return tokens[position];
  }

  function next() {
    const token = tokens[position];
    position += 1;
    return token;
  }

  function isOperator(token, value) {
    return token?.type === 'operator' && token.value === value;
  }

  function expect(value) {
    const token = next();
    if (!isOperator(token, value)) {
      throw new StatusExpressionError(`缺少“${value}”`);
    }
  }

  function parseExpression(minPrecedence, depth = 0) {
    if (depth > STATUS_EXPRESSION_LIMITS.depth) {
      throw new StatusExpressionError('表达式嵌套过深');
    }
    let left = parseUnary(depth + 1);
    for (;;) {
      const token = peek();
      if (token?.type !== 'operator') break;
      if (token.value === '?' && minPrecedence === 0) {
        next();
        const consequent = parseExpression(0, depth + 1);
        expect(':');
        const alternate = parseExpression(0, depth + 1);
        left = node({ type: 'conditional', test: left, consequent, alternate });
        continue;
      }
      const precedence = BINARY_PRECEDENCE.get(token.value);
      if (!precedence || precedence <= minPrecedence) break;
      next();
      const right = parseExpression(precedence, depth + 1);
      left = node(token.value === '&&' || token.value === '||'
        ? { type: 'logical', operator: token.value, left, right }
        : { type: 'binary', operator: token.value, left, right });
    }
    return left;
  }

  function parseUnary(depth) {
    const token = peek();
    if (token?.type === 'operator' && (token.value === '!' || token.value === '-' || token.value === '+')) {
      next();
      return node({ type: 'unary', operator: token.value, argument: parseUnary(depth + 1) });
    }
    return parsePrimary(depth);
  }

  function parsePrimary(depth) {
    const token = next();
    if (!token) {
      throw new StatusExpressionError('表达式意外结束');
    }
    if (token.type === 'number' || token.type === 'string') {
      return node({ type: 'literal', value: token.value });
    }
    if (isOperator(token, '(')) {
      const inner = parseExpression(0, depth + 1);
      expect(')');
      return inner;
    }
    if (token.type === 'identifier') {
      const word = token.value;
      const lower = word.toLowerCase();
      if (KEYWORD_LITERALS.has(lower)) {
        return node({ type: 'literal', value: KEYWORD_LITERALS.get(lower) });
      }
      if (isOperator(peek(), '(')) {
        next();
        const args = [];
        if (!isOperator(peek(), ')')) {
          for (;;) {
            args.push(parseExpression(0, depth + 1));
            if (isOperator(peek(), ',')) {
              next();
              continue;
            }
            break;
          }
        }
        expect(')');
        if (!FUNCTION_SET.has(lower)) {
          throw new StatusExpressionError(`未知函数 ${word}()`);
        }
        return node({ type: 'call', name: lower, args });
      }
      if (word[0] === '@') {
        return node({ type: 'loop', field: word.slice(1).toLowerCase() });
      }
      if (BUILTIN_SET.has(lower)) {
        return node({ type: 'builtin', name: lower });
      }
      return node({ type: 'ref', ...splitStatusReference(word) });
    }
    throw new StatusExpressionError(`无法识别“${token.text}”`);
  }

  return {
    parseExpression,
    done: () => position >= tokens.length,
    peekText: () => peek()?.text || ''
  };
}

function evaluateNode(ast, scope, state, depth) {
  state.steps += 1;
  if (state.steps > STATUS_EXPRESSION_LIMITS.nodes * 4 || depth > STATUS_EXPRESSION_LIMITS.depth * 2) {
    throw new StatusExpressionError('表达式过于复杂');
  }
  switch (ast?.type) {
    case 'literal':
      return ast.value;
    case 'ref':
      return typeof scope.reference === 'function' ? scope.reference(ast.rawName, ast.rawProperty) : '';
    case 'loop':
      return typeof scope.loopField === 'function' ? scope.loopField(ast.field) : '';
    case 'builtin':
      return typeof scope.builtin === 'function' ? scope.builtin(ast.name) : '';
    case 'unary': {
      const value = evaluateNode(ast.argument, scope, state, depth + 1);
      if (ast.operator === '!') return !isStatusValueTruthy(value);
      const number = toStatusNumber(value);
      if (number === null) return '';
      return ast.operator === '-' ? -number : number;
    }
    case 'logical': {
      const left = evaluateNode(ast.left, scope, state, depth + 1);
      if (ast.operator === '&&') {
        return isStatusValueTruthy(left) ? evaluateNode(ast.right, scope, state, depth + 1) : left;
      }
      return isStatusValueTruthy(left) ? left : evaluateNode(ast.right, scope, state, depth + 1);
    }
    case 'binary':
      return evaluateBinary(
        ast.operator,
        evaluateNode(ast.left, scope, state, depth + 1),
        evaluateNode(ast.right, scope, state, depth + 1)
      );
    case 'conditional':
      return isStatusValueTruthy(evaluateNode(ast.test, scope, state, depth + 1))
        ? evaluateNode(ast.consequent, scope, state, depth + 1)
        : evaluateNode(ast.alternate, scope, state, depth + 1);
    case 'call':
      return evaluateCall(ast, scope, state, depth);
    default:
      return '';
  }
}

function evaluateBinary(operator, left, right) {
  if (operator === 'contains') {
    return containsValue(left, right);
  }
  if (operator === '+') {
    const leftNumber = toStatusNumber(left);
    const rightNumber = toStatusNumber(right);
    if (leftNumber !== null && rightNumber !== null) return leftNumber + rightNumber;
    return limitText(`${formatStatusExpressionValue(left)}${formatStatusExpressionValue(right)}`);
  }
  if (['-', '*', '/', '%'].includes(operator)) {
    const leftNumber = toStatusNumber(left);
    const rightNumber = toStatusNumber(right);
    if (leftNumber === null || rightNumber === null) return '';
    if (operator === '-') return leftNumber - rightNumber;
    if (operator === '*') return leftNumber * rightNumber;
    if (rightNumber === 0) return '';
    return operator === '/' ? leftNumber / rightNumber : leftNumber % rightNumber;
  }
  return compareStatusValues(left, right, operator);
}

export function compareStatusValues(left, right, operator) {
  const leftNumber = toStatusNumber(left);
  const rightNumber = toStatusNumber(right);
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
  if (typeof left === 'boolean' || typeof right === 'boolean') {
    const equal = isStatusValueTruthy(left) === isStatusValueTruthy(right);
    return operator === '!=' ? !equal : operator === '==' ? equal : false;
  }
  const leftText = formatStatusExpressionValue(left).trim();
  const rightText = formatStatusExpressionValue(right).trim();
  switch (operator) {
    case '!=': return leftText !== rightText;
    case '>': return leftText > rightText;
    case '<': return leftText < rightText;
    case '>=': return leftText >= rightText;
    case '<=': return leftText <= rightText;
    default: return leftText === rightText;
  }
}

function containsValue(haystack, needle) {
  const target = formatStatusExpressionValue(needle).trim();
  if (!target) return false;
  const items = splitStatusListItems(haystack);
  if (items.includes(target)) return true;
  return formatStatusExpressionValue(haystack).includes(target);
}

function evaluateCall(ast, scope, state, depth) {
  const args = [];
  for (const arg of ast.args) args.push(evaluateNode(arg, scope, state, depth + 1));
  const numbers = () => args.map(toStatusNumber).filter((value) => value !== null);
  switch (ast.name) {
    case 'min': {
      const values = numbers();
      return values.length ? Math.min(...values) : '';
    }
    case 'max': {
      const values = numbers();
      return values.length ? Math.max(...values) : '';
    }
    case 'round':
    case 'fixed': {
      const value = toStatusNumber(args[0]);
      if (value === null) return '';
      const digits = Math.max(0, Math.min(6, Math.floor(toStatusNumber(args[1]) ?? 0)));
      return ast.name === 'fixed' ? value.toFixed(digits) : Number(value.toFixed(digits));
    }
    case 'floor':
    case 'ceil':
    case 'abs': {
      const value = toStatusNumber(args[0]);
      return value === null ? '' : Math[ast.name](value);
    }
    case 'clamp': {
      const value = toStatusNumber(args[0]);
      const low = toStatusNumber(args[1]);
      const high = toStatusNumber(args[2]);
      if (value === null) return '';
      return Math.min(high ?? value, Math.max(low ?? value, value));
    }
    case 'percent': {
      const value = toStatusNumber(args[0]);
      const total = toStatusNumber(args[1]);
      if (value === null || !total) return '';
      return Math.round((value / total) * 100);
    }
    case 'number': {
      const value = toStatusNumber(args[0]);
      return value === null ? (args.length > 1 ? args[1] : 0) : value;
    }
    case 'text':
      return formatStatusExpressionValue(args[0]);
    case 'len':
      return formatStatusExpressionValue(args[0]).length;
    case 'count':
      return splitStatusListItems(args[0]).length;
    case 'contains':
      return containsValue(args[0], args[1]);
    case 'upper':
      return formatStatusExpressionValue(args[0]).toUpperCase();
    case 'lower':
      return formatStatusExpressionValue(args[0]).toLowerCase();
    case 'trim':
      return formatStatusExpressionValue(args[0]).trim();
    case 'if':
      return isStatusValueTruthy(args[0]) ? args[1] ?? '' : args[2] ?? '';
    case 'default':
      return isStatusValueTruthy(args[0]) ? args[0] : args[1] ?? '';
    case 'join':
      return limitText(splitStatusListItems(args[0]).join(args.length > 1 ? formatStatusExpressionValue(args[1]) : '、'));
    case 'item': {
      const items = splitStatusListItems(args[0]);
      const index = Math.floor(toStatusNumber(args[1]) ?? 1);
      return items[index < 0 ? items.length + index : index - 1] ?? '';
    }
    case 'var': {
      const { rawName, rawProperty } = splitStatusReference(formatStatusExpressionValue(args[0]));
      return typeof scope.reference === 'function' && rawName ? scope.reference(rawName, rawProperty) : '';
    }
    default:
      return '';
  }
}

function limitText(value) {
  return String(value ?? '').slice(0, STATUS_EXPRESSION_LIMITS.outputLength);
}
