<script>
import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import MarkdownIt from 'markdown-it';
import markdownItKatex from '@vscode/markdown-it-katex';
import katex from 'katex';
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';
import { normalizeRegexFlags as normalizeSharedRegexFlags } from '../../../shared/regexFlags.js';
import { recordFrontendDiagnostic } from '../diagnostics.js';
import { reconcileDomChildren } from '../utils/domReconciler.js';
import {
  findColorBoxExpression,
  normalizeEscapedKatexSource,
  selectKatexSurfaceTextColor
} from '../utils/katexCompatibility.js';
import KatexPreviewDialog from './KatexPreviewDialog.vue';
import 'katex/dist/katex.min.css';

// Initialize markdown-it with highlight.js
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: true,
  highlight(str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        const highlighted = hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
        return `<pre class="markdown-code"><code class="hljs language-${lang}">${highlighted}</code></pre>`;
      } catch (error) {
        recordFrontendDiagnostic('markdown.highlight', error, { lang });
      }
    }
    const escaped = md.utils.escapeHtml(str);
    return `<pre class="markdown-code"><code>${escaped}</code></pre>`;
  }
});

// Register KaTeX plugin for $...$ and $$...$$ delimiters.
// The package is CommonJS, so the callable plugin may sit on `.default`.
const katexPlugin = typeof markdownItKatex === 'function'
  ? markdownItKatex
  : markdownItKatex?.default;
const compatibleKatex = {
  renderToString(source, options) {
    return katex.renderToString(normalizeEscapedKatexSource(source), options);
  }
};

md.use(katexPlugin, {
  katex: compatibleKatex,
  throwOnError: false,
  strict: false,
  enableBareBlocks: true
});

// Keep math readable in responsive containers by scaling only formulas whose
// natural width is larger than their containing paragraph.
const originalInlineKatexRenderer = md.renderer.rules.math_inline;
if (typeof originalInlineKatexRenderer === 'function') {
  md.renderer.rules.math_inline = (tokens, idx, options, env, self) => (
    `<span class="katex-inline-fit">${originalInlineKatexRenderer(tokens, idx, options, env, self)}</span>`
  );
}

// Character codes for backslash delimiter parsing
const BACKSLASH_CHAR_CODE = 0x5c;
const OPEN_PAREN_CHAR_CODE = 0x28;
const OPEN_BRACKET_CHAR_CODE = 0x5b;
const INLINE_MATH_CLOSE = '\\)';
const ESCAPED_INLINE_MATH_OPEN = '\\\\(';
const ESCAPED_INLINE_MATH_CLOSE = '\\\\)';
const BLOCK_MATH_CLOSE = '\\]';
const ESCAPED_BLOCK_MATH_OPEN = '\\\\[';
const ESCAPED_BLOCK_MATH_CLOSE = '\\\\]';

// A color box is a TeX expression even when the provider omits outer math
// delimiters. Capture the balanced command as one token so KaTeX can render
// the box and its nested `\(...\)` content together.
function mathInlineColorBox(state, silent) {
  const expression = findColorBoxExpression(state.src, state.pos);
  if (!expression) return false;
  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.markup = expression.name;
    token.content = state.src.slice(expression.start, expression.end);
  }
  state.pos = expression.end;
  return true;
}

// Inline rule for \(...\). Unterminated math falls through to plain text so
// streaming responses never flash a KaTeX error mid-formula.
function mathInlineParen(state, silent) {
  const start = state.pos;
  const escaped = state.src.startsWith(ESCAPED_INLINE_MATH_OPEN, start);
  const openLength = escaped ? ESCAPED_INLINE_MATH_OPEN.length : 2;
  const closeDelimiter = escaped ? ESCAPED_INLINE_MATH_CLOSE : INLINE_MATH_CLOSE;
  if (!escaped) {
    if (state.src.charCodeAt(start) !== BACKSLASH_CHAR_CODE) return false;
    if (state.src.charCodeAt(start + 1) !== OPEN_PAREN_CHAR_CODE) return false;
  }
  const end = state.src.indexOf(closeDelimiter, start + openLength);
  if (end === -1) return false;
  const content = state.src.slice(start + openLength, end);
  if (!content.trim()) return false;
  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.markup = '\\(';
    token.content = content;
  }
  state.pos = end + closeDelimiter.length;
  return true;
}

