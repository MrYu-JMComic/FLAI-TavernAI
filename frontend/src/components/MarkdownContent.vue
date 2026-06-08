<script>
import { computed, defineComponent, h } from 'vue';
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';

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
      } catch {}
    }
    const escaped = md.utils.escapeHtml(str);
    return `<pre class="markdown-code"><code>${escaped}</code></pre>`;
  }
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
const VALID_REGEX_FLAGS = 'dimsuvy';
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
    ADD_TAGS: ['pre', 'code', 'span', 'details', 'summary', 'div'],
    ADD_ATTR: ['class', 'data-lang', 'open']
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
    } catch {}
  }
  return plugins;
}

function normalizeRegexFlags(flags) {
  let normalized = '';
  for (const flag of String(flags || '')) {
    if (flag === 'g' || !VALID_REGEX_FLAGS.includes(flag) || normalized.includes(flag)) {
      continue;
    }
    normalized += flag;
  }
  return normalized || 'u';
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

export default defineComponent({
  name: 'MarkdownContent',
  inheritAttrs: false,
  props: {
    text: {
      type: String,
      default: ''
    },
    renderPlugins: {
      type: Array,
      default: () => []
    }
  },
  setup(props, { attrs }) {
    const renderedHtml = computed(() => getCachedRender(props.text, props.renderPlugins));
    
    return () => {
      const { class: className, ...restAttrs } = attrs;
      return h(
        'div',
        {
          ...restAttrs,
          class: ['markdown-content', className],
          innerHTML: renderedHtml.value
        }
      );
    };
  }
});
</script>
