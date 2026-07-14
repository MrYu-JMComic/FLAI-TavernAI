import assert from 'node:assert/strict';
import test from 'node:test';
import { readVueBlocks } from './frontendSfcTestUtils.js';

const { script: appScript } = readVueBlocks('frontend/src/App.vue', ['script']);

test('App session state preserves user and provider references for unchanged payloads', () => {
  assert.match(
    appScript,
    /import \{ samePlainValue \} from '\.\/utils\/plainValues';/
  );
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
  assert.doesNotMatch(
    appScript,
    /function samePlainValue\(/
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
    /let nextProvider = null;[\s\S]*nextProvider = await getProviderSettings\(\);[\s\S]*recordFrontendDiagnostic\('app\.provider\.refresh', error, \{ requestId \}\);[\s\S]*setProviderIfChanged\(nextProvider\);[\s\S]*return true;/
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

test('App refreshes the saved provider model catalog in the background after startup', () => {
  assert.match(
    appScript,
    /import \{ refreshProviderModels \} from '\.\/services\/modelCatalog\.js';/
  );
  assert.match(
    appScript,
    /async function refreshProvider\(authScope = authScopeVersion\) \{[\s\S]*setProviderIfChanged\(nextProvider\);[\s\S]*void refreshProviderModelCatalog\(nextProvider, authScope, requestId\);[\s\S]*return true;/
  );
  assert.match(
    appScript,
    /async function refreshProviderModelCatalog\(nextProvider, authScope, requestId\) \{[\s\S]*const canUseSavedCredential = Boolean\(nextProvider\?\.apiKey \|\| nextProvider\?\.apiKeySet\);[\s\S]*const canUseLocalNoAuth = nextProvider\?\.providerType === 'custom'[\s\S]*isLocalOrPrivateBaseUrl\(nextProvider\?\.baseUrl\);[\s\S]*if \(!nextProvider\?\.baseUrl \|\| nextProvider\.apiKeyNeedsReset \|\| \(!canUseSavedCredential && !canUseLocalNoAuth\)\) \{[\s\S]*await refreshProviderModels\(nextProvider, \{ forceRefresh: false \}\);[\s\S]*recordFrontendDiagnostic\('app\.provider\.models\.refresh', error, \{ requestId \}\);/
  );
});
