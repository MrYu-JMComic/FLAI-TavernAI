// Only sanitized, settled Markdown belongs here. Account for both the source
// key and HTML as UTF-16 strings; the limits bound retained text, not VM overhead.
export function createMarkdownRenderCache({
  maxEntries = 200,
  maxBytes = 8 * 1024 * 1024,
  maxEntryBytes = 512 * 1024
} = {}) {
  const entries = new Map();
  let bytes = 0;

  function remove(key) {
    const entry = entries.get(key);
    if (!entry) return;
    bytes -= entry.bytes;
    entries.delete(key);
  }

  return {
    get size() { return entries.size; },
    get bytes() { return bytes; },
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      entries.set(key, entry);
      return entry.html;
    },
    set(key, html) {
      remove(key);
      const entryBytes = (key.length + html.length) * 2;
      if (maxEntries <= 0 || entryBytes > maxEntryBytes || entryBytes > maxBytes) return;
      while (entries.size && (entries.size >= maxEntries || bytes + entryBytes > maxBytes)) {
        remove(entries.keys().next().value);
      }
      entries.set(key, { html, bytes: entryBytes });
      bytes += entryBytes;
    }
  };
}
