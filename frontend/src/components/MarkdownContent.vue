<script>
import { computed, defineComponent, h, ref, watch } from 'vue';
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

function getCachedRender(text, renderPlugins = []) {
  if (!text) return '';
  const cacheKey = `${text}\n<!--plugins:${JSON.stringify(pluginCacheShape(renderPlugins))}-->`;
  const cached = renderCache.get(cacheKey);
  if (cached) return cached;
  
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

  const segments = [];
  let normal = [];
  let fold = null;
  const flushNormal = () => {
    if (normal.length) {
      segments.push({ type: 'markdown', text: normal.join('\n') });
      normal = [];
    }
  };
  const flushFold = () => {
    if (fold) {
      segments.push(fold);
      fold = null;
    }
  };

  for (const line of String(text || '').split(/\r?\n/)) {
    const match = matchFoldPlugin(line, plugins);
    if (match) {
      flushNormal();
      flushFold();
      fold = { type: 'fold', title: match.title, body: [] };
      continue;
    }
    if (fold) {
      fold.body.push(line);
    } else {
      normal.push(line);
    }
  }
  flushFold();
  flushNormal();

  return segments.map((segment) => {
    if (segment.type === 'fold') {
      const body = md.render(segment.body.join('\n').trim());
      return [
        '<details class="markdown-fold">',
        '<summary class="markdown-fold-summary">',
        '<span class="markdown-fold-caret">›</span>',
        `<span class="markdown-fold-title">${md.utils.escapeHtml(segment.title || '折叠内容')}</span>`,
        '</summary>',
        `<div class="markdown-fold-body">${body}</div>`,
        '</details>'
      ].join('');
    }
    return md.render(segment.text);
  }).join('');
}

function compileFoldPlugins(renderPlugins = []) {
  return renderPlugins
    .filter((plugin) => plugin && plugin.enabled !== false && (plugin.type || 'fold') === 'fold' && plugin.pattern)
    .map((plugin) => {
      try {
        const flags = normalizeRegexFlags(plugin.flags || 'u');
        return {
          regex: new RegExp(plugin.pattern, flags),
          titleTemplate: String(plugin.titleTemplate || plugin.label || '$1')
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function normalizeRegexFlags(flags) {
  return [...new Set(String(flags || '').replace(/[^dgimsuvy]/g, '').replace('g', '').split(''))].join('') || 'u';
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
  return (value.trim() || fallback.trim() || '折叠内容').slice(0, 80);
}

function pluginCacheShape(renderPlugins = []) {
  return renderPlugins.map((plugin) => ({
    enabled: plugin?.enabled !== false,
    type: plugin?.type || 'fold',
    pattern: plugin?.pattern || '',
    flags: plugin?.flags || '',
    titleTemplate: plugin?.titleTemplate || plugin?.label || ''
  }));
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
