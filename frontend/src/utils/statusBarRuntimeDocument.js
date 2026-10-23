// Runs inside the frame's realm so scripts, Vue and browser globals all refer
// to its document. The frame deliberately permits the user's own code.
function startStatusBarRuntime(Vue, config, initial) {
  const notify = (action, payload = {}) => parent.postMessage({
    type: 'flai-status-runtime', id: initial.id, action, ...payload
  }, '*');
  const report = (error) => notify('error', { message: String(error?.message || error || '运行失败') });
  const keydown = (event) => {
    if (event.key === 'Escape' && !event.defaultPrevented) notify('escape');
  };
  document.addEventListener('keydown', keydown);
  window.addEventListener('error', (event) => {
    if (event.target?.tagName === 'SCRIPT') report(`脚本加载失败：${event.target.src || 'inline'}`);
    else if (event.target === window) report(event.error || event.message);
  }, true);
  window.addEventListener('unhandledrejection', (event) => report(event.reason));
  if (!Vue) { report('Vue 运行时加载失败，请重新加载状态栏。'); return; }

  const variables = Vue.reactive([]);
  const values = Vue.reactive(Object.create(null));
  const context = Vue.reactive({});
  const state = Vue.reactive({ name: '', id: '', conversationId: '' });
  const cleanups = new Set();
  const subscribers = new Set();
  let app = null;
  let disposed = false;
  let observer = null;
  let lastHeight = 0;
  let authoredTemplate = null;
  let renderedTemplateHtml = '';
  const templateNodes = new WeakMap();

  function isExecutableScript(node) {
    const type = (node.getAttribute('type') || '').trim().toLowerCase();
    return !type || type === 'module' || type === 'importmap'
      || /^(?:(?:text|application)\/(?:x-)?(?:java|ecma)script|text\/(?:javascript1\.[0-5]|jscript|livescript))$/.test(type);
  }

  // Keep authored nodes separate from live DOM: only changed template values
  // are patched, preserving script-owned content, listeners and inserted nodes.
  function cloneTemplateNode(node) {
    const live = node.cloneNode(false);
    if (node.nodeType === 1 && node.localName === 'script' && isExecutableScript(node)) {
      live.setAttribute('type', 'application/x-flai-status-inert');
    }
    templateNodes.set(node, live);
    for (const child of node.childNodes) live.appendChild(cloneTemplateNode(child));
    return live;
  }

  function patchTemplateNode(previous, next, parent) {
    const live = templateNodes.get(previous);
    if (!live) return;
    if (previous.nodeType !== next.nodeType || previous.nodeName !== next.nodeName) {
      if (live.parentNode === parent) parent.replaceChild(cloneTemplateNode(next), live);
      return;
    }
    templateNodes.set(next, live);
    if (next.nodeType === 1) {
      // Scripts run once per source revision, including scripts inside loops.
      if (next.localName === 'script') return;
      for (const name of new Set([...previous.getAttributeNames(), ...next.getAttributeNames()])) {
        if (previous.getAttribute(name) === next.getAttribute(name)) continue;
        if (next.hasAttribute(name)) live.setAttribute(name, next.getAttribute(name));
        else live.removeAttribute(name);
      }
      patchTemplateChildren(previous, next, live);
    } else if (previous.nodeValue !== next.nodeValue) live.nodeValue = next.nodeValue;
  }

  function patchTemplateChildren(previous, next, parent) {
    const before = Array.from(previous.childNodes);
    const after = Array.from(next.childNodes);
    const used = new Set();
    // Match authored elements rather than live child indexes; scripts may add
    // siblings and conditional blocks may insert content before a control.
    const matches = after.map((node) => {
      const match = before.find((candidate) => !used.has(candidate)
        && candidate.nodeType === node.nodeType && candidate.nodeName === node.nodeName
        && (node.nodeType !== 1 || (candidate.getAttribute('id') === node.getAttribute('id')
          && candidate.getAttribute('data-flai-template-node') === node.getAttribute('data-flai-template-node')
          && (node.hasAttribute('data-flai-template-node') || candidate.getAttribute('class') === node.getAttribute('class')))));
      if (match) used.add(match);
      return match;
    });
    let previousLive = null;
    for (let index = 0; index < after.length; index += 1) {
      if (matches[index]) patchTemplateNode(matches[index], after[index], parent);
      else {
        const anchor = matches.slice(index + 1).map((node) => templateNodes.get(node))
          .find((node) => node?.parentNode === parent);
        parent.insertBefore(cloneTemplateNode(after[index]), anchor || null);
      }
      const live = templateNodes.get(after[index]);
      if (live?.parentNode === parent) {
        if (previousLive && (previousLive.compareDocumentPosition(live) & Node.DOCUMENT_POSITION_PRECEDING)) {
          parent.insertBefore(live, previousLive.nextSibling);
        }
        previousLive = live;
      }
    }
    for (const obsolete of before.filter((node) => !used.has(node))) {
      const live = templateNodes.get(obsolete);
      if (live?.parentNode === parent) live.remove();
    }
  }

  function updateTemplateHtml(html) {
    if (typeof html !== 'string' || (authoredTemplate && renderedTemplateHtml === html)) return;
    const root = document.getElementById('flai-status-runtime-root');
    if (!root) return;
    const next = document.createElement('template');
    next.innerHTML = html;
    if (authoredTemplate) patchTemplateChildren(authoredTemplate, next.content, root);
    else {
      root.classList.add('status-bar-custom');
      for (const child of next.content.childNodes) root.appendChild(cloneTemplateNode(child));
    }
    authoredTemplate = next.content;
    renderedTemplateHtml = html;
    notify('template-updated');
  }

  function resize() {
    if (disposed || !document.body) return;
    // Measure content rather than viewport height so a shrinking panel shrinks
    // its host frame as well. Absolute content is included by scrollHeight.
    const root = document.getElementById('flai-status-runtime-root');
    const height = Math.max(40, Math.ceil(Math.max(root?.getBoundingClientRect().height || 0, document.body.scrollHeight)));
    if (height !== lastHeight) { lastHeight = height; notify('resize', { height }); }
  }

  function update(next) {
    const bar = next.statusBar || {};
    variables.splice(0, variables.length, ...(bar.variables || []));
    for (const key of Object.keys(values)) delete values[key];
    for (const variable of variables) values[variable.name] = variable.value;
    for (const key of Object.keys(context)) delete context[key];
    Object.assign(context, next.context || {});
    state.name = bar.name || '';
    state.id = bar.id || '';
    state.conversationId = bar.conversationId || '';
    if (authoredTemplate) updateTemplateHtml(next.templateHtml);
    for (const listener of subscribers) {
      try { listener(api); } catch (error) { report(error); }
    }
    window.dispatchEvent(new CustomEvent('flai:status-update', { detail: { variables, values, context } }));
    Vue.nextTick(resize);
  }

  function register(set, handler) {
    if (typeof handler !== 'function') throw new TypeError('监听器必须是函数');
    set.add(handler);
    return () => set.delete(handler);
  }

  const api = {
    variables, values, context, state,
    getVariable: (name) => variables.find((variable) => variable.name === name),
    setVariable: (name, value, details = {}) => notify('update-variables', { updates: [{ ...details, name, value }] }),
    updateVariables: (updates) => notify('update-variables', { updates }),
    quickReply: (text) => notify('quick-reply', { text: String(text ?? '') }),
    send: (text) => notify('send', { text: String(text ?? '') }),
    openSettings: () => notify('open-settings'),
    onCleanup: (handler) => {
      if (disposed) {
        if (typeof handler !== 'function') throw new TypeError('监听器必须是函数');
        handler();
        return () => {};
      }
      return register(cleanups, handler);
    },
    onUpdate: (handler) => register(subscribers, handler)
  };
  Object.assign(window, { Vue, api, variables, values, context });
  update(initial);

  for (const [name, value] of Object.entries(initial.themeVariables || {})) {
    document.documentElement.style.setProperty(name, value);
  }

  const style = document.createElement('style');
  style.textContent = config.css;
  document.head.appendChild(style);

  function dispose() {
    if (disposed) return;
    disposed = true;
    observer?.disconnect();
    window.removeEventListener('message', receive);
    window.removeEventListener('pagehide', dispose);
    document.removeEventListener('keydown', keydown);
    try { app?.unmount(); } catch (error) { report(error); }
    for (const cleanup of cleanups) {
      try { cleanup(); } catch (error) { report(error); }
    }
    cleanups.clear();
    subscribers.clear();
  }

  function receive(event) {
    if (event.source !== parent || event.data?.id !== initial.id || event.data?.type !== 'flai-status-host') return;
    if (event.data.action === 'dispose') dispose();
    if (event.data.action === 'update' && !disposed) update(event.data);
  }
  window.addEventListener('message', receive);
  window.addEventListener('pagehide', dispose);

  document.addEventListener('DOMContentLoaded', async () => {
    if (disposed) return;
    try {
      const run = new Function('api', 'Vue', 'variables', 'values', 'context',
        'return (async () => {\n' + config.javascript + '\n})()');
      observer = new ResizeObserver(resize);
      observer.observe(document.body);
      if (config.framework === 'vue') {
        const component = {
          template: config.html,
          // Invoke the script with Vue's active setup instance. Lifecycle hooks
          // registered before a top-level await work like ordinary async setup.
          setup: () => run(api, Vue, variables, values, context).then((bindings) => ({
            ...(bindings && typeof bindings === 'object' ? bindings : {}), api, variables, values, context
          }))
        };
        app = Vue.createApp({ render: () => Vue.h(Vue.Suspense, {
          onResolve: () => { Vue.nextTick(resize); notify('ready'); }
        }, { default: () => Vue.h(component) }) });
        app.config.errorHandler = report;
        app.mount(document.getElementById('flai-status-runtime-root'));
      } else {
        await run(api, Vue, variables, values, context);
        if (!disposed) notify('ready');
      }
      resize();
    } catch (error) { report(error); }
  }, { once: true });

  // The footer writes parser-inserted scripts so external dependencies, defer,
  // modules and DOMContentLoaded keep ordinary browser execution semantics.
  // Each parsed script is then moved back to its authored place in the panel.
  let scripts = [];
  function initializeTemplate() {
    if (typeof initial.templateHtml !== 'string') return '';
    updateTemplateHtml(initial.templateHtml);
    scripts = Array.from(authoredTemplate.querySelectorAll('script')).filter(isExecutableScript);
    return scripts.map((node, index) => `${node.outerHTML}<script>initializeStatusTemplate.relocate(${index}, document.currentScript.previousElementSibling);<\/script>`).join('');
  }
  initializeTemplate.relocate = (index, script) => {
    const original = scripts[index];
    const inert = templateNodes.get(original);
    if (!inert?.parentNode || !script) return;
    templateNodes.set(original, script);
    inert.replaceWith(script);
    document.currentScript.remove();
  };
  return initializeTemplate;
}

