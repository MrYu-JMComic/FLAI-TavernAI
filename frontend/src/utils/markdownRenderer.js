import MarkdownIt from 'markdown-it';
import markdownItKatex from '@vscode/markdown-it-katex';
import katex from 'katex';
import hljs from 'highlight.js/lib/common';
import { recordFrontendDiagnostic } from '../diagnostics.js';
import {
  findColorBoxExpression,
  normalizeEscapedKatexSource
} from './katexCompatibility.js';

// Initialize markdown-it with highlight.js
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: true,
  highlight(str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        const highlighted = hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
        return `<pre class="markdown-code"><code class="hljs language-${lang}">${highlighted}</code></pre>`;
      } catch (error) {
        recordFrontendDiagnostic('markdown.highlight', error, { lang });
      }
    }
    const escaped = md.utils.escapeHtml(str);
    return `<pre class="markdown-code"><code>${escaped}</code></pre>`;
  }
});

const CJK_CHARACTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function codePointBefore(source, position) {
  if (position === 0) return 0x20;
  const pair = position > 1 ? source.codePointAt(position - 2) : 0;
  return pair > 0xffff ? pair : source.charCodeAt(position - 1);
}

// Dialogue places formatting against punctuation and CJK text without spaces.
// Share these boundaries across emphasis and strikethrough, keeping native
// pairing, nesting, escapes and code rules. Underscores still cannot split
// Latin words or identifiers. Scope the scanner to this renderer's state.
md.inline.State = class extends md.inline.State {
  scanDelims(start, canSplitWord) {
    const scanned = super.scanDelims(start, canSplitWord);
    const marker = this.src.charCodeAt(start);
    if (marker !== 0x2a && marker !== 0x5f && marker !== 0x7e) return scanned;

    const end = start + scanned.length;
    // Read whole Unicode code points, including emoji and astral punctuation.
    const previous = codePointBefore(this.src, start);
    const next = end < this.posMax ? this.src.codePointAt(end) : 0x20;
    const { isPunctCharCode, isWhiteSpace } = this.md.utils;
    if (marker === 0x5f) {
      if (!isWhiteSpace(next) && CJK_CHARACTER.test(String.fromCodePoint(previous))) scanned.can_open = true;
      if (!isWhiteSpace(previous) && CJK_CHARACTER.test(String.fromCodePoint(next))) scanned.can_close = true;
    } else {
      if (!isWhiteSpace(next) && isPunctCharCode(next)) scanned.can_open = true;
      if (!isWhiteSpace(previous) && isPunctCharCode(previous)) scanned.can_close = true;
    }
    return scanned;
  }
};

// Register KaTeX plugin for $...$ and $$...$$ delimiters.
// The package is CommonJS, so the callable plugin may sit on `.default`.
const katexPlugin = typeof markdownItKatex === 'function'
  ? markdownItKatex
  : markdownItKatex?.default;
const compatibleKatex = {
  renderToString(source, options) {
    return katex.renderToString(normalizeEscapedKatexSource(source), options);
  }
};

md.use(katexPlugin, {
  katex: compatibleKatex,
  throwOnError: false,
  strict: false,
  enableBareBlocks: true
});

// Keep math readable in responsive containers by scaling only formulas whose
// natural width is larger than their containing paragraph.
const originalInlineKatexRenderer = md.renderer.rules.math_inline;
if (typeof originalInlineKatexRenderer === 'function') {
  md.renderer.rules.math_inline = (tokens, idx, options, env, self) => (
    `<span class="katex-inline-fit">${originalInlineKatexRenderer(tokens, idx, options, env, self)}</span>`
  );
}

// Character codes for backslash delimiter parsing
const BACKSLASH_CHAR_CODE = 0x5c;
const OPEN_PAREN_CHAR_CODE = 0x28;
const OPEN_BRACKET_CHAR_CODE = 0x5b;
const INLINE_MATH_CLOSE = '\\)';
const ESCAPED_INLINE_MATH_OPEN = '\\\\(';
const ESCAPED_INLINE_MATH_CLOSE = '\\\\)';
const BLOCK_MATH_CLOSE = '\\]';
const ESCAPED_BLOCK_MATH_OPEN = '\\\\[';
const ESCAPED_BLOCK_MATH_CLOSE = '\\\\]';

