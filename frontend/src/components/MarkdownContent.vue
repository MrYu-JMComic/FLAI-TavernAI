<script>
import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import DOMPurify from 'dompurify';
import { normalizeRegexFlags as normalizeSharedRegexFlags } from '../../../shared/regexFlags.js';
import { recordFrontendDiagnostic } from '../diagnostics.js';
import { reconcileDomChildren } from '../utils/domReconciler.js';
import { selectKatexSurfaceTextColor } from '../utils/katexCompatibility.js';
import { md } from '../utils/markdownRenderer.js';
import { createMarkdownRenderCache } from '../utils/markdownRenderCache.js';
import { highlightDialogueQuotes } from '../utils/dialogueQuotes.js';
import KatexPreviewDialog from './KatexPreviewDialog.vue';
import 'katex/dist/katex.min.css';

const renderCache = createMarkdownRenderCache();
const LF_CHAR_CODE = 10;
const CR_CHAR_CODE = 13;
const FOLD_CARET = '\u203a';
const DEFAULT_FOLD_TITLE = '\u6298\u53e0\u5185\u5bb9';

function getCachedRender(text, renderPlugins = [], cacheResult = true) {
  if (!text) return '';
  const cacheKey = `${text}\n<!--plugins:${buildPluginCacheKey(renderPlugins)}-->`;
  const cached = cacheResult ? renderCache.get(cacheKey) : undefined;
  if (cached !== undefined) return cached;
  
  const rawHtml = renderWithPlugins(text, renderPlugins);
  const html = DOMPurify.sanitize(rawHtml, {
    // `semantics`/`annotation` carry the original TeX inside KaTeX's MathML and
    // are not in DOMPurify's default allow-list, so copy-as-LaTeX and screen
    // readers need them added back explicitly.
    ADD_TAGS: ['pre', 'code', 'span', 'details', 'summary', 'div', 'semantics', 'annotation'],
    ADD_ATTR: ['class', 'data-lang', 'open', 'encoding']
  });
  
  // Streaming prefixes are rarely reused and would evict settled history.
  if (cacheResult) renderCache.set(cacheKey, html);
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
    },
    highlightDialogue: {
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
    let appliedDialogueHighlight = null;
    let templateElement = null;
    let katexResizeObserver = null;
    let katexFitTimeout = null;

    function renderMarkdownNow(text, renderPlugins) {
      pendingHtml = getCachedRender(text, renderPlugins, !props.deferUpdates);
      reconcileRenderedHtml();
    }

    function reconcileRenderedHtml() {
      const root = rootElement.value;
      if (!root || typeof document === 'undefined') return;
      if (appliedHtml === pendingHtml && appliedDialogueHighlight === props.highlightDialogue) return;
      templateElement ||= document.createElement('template');
      templateElement.innerHTML = pendingHtml;
      if (props.highlightDialogue) highlightDialogueQuotes(templateElement.content);
      reconcileDomChildren(root, templateElement.content);
      applyKatexSurfaceContrast(root);
      appliedHtml = pendingHtml;
      appliedDialogueHighlight = props.highlightDialogue;
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
    watch(
      [() => props.text, () => buildPluginCacheKey(props.renderPlugins), () => props.deferUpdates],
      scheduleRenderedMarkdown,
      { immediate: true, flush: 'post' }
    );
    // The cached HTML is presentation-neutral; toggles only reconcile its DOM.
    watch(() => props.highlightDialogue, reconcileRenderedHtml, { flush: 'post' });
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

<style scoped>
.markdown-content :deep(.chat-dialogue-quote) {
  color: var(--chat-dialogue-color);
}
</style>
