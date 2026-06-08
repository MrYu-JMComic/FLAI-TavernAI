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

test('App route parsing scans hash path segments directly', () => {
  assert.match(
    appScript,
    /function parseRoute\(\) {\s*const parts = readRoutePathSegments\(window\.location\.hash\);/
  );
  assert.match(
    appScript,
    /function readRoutePathSegments\(hashValue = ''\) \{[\s\S]*const parts = \[\];[\s\S]*let segmentStart = -1;[\s\S]*for \(let index = 0; index <= path\.length; index \+= 1\) \{[\s\S]*parts\.push\(path\.slice\(segmentStart, index\)\);[\s\S]*return parts;[\s\S]*\}/
  );
  assert.doesNotMatch(appScript, /path\.split\('\/'\)\.filter\(Boolean\)/);
});
