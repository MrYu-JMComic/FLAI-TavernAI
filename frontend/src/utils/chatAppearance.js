import { isPhoneViewport } from '../composables/useViewport.js';
import { THINKING_LEVELS } from '../../../shared/providerThinking.js';
import { adjustStatusVariableValue, normalizeStatusVariableKey, resolveStatusVariableKind } from '../../../shared/statusVariables.js';

const defaultAppearance = () => ({
  desktopBackgroundUrl: '',
  mobileBackgroundUrl: '',
  customCss: '',
  customCssEnabled: false,
  customCssRiskAccepted: false,
  customJs: '',
  customJsEnabled: false,
  customJsRiskAccepted: false,
  statusBarPrompt: '',
  showWorldBookMatches: true,
  highlightDialogue: true,
  castTracking: { enabled: false, providerProfileId: '', modelOverride: '', autoSyncOperations: {}, organizeOperations: {} }
});

export function createDefaultChatAppearance() {
  return defaultAppearance();
}

export function normalizeChatAppearance(input = {}) {
  return {
    desktopBackgroundUrl: normalizeImageUrl(
      input.desktopBackgroundUrl ?? input.desktop_background_url ?? ''
    ),
    mobileBackgroundUrl: normalizeImageUrl(
      input.mobileBackgroundUrl ?? input.mobile_background_url ?? ''
    ),
    customCss: normalizeOptionalText(input.customCss ?? input.custom_css ?? ''),
    customCssEnabled: normalizeBoolean(input.customCssEnabled ?? input.custom_css_enabled, false),
    customCssRiskAccepted: normalizeBoolean(input.customCssRiskAccepted ?? input.custom_css_risk_accepted, false),
    customJs: normalizeOptionalText(input.customJs ?? input.custom_js ?? ''),
    customJsEnabled: normalizeBoolean(input.customJsEnabled ?? input.custom_js_enabled, false),
    customJsRiskAccepted: normalizeBoolean(input.customJsRiskAccepted ?? input.custom_js_risk_accepted, false),
    statusBarPrompt: normalizeOptionalText(input.statusBarPrompt ?? input.status_bar_prompt ?? ''),
    showWorldBookMatches: normalizeBoolean(input.showWorldBookMatches ?? input.show_world_book_matches, true),
    highlightDialogue: normalizeBoolean(input.highlightDialogue ?? input.highlight_dialogue, true),
    castTracking: normalizeCastTracking(input.castTracking ?? input.cast_tracking)
  };
}

export function mergeChatAppearance(author = {}, user = {}, options = {}) {
  const authorSettings = normalizeChatAppearance(author);
  if (options.allowAuthorDangerous !== true) {
    authorSettings.customCss = '';
    authorSettings.customCssEnabled = false;
    authorSettings.customCssRiskAccepted = false;
    authorSettings.customJs = '';
    authorSettings.customJsEnabled = false;
    authorSettings.customJsRiskAccepted = false;
  }
  const userSettings = normalizeChatAppearance(user);
  return {
    desktopBackgroundUrl: userSettings.desktopBackgroundUrl || authorSettings.desktopBackgroundUrl,
    mobileBackgroundUrl: userSettings.mobileBackgroundUrl || authorSettings.mobileBackgroundUrl,
    customCss: mergeAppearanceText(
      enabledAppearanceText(authorSettings.customCss, authorSettings.customCssEnabled, authorSettings.customCssRiskAccepted),
      enabledAppearanceText(userSettings.customCss, userSettings.customCssEnabled, userSettings.customCssRiskAccepted)
    ),
    customCssEnabled: isRiskAcceptedEnabled(authorSettings.customCssEnabled, authorSettings.customCssRiskAccepted) ||
      isRiskAcceptedEnabled(userSettings.customCssEnabled, userSettings.customCssRiskAccepted),
    customCssRiskAccepted: Boolean(authorSettings.customCssRiskAccepted || userSettings.customCssRiskAccepted),
    customJs: mergeAppearanceText(
      enabledAppearanceText(authorSettings.customJs, authorSettings.customJsEnabled, authorSettings.customJsRiskAccepted),
      enabledAppearanceText(userSettings.customJs, userSettings.customJsEnabled, userSettings.customJsRiskAccepted)
    ),
    customJsEnabled: isRiskAcceptedEnabled(authorSettings.customJsEnabled, authorSettings.customJsRiskAccepted) ||
      isRiskAcceptedEnabled(userSettings.customJsEnabled, userSettings.customJsRiskAccepted),
    customJsRiskAccepted: Boolean(authorSettings.customJsRiskAccepted || userSettings.customJsRiskAccepted),
    statusBarPrompt: mergeAppearanceText(authorSettings.statusBarPrompt, userSettings.statusBarPrompt),
    showWorldBookMatches: hasOwnSetting(user, 'showWorldBookMatches', 'show_world_book_matches')
      ? userSettings.showWorldBookMatches
      : authorSettings.showWorldBookMatches,
    highlightDialogue: hasOwnSetting(user, 'highlightDialogue', 'highlight_dialogue')
      ? userSettings.highlightDialogue
      : authorSettings.highlightDialogue,
    castTracking: hasOwnSetting(user, 'castTracking', 'cast_tracking')
      ? userSettings.castTracking
      : authorSettings.castTracking
  };
}

