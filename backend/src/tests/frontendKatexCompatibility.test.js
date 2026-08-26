import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeKatexSource,
  selectKatexSurfaceTextColor
} from '../../../frontend/src/utils/katexCompatibility.js';
import { readFrontendStyles, readVueBlocks } from './frontendSfcTestUtils.js';

const { script: markdownContentScript } = readVueBlocks('frontend/src/components/MarkdownContent.vue');
const {
  script: katexPreviewScript,
  template: katexPreviewTemplate
} = readVueBlocks('frontend/src/components/KatexPreviewDialog.vue');
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

test('KaTeX surface contrast selects readable defaults for generated backgrounds', () => {
  assert.equal(selectKatexSurfaceTextColor('rgb(251, 248, 241)'), '#20241f');
  assert.equal(selectKatexSurfaceTextColor('rgb(17 22 20)'), '#f1f5ee');
  assert.equal(selectKatexSurfaceTextColor('rgb(117, 117, 117)'), '#ffffff');
  assert.equal(selectKatexSurfaceTextColor('rgba(251, 248, 241, 0)'), '');
  assert.equal(selectKatexSurfaceTextColor('transparent'), '');
});

test('MarkdownContent renders through the KaTeX compatibility adapter', () => {
  assert.match(
    markdownContentScript,
    /import \{[\s\S]*normalizeKatexSource,[\s\S]*selectKatexSurfaceTextColor[\s\S]*\} from '..\/utils\/katexCompatibility\.js';/
  );
  assert.match(
    markdownContentScript,
    /const compatibleKatex = \{\s*renderToString\(source, options\) \{\s*return katex\.renderToString\(normalizeKatexSource\(source\), options\);\s*\}\s*\};/
  );
  assert.match(markdownContentScript, /md\.use\(katexPlugin, \{\s*katex: compatibleKatex,/);
});

test('MarkdownContent applies surface-aware contrast to KaTeX color boxes', () => {
  assert.match(
    markdownContentScript,
    /root\.querySelectorAll\(\s*'\.katex-html \.stretchy\.fcolorbox, \.katex-html \.stretchy\.colorbox'\s*\)/
  );
  assert.match(markdownContentScript, /surface\.parentElement\?\.nextElementSibling/);
  assert.match(
    markdownContentScript,
    /selectKatexSurfaceTextColor\(\s*getComputedStyle\(surface\)\.backgroundColor\s*\)/
  );
  assert.match(
    markdownContentScript,
    /reconcileDomChildren\(root, templateElement\.content\);\s*applyKatexSurfaceContrast\(root\);/
  );
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

test('scaled KaTeX formulas expose click and keyboard preview entry points', () => {
  assert.match(markdownContentScript, /import KatexPreviewDialog from '.\/KatexPreviewDialog\.vue';/);
  assert.match(markdownContentScript, /wrapper\.dataset\.katexPreviewable = 'true';/);
  assert.match(markdownContentScript, /wrapper\.setAttribute\('role', 'button'\);/);
  assert.match(markdownContentScript, /wrapper\.setAttribute\('tabindex', '0'\);/);
  assert.match(markdownContentScript, /wrapper\.setAttribute\('aria-haspopup', 'dialog'\);/);
  assert.match(markdownContentScript, /event\.key !== 'Enter' && event\.key !== ' '/);
  assert.match(markdownContentScript, /sourceElement: katexPreviewSource\.value/);
  assert.match(markdownContentScript, /onClick: handleKatexPreviewClick/);
  assert.match(markdownContentScript, /onKeydown: handleKatexPreviewKeydown/);
  assert.match(frontendStyles, /\[data-katex-previewable="true"\][\s\S]*cursor: zoom-in;/);
});

test('KaTeX preview dialog supports accessible zooming and responsive fullscreen viewing', () => {
  assert.match(katexPreviewTemplate, /<Teleport to="body">/);
  assert.match(katexPreviewTemplate, /role="dialog"/);
  assert.match(katexPreviewTemplate, /aria-modal="true"/);
  assert.match(katexPreviewTemplate, /aria-labelledby="katex-preview-title"/);
  assert.match(katexPreviewTemplate, /@click\.self="requestClose"/);
  assert.match(katexPreviewTemplate, /@keydown="handleDialogKeydown"/);
  assert.match(katexPreviewTemplate, /<ZoomOut :size="19" \/>/);
  assert.match(katexPreviewTemplate, /<RotateCcw :size="18" \/>/);
  assert.match(katexPreviewTemplate, /<ZoomIn :size="19" \/>/);
  assert.match(katexPreviewScript, /document\.body\.style\.overflow = 'hidden';/);
  assert.match(katexPreviewScript, /previousFocus\.focus\(\{ preventScroll: true \}\);/);
  assert.match(katexPreviewScript, /event\.key === 'Escape'/);
  assert.match(frontendStyles, /\.katex-preview-action \{[\s\S]*width: 44px;[\s\S]*height: 44px;/);
  assert.match(frontendStyles, /@media \(max-width: 640px\) \{[\s\S]*\.katex-preview-dialog \{[\s\S]*width: 100vw;[\s\S]*height: 100dvh;/);
  assert.match(frontendStyles, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.katex-preview-enter-active/);
});
