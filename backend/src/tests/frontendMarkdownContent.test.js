import assert from 'node:assert/strict';
import test from 'node:test';
import { readVueBlocks } from './frontendSfcTestUtils.js';

const { script: markdownContentScript } = readVueBlocks('frontend/src/components/MarkdownContent.vue');

test('MarkdownContent render cache refreshes exact hits before returning cached HTML', () => {
  assert.match(
    markdownContentScript,
    /if \(renderCache\.has\(cacheKey\)\) \{\s*const cached = renderCache\.get\(cacheKey\);[\s\S]*renderCache\.delete\(cacheKey\);[\s\S]*renderCache\.set\(cacheKey, cached\);[\s\S]*return cached;[\s\S]*}/
  );
  assert.doesNotMatch(markdownContentScript, /const cached = renderCache\.get\(cacheKey\);\s*if \(cached\) return cached;/);
});

test('MarkdownContent builds plugin cache keys without plugin shape arrays', () => {
  assert.match(
    markdownContentScript,
    /const cacheKey = `\$\{text\}\\n<!--plugins:\$\{buildPluginCacheKey\(renderPlugins\)\}-->`;/
  );
  assert.match(
    markdownContentScript,
    /function buildPluginCacheKey\(renderPlugins = \[\]\) \{\s*let cacheKey = '';[\s\S]*const sourcePlugins = Array\.isArray\(renderPlugins\) \? renderPlugins : \[\];[\s\S]*for \(const plugin of sourcePlugins\) \{[\s\S]*appendPluginCacheField\(cacheKey, plugin\?\.enabled !== false \? '1' : '0'\)[\s\S]*appendPluginCacheField\(cacheKey, plugin\?\.titleTemplate \|\| plugin\?\.label \|\| ''\);[\s\S]*return cacheKey;[\s\S]*}/
  );
  assert.match(
    markdownContentScript,
    /function appendPluginCacheField\(cacheKey, value\) \{\s*const text = String\(value \?\? ''\);[\s\S]*return `\$\{cacheKey\}\$\{text\.length\}:\$\{text\};`;[\s\S]*}/
  );
  assert.doesNotMatch(markdownContentScript, /JSON\.stringify\(pluginCacheShape/);
  assert.doesNotMatch(markdownContentScript, /function pluginCacheShape/);
  assert.doesNotMatch(markdownContentScript, /renderPlugins\.map/);
});

test('MarkdownContent renders fold segments without split or segment map allocations', () => {
  assert.match(
    markdownContentScript,
    /const LF_CHAR_CODE = 10;[\s\S]*const CR_CHAR_CODE = 13;[\s\S]*const FOLD_CARET = '\\u203a';[\s\S]*const DEFAULT_FOLD_TITLE = '\\u6298\\u53e0\\u5185\\u5bb9';/
  );
  assert.match(
    markdownContentScript,
    /function renderWithPlugins\(text, renderPlugins = \[\]\) \{[\s\S]*let html = '';[\s\S]*let normalText = '';[\s\S]*let hasNormalText = false;[\s\S]*html \+= renderFoldSegment\(fold\);[\s\S]*forEachMarkdownLine\(String\(text \|\| ''\), \(line\) => \{[\s\S]*fold = \{ title: match\.title, bodyText: '', hasBodyText: false \};[\s\S]*return html;[\s\S]*}/
  );
  assert.match(
    markdownContentScript,
    /function appendLineText\(currentText, line, hasText\) \{\s*return hasText \? `\$\{currentText\}\\n\$\{line\}` : line;\s*\}/
  );
  assert.match(
    markdownContentScript,
    /function forEachMarkdownLine\(text, visit\) \{[\s\S]*for \(let index = 0; index < text\.length; index \+= 1\) \{[\s\S]*if \(text\.charCodeAt\(index\) !== LF_CHAR_CODE\) \{[\s\S]*continue;[\s\S]*const endIndex = index > startIndex && text\.charCodeAt\(index - 1\) === CR_CHAR_CODE[\s\S]*visit\(text\.slice\(startIndex, endIndex\)\);[\s\S]*visit\(text\.slice\(startIndex\)\);[\s\S]*}/
  );
  assert.match(
    markdownContentScript,
    /function renderFoldSegment\(segment\) \{[\s\S]*const body = md\.render\(segment\.bodyText\.trim\(\)\);[\s\S]*markdown-fold-caret">\$\{FOLD_CARET\}<\/span>`[\s\S]*segment\.title \|\| DEFAULT_FOLD_TITLE[\s\S]*}/
  );
  assert.doesNotMatch(markdownContentScript, /const htmlParts = \[\]/);
  assert.doesNotMatch(markdownContentScript, /htmlParts\.push/);
  assert.doesNotMatch(markdownContentScript, /htmlParts\.join/);
  assert.doesNotMatch(markdownContentScript, /String\(text \|\| ''\)\.split\(/);
  assert.doesNotMatch(markdownContentScript, /const segments = \[\]/);
  assert.doesNotMatch(markdownContentScript, /segments\.map/);
  assert.doesNotMatch(markdownContentScript, /segment\.body\.join/);
});

test('MarkdownContent compiles fold plugins with direct loops', () => {
  assert.match(
    markdownContentScript,
    /function compileFoldPlugins\(renderPlugins = \[\]\) \{\s*const plugins = \[\];[\s\S]*const sourcePlugins = Array\.isArray\(renderPlugins\) \? renderPlugins : \[\];[\s\S]*for \(const plugin of sourcePlugins\) \{[\s\S]*if \(!plugin \|\| plugin\.enabled === false \|\| \(plugin\.type \|\| 'fold'\) !== 'fold' \|\| !plugin\.pattern\) \{[\s\S]*continue;[\s\S]*plugins\.push\(\{[\s\S]*regex: new RegExp\(plugin\.pattern, flags\),[\s\S]*titleTemplate: String\(plugin\.titleTemplate \|\| plugin\.label \|\| '\$1'\)[\s\S]*return plugins;[\s\S]*}/
  );
  assert.doesNotMatch(markdownContentScript, /renderPlugins\s*\.\s*filter/);
  assert.doesNotMatch(markdownContentScript, /\.filter\(Boolean\)/);
});

test('MarkdownContent normalizes regex flags through the shared direct scanner', () => {
  assert.match(
    markdownContentScript,
    /import \{ normalizeRegexFlags as normalizeSharedRegexFlags \} from '..\/..\/..\/shared\/regexFlags\.js';/
  );
  assert.match(
    markdownContentScript,
    /function normalizeRegexFlags\(flags\) \{\s*return normalizeSharedRegexFlags\(flags, 'u'\)\.replace\(\/g\/g, ''\) \|\| 'u';\s*\}/
  );
  assert.doesNotMatch(markdownContentScript, /const VALID_REGEX_FLAGS = 'dimsuvy';/);
  assert.doesNotMatch(markdownContentScript, /new Set/);
  assert.doesNotMatch(markdownContentScript, /\.split\(''\)/);
});
