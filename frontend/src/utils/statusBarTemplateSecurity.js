export const STATUS_BAR_TEMPLATE_ALLOWED_TAGS = new Set([
  'article',
  'b',
  'br',
  'button',
  'div',
  'em',
  'footer',
  'header',
  'hr',
  'i',
  'li',
  'ol',
  'p',
  'section',
  'small',
  'span',
  'strong',
  'ul'
]);

export const STATUS_BAR_TEMPLATE_VALIDATOR_ALLOWED_TAGS = new Set([
  ...STATUS_BAR_TEMPLATE_ALLOWED_TAGS,
  'style'
]);

export const STATUS_BAR_TEMPLATE_VOID_TAGS = new Set(['br', 'hr']);

const STATUS_BAR_TEMPLATE_DANGEROUS_CSS = /@import|expression\s*\(|javascript:|url\s*\(|behavior\s*:/i;

export function hasDangerousStatusBarCss(value) {
  return STATUS_BAR_TEMPLATE_DANGEROUS_CSS.test(String(value || ''));
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
  return String(value || '')
    .replace(/@import[^;]+;?/gi, '')
    .replace(/url\s*\([^)]*\)/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/behavior\s*:/gi, '');
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
