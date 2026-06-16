import assert from 'node:assert/strict';
import test from 'node:test';
import { readFrontendStyles, readVueBlocks } from './frontendSfcTestUtils.js';

const { script: appScript } = readVueBlocks('frontend/src/App.vue', ['script']);
const stylesSource = readFrontendStyles();

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

test('App ripple stays inside the target bounds without transformed overflow geometry', () => {
  const rippleBaseRuleStart = stylesSource.indexOf(':where(button, a[href], label, [role="button"], [role="tab"], [data-ripple]) {');
  const rippleBaseRuleEnd = stylesSource.indexOf('\n}', rippleBaseRuleStart);
  const rippleBaseRule = stylesSource.slice(rippleBaseRuleStart, rippleBaseRuleEnd);
  const rippleActiveRuleStart = stylesSource.indexOf(':where(button, a[href], label, [role="button"], [role="tab"], [data-ripple])[data-ripple-active] {');
  const rippleRuleStart = stylesSource.indexOf(':where(button, a[href], label, [role="button"], [role="tab"], [data-ripple])[data-ripple-active]::after');
  const rippleRuleEnd = stylesSource.indexOf('\n}', rippleRuleStart);
  const rippleRule = stylesSource.slice(rippleRuleStart, rippleRuleEnd);
  const rippleKeyframesStart = stylesSource.indexOf('@keyframes ui-local-ripple');
  const rippleKeyframesEnd = stylesSource.indexOf('\n}', stylesSource.indexOf('100%', rippleKeyframesStart));
  const rippleKeyframes = stylesSource.slice(rippleKeyframesStart, rippleKeyframesEnd);

  assert.notEqual(rippleBaseRuleStart, -1);
  assert.notEqual(rippleRuleStart, -1);
  assert.notEqual(rippleKeyframesStart, -1);
  assert.equal(rippleActiveRuleStart, -1);
  assert.match(rippleBaseRule, /position:\s*relative;/);
  assert.doesNotMatch(rippleBaseRule, /overflow:/);
  assert.match(rippleRule, /inset:\s*0;/);
  assert.match(rippleRule, /radial-gradient\([\s\S]*circle at var\(--ripple-x\) var\(--ripple-y\)/);
  assert.doesNotMatch(rippleRule, /overflow:/);
  assert.doesNotMatch(rippleRule, /\bwidth:\s*var\(--ripple-size\)/);
  assert.doesNotMatch(rippleRule, /\bheight:\s*var\(--ripple-size\)/);
  assert.doesNotMatch(rippleRule, /transform:/);
  assert.doesNotMatch(rippleKeyframes, /transform:/);
});