function mergeAppearanceText(authorText, userText) {
  if (authorText && userText) {
    return `${authorText}\n\n${userText}`;
  }
  return authorText || userText || '';
}

export function resolveChatBackgroundUrl(settings = {}, isMobile = false) {
  const normalized = normalizeChatAppearance(settings);
  return isMobile
    ? normalized.mobileBackgroundUrl || normalized.desktopBackgroundUrl
    : normalized.desktopBackgroundUrl || normalized.mobileBackgroundUrl;
}

export function buildScopedChatCss(cssText, scopeSelector) {
  const source = String(cssText || '').trim();
  if (!source) {
    return '';
  }

  const preservedBlocks = [];
  let working = stripPreservedBlocks(source, preservedBlocks);
  working = prefixCssSelectors(working, scopeSelector);

  preservedBlocks.forEach((block, index) => {
    working = working.replace(`__FLAI_CHAT_BLOCK_${index}__`, block);
  });

  return working;
}

export function buildChatScriptContext({
  conversation = null,
  character = null,
  user = null,
  provider = null,
  settings = {},
  state = {},
  root = null,
  main = null,
  sidebar = null,
  messageScroller = null,
  composer = null,
  messages = [],
  statusBar = null,
  query = null,
  queryAll = null,
  notify = null,
  openSidebar = null,
  closeSidebar = null,
  openSettings = null,
  closeSettings = null,
  scrollToBottom = null,
  setCssVar = null,
  requestPaint = null,
  wait = null,
  updateStatusVariables = null,
  insertText = null,
  sendMessage = null
} = {}) {
  return {
    conversation,
    character,
    user,
    provider,
    settings,
    state,
    root,
    main,
    sidebar,
    messageScroller,
    composer,
    messages,
    statusBar: snapshotStatusBarForScript(statusBar),
    query,
    queryAll,
    notify,
    openSidebar,
    closeSidebar,
    openSettings,
    closeSettings,
    scrollToBottom,
    setCssVar,
    requestPaint,
    wait,
    updateStatusVariables,
    insertText,
    sendMessage,
    isMobile: isPhoneViewport()
  };
}

// Plain, clonable view of the status bar handed to scripts; `type` is the
// resolved kind so scripts never have to guess meter vs text.
export function snapshotStatusBarForScript(statusBar) {
  if (!statusBar || typeof statusBar !== 'object') return null;
  const variables = [];
  for (const variable of Array.isArray(statusBar.variables) ? statusBar.variables : []) {
    if (!variable?.name) continue;
    const kind = resolveStatusVariableKind(variable);
    variables.push({
      name: String(variable.name),
      value: variable.value,
      type: kind,
      ...(kind === 'meter' ? { min: Number(variable.min) || 0, max: Number(variable.max) || 100 } : {}),
      unit: String(variable.unit || ''),
      color: String(variable.color || '')
    });
  }
  return {
    name: String(statusBar.name || ''),
    variables,
    template: String(statusBar.template || '')
  };
}

