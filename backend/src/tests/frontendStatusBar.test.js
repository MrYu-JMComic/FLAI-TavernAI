import assert from 'node:assert/strict';
import test from 'node:test';
import { readVueBlocks } from './frontendSfcTestUtils.js';

const { script: statusBarScript, template: statusBarTemplate } = readVueBlocks(
  'frontend/src/components/StatusBar.vue'
);

test('StatusBar normalizes display variables and immersive characters with direct loops', () => {
  assert.match(statusBarScript, /from '..\/..\/..\/shared\/statusTemplateTokens\.js'/);
  assert.match(
    statusBarScript,
    /const displayVariables = computed\(\(\) => \{\s*return normalizeDisplayVariables\(props\.statusBar\?\.variables\);\s*\}\);/
  );
  assert.match(
    statusBarScript,
    /const displayCharacters = computed\(\(\) => \{\s*return normalizeDisplayCharacters\(cfg\.value\.characters\);\s*\}\);/
  );
  assert.match(
    statusBarScript,
    /function normalizeDisplayVariables\(variables, fallbackColor\) \{\s*const rows = \[\];\s*for \(const variable of Array\.isArray\(variables\) \? variables : \[\]\) \{\s*rows\.push\(normalizeDisplayVariable\(variable, fallbackColor\)\);\s*\}\s*return rows;\s*\}/
  );
  assert.match(
    statusBarScript,
    /function normalizeDisplayCharacters\(characters\) \{[\s\S]*for \(let index = 0; index < source\.length; index \+= 1\) \{[\s\S]*variables: normalizeDisplayVariables\(character\.variables, '#6c757d'\)[\s\S]*\}/
  );
  assert.match(
    statusBarScript,
    /function findDisplayVariable\(name\) \{[\s\S]*for \(let index = 0; index < variables\.length; index \+= 1\) \{[\s\S]*return item;[\s\S]*return null;[\s\S]*\}/
  );
  assert.match(
    statusBarTemplate,
    /v-for="entry in displayCharacters"[\s\S]*v-if="entry\.variables\.length"[\s\S]*v-for="\(v, vi\) in entry\.variables"/
  );
  assert.doesNotMatch(statusBarScript, /variables\.map\(normalizeDisplayVariable\)/);
  assert.doesNotMatch(statusBarScript, /charVariables\(ch\)/);
  assert.doesNotMatch(statusBarScript, /String\(token \|\| ''\)\.split\('\.'\)\.map/);
});

test('StatusBar builds custom template CSS and style text without array pipelines', () => {
  assert.match(
    statusBarScript,
    /const css = buildCustomTemplateCss\(\s*extracted\.styleBlocks,\s*styleBlocks,\s*`\[data-status-bar-scope="\$\{templateScopeId\.value\}"\]`\s*\);/
  );
  assert.match(
    statusBarScript,
    /function buildCustomTemplateCss\(extractedStyleBlocks, inlineStyleBlocks, scopeSelector\) \{\s*let cssText = appendSafeStyleBlocks\('', extractedStyleBlocks\);\s*cssText = appendSafeStyleBlocks\(cssText, inlineStyleBlocks\);\s*return cssText \? buildScopedChatCss\(cssText, scopeSelector\) : '';\s*\}/
  );
  assert.match(
    statusBarScript,
    /function appendSafeStyleBlocks\(cssText, blocks\) \{\s*for \(const block of Array\.isArray\(blocks\) \? blocks : \[\]\) \{[\s\S]*cssText = cssText \? `\$\{cssText\}\\n\\n\$\{safeBlock\}` : safeBlock;[\s\S]*return cssText;\s*\}/
  );
  assert.match(
    statusBarScript,
    /function applySafeStyleText\(style, css\) \{\s*const text = String\(css \|\| ''\);\s*let segmentStart = 0;\s*for \(let index = 0; index <= text\.length; index \+= 1\) \{/
  );
  assert.match(statusBarScript, /function toCamelStyleProp\(rawProp\) \{[\s\S]*upperNext \? char\.toUpperCase\(\) : char;[\s\S]*\}/);
  assert.doesNotMatch(statusBarScript, /\[\.\.\.extracted\.styleBlocks,\s*\.\.\.styleBlocks\]/);
  assert.doesNotMatch(statusBarScript, /\.map\(\(block\) => sanitizeStyleBlock\(block\)\)/);
  assert.doesNotMatch(statusBarScript, /\.filter\(Boolean\)/);
  assert.doesNotMatch(statusBarScript, /safeStyleBlocks\.join\('\\n\\n'\)/);
  assert.doesNotMatch(statusBarScript, /const segments = css\.split\(';'\)/);
  assert.doesNotMatch(statusBarScript, /rawProp\.replace\(/);
});
