import assert from 'node:assert/strict';
import test from 'node:test';
import { readVueBlocks } from './frontendSfcTestUtils.js';

const { script: baseLayoutScript } = readVueBlocks('frontend/src/components/BaseLayout.vue', ['script']);

test('BaseLayout document click handler tolerates missing event targets', () => {
  assert.match(
    baseLayoutScript,
    /function handleDocumentClick\(event\) {\s*const target = event\?\.target;\s*if \(!isDomEventTarget\(target\) \|\| !userMenuRef\.value\?\.contains\(target\)\) {\s*userMenuOpen\.value = false;\s*}\s*}/
  );
  assert.match(
    baseLayoutScript,
    /function isDomEventTarget\(target\) {\s*return Boolean\(target && typeof target === 'object' && typeof target\.nodeType === 'number'\);\s*}/
  );
  assert.doesNotMatch(baseLayoutScript, /contains\(event\.target\)/);
});
