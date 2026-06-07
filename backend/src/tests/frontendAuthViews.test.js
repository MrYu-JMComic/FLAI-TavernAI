import assert from 'node:assert/strict';
import test from 'node:test';
import { countMatches, readVueBlocks } from './frontendSfcTestUtils.js';

const { script: loginScript, template: loginTemplate } = readVueBlocks('frontend/src/views/LoginView.vue');
const { script: registerScript, template: registerTemplate } = readVueBlocks('frontend/src/views/RegisterView.vue');

test('auth forms freeze inputs and navigation while submitting', () => {
  assert.match(loginScript, /async function submit\(\)\s*{\s*if \(loading\.value\) return;/);
  assert.match(registerScript, /async function submit\(\)\s*{\s*if \(loading\.value\) return;/);

  assert.match(loginTemplate, /<form class="form-grid" :aria-busy="loading" @submit\.prevent="submit" novalidate>/);
  assert.match(registerTemplate, /<form class="form-grid" :aria-busy="loading" @submit\.prevent="submit" novalidate>/);
  assert.equal(countMatches(loginTemplate, /:disabled="loading"/g), 4);
  assert.equal(countMatches(registerTemplate, /:disabled="loading"/g), 5);
  assert.match(loginTemplate, /aria-label="跳转到注册页面" :disabled="loading"/);
  assert.match(registerTemplate, /aria-label="跳转到登录页面" :disabled="loading"/);
});