// Block rule for \[...\]. Emitting a block token keeps the rendered
// <p class="katex-block"> at the top level instead of nesting it in a paragraph.
function mathBlockBracket(state, startLine, endLine, silent) {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const escaped = state.src.startsWith(ESCAPED_BLOCK_MATH_OPEN, start);
  const openLength = escaped ? ESCAPED_BLOCK_MATH_OPEN.length : 2;
  const closeDelimiter = escaped ? ESCAPED_BLOCK_MATH_CLOSE : BLOCK_MATH_CLOSE;
  if (!escaped) {
    if (state.src.charCodeAt(start) !== BACKSLASH_CHAR_CODE) return false;
    if (state.src.charCodeAt(start + 1) !== OPEN_BRACKET_CHAR_CODE) return false;
  }

  const firstLineTail = state.src.slice(start + openLength, max);
  let content = null;
  let nextLine = startLine;
  const closeIndex = firstLineTail.indexOf(closeDelimiter);
  if (closeIndex !== -1) {
    if (firstLineTail.slice(closeIndex + closeDelimiter.length).trim()) return false;
    content = firstLineTail.slice(0, closeIndex);
  } else {
    let buffer = firstLineTail;
    while (content === null) {
      nextLine += 1;
      if (nextLine >= endLine) return false;
      const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
      const lineEnd = state.eMarks[nextLine];
      const line = state.src.slice(lineStart, lineEnd);
      const lineClose = line.indexOf(closeDelimiter);
      if (lineClose === -1) {
        buffer += `\n${line}`;
        continue;
      }
      if (line.slice(lineClose + closeDelimiter.length).trim()) return false;
      content = `${buffer}\n${line.slice(0, lineClose)}`;
    }
  }
  if (!content.trim()) return false;
  if (silent) return true;

  const token = state.push('math_block', 'math', 0);
  token.block = true;
  token.markup = '\\[';
  token.content = content;
  token.map = [startLine, nextLine + 1];
  state.line = nextLine + 1;
  return true;
}

md.inline.ruler.before('escape', 'math_inline_paren', mathInlineParen);
md.inline.ruler.before('escape', 'math_inline_colorbox', mathInlineColorBox);
md.block.ruler.before('fence', 'math_block_bracket', mathBlockBracket, {
  alt: ['paragraph', 'blockquote', 'list']
});

// Custom fence renderer to wrap code blocks properly
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const info = token.info ? token.info.trim() : '';
  const langName = info.split(/\s+/)[0];
  
  if (options.highlight) {
    const highlighted = options.highlight(token.content, langName, info);
    if (highlighted.indexOf('<pre') !== 0) {
      return `<pre class="markdown-code"><code class="hljs${langName ? ` language-${langName}` : ''}">${highlighted}</code></pre>`;
    }
    return highlighted;
  }
  
  const escaped = md.utils.escapeHtml(token.content);
  return `<pre class="markdown-code"><code${langName ? ` class="language-${langName}"` : ''}>${escaped}</code></pre>`;
};

// Cache for rendered HTML
const renderCache = new Map();
const MAX_CACHE_SIZE = 200;
const LF_CHAR_CODE = 10;
const CR_CHAR_CODE = 13;
const FOLD_CARET = '\u203a';
const DEFAULT_FOLD_TITLE = '\u6298\u53e0\u5185\u5bb9';

function getCachedRender(text, renderPlugins = []) {
  if (!text) return '';
  const cacheKey = `${text}\n<!--plugins:${buildPluginCacheKey(renderPlugins)}-->`;
  if (renderCache.has(cacheKey)) {
    const cached = renderCache.get(cacheKey);
    renderCache.delete(cacheKey);
    renderCache.set(cacheKey, cached);
    return cached;
  }
  
  const rawHtml = renderWithPlugins(text, renderPlugins);
  const html = DOMPurify.sanitize(rawHtml, {
    // `semantics`/`annotation` carry the original TeX inside KaTeX's MathML and
    // are not in DOMPurify's default allow-list, so copy-as-LaTeX and screen
    // readers need them added back explicitly.
    ADD_TAGS: ['pre', 'code', 'span', 'details', 'summary', 'div', 'semantics', 'annotation'],
    ADD_ATTR: ['class', 'data-lang', 'open', 'encoding']
  });
  
  // Evict oldest entries if cache is full
  if (renderCache.size >= MAX_CACHE_SIZE) {
    const firstKey = renderCache.keys().next().value;
    renderCache.delete(firstKey);
  }
  
  renderCache.set(cacheKey, html);
  return html;
}

