import assert from 'node:assert/strict';
import test from 'node:test';
import { countMatches, readFrontendStyles, readVueBlocks } from './frontendSfcTestUtils.js';

const { script: authScript, template: authTemplate } = readVueBlocks('frontend/src/views/AuthView.vue');
const { script: loginScript, template: loginTemplate } = readVueBlocks('frontend/src/views/LoginView.vue');
const { script: registerScript, template: registerTemplate } = readVueBlocks('frontend/src/views/RegisterView.vue');
const stylesSource = readFrontendStyles();

test('auth routes share one switchable login/register form', () => {
  assert.match(loginScript, /import AuthView from '\.\/AuthView\.vue';/);
  assert.match(registerScript, /import AuthView from '\.\/AuthView\.vue';/);
  assert.match(loginTemplate, /<AuthView initial-mode="login" @authenticated="emit\('authenticated', \$event\)" \/>/);
  assert.match(registerTemplate, /<AuthView initial-mode="register" @authenticated="emit\('authenticated', \$event\)" \/>/);
  assert.doesNotMatch(loginScript, /async function submit/);
  assert.doesNotMatch(registerScript, /async function submit/);
  assert.doesNotMatch(loginTemplate, /<form class="form-grid"/);
  assert.doesNotMatch(registerTemplate, /<form class="form-grid"/);

  assert.match(authTemplate, /class="auth-mode-tabs" role="tablist" aria-label="账号操作"/);
  assert.equal(countMatches(authTemplate, /role="tab"/g), 2);
  assert.match(authTemplate, /@click="setMode\('login'\)"/);
  assert.match(authTemplate, /@click="setMode\('register'\)"/);
  assert.doesNotMatch(authTemplate, /@click="emit\('navigate'/);
});

test('auth form freezes controls and shows inline errors while submitting', () => {
  assert.match(authScript, /async function submit\(\)\s*{\s*if \(loading\.value\) return;/);
  assert.match(authTemplate, /<form class="form-grid auth-form" :aria-busy="loading" @submit\.prevent="submit" novalidate>/);
  assert.ok(countMatches(authTemplate, /:disabled="loading"/g) >= 7);
  assert.match(authTemplate, /<p v-if="formError" class="error-text auth-inline-error" role="alert">/);
  assert.match(
    authScript,
    /function validateAuthForm\(\) \{[\s\S]*formError\.value = '请输入用户名';[\s\S]*formError\.value = '密码至少需要 6 个字符';[\s\S]*formError\.value = '两次输入的密码不一致';/
  );
  assert.match(
    authScript,
    /catch \(err\) \{[\s\S]*formError\.value = err\?\.message \|\| '认证失败，请稍后重试';[\s\S]*notify\.error\(formError\.value\);/
  );
});

test('auth form supports password visibility without duplicating fields', () => {
  assert.match(authScript, /const passwordVisible = ref\(false\);/);
  assert.match(authScript, /const confirmPasswordVisible = ref\(false\);/);
  assert.match(authScript, /const passwordInputType = computed\(\(\) => \(passwordVisible\.value \? 'text' : 'password'\)\);/);
  assert.match(authScript, /const confirmPasswordInputType = computed\(\(\) => \(confirmPasswordVisible\.value \? 'text' : 'password'\)\);/);
  assert.equal(countMatches(authTemplate, /class="icon-button auth-password-toggle"/g), 2);
  assert.match(authTemplate, /:aria-label="passwordVisible \? '隐藏密码' : '显示密码'"/);
  assert.match(authTemplate, /:aria-label="confirmPasswordVisible \? '隐藏确认密码' : '显示确认密码'"/);
  assert.match(stylesSource, /\.auth-password-field\s*\{[\s\S]*position:\s*relative;[\s\S]*display:\s*grid;/);
  assert.match(stylesSource, /\.auth-password-toggle\s*\{[\s\S]*position:\s*absolute;[\s\S]*right:\s*4px;/);
});

test('auth form ignores stale submit completions after unmount', () => {
  assert.match(authScript, /import \{ computed, onBeforeUnmount, ref, watch \} from 'vue';/);
  assert.match(authScript, /let submitToken = 0;/);
  assert.match(authScript, /let disposed = false;/);
  assert.match(
    authScript,
    /onBeforeUnmount\(\(\) => \{\s*disposed = true;\s*submitToken \+= 1;\s*\}\);/
  );
  assert.match(
    authScript,
    /function isCurrentSubmit\(token\)\s*{\s*return !disposed && token === submitToken;\s*}/
  );
  assert.match(
    authScript,
    /const requestToken = \+\+submitToken;[\s\S]*if \(!isCurrentSubmit\(requestToken\)\) return;[\s\S]*emit\('authenticated', result\);/
  );
  assert.match(
    authScript,
    /catch \(err\) \{\s*if \(!isCurrentSubmit\(requestToken\)\) return;[\s\S]*notify\.error\(formError\.value\);/
  );
  assert.match(
    authScript,
    /finally \{\s*if \(isCurrentSubmit\(requestToken\)\) \{\s*loading\.value = false;\s*\}\s*\}/
  );
});
