// Executable status bars share the existing template storage and export path.
export const STATUS_BAR_RUNTIME_LIMIT = 50000;

// Custom templates keep their placeholder language outside scripts. Treat a
// script as HTML raw text so JavaScript braces and script attributes survive
// interpolation without becoming inferred status variables.
export function hasStatusBarTemplateScripts(template) {
  if (typeof template !== 'string') return false;
  try {
    JSON.parse(template);
    return false;
  } catch {
    return collectTemplateScriptRanges(template).length > 0;
  }
}

// Inline handlers and JavaScript URLs need the same frame as script tags,
// including templates that do not contain a separate <script> block.
export function hasStatusBarTemplateRuntime(template) {
  if (typeof template !== 'string') return false;
  try {
    JSON.parse(template);
    return false;
  } catch {
    return collectTemplateCodeRanges(template).length > 0;
  }
}

export function mapStatusBarTemplateMarkup(template, transform, { markNodes = false } = {}) {
  const source = String(template ?? '');
  const ranges = collectTemplateCodeRanges(source);
  if (!ranges.length) return transform(markNodes ? markTemplateElements(source) : source);
  let prefix = 'FLAI_STATUS_SCRIPT_BLOCK_';
  while (source.includes(prefix)) prefix += '_';
  const scripts = [];
  let cursor = 0;
  const parts = [];
  for (const { start, end } of ranges) {
    const marker = `${prefix}${scripts.length}_END`;
    parts.push(source.slice(cursor, start), marker);
    scripts.push({ marker, source: source.slice(start, end) });
    cursor = end;
  }
  parts.push(source.slice(cursor));
  const markup = parts.join('');
  let result = String(transform(markNodes ? markTemplateElements(markup) : markup) ?? '');
  for (const script of scripts) result = result.split(script.marker).join(script.source);
  return result;
}

export function stripStatusBarTemplateScripts(template) {
  const source = String(template ?? '');
  return removeTemplateRanges(source, collectTemplateScriptRanges(source));
}

export function stripStatusBarTemplateCode(template) {
  const source = String(template ?? '');
  return removeTemplateRanges(source, collectTemplateCodeRanges(source));
}

function removeTemplateRanges(source, ranges) {
  let cursor = 0;
  const parts = [];
  for (const { start, end } of ranges) {
    parts.push(source.slice(cursor, start));
    cursor = end;
  }
  parts.push(source.slice(cursor));
  return parts.join('');
}

function collectTemplateCodeRanges(source) {
  const attributes = [];
  const scripts = collectTemplateScriptRanges(source, ({ start, end }) => {
    const opening = source.slice(start, end);
    const tag = /^<[a-z][a-z0-9:-]*/i.exec(opening);
    const pattern = /([^\t\n\f\r "'<>\/=]+)(?:[\t\n\f\r ]*=[\t\n\f\r ]*(?:"([^"]*)"|'([^']*)'|([^\t\n\f\r >]*)))?/g;
    pattern.lastIndex = tag?.[0].length || 0;
    let match;
    while ((match = pattern.exec(opening))) {
      const name = match[1].toLowerCase();
      const value = match[2] ?? match[3] ?? match[4] ?? '';
      if (/^on[a-z]+$/.test(name) || isTemplateJavaScriptUrl(name, value)) {
        attributes.push({ start: start + match.index, end: start + pattern.lastIndex });
      }
    }
  });
  return [...scripts, ...attributes].sort((left, right) => left.start - right.start);
}

function isTemplateJavaScriptUrl(name, value) {
  if (!['href', 'src', 'xlink:href', 'action', 'formaction'].includes(name)) return false;
  const decoded = value.replace(/&#(x[0-9a-f]+|[0-9]+);?|&(colon|tab|newline);/gi, (entity, numeric, named) => {
    if (numeric) {
      const code = numeric[0].toLowerCase() === 'x' ? parseInt(numeric.slice(1), 16) : parseInt(numeric, 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return named.toLowerCase() === 'colon' ? ':' : '\n';
  }).replace(/[\u0000-\u0020]/g, '');
  return /^javascript:/i.test(decoded);
}

function markTemplateElements(source) {
  const parts = [];
  let cursor = 0;
  collectTemplateScriptRanges(source, ({ start, end }) => {
    if (source[end - 1] !== '>') return;
    const insertion = source[end - 2] === '/' ? end - 2 : end - 1;
    parts.push(source.slice(cursor, insertion), ` data-flai-template-node="sb-${start}"`);
    cursor = insertion;
  });
  parts.push(source.slice(cursor));
  return parts.join('');
}

function collectTemplateScriptRanges(source, visitOpening) {
  const ranges = [];
  const rawTextTags = new Set(['style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes']);
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf('<', cursor);
    if (start < 0) break;
    if (source.startsWith('<!--', start)) {
      const end = source.indexOf('-->', start + 4);
      cursor = end < 0 ? source.length : end + 3;
      continue;
    }
    const opening = /^<([a-z][a-z0-9:-]*)(?=[\t\n\f\r />]|$)/i.exec(source.slice(start));
    const tagEnd = findTemplateTagEnd(source, start);
    if (!opening) {
      cursor = /^<\/?[a-z!]/i.test(source.slice(start, start + 3)) ? tagEnd : start + 1;
      continue;
    }
    const tag = opening[1].toLowerCase();
    if (tag !== 'script') visitOpening?.({ start, end: tagEnd });
    if (tag === 'plaintext') break;
    if (tag === 'script' || rawTextTags.has(tag)) {
      const closing = new RegExp(`</${tag}(?=[\\t\\n\\f\\r />]|$)`, 'gi');
      closing.lastIndex = tagEnd;
      const match = closing.exec(source);
      const end = match ? findTemplateTagEnd(source, match.index) : source.length;
      if (tag === 'script') ranges.push({ start, end });
      cursor = end;
    } else {
      cursor = tagEnd;
    }
  }
  return ranges;
}

function findTemplateTagEnd(source, start) {
  let quote = '';
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index + 1;
    }
  }
  return source.length;
}