function renderWithPlugins(text, renderPlugins = []) {
  const plugins = compileFoldPlugins(renderPlugins);
  if (!plugins.length) {
    return md.render(text);
  }

  let html = '';
  let normalText = '';
  let hasNormalText = false;
  let fold = null;
  const flushNormal = () => {
    if (hasNormalText) {
      html += md.render(normalText);
      normalText = '';
      hasNormalText = false;
    }
  };
  const flushFold = () => {
    if (fold) {
      html += renderFoldSegment(fold);
      fold = null;
    }
  };

  forEachMarkdownLine(String(text || ''), (line) => {
    const match = matchFoldPlugin(line, plugins);
    if (match) {
      flushNormal();
      flushFold();
      fold = { title: match.title, bodyText: '', hasBodyText: false };
      return;
    }
    if (fold) {
      fold.bodyText = appendLineText(fold.bodyText, line, fold.hasBodyText);
      fold.hasBodyText = true;
    } else {
      normalText = appendLineText(normalText, line, hasNormalText);
      hasNormalText = true;
    }
  });
  flushFold();
  flushNormal();

  return html;
}

function appendLineText(currentText, line, hasText) {
  return hasText ? `${currentText}\n${line}` : line;
}

function forEachMarkdownLine(text, visit) {
  let startIndex = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== LF_CHAR_CODE) {
      continue;
    }
    const endIndex = index > startIndex && text.charCodeAt(index - 1) === CR_CHAR_CODE
      ? index - 1
      : index;
    visit(text.slice(startIndex, endIndex));
    startIndex = index + 1;
  }
  visit(text.slice(startIndex));
}

function renderFoldSegment(segment) {
  const body = md.render(segment.bodyText.trim());
  return '<details class="markdown-fold">'
    + '<summary class="markdown-fold-summary">'
    + `<span class="markdown-fold-caret">${FOLD_CARET}</span>`
    + `<span class="markdown-fold-title">${md.utils.escapeHtml(segment.title || DEFAULT_FOLD_TITLE)}</span>`
    + '</summary>'
    + `<div class="markdown-fold-body">${body}</div>`
    + '</details>';
}

function compileFoldPlugins(renderPlugins = []) {
  const plugins = [];
  const sourcePlugins = Array.isArray(renderPlugins) ? renderPlugins : [];
  for (const plugin of sourcePlugins) {
    if (!plugin || plugin.enabled === false || (plugin.type || 'fold') !== 'fold' || !plugin.pattern) {
      continue;
    }
    try {
      const flags = normalizeRegexFlags(plugin.flags || 'u');
      plugins.push({
        regex: new RegExp(plugin.pattern, flags),
        titleTemplate: String(plugin.titleTemplate || plugin.label || '$1')
      });
    } catch (error) {
      recordFrontendDiagnostic('markdown.foldPlugin.compile', error, {
        pattern: plugin.pattern,
        flags: plugin.flags || 'u'
      });
    }
  }
  return plugins;
}

function normalizeRegexFlags(flags) {
  return normalizeSharedRegexFlags(flags, 'u').replace(/g/g, '') || 'u';
}

function matchFoldPlugin(line, plugins) {
  for (const plugin of plugins) {
    plugin.regex.lastIndex = 0;
    const match = plugin.regex.exec(line);
    if (match) {
      return {
        title: applyTitleTemplate(plugin.titleTemplate, match, line)
      };
    }
  }
  return null;
}

function applyTitleTemplate(template, match, fallback) {
  const value = String(template || '$1').replace(/\$(\d+)/g, (_, index) => match[Number(index)] || '');
  return (value.trim() || fallback.trim() || DEFAULT_FOLD_TITLE).slice(0, 80);
}

