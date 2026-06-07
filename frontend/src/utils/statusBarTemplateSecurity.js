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
  return String(value || '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part && isSafeStatusBarCssValue(part))
    .join('; ');
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