function findScriptStatusVariable(statusBar, name) {
  const key = normalizeStatusVariableKey(name);
  for (const variable of statusBar?.variables || []) {
    if (normalizeStatusVariableKey(variable.name) === key) return variable;
  }
  return null;
}

export async function runChatCustomScript(source, ctx = {}) {
  const script = String(source || '').trim();
  if (!script) {
    return null;
  }

  const cleanupFns = [];
  const listeners = new Map();
  const scriptContext = buildChatScriptContext(ctx);
  const context = {
    ...scriptContext,
    onCleanup(fn) {
      if (typeof fn === 'function') {
        cleanupFns.push(fn);
      }
    },
    on(event, fn) {
      addScriptListener(listeners, event, fn);
    },
    onAction(name, fn) {
      addScriptListener(listeners, `action:${String(name || '').trim()}`, fn);
    },
    getVar(name) {
      return findScriptStatusVariable(context.statusBar, name)?.value;
    },
    setVar(name, value) {
      return scriptContext.updateStatusVariables?.([{ name, value }]);
    },
    adjustVar(name, delta) {
      const variable = findScriptStatusVariable(context.statusBar, name);
      if (!variable) return undefined;
      return scriptContext.updateStatusVariables?.([{ name: variable.name, value: adjustStatusVariableValue(variable, delta) }]);
    },
    query(selector, root = ctx.root) {
      return root?.querySelector?.(selector) || null;
    },
    queryAll(selector, root = ctx.root) {
      return collectCustomScriptQueryAll(selector, root);
    },
    wait(ms) {
      if (typeof scriptContext.wait === 'function') {
        return scriptContext.wait(ms);
      }
      return waitMs(ms);
    },
    requestPaint() {
      if (typeof scriptContext.requestPaint === 'function') {
        return scriptContext.requestPaint();
      }
      return nextFrame();
    }
  };

  const wrapped = `
    const {
      conversation,
      character,
      user,
      provider,
      settings,
      state,
      root,
      main,
      sidebar,
      messageScroller,
      composer,
      messages,
      statusBar,
      query,
      queryAll,
      notify,
      openSidebar,
      closeSidebar,
      openSettings,
      closeSettings,
      scrollToBottom,
      setCssVar,
      requestPaint,
      wait,
      updateStatusVariables,
      insertText,
      sendMessage,
      getVar,
      setVar,
      adjustVar,
      on,
      onAction,
      isMobile,
      onCleanup
    } = ctx;
    ${script}
  `;

  // Browser execution is isolated; both paths expose the same named context API.
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    return runCustomScriptInSandbox(wrapped, context);
  }

  const runner = new Function('ctx', `return (async () => {${wrapped}})()`);
  let result;
  try {
    result = await runner(context);
  } catch (err) {
    runCustomScriptCleanup(cleanupFns);
    throw err;
  }
  if (typeof result === 'function') {
    cleanupFns.push(result);
  }

  if (!cleanupFns.length && !listeners.size) {
    return null;
  }

  const dispose = () => runCustomScriptCleanup(cleanupFns);
  dispose.emit = (event, payload) => {
    if (event === 'status') context.statusBar = snapshotStatusBarForScript(payload);
    dispatchScriptEvent(listeners, event, payload);
  };
  return dispose;
}

function addScriptListener(listeners, event, fn) {
  const name = String(event || '').trim();
  if (!name || typeof fn !== 'function') return;
  if (!listeners.has(name)) listeners.set(name, []);
  listeners.get(name).push(fn);
}

// `action` events carry { name, value, text } and reach both on('action') and
// the matching onAction(name) handlers.
function dispatchScriptEvent(listeners, event, payload) {
  const names = [String(event || '')];
  if (event === 'action' && payload?.name) names.push(`action:${payload.name}`);
  for (const name of names) {
    for (const fn of listeners.get(name) || []) {
      try {
        fn(event === 'status' ? snapshotStatusBarForScript(payload) : payload);
      } catch {
        // A failing listener must not break the host page.
      }
    }
  }
}

