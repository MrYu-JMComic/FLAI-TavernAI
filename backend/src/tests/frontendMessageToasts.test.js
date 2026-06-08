import assert from 'node:assert/strict';
import test from 'node:test';
import { readVueBlocks } from './frontendSfcTestUtils.js';

const { script: messageToastsScript, template: messageToastsTemplate } = readVueBlocks(
  'frontend/src/components/MessageToasts.vue'
);

test('MessageToasts prevents duplicate action clicks before dismissal renders', () => {
  assert.match(messageToastsScript, /import \{ ref, watch \} from 'vue';/);
  assert.match(messageToastsScript, /const props = defineProps\(/);
  assert.match(messageToastsScript, /const pendingActionIds = ref\(new Set\(\)\);/);
  assert.match(
    messageToastsScript,
    /function markActionPending\(id\)\s*{\s*const nextPendingIds = new Set\(pendingActionIds\.value\);\s*nextPendingIds\.add\(id\);\s*pendingActionIds\.value = nextPendingIds;/
  );
  assert.match(
    messageToastsScript,
    /function runAction\(item\)\s*{\s*if \(!item\?\.id \|\| isActionPending\(item\)\) return;\s*markActionPending\(item\.id\);\s*emit\('dismiss', item\.id\);\s*item\.action\?\.\(\);/
  );
  assert.match(
    messageToastsScript,
    /function syncPendingActionIds\(items\)\s*{\s*const pendingIds = pendingActionIds\.value;\s*if \(!pendingIds\.size\) return;[\s\S]*const activeIds = collectToastIds\(items\);[\s\S]*const nextPendingIds = new Set\(\);[\s\S]*let changed = false;[\s\S]*for \(const id of pendingIds\) {[\s\S]*if \(activeIds\.has\(id\)\) {[\s\S]*nextPendingIds\.add\(id\);[\s\S]*} else {[\s\S]*changed = true;[\s\S]*}[\s\S]*if \(changed\) {[\s\S]*pendingActionIds\.value = nextPendingIds;/
  );
  assert.match(
    messageToastsScript,
    /function collectToastIds\(items\)\s*{\s*const ids = new Set\(\);[\s\S]*const list = Array\.isArray\(items\) \? items : \[\];[\s\S]*for \(const item of list\) {[\s\S]*if \(item\?\.id\) {[\s\S]*ids\.add\(item\.id\);/
  );
  assert.match(
    messageToastsScript,
    /watch\(\s*\(\) => props\.items,\s*syncPendingActionIds\s*\);/
  );
  assert.doesNotMatch(messageToastsScript, /\[\.\.\.pendingIds\]\.filter/);
  assert.doesNotMatch(messageToastsScript, /props\.items\.map\(\(item\) => item\.id\)/);

  assert.match(messageToastsTemplate, /:disabled="isActionPending\(item\)"/);
  assert.match(messageToastsTemplate, /:aria-busy="isActionPending\(item\)"/);
});