// A color box is a TeX expression even when the provider omits outer math
// delimiters. Capture the balanced command as one token so KaTeX can render
// the box and its nested `\(...\)` content together.
function mathInlineColorBox(state, silent) {
  const expression = findColorBoxExpression(state.src, state.pos);
  if (!expression) return false;
  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.markup = expression.name;
    token.content = state.src.slice(expression.start, expression.end);
  }
  state.pos = expression.end;
  return true;
}

// Inline rule for \(...\). Unterminated math falls through to plain text so
// streaming responses never flash a KaTeX error mid-formula.
function mathInlineParen(state, silent) {
  const start = state.pos;
  const escaped = state.src.startsWith(ESCAPED_INLINE_MATH_OPEN, start);
  const openLength = escaped ? ESCAPED_INLINE_MATH_OPEN.length : 2;
  const closeDelimiter = escaped ? ESCAPED_INLINE_MATH_CLOSE : INLINE_MATH_CLOSE;
  if (!escaped) {
    if (state.src.charCodeAt(start) !== BACKSLASH_CHAR_CODE) return false;
    if (state.src.charCodeAt(start + 1) !== OPEN_PAREN_CHAR_CODE) return false;
  }
  const end = state.src.indexOf(closeDelimiter, start + openLength);
  if (end === -1) return false;
  const content = state.src.slice(start + openLength, end);
  if (!content.trim()) return false;
  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.markup = '\\(';
    token.content = content;
  }
  state.pos = end + closeDelimiter.length;
  return true;
}

// Block rule for \[...\]. Emitting a block token keeps the rendered
// <p class="katex-block"> at the top level instead of nesting it in a paragraph.
function mathBlockBracket(state, startLine, endLine, silent) {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const escaped = state.src.startsWith(ESCAPED_BLOCK_MATH_OPEN, start);
  const openLength = escaped ? ESCAPED_BLOCK_MATH_OPEN.length : 2;
  const closeDelimiter = escaped ? ESCAPED_BLOCK_MATH_CLOSE : BLOCK_MATH_CLOSE;
  if (!escaped) {
    if (state.src.charCodeAt(start) !== BACKSLASH_CHAR_CODE) return false;
    if (state.src.charCodeAt(start + 1) !== OPEN_BRACKET_CHAR_CODE) return false;
  }

  const firstLineTail = state.src.slice(start + openLength, max);
  let content = null;
  let nextLine = startLine;
  const closeIndex = firstLineTail.indexOf(closeDelimiter);
  if (closeIndex !== -1) {
    if (firstLineTail.slice(closeIndex + closeDelimiter.length).trim()) return false;
    content = firstLineTail.slice(0, closeIndex);
  } else {
    let buffer = firstLineTail;
    while (content === null) {
      nextLine += 1;
      if (nextLine >= endLine) return false;
      const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
      const lineEnd = state.eMarks[nextLine];
      const line = state.src.slice(lineStart, lineEnd);
      const lineClose = line.indexOf(closeDelimiter);
      if (lineClose === -1) {
        buffer += `\n${line}`;
        continue;
      }
      if (line.slice(lineClose + closeDelimiter.length).trim()) return false;
      content = `${buffer}\n${line.slice(0, lineClose)}`;
    }
  }
  if (!content.trim()) return false;
  if (silent) return true;

  const token = state.push('math_block', 'math', 0);
  token.block = true;
  token.markup = '\\[';
  token.content = content;
  token.map = [startLine, nextLine + 1];
  state.line = nextLine + 1;
  return true;
}

md.inline.ruler.before('escape', 'math_inline_paren', mathInlineParen);
md.inline.ruler.before('escape', 'math_inline_colorbox', mathInlineColorBox);
md.block.ruler.before('fence', 'math_block_bracket', mathBlockBracket, {
  alt: ['paragraph', 'blockquote', 'list']
});

// Custom fence renderer to wrap code blocks properly
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const info = token.info ? token.info.trim() : '';
  const langName = info.split(/\s+/)[0];
  
  if (options.highlight) {
    const highlighted = options.highlight(token.content, langName, info);
    if (highlighted.indexOf('<pre') !== 0) {
      return `<pre class="markdown-code"><code class="hljs${langName ? ` language-${langName}` : ''}">${highlighted}</code></pre>`;
    }
    return highlighted;
  }
  
  const escaped = md.utils.escapeHtml(token.content);
  return `<pre class="markdown-code"><code${langName ? ` class="language-${langName}"` : ''}>${escaped}</code></pre>`;
};

export { md };