function buildPluginCacheKey(renderPlugins = []) {
  let cacheKey = '';
  const sourcePlugins = Array.isArray(renderPlugins) ? renderPlugins : [];
  for (const plugin of sourcePlugins) {
    cacheKey = appendPluginCacheField(cacheKey, plugin?.enabled !== false ? '1' : '0');
    cacheKey = appendPluginCacheField(cacheKey, plugin?.type || 'fold');
    cacheKey = appendPluginCacheField(cacheKey, plugin?.pattern || '');
    cacheKey = appendPluginCacheField(cacheKey, plugin?.flags || '');
    cacheKey = appendPluginCacheField(cacheKey, plugin?.titleTemplate || plugin?.label || '');
  }
  return cacheKey;
}

function appendPluginCacheField(cacheKey, value) {
  const text = String(value ?? '');
  return `${cacheKey}${text.length}:${text};`;
}

function applyKatexSurfaceContrast(root) {
  if (!root || typeof getComputedStyle !== 'function') return;

  const surfaces = root.querySelectorAll(
    '.katex-html .stretchy.fcolorbox, .katex-html .stretchy.colorbox'
  );
  for (const surface of surfaces) {
    const contentLayer = surface.parentElement?.nextElementSibling;
    if (!contentLayer?.style) continue;

    const textColor = selectKatexSurfaceTextColor(
      getComputedStyle(surface).backgroundColor
    );
    if (textColor) {
      contentLayer.style.color = textColor;
    } else {
      contentLayer.style.removeProperty('color');
    }
  }
}

