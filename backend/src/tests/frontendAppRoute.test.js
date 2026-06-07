import assert from 'node:assert/strict';
import test from 'node:test';
import { readVueBlocks } from './frontendSfcTestUtils.js';

const { script: appScript } = readVueBlocks('frontend/src/App.vue', ['script']);

test('App route sync preserves the route reference for same-route hash updates', () => {
  assert.match(
    appScript,
    /const routeKey = computed\(\(\) => getRouteKey\(route\.value\)\);/
  );
  assert.match(
    appScript,
    /function syncRouteFromHash\(\) {\s*const nextRoute = parseRoute\(\);\s*if \(getRouteKey\(route\.value\) === getRouteKey\(nextRoute\)\) {\s*return;\s*}\s*route\.value = nextRoute;\s*}/
  );
  assert.match(
    appScript,
    /function getRouteKey\(value\) {\s*return `\$\{value\?\.name \|\| 'home'\}:\$\{value\?\.params\?\.id \|\| ''\}`;\s*}/
  );
});
