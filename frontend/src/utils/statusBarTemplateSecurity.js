import { STATUS_TEMPLATE_ACTIONS } from '../../../shared/statusTemplateActions.js';

// Display-only markup a custom status template may use. Anything that can load
// a remote resource, submit data or run script stays out; `style` is handled
// separately because its text is sanitised rather than kept as a node.
export const STATUS_BAR_TEMPLATE_ALLOWED_TAGS = new Set([
  'abbr',
  'article',
  'aside',
  'b',
  'blockquote',
  'br',
  'button',
  'caption',
  'code',
  'dd',
  'del',
  'details',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'i',
  'ins',
  'kbd',
  'label',
  'li',
  'main',
  'mark',
  'meter',
  'nav',
  'ol',
  'p',
  'pre',
  'progress',
  's',
  'section',
  'small',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'u',
  'ul'
]);

// Attributes kept on allowed tags. `data-sb-*` is matched by prefix in the
// sanitiser; everything else must be listed here. `id` stays out on purpose:
// template ids would land in the app document and could clobber globals.
export const STATUS_BAR_TEMPLATE_ALLOWED_ATTRS = new Set([
  'aria-expanded',
  'aria-hidden',
  'aria-label',
  'aria-pressed',
  'aria-selected',
  'class',
  'colspan',
  'datetime',
  'hidden',
  'high',
  'low',
  'max',
  'min',
  'open',
  'optimum',
  'role',
  'rowspan',
  'style',
  'title',
  'type',
  'value'
]);

export const STATUS_BAR_TEMPLATE_DATA_ATTR_PREFIX = 'data-sb-';
export const STATUS_BAR_TEMPLATE_DATA_ATTR_LIMIT = 500;

// Declarative button actions, documented once in shared/statusTemplateSyntax.js
// so the editors and the AI tool prompts describe the same set.
export const STATUS_BAR_TEMPLATE_ACTIONS = STATUS_TEMPLATE_ACTIONS;

export const STATUS_BAR_TEMPLATE_VALIDATOR_ALLOWED_TAGS = new Set([
  ...STATUS_BAR_TEMPLATE_ALLOWED_TAGS,
  'style'
]);

export const STATUS_BAR_TEMPLATE_VOID_TAGS = new Set(['br', 'hr']);

// Inline images are the only url() allowed: they cannot reach the network.
const STATUS_BAR_TEMPLATE_DATA_IMAGE_URL = /url\(\s*(["']?)data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+\1\s*\)/gi;
const STATUS_BAR_TEMPLATE_DANGEROUS_CSS = /@import|expression\s*\(|javascript:|url\s*\(|behavior\s*:|-moz-binding/i;

function withoutDataImageUrls(value) {
  return String(value || '').replace(STATUS_BAR_TEMPLATE_DATA_IMAGE_URL, 'none');
}

export function hasDangerousStatusBarCss(value) {
  return STATUS_BAR_TEMPLATE_DANGEROUS_CSS.test(withoutDataImageUrls(value));
}

export function isSafeStatusBarCssValue(value) {
  return !hasDangerousStatusBarCss(value);
}

export function sanitizeStatusBarStyleText(value) {
  const source = String(value || '');
  let output = '';
  let startIndex = 0;
  let quote = '';
  let escaped = false;
  let parenDepth = 0;

  for (let index = 0; index <= source.length; index += 1) {
    const char = source[index];
    if (index === source.length || (char === ';' && !quote && parenDepth === 0)) {
      output = appendSafeStatusBarStylePart(output, source.slice(startIndex, index));
      startIndex = index + 1;
      continue;
    }

    if (escaped) {
      escaped = false;
      continue;
    }

    if (quote) {
      if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(') {
      parenDepth += 1;
    } else if (char === ')' && parenDepth > 0) {
      parenDepth -= 1;
    }
  }

  return output;
}

function appendSafeStatusBarStylePart(output, part) {
  const trimmed = part.trim();
  if (!trimmed || !isSafeStatusBarCssValue(trimmed)) {
    return output;
  }
  return output ? `${output}; ${trimmed}` : trimmed;
}

export function sanitizeStatusBarStyleBlock(value) {
  const preserved = [];
  const masked = String(value || '').replace(STATUS_BAR_TEMPLATE_DATA_IMAGE_URL, (match) => {
    preserved.push(match);
    return `__FLAI_SB_IMAGE_${preserved.length - 1}__`;
  });
  const cleaned = masked
    .replace(/@import[^;]+;?/gi, '')
    .replace(/url\s*\([^)]*\)/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/behavior\s*:/gi, '')
    .replace(/-moz-binding/gi, '');
  return cleaned.replace(/__FLAI_SB_IMAGE_(\d+)__/g, (_match, index) => preserved[Number(index)] || 'none');
}

// Keyframe names are global in CSS, so a template's `@keyframes pulse` would
// replace the app's own animation. Rename them per status bar and rewrite the
// animation declarations that use them.
export function namespaceStatusBarKeyframes(cssText, prefix) {
  const css = String(cssText || '');
  const names = new Map();
  const keyframePattern = /@(-webkit-)?keyframes\s+(-?[_a-zA-Z][\w-]*)/g;
  let match;
  while ((match = keyframePattern.exec(css))) {
    names.set(match[2], `${prefix}-${match[2]}`);
  }
  if (!names.size) return css;
  const renamed = css.replace(keyframePattern, (_full, vendor, name) => `@${vendor || ''}keyframes ${names.get(name)}`);
  return renamed.replace(/(animation(?:-name)?\s*:\s*)([^;{}]+)/gi, (_full, property, declaration) => (
    property + declaration.replace(/(^|[\s,])(-?[_a-zA-Z][\w-]*)(?=$|[\s,!])/g, (token, lead, name) => (
      names.has(name) ? `${lead}${names.get(name)}` : token
    ))
  ));
}

export function escapeStatusBarTemplateHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}
