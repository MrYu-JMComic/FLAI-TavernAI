import { isPhoneViewport } from '../composables/useViewport.js';

const defaultAppearance = () => ({
  desktopBackgroundUrl: '',
  mobileBackgroundUrl: '',
  customCss: '',
  customJs: '',
  statusBarPrompt: ''
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
    customJs: normalizeOptionalText(input.customJs ?? input.custom_js ?? ''),
    statusBarPrompt: normalizeOptionalText(input.statusBarPrompt ?? input.status_bar_prompt ?? '')
  };
}

export function mergeChatAppearance(author = {}, user = {}) {
  const authorSettings = normalizeChatAppearance(author);
  const userSettings = normalizeChatAppearance(user);
  return {
    desktopBackgroundUrl: userSettings.desktopBackgroundUrl || authorSettings.desktopBackgroundUrl,
    mobileBackgroundUrl: userSettings.mobileBackgroundUrl || authorSettings.mobileBackgroundUrl,
    customCss: [authorSettings.customCss, userSettings.customCss].filter(Boolean).join('\n\n'),
    customJs: [authorSettings.customJs, userSettings.customJs].filter(Boolean).join('\n\n'),
    statusBarPrompt: [authorSettings.statusBarPrompt, userSettings.statusBarPrompt].filter(Boolean).join('\n\n')
  };
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
  wait = null
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
    isMobile: isPhoneViewport()
  };
}

export async function runChatCustomScript(source, ctx = {}) {
  const script = String(source || '').trim();
  if (!script) {
    return null;
  }

  const cleanupFns = [];
  const context = {
    ...buildChatScriptContext(ctx),
    onCleanup(fn) {
      if (typeof fn === 'function') {
        cleanupFns.push(fn);
      }
    },
    query(selector, root = ctx.root) {
      return root?.querySelector?.(selector) || null;
    },
    queryAll(selector, root = ctx.root) {
      return collectCustomScriptQueryAll(selector, root);
    },
    wait(ms) {
      return waitMs(ms);
    },
    requestPaint() {
      return nextFrame();
    }
  };

  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
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
      isMobile,
      onCleanup
    } = ctx;
    ${script}
  `;

  const runner = new AsyncFunction('ctx', wrapped);
  const result = await runner(context);
  if (typeof result === 'function') {
    cleanupFns.push(result);
  }

  if (!cleanupFns.length) {
    return null;
  }

  return () => {
    for (let index = cleanupFns.length - 1; index >= 0; index -= 1) {
      try {
        cleanupFns[index]();
      } catch {
        // Ignore custom cleanup failures.
      }
    }
  };
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
  return source.replace(/(^|})\s*([^@{}][^{}]*?)\s*\{/g, (full, prefix, selectorText) => {
    const selectors = selectorText
      .split(',')
      .map((selector) => scopeSelectorSelector(selector.trim(), scopeSelector))
      .filter(Boolean)
      .join(', ');
    return `${prefix}\n${selectors} {`;
  });
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