function runCustomScriptCleanup(cleanupFns) {
  for (let index = cleanupFns.length - 1; index >= 0; index -= 1) {
    try {
      cleanupFns[index]();
    } catch {
      // Ignore custom cleanup failures.
    }
  }
}

function collectCustomScriptQueryAll(selector, root) {
  if (!root || typeof root.querySelectorAll !== 'function') {
    return [];
  }
  const nodes = root.querySelectorAll(selector);
  const results = [];
  for (let index = 0; index < nodes.length; index += 1) {
    results.push(nodes[index]);
  }
  return results;
}

function normalizeOptionalText(value) {
  const text = String(value || '');
  return text.trim() ? text : '';
}

function normalizeBoolean(value, fallback = false) {
  if (value === true || value === 'true' || value === '1' || value === 'on') {
    return true;
  }
  if (value === false || value === 'false' || value === '0' || value === 'off') {
    return false;
  }
  return fallback;
}

// Functions cannot cross postMessage, so the sandbox receives an async proxy
// for each one and the parent performs the call. Only these names are exposed;
// anything else the script asks for is rejected here, in the parent.
const SANDBOX_CALLABLE_API = Object.freeze([
  'notify',
  'openSidebar',
  'closeSidebar',
  'openSettings',
  'closeSettings',
  'scrollToBottom',
  'setCssVar',
  'requestPaint',
  'wait',
  'updateStatusVariables',
  'setVar',
  'adjustVar',
  'insertText',
  'sendMessage',
  'query',
  'queryAll'
]);
const SANDBOX_STATUS_WRITERS = new Set(['setVar', 'adjustVar']);
const SANDBOX_QUERY_RESULT_LIMIT = 50;

const SANDBOX_SCRIPT_TIMEOUT_MS = 10000;

function isSandboxCallable(context, name) {
  if (name === 'notify') {
    return Boolean(context.notify) && (typeof context.notify === 'function' || typeof context.notify === 'object');
  }
  if (SANDBOX_STATUS_WRITERS.has(name)) {
    return typeof context.updateStatusVariables === 'function';
  }
  return typeof context[name] === 'function';
}

