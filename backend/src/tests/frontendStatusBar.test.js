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

test('StatusBar normalizes template option lists with direct loops', () => {
  assert.match(
    statusBarScript,
    /const variant = isAllowedTemplateOption\(VALID_VARIANTS, raw\.variant\) \? raw\.variant : 'default';/
  );
  assert.match(
    statusBarScript,
    /const density = isAllowedTemplateOption\(VALID_DENSITIES, raw\.density\) \? raw\.density : 'default';/
  );
  assert.match(statusBarScript, /const effects = normalizeTemplateEffects\(raw\.effects\);/);
  assert.match(
    statusBarScript,
    /const displayMode = isAllowedTemplateOption\(VALID_DISPLAY_MODES, raw\.displayMode\) \? raw\.displayMode : 'compact';/
  );
  assert.match(
    statusBarScript,
    /function isAllowedTemplateOption\(options, value\) \{\s*for \(let index = 0; index < options\.length; index \+= 1\) \{[\s\S]*if \(options\[index\] === value\) \{[\s\S]*return true;[\s\S]*return false;[\s\S]*\}/
  );
  assert.match(
    statusBarScript,
    /function normalizeTemplateEffects\(effects\) \{\s*const rows = \[\];\s*const source = Array\.isArray\(effects\) \? effects : \[\];\s*for \(let index = 0; index < source\.length; index \+= 1\) \{[\s\S]*if \(isAllowedTemplateOption\(VALID_EFFECTS, effect\)\) \{[\s\S]*rows\.push\(effect\);[\s\S]*return rows;[\s\S]*\}/
  );
  assert.doesNotMatch(statusBarScript, /VALID_VARIANTS\.includes/);
  assert.doesNotMatch(statusBarScript, /VALID_DENSITIES\.includes/);
  assert.doesNotMatch(statusBarScript, /VALID_EFFECTS\.includes/);
  assert.doesNotMatch(statusBarScript, /VALID_DISPLAY_MODES\.includes/);
  assert.doesNotMatch(statusBarScript, /raw\.effects\.filter/);
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

test('StatusBar scans custom template DOM collections without cloning node lists', () => {
  assert.match(
    statusBarScript,
    /function sanitizeTemplateHtml\(html, styleBlocks = \[\]\) \{[\s\S]*const nodes = doc\.body\.querySelectorAll\('\*'\);[\s\S]*for \(let nodeIndex = 0; nodeIndex < nodes\.length; nodeIndex \+= 1\) \{[\s\S]*const attrs = node\.attributes;[\s\S]*for \(let attrIndex = attrs\.length - 1; attrIndex >= 0; attrIndex -= 1\) \{/
  );
  assert.match(
    statusBarScript,
    /function normalizeTemplateValueText\(root\) \{[\s\S]*const values = root\.querySelectorAll\('\.sb-val'\);[\s\S]*for \(let index = 0; index < values\.length; index \+= 1\) \{/
  );
  assert.match(
    statusBarScript,
    /function findTemplateValuePairs\(root\) \{[\s\S]*const labels = root\.querySelectorAll\('\.sb-label'\);[\s\S]*for \(let labelIndex = 0; labelIndex < labels\.length; labelIndex \+= 1\) \{[\s\S]*const values = root\.querySelectorAll\('\.sb-val'\);[\s\S]*for \(let valueIndex = 0; valueIndex < values\.length; valueIndex \+= 1\) \{/
  );
  assert.match(
    statusBarScript,
    /const parentValues = label\.parentElement\?\.querySelectorAll\?\.\('\.sb-val'\);[\s\S]*for \(let index = 0; index < parentValues\.length; index \+= 1\) \{[\s\S]*return value;[\s\S]*return null;/
  );
  assert.doesNotMatch(statusBarScript, /\[\.\.\.[^\]]*querySelectorAll/);
  assert.doesNotMatch(statusBarScript, /\[\.\.\.node\.attributes\]/);
  assert.doesNotMatch(statusBarScript, /parentValues\.find\(/);
});

test('StatusBar custom template click handler tolerates missing event targets', () => {
  assert.match(
    statusBarScript,
    /function onCustomTemplateClick\(event\) \{\s*const target = event\?\.target\?\.closest\?\.\('\[data-sb-action\]'\);\s*if \(!target \|\| !event\?\.currentTarget\?\.contains\?\.\(target\)\) \{\s*return;\s*\}/
  );
  assert.doesNotMatch(statusBarScript, /event\.target\?\.closest/);
  assert.doesNotMatch(statusBarScript, /event\.currentTarget\?\.contains\(target\)/);
});
