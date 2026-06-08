import assert from 'node:assert/strict';
import test from 'node:test';
import { readVueBlocks } from './frontendSfcTestUtils.js';

const { script: appScript } = readVueBlocks('frontend/src/App.vue', ['script']);

test('App notification queue updates use direct helpers', () => {
  assert.match(
    appScript,
    /const visibleNotifications = prependNotificationWithLimit\(item\);[\s\S]*for \(const \[timerId, timer\] of notificationTimers\.entries\(\)\) {\s*if \(!isNotificationVisible\(visibleNotifications, timerId\)\) {/
  );
  assert.match(
    appScript,
    /function prependNotificationWithLimit\(item\) {\s*const currentNotifications = Array\.isArray\(notifications\.value\) \? notifications\.value : \[\];\s*const nextNotifications = \[item\];[\s\S]*for \(const notification of currentNotifications\) {[\s\S]*nextNotifications\.push\(notification\);[\s\S]*notifications\.value = nextNotifications;[\s\S]*return nextNotifications;[\s\S]*}/
  );
  assert.match(
    appScript,
    /function isNotificationVisible\(currentNotifications, notificationId\) {[\s\S]*for \(const notification of currentNotifications\) {[\s\S]*notification\?\.id === notificationId[\s\S]*return true;[\s\S]*return false;[\s\S]*}/
  );
  assert.doesNotMatch(appScript, /notifications\.value\.map\(\(notification\) => notification\.id\)/);
  assert.doesNotMatch(appScript, /notifications\.value = \[item, \.\.\.notifications\.value\]\.slice\(0, 4\);/);
});

test('App notification dismissal skips reactive array replacement for missing ids', () => {
  assert.match(
    appScript,
    /function dismissNotification\(id\) {[\s\S]*removeNotificationByIdIfPresent\(id\);[\s\S]*}/
  );
  assert.match(
    appScript,
    /function removeNotificationByIdIfPresent\(id\) {\s*const currentNotifications = Array\.isArray\(notifications\.value\) \? notifications\.value : \[\];\s*const nextNotifications = \[\];\s*let changed = false;[\s\S]*for \(const notification of currentNotifications\) {[\s\S]*notification\?\.id === id[\s\S]*changed = true;[\s\S]*nextNotifications\.push\(notification\);[\s\S]*if \(changed\) {\s*notifications\.value = nextNotifications;\s*}[\s\S]*return changed;[\s\S]*}/
  );
  assert.doesNotMatch(appScript, /notifications\.value\.findIndex/);
  assert.doesNotMatch(appScript, /notifications\.value\.slice\(0, notificationIndex\)/);
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