function runCustomScriptInSandbox(script, context) {
  const frame = document.createElement('iframe');
  // No allow-same-origin: the frame gets an opaque origin, so it cannot reach
  // this document's cookies, localStorage or same-origin fetch.
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.style.display = 'none';
  const token = `flai-chat-script-${Date.now()}-${Math.random()}`;
  const serialized = serializeSandboxContext(context);
  const callable = SANDBOX_CALLABLE_API.filter((name) => isSandboxCallable(context, name));
  const source = `<!doctype html><script>
    const TOKEN = ${JSON.stringify(token)};
    const pending = new Map();
    const cleanupFns = [];
    const listeners = new Map();
    let scriptContext = null;
    let nextCallId = 1;
    let started = false;
    let cleaning = false;
    let closed = false;
    function call(name, args) {
      return new Promise((resolve, reject) => {
        if (closed) return reject(new Error('Script has been disposed'));
        const callId = nextCallId++;
        pending.set(callId, { resolve, reject });
        try {
          parent.postMessage({ token: TOKEN, type: 'call', callId, name, args }, '*');
        } catch (error) {
          pending.delete(callId);
          reject(error);
        }
      });
    }
    function addListener(name, fn) {
      const key = String(name || '').trim();
      if (!key || typeof fn !== 'function' || cleaning) return;
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key).push(fn);
    }
    function dispatch(event, payload) {
      const names = [String(event || '')];
      if (event === 'action' && payload && payload.name) names.push('action:' + payload.name);
      for (const name of names) {
        for (const fn of listeners.get(name) || []) {
          try { fn(payload); } catch {}
        }
      }
    }
    async function cleanup() {
      if (cleaning) return;
      cleaning = true;
      for (let index = cleanupFns.length - 1; index >= 0; index -= 1) {
        try { await cleanupFns[index](); } catch {}
      }
      cleanupFns.length = 0;
      listeners.clear();
      closed = true;
    }
    window.addEventListener('message', async (event) => {
      if (event.source !== parent) return;
      const data = event.data;
      if (!data || data.token !== TOKEN) return;
      if (data.type === 'call-result') {
        const entry = pending.get(data.callId);
        pending.delete(data.callId);
        if (!entry) return;
        if (data.error) entry.reject(new Error(data.error));
        else entry.resolve(data.value);
        return;
      }
      if (data.type === 'event') {
        if (closed || !scriptContext) return;
        if (data.event === 'status') scriptContext.statusBar = data.payload;
        dispatch(data.event, data.payload);
        return;
      }
      if (data.type === 'cleanup' && !cleaning) {
        await cleanup();
        parent.postMessage({ token: TOKEN, type: 'cleanup_done' }, '*');
        return;
      }
      if (data.type !== 'run' || started) return;
      started = true;
      const ctx = data.context || {};
      scriptContext = ctx;
      for (const name of data.callable || []) ctx[name] = (...args) => call(name, args);
      if (typeof ctx.notify === 'function') {
        const send = ctx.notify;
        ctx.notify = Object.assign((text, type) => send(text, type), {
          info: (text) => send(text, 'info'),
          success: (text) => send(text, 'success'),
          warning: (text) => send(text, 'warning'),
          error: (text) => send(text, 'error')
        });
      }
      ctx.getVar = (name) => {
        const target = String(name == null ? '' : name).trim().toLowerCase();
        const variables = (ctx.statusBar && ctx.statusBar.variables) || [];
        const found = variables.find((item) => String(item.name).trim().toLowerCase() === target);
        return found ? found.value : undefined;
      };
      ctx.on = (name, fn) => addListener(name, fn);
      ctx.onAction = (name, fn) => addListener('action:' + String(name || '').trim(), fn);
      ctx.onCleanup = (fn) => {
        if (typeof fn === 'function' && !cleaning) cleanupFns.push(fn);
      };
      try {
        const result = await (new Function('ctx', 'return (async () => {' + data.script + '})()'))(ctx);
        if (typeof result === 'function') cleanupFns.push(result);
        parent.postMessage({ token: TOKEN, type: 'done', hasCleanup: cleanupFns.length > 0 || listeners.size > 0 }, '*');
      } catch (error) {
        await cleanup();
        parent.postMessage({ token: TOKEN, type: 'error', message: String(error?.message || error) }, '*');
      }
    });
  <\/script>`;
  frame.srcdoc = source;

  return new Promise((resolve, reject) => {
    let completed = false;
    let disposed = false;
    let cleanupPromise = null;
    let finishCleanup;
    const finish = () => {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      frame.remove();
      finishCleanup?.();
    };
    const dispose = () => {
      if (cleanupPromise) return cleanupPromise;
      if (disposed) return Promise.resolve();
      cleanupPromise = new Promise((done) => { finishCleanup = done; });
      timer = setTimeout(finish, SANDBOX_SCRIPT_TIMEOUT_MS);
      frame.contentWindow?.postMessage({ token, type: 'cleanup' }, '*');
      return cleanupPromise;
    };
    // Host events (status changes, template button actions) for listeners the
    // script registered with on() / onAction().
    dispose.emit = (event, payload) => {
      if (disposed || cleanupPromise || !completed) return;
      const data = event === 'status' ? snapshotStatusBarForScript(payload) : payload;
      frame.contentWindow?.postMessage({ token, type: 'event', event, payload: cloneableOrNull(data) }, '*');
    };
    const onMessage = (event) => {
      // The frame has an opaque origin, so identity is established by the
      // source window, not by event.origin.
      if (event.source !== frame.contentWindow) return;
      const data = event.data;
      if (!data || data.token !== token) return;
      if (data.type === 'call') {
        respondToSandboxCall(frame, token, data, context, callable);
        return;
      }
      if (data.type === 'error') {
        finish();
        reject(new Error(data.message));
        return;
      }
      if (data.type === 'cleanup_done') {
        finish();
        return;
      }
      if (data.type === 'done' && !completed) {
        completed = true;
        clearTimeout(timer);
        if (data.hasCleanup) resolve(dispose);
        else {
          finish();
          resolve(null);
        }
      }
    };
    let timer = setTimeout(() => {
      finish();
      reject(new Error('自定义脚本执行超时。'));
    }, SANDBOX_SCRIPT_TIMEOUT_MS);
    window.addEventListener('message', onMessage);
    frame.addEventListener('load', () => {
      if (!disposed) frame.contentWindow?.postMessage({ token, type: 'run', script, context: serialized, callable }, '*');
    }, { once: true });
    document.body?.appendChild(frame);
  });
}

