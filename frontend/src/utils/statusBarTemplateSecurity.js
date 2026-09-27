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
// sanitiser; everything else must be listed here.
export const STATUS_BAR_TEMPLATE_ALLOWED_ATTRS = new Set([
  'aria-hidden',
  'aria-label',
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

// Declarative button actions: `data-sb-action="<name>"` plus the listed
// companion attributes. Documented in the editors and in the AI tool prompts.
export const STATUS_BAR_TEMPLATE_ACTIONS = Object.freeze([
  { action: 'quick-reply', attrs: ['data-sb-text'], summary: '把文字填入输入框，由用户决定是否发送' },
  { action: 'send', attrs: ['data-sb-text'], summary: '直接把文字作为一条消息发送' },
  { action: 'copy', attrs: ['data-sb-copy'], summary: '复制文字到剪贴板' },
  { action: 'set', attrs: ['data-sb-var', 'data-sb-value'], summary: '把变量设为指定值' },
  { action: 'adjust', attrs: ['data-sb-var', 'data-sb-delta'], summary: '给数值变量加减指定数值' },
  { action: 'toggle', attrs: ['data-sb-target'], summary: '显示 / 隐藏模板内匹配选择器的元素' },
  { action: 'collapse', attrs: [], summary: '收起状态栏' },
  { action: 'open-settings', attrs: [], summary: '打开会话设置面板' }
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
