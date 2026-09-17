import { describe, expect, it } from 'vitest';
import { md } from '../markdownRenderer.js';

const FENCE = '```';

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
