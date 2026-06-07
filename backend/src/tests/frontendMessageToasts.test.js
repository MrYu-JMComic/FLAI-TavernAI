import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText, readVueBlock } from './frontendSfcTestUtils.js';

const messageToastsSource = readRepoText('frontend/src/components/MessageToasts.vue');

test('MessageToasts prevents duplicate action clicks before dismissal renders', () => {
  const scriptSetup = readVueBlock(messageToastsSource, 'script');
  const template = readVueBlock(messageToastsSource, 'template');

  assert.match(scriptSetup, /import \{ ref, watch \} from 'vue';/);
  assert.match(scriptSetup, /const props = defineProps\(/);
  assert.match(scriptSetup, /const pendingActionIds = ref\(new Set\(\)\);/);
  assert.match(
    scriptSetup,
    /function runAction\(item\)\s*{\s*if \(!item\?\.id \|\| isActionPending\(item\)\) return;\s*markActionPending\(item\.id\);\s*emit\('dismiss', item\.id\);\s*item\.action\?\.\(\);/
  );
  assert.match(
    scriptSetup,
    /watch\(\s*\(\) => props\.items\.map\(\(item\) => item\.id\),[\s\S]*pendingActionIds\.value = nextPendingIds;[\s\S]*\);/
  );

  assert.match(template, /:disabled="isActionPending\(item\)"/);
  assert.match(template, /:aria-busy="isActionPending\(item\)"/);
});
