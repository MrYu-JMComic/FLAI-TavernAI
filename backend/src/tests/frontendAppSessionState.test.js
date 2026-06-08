import assert from 'node:assert/strict';
import test from 'node:test';
import { readVueBlocks } from './frontendSfcTestUtils.js';

const { script: appScript } = readVueBlocks('frontend/src/App.vue', ['script']);

test('App session state preserves user and provider references for unchanged payloads', () => {
  assert.match(
    appScript,
    /function setUserIfChanged\(nextUser\) {\s*return setRefIfPlainValueChanged\(user, nextUser \|\| null\);\s*}/
  );
  assert.match(
    appScript,
    /function setProviderIfChanged\(nextProvider\) {\s*return setRefIfPlainValueChanged\(provider, nextProvider \|\| null\);\s*}/
  );
  assert.match(
    appScript,
    /function setRefIfPlainValueChanged\(valueRef, nextValue\) {[\s\S]*samePlainValue\(valueRef\.value, nextValue\)[\s\S]*valueRef\.value = nextValue;[\s\S]*return true;[\s\S]*}/
  );
  assert.match(
    appScript,
    /function samePlainValue\(current, next\) {[\s\S]*Object\.is\(current, next\)[\s\S]*Array\.isArray\(current\)[\s\S]*for \(let index = 0; index < current\.length; index \+= 1\) {[\s\S]*samePlainValue\(current\[index\], next\[index\]\)[\s\S]*let currentKeyCount = 0;[\s\S]*for \(const key in current\) {[\s\S]*currentKeyCount \+= 1;[\s\S]*samePlainValue\(current\[key\], next\[key\]\)[\s\S]*let nextKeyCount = 0;[\s\S]*for \(const key in next\) {[\s\S]*nextKeyCount \+= 1;[\s\S]*return currentKeyCount === nextKeyCount;[\s\S]*}/
  );
  assert.doesNotMatch(
    appScript,
    /Object\.keys\(current\)/
  );
  assert.match(
    appScript,
    /const result = await getMe\(\);[\s\S]*setUserIfChanged\(result\.user\);[\s\S]*if \(user\.value\) {/
  );
  assert.match(
    appScript,
    /const nextProvider = await getProviderSettings\(\)\.catch\(\(\) => null\);[\s\S]*setProviderIfChanged\(nextProvider\);[\s\S]*return true;/
  );
  assert.match(
    appScript,
    /function handleProfileSaved\(nextUser\) {\s*if \(nextUser\?\.id && user\.value\?\.id === nextUser\.id\) {\s*setUserIfChanged\(nextUser\);/
  );
  assert.doesNotMatch(appScript, /user\.value\s*=\s*(result\.user|nextUser|null)/);
  assert.doesNotMatch(appScript, /provider\.value\s*=\s*(nextProvider|null)/);
});

test('App auth boundary resets use stable user and provider setters', () => {
  assert.match(
    appScript,
    /async function handleAuthenticated\(result\) {[\s\S]*clearNotifications\(\);[\s\S]*setUserIfChanged\(result\.user\);[\s\S]*setProviderIfChanged\(null\);[\s\S]*await refreshProvider\(authScope\);/
  );
  assert.match(
    appScript,
    /async function handleLogout\(\) {[\s\S]*clearNotifications\(\);[\s\S]*setUserIfChanged\(null\);[\s\S]*setProviderIfChanged\(null\);[\s\S]*navigate\('login'\);/
  );
  assert.match(
    appScript,
    /} catch \(error\) {[\s\S]*setUserIfChanged\(null\);[\s\S]*setProviderIfChanged\(null\);[\s\S]*clearNotifications\(\);/
  );
});