function inlineJson(value) {
  // Keep code in JSON data until it is executed, including literal closing
  // script tags, Unicode separators, quotes and template expressions.
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function attribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function buildStatusBarRuntimeDocument(config, options) {
  const initial = { id: options.id, statusBar: options.statusBar || {}, context: options.context || {},
    templateHtml: options.templateHtml, themeVariables: options.theme?.variables };
  const theme = options.theme || {};
  const baseStyle = `:root { color-scheme: ${theme.colorScheme === 'light' ? 'light' : 'dark'}; }
html, body { margin: 0; min-height: 0; background: transparent; }
body { color: ${theme.color || '#e5e7eb'}; font: 14px/1.5 system-ui, sans-serif; overflow-wrap: anywhere; }
#flai-status-runtime-root { display: flow-root; }
* { box-sizing: border-box; }`;
  const bootstrap = startStatusBarRuntime.toString().replace(/<\/script/gi, '<\\/script');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${baseStyle}</style>
<script src="${attribute(options.moduleUrl)}"></script>
<script>const initializeStatusTemplate = (${bootstrap})(window.Vue, ${inlineJson(config)}, ${inlineJson(initial)});</script>
</head><body><div id="flai-status-runtime-root">${config.framework === 'html' ? config.html : ''}</div><script>document.write(initializeStatusTemplate?.() || '');</script></body></html>`;
}
