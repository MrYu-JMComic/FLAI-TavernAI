const STANDALONE_HTML_FENCE_PATTERN = /^```(?:html?)?[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/i;
const HTML_DOCUMENT_START_PATTERN = /^(?:<!doctype\s+html(?:\s[^>]*)?>\s*)?<html(?:\s[^>]*)?>/i;

export function extractHtmlDocument(value) {
  const source = String(value || '').trim();
  if (!source) return '';

  const fencedMatch = source.match(STANDALONE_HTML_FENCE_PATTERN);
  const candidate = String(fencedMatch?.[1] || source).trim();
  return HTML_DOCUMENT_START_PATTERN.test(candidate) ? candidate : '';
}
