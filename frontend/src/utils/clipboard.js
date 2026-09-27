/**
 * Copy text across secure and non-secure browser contexts.
 * The legacy branch must stay synchronous after the click so mobile HTTP
 * pages retain the user activation required by execCommand('copy').
 */
export async function copyTextToClipboard(value) {
  const text = String(value ?? '');
  if (!text) {
    throw new Error('没有可复制的内容');
  }

  const nativeNavigator = typeof navigator !== 'undefined' ? navigator : null;
  const browserNavigator = nativeNavigator?.clipboard
    ? nativeNavigator
    : typeof window !== 'undefined' ? window.navigator : nativeNavigator;
  const modernClipboard = browserNavigator?.clipboard;
  if (typeof modernClipboard?.writeText === 'function') {
    try {
      await modernClipboard.writeText(text);
      return 'clipboard';
    } catch {
      // Permission errors fall through to the user-gesture-preserving branch.
    }
  }

  const copyTextarea = createCopyTextarea(text);
  const browserDocument = typeof document !== 'undefined'
    ? document
    : typeof window !== 'undefined' ? window.document : null;
  const body = browserDocument?.body;
  if (!body || typeof browserDocument.execCommand !== 'function') {
    throw new Error('复制失败，请手动选择文本');
  }
  body.appendChild(copyTextarea);
  try {
    copyTextarea.focus?.({ preventScroll: true });
    copyTextarea.select?.();
    copyTextarea.setSelectionRange?.(0, text.length);
    if (!browserDocument.execCommand('copy')) {
      throw new Error('复制失败，请手动选择文本');
    }
    return 'execCommand';
  } finally {
    body.removeChild(copyTextarea);
  }
}

function createCopyTextarea(text) {
  const browserDocument = typeof document !== 'undefined'
    ? document
    : typeof window !== 'undefined' ? window.document : null;
  if (!browserDocument?.createElement) {
    throw new Error('复制失败，请手动选择文本');
  }
  const textarea = browserDocument.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.width = '1px';
  textarea.style.height = '1px';
  textarea.style.padding = '0';
  textarea.style.border = '0';
  textarea.style.opacity = '0.01';
  textarea.style.pointerEvents = 'none';
  return textarea;
}
