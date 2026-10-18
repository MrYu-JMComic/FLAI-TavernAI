import { describe, expect, it } from 'vitest';
import MarkdownIt from 'markdown-it';
import { md } from '../markdownRenderer.js';

const FENCE = '```';
const INLINE_FORMATS = [
  ['*', '<em>', '</em>'],
  ['**', '<strong>', '</strong>'],
  ['***', '<em><strong>', '</strong></em>'],
  ['_', '<em>', '</em>'],
  ['__', '<strong>', '</strong>'],
  ['___', '<em><strong>', '</strong></em>'],
  ['~~', '<s>', '</s>']
];

describe('markdown renderer', () => {
  it('escapes raw HTML, keeps line breaks and applies typographer quotes', () => {
    const rendered = md.render('# Title\n\n"Hello" **world** <script>alert(1)</script>\nnext line');

    expect(rendered).toContain('<h1>Title</h1>');
    expect(rendered).toContain('<strong>world</strong>');
    expect(rendered).not.toContain('<script>');
    expect(rendered).toContain('&lt;script&gt;');
    expect(rendered).toContain('<br>');
    expect(rendered).toContain('“Hello”');
  });

  it('linkifies bare URLs', () => {
    const rendered = md.render('see https://example.test/path?q=1');

    expect(rendered).toContain('<a href="https://example.test/path?q=1">');
  });

  it.each([
    ['**空气里是汗味、酒味。**墙上贴着羊皮纸。', '<strong>空气里是汗味、酒味。</strong>墙上贴着羊皮纸。'],
    ['她说**“教会的人？”**又挑了挑眉。', '她说<strong>“教会的人？”</strong>又挑了挑眉。'],
    ['“**采集月光草 · 报酬3金。**任务地点在下城区。”', '“<strong>采集月光草 · 报酬3金。</strong>任务地点在下城区。”'],
    ['她看着**（圣女袍）**点头。', '她看着<strong>（圣女袍）</strong>点头。'],
    ['前文**【任务】**后文', '前文<strong>【任务】</strong>后文'],
    ['before**(Hello!)**after', 'before<strong>(Hello!)</strong>after'],
    ['*空气里是汗味、酒味。*墙上贴着羊皮纸。', '<em>空气里是汗味、酒味。</em>墙上贴着羊皮纸。'],
    ['她说*“你好！”*又点了点头。', '她说<em>“你好！”</em>又点了点头。'],
    ['前文***“你好！”***后文', '前文<em><strong>“你好！”</strong></em>后文']
  ])('renders punctuated asterisk emphasis next to text: %s', (source, expected) => {
    expect(md.render(source)).toBe(`<p>${expected}</p>\n`);
  });

  it.each(INLINE_FORMATS)('renders %s at CJK, punctuation and Unicode symbol boundaries', (marker, open, close) => {
    for (const content of ['任务', '任务。', '“任务。”', '（任务）', '【任务】', 'Hello!', '🙂任务🙂', '🙂', '\u{10100}任务\u{10100}']) {
      expect(md.render(`前文${marker}${content}${marker}后文`))
        .toBe(`<p>前文${open}${content}${close}后文</p>\n`);
    }
    expect(md.render(`${marker}“任务。”${marker}随后${marker}“说明。”${marker}结束`))
      .toBe(`<p>${open}“任务。”${close}随后${open}“说明。”${close}结束</p>\n`);
    expect(md.render(`\u{20bb7}${marker}“任务。”${marker}\u{20bb7}`))
      .toBe(`<p>\u{20bb7}${open}“任务。”${close}\u{20bb7}</p>\n`);
  });

  it('preserves mixed nested and adjacent formats without styling intervening narration', () => {
    const rendered = md.render('前文~~__*“任务。”*__~~随后**“说明。”**_“结束。”_后文');

    expect(rendered).toBe('<p>前文<s><strong><em>“任务。”</em></strong></s>随后<strong>“说明。”</strong><em>“结束。”</em>后文</p>\n');
  });

  it('retains underscore word boundaries in identifiers, paths and bare URLs', () => {
    const identifiers = 'snake_case_name file__name__suffix foo__bar.baz__qux version_(draft)_final';

    expect(md.render(identifiers)).toBe(`<p>${identifiers}</p>\n`);
    expect(md.render('before__(Hello!)__after')).toBe('<p>before__(Hello!)__after</p>\n');
    expect(md.render('[file](https://example.test/file__name__suffix?q=snake_case)'))
      .toBe('<p><a href="https://example.test/file__name__suffix?q=snake_case">file</a></p>\n');
    expect(md.render('https://example.test/file__name__suffix?q=snake_case'))
      .toBe('<p><a href="https://example.test/file__name__suffix?q=snake_case">https://example.test/file__name__suffix?q=snake_case</a></p>\n');
  });

  it.each(INLINE_FORMATS)('keeps literal, incomplete and whitespace-separated %s markers safe', (marker) => {
    const literal = `${marker}“任务。”${marker}`;
    const escapedMarker = Array.from(marker, (character) => `\\${character}`).join('');

    expect(md.render(`前文${escapedMarker}“任务。”${escapedMarker}后文`)).toBe(`<p>前文${literal}后文</p>\n`);
    expect(md.render(`\`${literal}\``)).toBe(`<p><code>${literal}</code></p>\n`);
    expect(md.render(`${FENCE}\n${literal}\n${FENCE}`))
      .toBe(`<pre class="markdown-code"><code>${literal}\n</code></pre>`);
    expect(md.render(`前文${marker}“任务。”后文`)).not.toMatch(/<(?:strong|em|s)>/);
    for (const whitespace of [' ', '\t', '\n', '\u00a0', '\u3000']) {
      expect(md.render(`前文${marker}${whitespace}“任务。”${marker}后文`)).not.toMatch(/<(?:strong|em|s)>/);
      expect(md.render(`前文${marker}“任务。”${whitespace}${marker}后文`)).not.toMatch(/<(?:strong|em|s)>/);
    }
  });

  it('does not alter other MarkdownIt instances or block syntax', () => {
    expect(new MarkdownIt().render('**任务。**后文')).toBe('<p>**任务。**后文</p>\n');
    expect(md.render('***\n\n___\n\n---')).toBe('<hr>\n<hr>\n<hr>\n');
    expect(md.render('- __“任务。”__后文')).toBe('<ul>\n<li><strong>“任务。”</strong>后文</li>\n</ul>\n');
    expect(md.render('2 * 3 * 4')).toBe('<p>2 * 3 * 4</p>\n');
  });

  it('preserves nested formatting, links, inline code and math inside punctuated emphasis', () => {
    const rendered = md.render('她说**（*小声*，[任务](https://example.test) `code` $x^2$。）**随后点头。');

    expect(rendered).toContain('她说<strong>（<em>小声</em>，<a href="https://example.test">任务</a> <code>code</code>');
    expect(rendered).toContain('katex-inline-fit');
    expect(rendered).toContain('。）</strong>随后点头。');
  });

  it('renders fenced code through highlight.js and escapes unknown languages', () => {
    const highlighted = md.render(`${FENCE}js\nconst answer = 42;\n${FENCE}`);
    const unknown = md.render(`${FENCE}nope\n<x>\n${FENCE}`);
    const plain = md.render(`${FENCE}\nplain <b>\n${FENCE}`);

    expect(highlighted).toContain('<pre class="markdown-code"><code class="hljs language-js">');
    expect(highlighted).toContain('hljs-keyword');
    expect(unknown).toContain('<pre class="markdown-code"><code>&lt;x&gt;');
    expect(plain).toContain('<pre class="markdown-code"><code>plain &lt;b&gt;');
  });

  it('renders $ delimiters and LaTeX \\( \\) / \\[ \\] delimiters as KaTeX', () => {
    const inline = md.render(String.raw`Energy \(E = mc^2\) and $x^2$`);
    const block = md.render('Before\n\\[\n\\int_0^1 x\\,dx\n\\]\nAfter');

    expect(inline.match(/katex-inline-fit/g)).toHaveLength(2);
    expect(inline).toContain('<annotation encoding="application/x-tex">E = mc^2</annotation>');
    expect(block).toContain('<p class="katex-block">');
    expect(block).toContain('<annotation encoding="application/x-tex">\n\\int_0^1 x\\,dx\n</annotation>');
    expect(block).toMatch(/<p>Before<\/p>[\s\S]*<p>After<\/p>/);
  });

  it('accepts the double-escaped delimiters some providers emit', () => {
    const inline = md.render(String.raw`Energy \\(E = mc^2\\) here`);
    const block = md.render(String.raw`\\[a+b\\]`);

    expect(inline).toContain('katex-inline-fit');
    expect(inline).toContain('E = mc^2</annotation>');
    expect(block).toContain('<p class="katex-block">');
  });

  it('renders color boxes without outer math delimiters as one KaTeX token', () => {
    const rendered = md.render(String.raw`Note \colorbox{yellow}{\(x\)} end`);
    const escaped = md.render(String.raw`\\fcolorbox{red}{yellow}{\\(y\\)}`);

    expect(rendered).toContain('katex-inline-fit');
    expect(rendered).toContain('colorbox');
    expect(rendered).not.toContain('katex-error');
    expect(escaped).toContain('fcolorbox');
    expect(escaped).not.toContain('katex-error');
  });

  it('recovers array color boxes whose content closes before the final row', () => {
    const rendered = md.render(String.raw`\(\fcolorbox{red}{yellow}{\begin{array}{l}x} \\ y \end{array}}\)`);

    expect(rendered).toContain('fcolorbox');
    expect(rendered).not.toContain('katex-error');
  });

  it('leaves unterminated inline math as plain text while streaming', () => {
    const rendered = md.render(String.raw`start \(x + y`);

    expect(rendered).not.toContain('katex');
    expect(rendered).toContain('(x + y');
  });
});