export function parseStatusBarRuntime(template) {
  let source;
  try {
    source = typeof template === 'string' ? JSON.parse(template) : template;
  } catch {
    return null;
  }
  if (!source || Array.isArray(source) || source.renderer !== 'runtime') return null;
  return {
    renderer: 'runtime',
    framework: source.framework === 'vue' ? 'vue' : 'html',
    html: typeof source.html === 'string' ? source.html : '',
    css: typeof source.css === 'string' ? source.css : '',
    javascript: typeof source.javascript === 'string' ? source.javascript : ''
  };
}

export function serializeStatusBarRuntime(config = {}) {
  return JSON.stringify(parseStatusBarRuntime({ ...config, renderer: 'runtime' }));
}

export function createStatusBarRuntimeExample(framework = 'vue') {
  const css = `body { margin: 0; font-family: system-ui, sans-serif; color: var(--sb-text, #e5e7eb); }
.panel { padding: 18px; border-radius: 16px; background: linear-gradient(135deg, #17253d, #1d3441); }
h3 { margin: 0 0 12px; color: #8ee6d2; }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 8px 0; }
button { padding: 6px 12px; border: 1px solid #76cbb9; border-radius: 8px; color: #d4fff5; background: #25483f; cursor: pointer; }
small { opacity: .7; }`;
  if (framework === 'html') {
    return {
      renderer: 'runtime', framework: 'html', css,
      html: '<section class="panel"><h3 id="title">状态面板</h3><div id="stats"></div><button onclick="api.quickReply(\'查看周围\')">查看周围</button></section>',
      javascript: `const title = document.querySelector('#title');
const stats = document.querySelector('#stats');
function render() {
  title.textContent = context.char || '状态面板';
  stats.replaceChildren(...variables.map(variable => {
    const row = document.createElement('p');
    row.textContent = variable.name + '：' + variable.value;
    return row;
  }));
}
render();
api.onUpdate(render);`
    };
  }
  return {
    renderer: 'runtime', framework: 'vue', css,
    html: `<section class="panel">
  <h3>{{ context.char || '状态面板' }}</h3>
  <div v-for="variable in variables" :key="variable.name" class="row">
    <span>{{ variable.name }}：{{ variable.value }}{{ variable.unit || '' }}</span>
    <button v-if="typeof variable.value === 'number'" @click="api.setVariable(variable.name, variable.value + 1)">+1</button>
  </div>
  <p v-if="!variables.length"><small>添加变量后会自动显示，也可以直接编写自己的界面。</small></p>
  <button @click="api.quickReply('查看周围')">查看周围</button>
  <small> 运行 {{ elapsed }} 秒</small>
</section>`,
    javascript: `const elapsed = Vue.ref(0);
const timer = setInterval(() => elapsed.value++, 1000);
api.onCleanup(() => clearInterval(timer));
return { elapsed };`
  };
}
