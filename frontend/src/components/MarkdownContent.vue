<script>
import { computed, defineComponent, h } from 'vue';

export default defineComponent({
  name: 'MarkdownContent',
  inheritAttrs: false,
  props: {
    text: {
      type: String,
      default: ''
    }
  },
  setup(props, { attrs }) {
    const blocks = computed(() => parseMarkdownBlocks(props.text));

    return () => {
      const { class: className, ...restAttrs } = attrs;
      return h(
        'div',
        {
          ...restAttrs,
          class: ['markdown-content', className]
        },
        blocks.value.map((block, index) => renderBlock(block, index))
      );
    };
  }
});

function parseMarkdownBlocks(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const fence = trimmed.match(/^```(\S*)?/);
    if (fence) {
      const language = fence[1] || '';
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push({ type: 'code', language, text: code.join('\n') });
      continue;
    }

    if (isTableStart(lines, index)) {
      const table = parseTable(lines, index);
      blocks.push(table.block);
      index = table.nextIndex;
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        inlines: parseInlineTokens(heading[2])
      });
      index += 1;
      continue;
    }

    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      const quoteLines = [];
      while (index < lines.length) {
        const match = lines[index].trim().match(/^>\s?(.*)$/);
        if (!match) {
          break;
        }
        quoteLines.push(match[1]);
        index += 1;
      }
      blocks.push({ type: 'quote', inlines: parseInlineTokens(quoteLines.join('\n')) });
      continue;
    }

    const listMatch = trimmed.match(/^(([-*+])|(\d+[.)]))\s+(.+)$/);
    if (listMatch) {
      const ordered = Boolean(listMatch[3]);
      const items = [];
      while (index < lines.length) {
        const item = lines[index].trim().match(/^(([-*+])|(\d+[.)]))\s+(.+)$/);
        if (!item || Boolean(item[3]) !== ordered) {
          break;
        }
        items.push(parseInlineTokens(item[4]));
        index += 1;
      }
      blocks.push({ type: ordered ? 'ol' : 'ul', items });
      continue;
    }

    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !startsBlock(lines, index)) {
      paragraph.push(lines[index]);
      index += 1;
    }
    if (!paragraph.length) {
      paragraph.push(line);
      index += 1;
    }
    blocks.push({ type: 'paragraph', inlines: parseInlineTokens(paragraph.join('\n')) });
  }

  return blocks;
}

function startsBlock(lines, index) {
  const trimmed = lines[index].trim();
  if (!trimmed) {
    return true;
  }
  return (
    /^```/.test(trimmed)
    || /^(#{1,4})\s+/.test(trimmed)
    || /^>\s?/.test(trimmed)
    || /^(([-*+])|(\d+[.)]))\s+/.test(trimmed)
    || isTableStart(lines, index)
  );
}

function isTableStart(lines, index) {
  if (index + 1 >= lines.length) {
    return false;
  }
  return lines[index].includes('|') && /^\s*\|?[\s:-]+\|[\s|:-]+\|?\s*$/.test(lines[index + 1]);
}

function parseTable(lines, startIndex) {
  const headers = splitTableRow(lines[startIndex]).map(parseInlineTokens);
  const rows = [];
  let index = startIndex + 2;

  while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
    rows.push(splitTableRow(lines[index]).map(parseInlineTokens));
    index += 1;
  }

  return {
    nextIndex: index,
    block: { type: 'table', headers, rows }
  };
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function parseInlineTokens(text) {
  const tokens = [];
  const pattern = /(!\[[^\]\n]*\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\([^)]+\))/g;
  let cursor = 0;
  let match = pattern.exec(text);

  while (match) {
    if (match.index > cursor) {
      tokens.push({ type: 'text', text: text.slice(cursor, match.index) });
    }
    tokens.push(toInlineToken(match[0]));
    cursor = match.index + match[0].length;
    match = pattern.exec(text);
  }

  if (cursor < text.length) {
    tokens.push({ type: 'text', text: text.slice(cursor) });
  }

  return tokens.length ? tokens : [{ type: 'text', text }];
}

