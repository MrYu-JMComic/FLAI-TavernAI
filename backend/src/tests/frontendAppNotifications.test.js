import assert from 'node:assert/strict';
import test from 'node:test';
import { readVueBlocks } from './frontendSfcTestUtils.js';

const { script: appScript } = readVueBlocks('frontend/src/App.vue', ['script']);

test('App notification dismissal skips reactive array replacement for missing ids', () => {
  assert.match(
    appScript,
    /function dismissNotification\(id\) {\s*const notificationIndex = notifications\.value\.findIndex\(\(item\) => item\.id === id\);/
  );
  assert.match(
    appScript,
    /if \(notificationIndex === -1\) {\s*return;\s*}\s*notifications\.value = \[\s*\.\.\.notifications\.value\.slice\(0, notificationIndex\),\s*\.\.\.notifications\.value\.slice\(notificationIndex \+ 1\)\s*\];/
  );
});

test('App notification clearing skips empty reactive array replacement', () => {
  assert.match(
    appScript,
    /function clearNotifications\(\) {\s*if \(!notificationTimers\.size && notifications\.value\.length === 0\) {\s*return;\s*}/
  );
  assert.match(
    appScript,
    /if \(notifications\.value\.length > 0\) {\s*notifications\.value = \[\];\s*}/
  );
});
