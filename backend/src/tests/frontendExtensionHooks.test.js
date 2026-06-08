import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText } from './frontendSfcTestUtils.js';

const {
  HOOK_TYPES,
  clearAllHooks,
  getHooks,
  registerHook,
  unregisterHook
} = await import('../../../frontend/src/services/extensionHooks.js');

const extensionHooksSource = readRepoText('frontend/src/services/extensionHooks.js');

test('extension hook unregister preserves other hooks and reports no-op removals', () => {
  clearAllHooks();
  const firstHandler = () => ({ first: true });
  const secondHandler = () => ({ second: true });

  registerHook(HOOK_TYPES.MESSAGE_SEND, firstHandler, 'first-extension', 20);
  registerHook(HOOK_TYPES.MESSAGE_SEND, secondHandler, 'second-extension', 10);

  assert.equal(unregisterHook(HOOK_TYPES.MESSAGE_SEND, 'missing-extension'), false);
  assert.deepEqual(
    getHooks(HOOK_TYPES.MESSAGE_SEND).map((entry) => entry.extensionName),
    ['second-extension', 'first-extension']
  );

  assert.equal(unregisterHook(HOOK_TYPES.MESSAGE_SEND, 'second-extension'), true);
  assert.deepEqual(
    getHooks(HOOK_TYPES.MESSAGE_SEND).map((entry) => entry.extensionName),
    ['first-extension']
  );

  assert.equal(unregisterHook(HOOK_TYPES.MESSAGE_SEND, 'first-extension'), true);
  assert.deepEqual(getHooks(HOOK_TYPES.MESSAGE_SEND), []);
  clearAllHooks();
});

test('extension hook unregister scans entries directly without filter allocation', () => {
  assert.match(
    extensionHooksSource,
    /export function unregisterHook\(hookType, extensionName\) \{[\s\S]*const entries = hooks\.get\(hookType\);[\s\S]*let nextEntries = null;[\s\S]*for \(let index = 0; index < entries\.length; index \+= 1\) \{[\s\S]*const entry = entries\[index\];[\s\S]*entry\.extensionName === extensionName[\s\S]*for \(let copyIndex = 0; copyIndex < index; copyIndex \+= 1\) \{[\s\S]*nextEntries\.push\(entries\[copyIndex\]\);[\s\S]*if \(!nextEntries\) return false;[\s\S]*hooks\.set\(hookType, nextEntries\);[\s\S]*return true;[\s\S]*\}/
  );
  assert.doesNotMatch(extensionHooksSource, /entries\.filter\(/);
});
