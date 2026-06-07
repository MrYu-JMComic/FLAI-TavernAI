import assert from 'node:assert/strict';
import test from 'node:test';
import { readVueBlocks } from './frontendSfcTestUtils.js';

const { script: variableEditorScript, template: variableEditorTemplate } = readVueBlocks(
  'frontend/src/components/VariableEditor.vue'
);

test('VariableEditor coalesces mirror scroll sync work into the next animation frame', () => {
  assert.match(variableEditorScript, /let syncScrollPending = false;/);
  assert.match(variableEditorScript, /let syncScrollFrame = 0;/);
  assert.match(
    variableEditorScript,
    /function scheduleSyncScroll\(\) {[\s\S]*nextTick\(\(\) => {[\s\S]*requestAnimationFrame\(run\)[\s\S]*run\(\);[\s\S]*}\);[\s\S]*}/
  );
  assert.match(
    variableEditorScript,
    /onBeforeUnmount\(\(\) => {[\s\S]*cancelAnimationFrame\(syncScrollFrame\);[\s\S]*syncScrollFrame = 0;[\s\S]*}\);/
  );
  assert.match(variableEditorTemplate, /@scroll="scheduleSyncScroll"/);
  assert.match(variableEditorTemplate, /@focus="scheduleSyncScroll"/);
  assert.doesNotMatch(variableEditorTemplate, /@(?:scroll|focus)="syncScroll"/);
});