async function respondToSandboxCall(frame, token, data, context, callable = SANDBOX_CALLABLE_API) {
  const reply = { token, type: 'call-result', callId: data.callId };
  const name = String(data.name);
  const args = Array.isArray(data.args) ? data.args : [];
  if (!SANDBOX_CALLABLE_API.includes(name) || !callable.includes(name)) {
    frame.contentWindow?.postMessage({ ...reply, error: `API 不可用: ${name}` }, '*');
    return;
  }
  try {
    let value;
    if (name === 'notify') {
      value = await callScriptNotify(context.notify, args[0], args[1]);
    } else if (name === 'query') {
      value = describeScriptElement(await context.query(String(args[0] ?? '')));
    } else if (name === 'queryAll') {
      const nodes = await context.queryAll(String(args[0] ?? ''));
      value = [];
      for (const node of Array.isArray(nodes) ? nodes.slice(0, SANDBOX_QUERY_RESULT_LIMIT) : []) {
        value.push(describeScriptElement(node));
      }
    } else {
      value = await context[name](...args);
    }
    frame.contentWindow?.postMessage({ ...reply, value: cloneableOrNull(value) }, '*');
  } catch (error) {
    frame.contentWindow?.postMessage({ ...reply, error: String(error?.message || error) }, '*');
  }
}

// notify(text, type) works with either the app's notify object or a plain
// callback (tests and embedders).
function callScriptNotify(notify, text, type) {
  const message = String(text ?? '');
  if (typeof notify === 'function') return notify(message, type);
  const level = ['success', 'warning', 'error', 'info'].includes(type) ? type : 'info';
  const method = notify?.[level] || notify?.info || notify?.show;
  return typeof method === 'function' ? method.call(notify, message) : undefined;
}

// DOM nodes never cross into the sandbox; scripts get a read-only summary.
function describeScriptElement(node) {
  if (!node || typeof node !== 'object' || !node.tagName) return null;
  const dataset = {};
  for (const [key, value] of Object.entries(node.dataset || {})) {
    dataset[key] = String(value).slice(0, 200);
  }
  return {
    tag: String(node.tagName).toLowerCase(),
    text: String(node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500),
    className: typeof node.className === 'string' ? node.className : '',
    dataset
  };
}

function cloneableOrNull(value) {
  try {
    return structuredClone(value);
  } catch {
    return null;
  }
}

// DOM handles and functions cannot be structured-cloned. Functions come back as
// proxies; DOM nodes stay unavailable by design, since reaching them would
// defeat the sandbox.
function serializeSandboxContext(context) {
  const output = {};
  for (const [key, value] of Object.entries(context)) {
    output[key] = typeof value === 'function' ? null : cloneableOrNull(value);
  }
  return output;
}

function normalizeCastTracking(value) {
  const input = value && typeof value === 'object' ? value : {};
  const thinkingLevel = normalizeOptionalThinkingLevel(input.thinkingLevel ?? input.thinking_level);
  return {
    enabled: normalizeBoolean(input.enabled, false),
    providerProfileId: String(input.providerProfileId || input.provider_profile_id || '').trim(),
    modelOverride: String(input.modelOverride || input.model_override || '').trim(),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    autoSyncOperations: normalizeOperationSwitches(input.autoSyncOperations ?? input.auto_sync_operations),
    organizeOperations: normalizeOperationSwitches(input.organizeOperations ?? input.organize_operations)
  };
}

