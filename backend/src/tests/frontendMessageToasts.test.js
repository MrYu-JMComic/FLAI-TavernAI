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
    /watch\(\s*\(\) => props\.items\.map\(\(item\) => item\.id\),[\s\S]*pendingActionIds\.value = nextPendingIds;[\s\S]*\);/
  );

  assert.match(messageToastsTemplate, /:disabled="isActionPending\(item\)"/);
  assert.match(messageToastsTemplate, /:aria-busy="isActionPending\(item\)"/);
});
