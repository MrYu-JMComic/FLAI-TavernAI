// Adapt model presentation to a JSON Schema without weakening domain validation.
// Unknown fields and invalid values survive unchanged so the caller's schema can
// report them. In particular, absence and an explicitly nullable value differ.
export function normalizeModelInput(value, schema, options = {}) {
  const metadataKeys = new Set(options.metadataKeys || []);
  const metadataPaths = new Set(options.metadataPaths || ['']);
  const visit = (input, definition, path = '') => {
    if (!definition || typeof definition !== 'object') return input;
    const selected = selectVariant(input, definition);
    if (selected !== definition) return visit(input, selected, path);

    if (definition.type === 'object' && isObject(input)) {
      const required = new Set(definition.required || []);
      const properties = definition.properties || {};
      return Object.fromEntries(Object.entries(input).flatMap(([key, item]) => {
        if (!Object.hasOwn(properties, key)) {
          if (metadataPaths.has(path) && metadataKeys.has(key) && (item === null || typeof item === 'string')) return [];
          return [[key, item]];
        }
        const property = properties[key];
        if (item === null && !required.has(key) && !allowsNull(property)) return [];
        return [[key, visit(item, property, path ? `${path}.${key}` : key)]];
      }));
    }
    if (definition.type === 'array' && Array.isArray(input)) {
      return input.map(item => visit(item, definition.items, path ? `${path}.*` : '*'));
    }
    if (typeof input !== 'string') return input;
    const text = input.trim();
    if (definition.type === 'boolean' && /^(?:true|false)$/iu.test(text)) return text.toLowerCase() === 'true';
    if (['number', 'integer'].includes(definition.type)) {
      const percent = definition.minimum === 0 && definition.maximum === 1 && text.endsWith('%');
      const numeric = percent ? text.slice(0, -1).trim() : text;
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(numeric)) return input;
      const parsed = Number(numeric) / (percent ? 100 : 1);
      if (!Number.isFinite(parsed) || (Number.isInteger(parsed) && !Number.isSafeInteger(parsed))) return input;
      return parsed;
    }
    return input;
  };
  return visit(value, schema);
}

function selectVariant(value, schema) {
  // Schema anyOf/oneOf may also express constraints on an existing object.
  // Only select actual typed alternatives, never one of those constraints.
  if (schema.type) return schema;
  const variants = schema.oneOf || schema.anyOf;
  if (!Array.isArray(variants)) return schema;
  const typed = variants.filter(variant => variant && typeof variant === 'object' && variant.type);
  if (isObject(value)) {
    const discriminated = typed.filter(variant => variant.type === 'object'
      && Object.entries(variant.properties || {}).some(([key, field]) => Object.hasOwn(field, 'const')
        && Object.hasOwn(value, key) && value[key] === field.const));
    if (discriminated.length === 1) return discriminated[0];
  }
  const exact = typed.filter(variant => matchesType(value, variant.type));
  if (exact.length === 1) return exact[0];
  // A numeric/boolean string may be adapted in a nullable typed field, but
  // must not guess between two competing types in a general union.
  const nonNull = typed.filter(variant => variant.type !== 'null');
  return nonNull.length === 1 ? nonNull[0] : schema;
}

function allowsNull(schema) {
  return Boolean(schema && (schema.type === 'null' || schema.const === null
    || (Array.isArray(schema.type) && schema.type.includes('null'))
    || schema.enum?.includes(null)
    || [...(schema.anyOf || []), ...(schema.oneOf || [])].some(allowsNull)));
}

function matchesType(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isObject(value);
  if (type === 'integer') return Number.isInteger(value);
  return typeof value === type;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
