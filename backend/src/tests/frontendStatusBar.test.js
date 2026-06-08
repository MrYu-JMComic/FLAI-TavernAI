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
