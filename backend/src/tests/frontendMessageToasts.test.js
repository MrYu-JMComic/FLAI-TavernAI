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
    /function runAction\(item\)\s*{\s*if \(!item\?\.id \|\| isActionPending\(item\)\) return;\s*markActionPending\(item\.id\);\s*emit\('dismiss', item\.id\);\s*item\.action\?\.\(\);/
  );
  assert.match(
    messageToastsScript,
    /function syncPendingActionIds\(ids\)\s*{\s*const pendingIds = pendingActionIds\.value;\s*if \(!pendingIds\.size\) return;[\s\S]*for \(const id of pendingIds\) {[\s\S]*if \(!activeIds\.has\(id\)\) {[\s\S]*pendingActionIds\.value = new Set\(\[\.\.\.pendingIds\]\.filter\(\(pendingId\) => activeIds\.has\(pendingId\)\)\);[\s\S]*return;/
  );
  assert.match(
    messageToastsScript,
    /watch\(\s*\(\) => props\.items\.map\(\(item\) => item\.id\),\s*syncPendingActionIds\s*\);/
  );

  assert.match(messageToastsTemplate, /:disabled="isActionPending\(item\)"/);
  assert.match(messageToastsTemplate, /:aria-busy="isActionPending\(item\)"/);
});
