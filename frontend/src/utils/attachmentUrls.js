const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/i;
const SAFE_ASSET_PATH = /^\/api\/assets\/[^/?#]+$/;

/**
 * Return true only for attachment URLs that are safe to put in href/src.
 * Protocol-relative, javascript:, vbscript:, HTML data documents and other
 * browser URL schemes are deliberately rejected.
 */
export function isSafeAttachmentUrl(value) {
  const text = String(value || '').trim();
  if (!text || /[\u0000-\u001f\u007f]/.test(text)) {
    return false;
  }
  if (SAFE_DATA_IMAGE.test(text) || SAFE_ASSET_PATH.test(text)) {
    return true;
  }
  let parsed;
  try {
    const origin = typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://localhost';
    parsed = new URL(text, origin);
  } catch {
    return false;
  }
  return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
    && !parsed.username
    && !parsed.password
    && !text.startsWith('//');
}

export function normalizeSafeAttachmentUrl(value) {
  const text = String(value || '').trim();
  return isSafeAttachmentUrl(text) ? text : '';
}
