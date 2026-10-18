const DEFAULT_MAX_LENGTH = 262_144;

// This is a model-response boundary, not a replacement for persisted JSON parsing.
// It accepts presentation differences without changing keys, values or quotations.
export function parseModelJsonObject(text, options = {}) {
  const {
    matches,
    wrapperKeys = ['plan', 'result'],
    wrapperSiblingKeys = ['note', 'notes', 'explanation'],
    wrapperSiblingMatcher,
    onWrapperSibling,
    wrapperKeyNormalizer,
    wrapperShapeMatcher,
    wrapperFieldMatcher,
    allowRootArray = false,
    rootArrayMatcher,
    maxLength = DEFAULT_MAX_LENGTH,
    maxDepth = 64,
    maxWrapperDepth = 4,
  } = options;
  if (typeof text !== 'string' || !text.trim()) throw invalid('Expected a nonempty model response');
  for (const [name, value] of Object.entries({ maxLength, maxDepth, maxWrapperDepth })) {
    if (!Number.isSafeInteger(value) || value < (name === 'maxWrapperDepth' ? 0 : 1)) {
      throw invalid(`Invalid ${name} limit`);
    }
  }
  if (text.length > maxLength) throw invalid('Model response exceeds the length limit');
  if ((matches !== undefined && typeof matches !== 'function') || !Array.isArray(wrapperKeys)
    || wrapperKeys.some(key => typeof key !== 'string') || !Array.isArray(wrapperSiblingKeys)
    || wrapperSiblingKeys.some(key => typeof key !== 'string')
    || (wrapperSiblingMatcher !== undefined && typeof wrapperSiblingMatcher !== 'function')
    || (onWrapperSibling !== undefined && typeof onWrapperSibling !== 'function')
    || (wrapperKeyNormalizer !== undefined && typeof wrapperKeyNormalizer !== 'function')
    || (wrapperShapeMatcher !== undefined && typeof wrapperShapeMatcher !== 'function')
    || (wrapperFieldMatcher !== undefined && typeof wrapperFieldMatcher !== 'function')
    || typeof allowRootArray !== 'boolean'
    || (rootArrayMatcher !== undefined && typeof rootArrayMatcher !== 'function')) {
    throw invalid('Invalid response matching options');
  }

  const source = text.trim();
  const reader = createReader(source, maxDepth);
  const roots = [];
  while (reader.position < source.length) {
    reader.skipSpace();
    const start = reader.position;
    const char = source[start];
    if (char === '{' || char === '[') {
      // Bracketed prose such as [Plan result] and {format note} is not JSON.
      const label = source.slice(start).match(char === '{'
        ? /^\{[^{}\[\]":\r\n]+\}/u : /^\[[^{}\[\]":\r\n]+\]/u);
      if (label && !looksLikeJsonStart(label[0], char)) {
        reader.position += label[0].length;
        continue;
      }
      const value = reader.readValue();
      // Numeric citations in surrounding explanation are not plan arrays.
      if (Array.isArray(value) && value.length && value.every(item => typeof item === 'number')) continue;
      roots.push(value);
    } else if (char === '"') {
      const value = reader.readValue();
      if (/^\s*(?:\[|\{|")/u.test(value)) roots.push(value);
    } else if (char === '}' || char === ']') {
      throw invalid('Unmatched closing JSON bracket');
    } else {
      reader.position += 1;
    }
  }

  const candidates = [];
  const fallbacks = [];
  const keys = [...new Set(wrapperKeys)];
  const siblingKeys = new Set(wrapperSiblingKeys);
  const normalizeWrapperKey = wrapperKeyNormalizer || (key => key);
  for (const root of roots) {
    const unwrapped = unwrapTransport(root, 0, false);
    if (isAcceptedRootArray(unwrapped.value)) {
      candidates.push(unwrapped.value);
      continue;
    }
    if (!isObject(unwrapped.value)) throw invalid('Expected a JSON object');
    fallbacks.push(unwrapped.value);
    collect(unwrapped.value, unwrapped.depth, unwrapped.decoded);
  }
  if (candidates.length > 1) throw ambiguous('More than one matching JSON object');
  if (candidates.length === 1) return candidates[0];
  // Preserve a lone schema-invalid object so callers can report useful field errors.
  if (fallbacks.length === 1) return fallbacks[0];
  throw invalid(fallbacks.length ? 'No unique JSON object found in the model response' : 'No JSON object found in the model response');

  function unwrapTransport(value, depth, decoded) {
    if (depth > maxWrapperDepth) throw invalid('Response wrapper depth exceeded');
    if (Array.isArray(value)) {
      if (isAcceptedRootArray(value)) return { value, depth, decoded };
      if (value.length !== 1) throw invalid('Only a single-element object wrapper array is accepted');
      return unwrapTransport(value[0], depth + 1, decoded);
    }
    if (typeof value === 'string') {
      if (decoded) throw invalid('Only one JSON string encoding layer is accepted');
      const nested = createReader(value.trim(), maxDepth);
      const decodedValue = nested.readValue();
      nested.skipSpace();
      if (nested.position !== value.trim().length) throw invalid('Encoded JSON contains trailing content');
      return unwrapTransport(decodedValue, depth + 1, true);
    }
    return { value, depth, decoded };
  }

  function collect(value, depth, decoded, path = '') {
    if (isAcceptedRootArray(value)) {
      candidates.push(value);
      return;
    }
    const explicitMatching = matches?.(value);
    const childKeys = Object.keys(value).filter(key => {
      if (wrapperFieldMatcher && !wrapperFieldMatcher(value, key)) return false;
      const normalized = normalizeWrapperKey(key);
      const configured = keys.includes(normalized);
      const shapeMatched = explicitMatching !== true && !siblingKeys.has(normalized)
        && wrapperShapeMatcher?.(value[key], key);
      return (configured || shapeMatched) && (isObject(value[key]) || Array.isArray(value[key])
        || (typeof value[key] === 'string' && /^\s*(?:\[|\{|")/u.test(value[key])));
    });
    const matching = matches ? explicitMatching : childKeys.length === 0;
    if (matching) {
      for (const [key, entry] of Object.entries(value)) {
        if (!siblingKeys.has(normalizeWrapperKey(key))) continue;
        if (wrapperSiblingMatcher && !isAllowedWrapperSibling(key, entry)) throw invalid('Response wrapper contains unsupported sibling fields');
        notifyWrapperSibling(key, entry, path);
      }
      candidates.push(value);
    }
    if (!matching && childKeys.length) {
      for (const [key, entry] of Object.entries(value)) {
        if (childKeys.includes(key)) continue;
        if (!siblingKeys.has(normalizeWrapperKey(key)) || !isAllowedWrapperSibling(key, entry)) {
          throw invalid('Response wrapper contains unsupported sibling fields');
        }
        notifyWrapperSibling(key, entry, path);
      }
    }
    for (const key of childKeys) {
      const wrapped = value[key];
      const child = unwrapTransport(wrapped, depth + 1, decoded);
      if (isAcceptedRootArray(child.value)) {
        candidates.push(child.value);
        continue;
      }
      if (!isObject(child.value)) throw invalid('Response wrapper must contain an object');
      collect(child.value, child.depth, child.decoded, path ? `${path}.${key}` : key);
    }
  }

  function notifyWrapperSibling(key, value, path) {
    onWrapperSibling?.({ key, value, path });
  }

  function isAllowedWrapperSibling(key, value) {
    return wrapperSiblingMatcher
      ? wrapperSiblingMatcher(value, key)
      : value === null || typeof value === 'string';
  }

  function isAcceptedRootArray(value) {
    return allowRootArray && Array.isArray(value)
      && (!rootArrayMatcher || rootArrayMatcher(value));
  }
}

function looksLikeJsonStart(label, opening) {
  const content = label.slice(1).trimStart();
  return opening === '{' ? /^(?:"|\}|\/)/u.test(content)
    : /^(?:[\[\{"\d-]|true\b|false\b|null\b|\]|\/)/u.test(content);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalid(message) {
  return Object.assign(new Error(message), { code: 'MODEL_JSON_INVALID' });
}

function ambiguous(message) {
  return Object.assign(new Error(message), { code: 'MODEL_JSON_AMBIGUOUS' });
}

// A small JSON reader is needed instead of regex replacement: comments and commas
// inside strings must survive, and JSON.parse alone cannot detect duplicate keys.
function createReader(source, maxDepth) {
  const reader = { position: 0, skipSpace, readValue };
  return reader;

  function skipSpace() {
    while (reader.position < source.length) {
      if (/\s/u.test(source[reader.position])) reader.position += 1;
      else if (source.startsWith('//', reader.position)) {
        const newline = source.indexOf('\n', reader.position + 2);
        reader.position = newline < 0 ? source.length : newline + 1;
      } else if (source.startsWith('/*', reader.position)) {
        const end = source.indexOf('*/', reader.position + 2);
        if (end < 0) throw invalid('Unterminated JSON comment');
        reader.position = end + 2;
      } else break;
    }
  }

  function readValue(depth = 0) {
    if (depth > maxDepth) throw invalid('JSON nesting depth exceeded');
    skipSpace();
    const char = source[reader.position];
    if (char === '{' || char === '[') return readContainer(char, depth);
    if (char === '"') return readString();
    for (const [literal, value] of [['true', true], ['false', false], ['null', null]]) {
      if (source.startsWith(literal, reader.position)) {
        reader.position += literal.length;
        return value;
      }
    }
    const number = source.slice(reader.position).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u);
    if (number) {
      reader.position += number[0].length;
      const value = Number(number[0]);
      if (!Number.isFinite(value)) throw invalid('JSON number exceeds the finite range');
      return value;
    }
    throw invalid('Invalid or incomplete JSON value');
  }

  function readString() {
    const start = reader.position++;
    let escaped = false;
    while (reader.position < source.length) {
      const char = source[reader.position++];
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') {
        try { return JSON.parse(source.slice(start, reader.position)); }
        catch { throw invalid('Invalid JSON string'); }
      }
    }
    throw invalid('Unterminated JSON string');
  }

  function readContainer(opening, depth) {
    const object = opening === '{';
    const closing = object ? '}' : ']';
    const value = object ? {} : [];
    const keys = new Set();
    reader.position += 1;
    skipSpace();
    if (source[reader.position] === closing) { reader.position += 1; return value; }
    while (reader.position < source.length) {
      let key;
      if (object) {
        if (source[reader.position] !== '"') throw invalid('JSON object keys must be double-quoted');
        key = readString();
        if (keys.has(key)) throw invalid('Duplicate JSON object key');
        keys.add(key);
        skipSpace();
        if (source[reader.position++] !== ':') throw invalid('Expected a colon after the JSON object key');
      }
      const entry = readValue(depth + 1);
      if (object) Object.defineProperty(value, key, { value: entry, enumerable: true, writable: true, configurable: true });
      else value.push(entry);
      skipSpace();
      const separator = source[reader.position++];
      if (separator === closing) return value;
      if (separator !== ',') throw invalid('Unbalanced or incomplete JSON container');
      skipSpace();
      if (source[reader.position] === closing) { reader.position += 1; return value; }
    }
    throw invalid('Unterminated JSON container');
  }
}
