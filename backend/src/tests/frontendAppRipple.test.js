import assert from 'node:assert/strict';
import test from 'node:test';
import { readVueBlocks } from './frontendSfcTestUtils.js';

const { script: appScript } = readVueBlocks('frontend/src/App.vue', ['script']);

test('App ripple ignores form controls before resolving wrapped label targets', () => {
  assert.match(
    appScript,
    /pruneStaleRippleTimers\(\);\s*if \(isFormControlRippleSource\(event\.target\)\) {\s*return;\s*}\s*const target = event\.target\?\.closest\?\.\(rippleSelector\);/
  );
  assert.match(
    appScript,
    /function isFormControlRippleSource\(source\) {\s*return Boolean\(source\?\.closest\?\.\('input, textarea, select, option'\)\);\s*}/
  );
});