function toInlineToken(raw) {
  const image = raw.match(/^!\[([^\]\n]*)\]\(([^)]+)\)$/);
  if (image) {
    const src = normalizeSafeImageUrl(image[2].trim());
    return src
      ? { type: 'image', alt: image[1], src }
      : { type: 'text', text: raw };
  }

  if (raw.startsWith('`')) {
    return { type: 'code', text: raw.slice(1, -1) };
  }
  if (raw.startsWith('**') || raw.startsWith('__')) {
    return { type: 'strong', text: raw.slice(2, -2) };
  }
  if (raw.startsWith('*') || raw.startsWith('_')) {
    return { type: 'em', text: raw.slice(1, -1) };
  }

  const link = raw.match(/^\[([^\]\n]+)\]\(([^)]+)\)$/);
  if (link) {
    const href = normalizeSafeLinkUrl(link[2].trim());
    return href
      ? { type: 'link', text: link[1], href }
      : { type: 'text', text: raw };
  }

  return { type: 'text', text: raw };
}

function normalizeSafeLinkUrl(url) {
  if (/^(https?:|mailto:)/i.test(url) || url.startsWith('/') || url.startsWith('#')) {
    return url;
  }
  return '';
}

function normalizeSafeImageUrl(url) {
  if (/^https?:/i.test(url) || url.startsWith('/')) {
    return url;
  }
  if (/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(url)) {
    return url;
  }
  return '';
}

function renderBlock(block, index) {
  const key = `${block.type}-${index}`;
  if (block.type === 'code') {
    return h('pre', { class: 'markdown-code', key }, [
      h('code', { class: block.language ? `language-${block.language}` : undefined }, block.text)
    ]);
  }

  if (block.type === 'heading') {
    return h(
      `h${Math.min(block.level, 6)}`,
      { class: 'markdown-heading', key },
      renderInlineTokens(block.inlines, key)
    );
  }

  if (block.type === 'quote') {
    return h('blockquote', { class: 'markdown-quote', key }, renderInlineTokens(block.inlines, key));
  }

  if (block.type === 'ul' || block.type === 'ol') {
    return h(
      block.type,
      { class: 'markdown-list', key },
      block.items.map((item, itemIndex) => h(
        'li',
        { key: `${key}-item-${itemIndex}` },
        renderInlineTokens(item, `${key}-item-${itemIndex}`)
      ))
    );
  }

  if (block.type === 'table') {
    return h('div', { class: 'markdown-table-wrap', key }, [
      h('table', { class: 'markdown-table' }, [
        h('thead', [
          h('tr', block.headers.map((cell, cellIndex) => h(
            'th',
            { key: `${key}-head-${cellIndex}` },
            renderInlineTokens(cell, `${key}-head-${cellIndex}`)
          )))
        ]),
        h('tbody', block.rows.map((row, rowIndex) => h(
          'tr',
          { key: `${key}-row-${rowIndex}` },
          row.map((cell, cellIndex) => h(
            'td',
            { key: `${key}-cell-${rowIndex}-${cellIndex}` },
            renderInlineTokens(cell, `${key}-cell-${rowIndex}-${cellIndex}`)
          ))
        )))
      ])
    ]);
  }

  return h('p', { class: 'markdown-paragraph', key }, renderInlineTokens(block.inlines, key));
}

function renderInlineTokens(tokens, keyPrefix) {
  return tokens.map((token, index) => {
    const key = `${keyPrefix}-inline-${index}-${token.type}`;

    if (token.type === 'code') {
      return h('code', { class: 'markdown-inline-code', key }, token.text);
    }
    if (token.type === 'strong') {
      return h('strong', { key }, token.text);
    }
    if (token.type === 'em') {
      return h('em', { key }, token.text);
    }
    if (token.type === 'link') {
      return h(
        'a',
        {
          href: token.href,
          target: '_blank',
          rel: 'noopener noreferrer',
          key
        },
        token.text
      );
    }
    if (token.type === 'image') {
      return h('img', {
        class: 'markdown-image',
        src: token.src,
        alt: token.alt || '',
        loading: 'lazy',
        decoding: 'async',
        key
      });
    }
    return h('span', { key }, token.text);
  });
}

</script>
