import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeKatexSource } from '../../../frontend/src/utils/katexCompatibility.js';
import { readFrontendStyles, readVueBlocks } from './frontendSfcTestUtils.js';

const { script: markdownContentScript } = readVueBlocks('frontend/src/components/MarkdownContent.vue');
const frontendStyles = readFrontendStyles();

test('KaTeX compatibility wraps math environments placed directly inside color boxes', () => {
  const source = String.raw`\fcolorbox{#6FA698}{#FBF8F1}{
\begin{array}{l}
\textcolor{#2B2620}{\text{Title}} \\
\textcolor{#8C8578}{\text{Body}}
\end{array}
}`;
  const expected = String.raw`\fcolorbox{#6FA698}{#FBF8F1}{
\(\begin{array}{l}
\textcolor{#2B2620}{\text{Title}} \\
\textcolor{#8C8578}{\text{Body}}
\end{array}\)
}`;

  assert.equal(normalizeKatexSource(source), expected);
});

test('KaTeX compatibility handles nested boxes and is idempotent', () => {
  const source = String.raw`\colorbox{red}{\begin{array}{l}\colorbox{blue}{\begin{matrix}1 & 2\end{matrix}}\end{array}}`;
  const expected = String.raw`\colorbox{red}{\(\begin{array}{l}\colorbox{blue}{\(\begin{matrix}1 & 2\end{matrix}\)}\end{array}\)}`;
  const normalized = normalizeKatexSource(source);

  assert.equal(normalized, expected);
  assert.equal(normalizeKatexSource(normalized), expected);
});

test('KaTeX compatibility preserves ordinary and incomplete color boxes', () => {
  const ordinary = String.raw`\colorbox{red}{\text{Alert}}`;
  const incomplete = String.raw`\fcolorbox{red}{white}{\begin{array}{l}`;
  const escapedCommand = String.raw`\\colorbox{red}{\begin{array}{l}x\end{array}}`;

  assert.equal(normalizeKatexSource(ordinary), ordinary);
  assert.equal(normalizeKatexSource(incomplete), incomplete);
  assert.equal(normalizeKatexSource(escapedCommand), escapedCommand);
});

test('MarkdownContent renders through the KaTeX compatibility adapter', () => {
  assert.match(
    markdownContentScript,
    /import \{ normalizeKatexSource \} from '..\/utils\/katexCompatibility\.js';/
  );
  assert.match(
    markdownContentScript,
    /const compatibleKatex = \{\s*renderToString\(source, options\) \{\s*return katex\.renderToString\(normalizeKatexSource\(source\), options\);\s*\}\s*\};/
  );
  assert.match(markdownContentScript, /md\.use\(katexPlugin, \{\s*katex: compatibleKatex,/);
});

test('MarkdownContent scales oversized KaTeX formulas to the narrow message width', () => {
  assert.match(markdownContentScript, /katex-inline-fit/);
  assert.match(markdownContentScript, /root\.querySelectorAll\('\.katex-inline-fit, \.katex-block'\)/);
  assert.doesNotMatch(markdownContentScript, /matchMedia\('\(max-width: 620px\)'\)/);
  assert.match(markdownContentScript, /const naturalWidth = Math\.max\(naturalSize\.width, formula\.scrollWidth \|\| 0\);/);
  assert.match(markdownContentScript, /const fittingWidth = Math\.max\(1, availableWidth - 1\);/);
  assert.match(markdownContentScript, /const scale = fittingWidth \/ naturalWidth;/);
  assert.match(markdownContentScript, /wrapper\.style\.height = `\$\{naturalSize\.height \* scale\}px`;/);
  assert.match(frontendStyles, /\.markdown-content \.katex-inline-fit\[data-katex-scaled\] > \.katex-display,[\s\S]*transform: scale\(var\(--katex-scale, 1\)\)/);
  assert.match(frontendStyles, /\.markdown-content \.katex-block\[data-katex-scaled\] > \.katex-display,[\s\S]*transform: scale\(var\(--katex-scale, 1\)\)/);
  assert.match(frontendStyles, /\.markdown-content \.katex-block \{[\s\S]*overflow: hidden;/);
});
