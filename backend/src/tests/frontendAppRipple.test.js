import assert from 'node:assert/strict';
import test from 'node:test';
import { readVueBlocks } from './frontendSfcTestUtils.js';

const { script: appScript } = readVueBlocks('frontend/src/App.vue', ['script']);

test('App ripple ignores form controls before resolving wrapped label targets', () => {
  assert.match(
    appScript,
    /const source = event\?\.target;\s*pruneStaleRippleTimers\(\);\s*if \(isFormControlRippleSource\(source\)\) {\s*return;\s*}\s*const target = source\?\.closest\?\.\(rippleSelector\);/
  );
  assert.match(
    appScript,
    /function isFormControlRippleSource\(source\) {\s*return Boolean\(source\?\.closest\?\.\('input, textarea, select, option'\)\);\s*}/
  );
  assert.doesNotMatch(appScript, /event\.target/);
});

test('App ripple falls back to target center when pointer coordinates are missing', () => {
  assert.match(
    appScript,
    /const clientX = Number\.isFinite\(event\?\.clientX\) \? event\.clientX : rect\.left \+ rect\.width \/ 2;\s*const clientY = Number\.isFinite\(event\?\.clientY\) \? event\.clientY : rect\.top \+ rect\.height \/ 2;/
  );
  assert.match(
    appScript,
    /target\.style\.setProperty\('--ripple-x', `\$\{Math\.round\(clientX - rect\.left\)\}px`\);\s*target\.style\.setProperty\('--ripple-y', `\$\{Math\.round\(clientY - rect\.top\)\}px`\);/
  );
});
