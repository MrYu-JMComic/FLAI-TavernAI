const QUOTE_PAIRS = new Map([
  ['\u201c', '\u201d'], ['"', '"'], ['\u00ab', '\u00bb'],
  ['\u300c', '\u300d'], ['\u300e', '\u300f'], ['\uff02', '\uff02']
]);
const EXCLUDED_CONTENT = 'pre, code, math, svg, script, style, textarea, .katex, .markdown-fold-summary';

// Work on a detached, sanitized Markdown tree. Text-node spans remain valid
// across paragraphs, links and emphasis without rewriting any HTML attributes.
export function highlightDialogueQuotes(root) {
  const document = root.ownerDocument;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === 1) return node.matches(EXCLUDED_CONTENT) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
      return node.data ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    }
  });
  const fragments = [];
  const openings = [];
  const latestOpeningByClose = new Map();
  const ranges = [];
  let offset = 0;
  let node;
  while ((node = walker.nextNode())) {
    const text = node.data;
    fragments.push({ node, start: offset, end: offset + text.length });
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      const openingIndex = latestOpeningByClose.get(character);
      if (openingIndex !== undefined) {
        const opening = openings[openingIndex];
        // An unmatched inner symbol (such as a 6-inch mark) must not prevent
        // the enclosing curly quote from closing. Pop each opener only once.
        while (openings.length > openingIndex) {
          const removed = openings.pop();
          if (removed.previous === undefined) latestOpeningByClose.delete(removed.close);
          else latestOpeningByClose.set(removed.close, removed.previous);
        }
        // Completed outer quotes subsume completed nested quotes. Each range
        // is pushed/popped once, keeping matching linear even for long replies.
        while (ranges.length && ranges.at(-1).start >= opening.start) ranges.pop();
        ranges.push({ start: opening.start, end: offset + index + 1 });
      } else if (QUOTE_PAIRS.has(character)) {
        const close = QUOTE_PAIRS.get(character);
        const previous = latestOpeningByClose.get(close);
        latestOpeningByClose.set(close, openings.length);
        openings.push({ start: offset + index, close, previous });
      }
    }
    offset += text.length;
  }

  // Unmatched quotes (including a partially streamed reply) stay unchanged.
  let rangeIndex = 0;
  for (const fragment of fragments) {
    while (ranges[rangeIndex]?.end <= fragment.start) rangeIndex += 1;
    if (!ranges[rangeIndex] || ranges[rangeIndex].start >= fragment.end) continue;
    // Do not introduce spans into structural whitespace between list/table rows.
    if (!fragment.node.data.trim()) continue;
    const replacement = document.createDocumentFragment();
    let cursor = fragment.start;
    let index = rangeIndex;
    while (ranges[index] && ranges[index].start < fragment.end) {
      const start = Math.max(fragment.start, ranges[index].start);
      const end = Math.min(fragment.end, ranges[index].end);
      if (start > cursor) replacement.append(document.createTextNode(fragment.node.data.slice(cursor - fragment.start, start - fragment.start)));
      const span = document.createElement('span');
      span.className = 'chat-dialogue-quote';
      span.textContent = fragment.node.data.slice(start - fragment.start, end - fragment.start);
      replacement.append(span);
      cursor = end;
      index += 1;
    }
    if (cursor < fragment.end) replacement.append(document.createTextNode(fragment.node.data.slice(cursor - fragment.start)));
    fragment.node.replaceWith(replacement);
  }
}