export default defineComponent({
  name: 'MarkdownContent',
  inheritAttrs: false,
  emits: ['rendered'],
  props: {
    text: {
      type: String,
      default: ''
    },
    renderPlugins: {
      type: Array,
      default: () => []
    },
    deferUpdates: {
      type: Boolean,
      default: false
    }
  },
  setup(props, { attrs, emit }) {
    const rootElement = ref(null);
    const katexPreviewSource = ref(null);
    let pendingMarkdownText = props.text;
    let pendingRenderPlugins = props.renderPlugins;
    let pendingHtml = '';
    let appliedHtml = null;
    let templateElement = null;
    let katexResizeObserver = null;
    let katexFitTimeout = null;

    function renderMarkdownNow(text, renderPlugins) {
      pendingHtml = getCachedRender(text, renderPlugins);
      reconcileRenderedHtml();
    }

    function reconcileRenderedHtml() {
      const root = rootElement.value;
      if (!root || appliedHtml === pendingHtml || typeof document === 'undefined') return;
      templateElement ||= document.createElement('template');
      templateElement.innerHTML = pendingHtml;
      reconcileDomChildren(root, templateElement.content);
      applyKatexSurfaceContrast(root);
      appliedHtml = pendingHtml;
      fitInlineKatex();
      emit('rendered');
    }

    function fitInlineKatex() {
      const root = rootElement.value;
      if (!root) return;

      const wrappers = root.querySelectorAll('.katex-inline-fit, .katex-block');

      for (const wrapper of wrappers) {
        wrapper.style.removeProperty('width');
        wrapper.style.removeProperty('height');
        wrapper.style.removeProperty('--katex-scale');
        wrapper.removeAttribute('data-katex-scaled');
        wrapper.removeAttribute('data-katex-previewable');
        wrapper.removeAttribute('role');
        wrapper.removeAttribute('tabindex');
        wrapper.removeAttribute('aria-haspopup');
        wrapper.removeAttribute('aria-label');
        wrapper.removeAttribute('title');

        const formula = wrapper.querySelector(':scope > .katex') || wrapper.querySelector('.katex');
        const parent = wrapper.parentElement;
        const parentStyle = parent && typeof getComputedStyle === 'function'
          ? getComputedStyle(parent)
          : null;
        const parentWidth = parent?.clientWidth || root.clientWidth;
        const horizontalPadding = parentStyle
          ? (parseFloat(parentStyle.paddingLeft) || 0) + (parseFloat(parentStyle.paddingRight) || 0)
          : 0;
        const availableWidth = Math.max(1, parentWidth - horizontalPadding);
        if (!formula || !availableWidth) continue;

        const naturalSize = formula.getBoundingClientRect();
        // Display-mode KaTeX can stretch its outer box to the paragraph width;
        // scrollWidth preserves the formula's actual min-content width.
        const naturalWidth = Math.max(naturalSize.width, formula.scrollWidth || 0);
        if (!(naturalWidth > availableWidth + 0.5)) continue;

        // Leave a pixel of breathing room for fractional transform rounding.
        const fittingWidth = Math.max(1, availableWidth - 1);
        const scale = fittingWidth / naturalWidth;
        wrapper.style.width = `${availableWidth}px`;
        wrapper.style.height = `${naturalSize.height * scale}px`;
        wrapper.style.setProperty('--katex-scale', String(scale));
        wrapper.dataset.katexScaled = 'true';
        wrapper.dataset.katexPreviewable = 'true';
        wrapper.setAttribute('role', 'button');
        wrapper.setAttribute('tabindex', '0');
        wrapper.setAttribute('aria-haspopup', 'dialog');
        wrapper.setAttribute('aria-label', '打开公式预览');
        wrapper.setAttribute('title', '打开公式预览');
      }
    }

    function findKatexPreviewWrapper(target) {
      const element = target?.nodeType === 1 ? target : target?.parentElement;
      const wrapper = element?.closest?.('[data-katex-previewable="true"]');
      return wrapper && rootElement.value?.contains(wrapper) ? wrapper : null;
    }

    function openKatexPreview(wrapper) {
      const formula = wrapper?.querySelector(':scope > .katex') || wrapper?.querySelector('.katex');
      if (!formula || typeof getComputedStyle !== 'function') return;

      const source = formula.cloneNode(true);
      const formulaStyle = getComputedStyle(formula);
      source.style.fontSize = formulaStyle.fontSize;
      source.style.color = formulaStyle.color;
      wrapper.focus({ preventScroll: true });
      katexPreviewSource.value = source;
    }

    function closeKatexPreview() {
      katexPreviewSource.value = null;
    }

    function handleKatexPreviewClick(event) {
      const wrapper = findKatexPreviewWrapper(event.target);
      if (wrapper) openKatexPreview(wrapper);
    }

    function handleKatexPreviewKeydown(event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const wrapper = findKatexPreviewWrapper(event.target);
      if (!wrapper) return;
      event.preventDefault();
      openKatexPreview(wrapper);
    }

    function scheduleKatexFit() {
      if (katexFitTimeout !== null) return;
      // Defer observer-driven writes to the next task to avoid resize loops.
      katexFitTimeout = setTimeout(() => {
        katexFitTimeout = null;
        fitInlineKatex();
      }, 0);
    }

    function scheduleRenderedMarkdown() {
      pendingMarkdownText = props.text;
      pendingRenderPlugins = props.renderPlugins;

      renderMarkdownNow(pendingMarkdownText, pendingRenderPlugins);
    }

    // The typewriter owns the visible update cadence. Commit Markdown after
    // Vue's text update without adding a second animation-frame queue.
    watch(() => props.text, scheduleRenderedMarkdown, { immediate: true, flush: 'post' });
    watch(() => buildPluginCacheKey(props.renderPlugins), scheduleRenderedMarkdown, { flush: 'post' });
    onMounted(() => {
      reconcileRenderedHtml();
      fitInlineKatex();
      if (typeof ResizeObserver === 'function' && rootElement.value) {
        katexResizeObserver = new ResizeObserver(scheduleKatexFit);
        katexResizeObserver.observe(rootElement.value);
      }
    });
    onBeforeUnmount(() => {
      closeKatexPreview();
      katexResizeObserver?.disconnect();
      katexResizeObserver = null;
      if (katexFitTimeout !== null) {
        clearTimeout(katexFitTimeout);
        katexFitTimeout = null;
      }
    });
    
    return () => {
      const { class: className, ...restAttrs } = attrs;
      return [
        h(
          'div',
          {
            ...restAttrs,
            ref: rootElement,
            class: ['markdown-content', className],
            'data-stream-rendering': props.deferUpdates ? 'true' : undefined,
            onClick: handleKatexPreviewClick,
            onKeydown: handleKatexPreviewKeydown
          }
        ),
        katexPreviewSource.value
          ? h(KatexPreviewDialog, {
              sourceElement: katexPreviewSource.value,
              onClose: closeKatexPreview
            })
          : null
      ];
    };
  }
});
</script>