function normalizeOptionalThinkingLevel(value) {
  const level = String(value ?? '').trim().toLowerCase();
  return THINKING_LEVELS.includes(level) ? level : '';
}

function normalizeOperationSwitches(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const switches = {};
  for (const key of Object.keys(source)) {
    switches[key] = source[key] === true;
  }
  return switches;
}

function hasOwnSetting(source, camelKey, snakeKey) {
  const input = source && typeof source === 'object' ? source : {};
  return Object.prototype.hasOwnProperty.call(input, camelKey)
    || Object.prototype.hasOwnProperty.call(input, snakeKey);
}

function normalizeImageUrl(value) {
  const input = String(value || '').trim();
  if (!input) {
    return '';
  }

  const unwrapped = input.replace(/^url\((.*)\)$/i, '$1').trim().replace(/^['"]|['"]$/g, '');
  if (
    /^https?:\/\//i.test(unwrapped)
    || unwrapped.startsWith('/')
    || /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(unwrapped)
  ) {
    return unwrapped;
  }

  return '';
}

function stripPreservedBlocks(source, preservedBlocks) {
  const markers = [
    '@-webkit-keyframes',
    '@keyframes'
  ];
  let output = '';
  let index = 0;

  while (index < source.length) {
    const match = markers.find((marker) => source.startsWith(marker, index));
    if (!match) {
      output += source[index];
      index += 1;
      continue;
    }

    const end = findBlockEnd(source, index);
    const token = `__FLAI_CHAT_BLOCK_${preservedBlocks.length}__`;
    preservedBlocks.push(source.slice(index, end));
    output += token;
    index = end;
  }

  return output;
}

function findBlockEnd(source, startIndex) {
  let depth = 0;
  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  return source.length;
}

function prefixCssSelectors(source, scopeSelector) {
  return source.replace(/(^|[{}])\s*([^@{}][^{}]*?)\s*\{/g, (full, prefix, selectorText) => {
    const selectors = scopeCssSelectorList(selectorText, scopeSelector);
    return `${prefix}\n${selectors} {`;
  });
}

function enabledAppearanceText(value, enabled, riskAccepted) {
  return isRiskAcceptedEnabled(enabled, riskAccepted) ? value : '';
}

function isRiskAcceptedEnabled(enabled, riskAccepted) {
  return Boolean(enabled && riskAccepted);
}

function scopeCssSelectorList(selectorText, scopeSelector) {
  let output = '';
  let startIndex = 0;
  let quote = '';
  let escaped = false;
  let bracketDepth = 0;
  let parenDepth = 0;

  for (let index = 0; index <= selectorText.length; index += 1) {
    const char = selectorText[index];
    if (
      index === selectorText.length
      || (char === ',' && !quote && bracketDepth === 0 && parenDepth === 0)
    ) {
      output = appendScopedCssSelector(output, selectorText.slice(startIndex, index), scopeSelector);
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
    } else if (char === '[') {
      bracketDepth += 1;
    } else if (char === ']' && bracketDepth > 0) {
      bracketDepth -= 1;
    } else if (char === '(') {
      parenDepth += 1;
    } else if (char === ')' && parenDepth > 0) {
      parenDepth -= 1;
    }
  }

  return output;
}

function appendScopedCssSelector(output, selector, scopeSelector) {
  const scopedSelector = scopeSelectorSelector(selector.trim(), scopeSelector);
  if (!scopedSelector) {
    return output;
  }
  return output ? `${output}, ${scopedSelector}` : scopedSelector;
}

function scopeSelectorSelector(selector, scopeSelector) {
  if (!selector) {
    return '';
  }

  const normalized = selector.replace(/^(?:\:root|html|body)\b/i, scopeSelector);
  if (normalized.startsWith(scopeSelector)) {
    return normalized;
  }
  return `${scopeSelector} ${normalized}`;
}

function waitMs(duration) {
  if (typeof window === 'undefined') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    window.setTimeout(resolve, Number(duration) || 0);
  });
}

function nextFrame() {
  if (typeof window === 'undefined') {
    return Promise.resolve();
  }
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}
