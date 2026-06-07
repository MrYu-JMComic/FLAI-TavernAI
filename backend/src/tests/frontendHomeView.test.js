import assert from 'node:assert/strict';
import test from 'node:test';
import { countMatches, readRepoText, readVueBlock } from './frontendSfcTestUtils.js';

const homeViewSource = readRepoText('frontend/src/views/HomeView.vue');

test('HomeView retry actions ignore events while their loads are active', () => {
  const scriptSetup = readVueBlock(homeViewSource, 'script');
  const template = readVueBlock(homeViewSource, 'template');

  assert.match(scriptSetup, /const tagLoading = ref\(false\);/);
  assert.match(
    scriptSetup,
    /async function loadTags\(\)[\s\S]*tagLoading\.value = true;[\s\S]*finally\s*{[\s\S]*isCurrentTagLoad\(requestToken\)[\s\S]*tagLoading\.value = false;/
  );
  assert.match(scriptSetup, /function resetHomeAsyncScope\(\)[\s\S]*tagLoading\.value = false;/);
  assert.match(
    scriptSetup,
    /function retryLoadTags\(\)\s*{\s*if \(tagLoading\.value\) return;\s*loadTags\(\);/
  );
  assert.match(
    scriptSetup,
    /function retryLoadCharacters\(\)\s*{\s*if \(loading\.value\) return;\s*loadCharacters\(\);/
  );

  assert.equal(countMatches(template, /@click="retryLoadCharacters"/g), 2);
  assert.match(
    template,
    /<button class="home-icon-button" type="button" title="[^"]+" aria-label="[^"]+" :disabled="loading" :aria-busy="loading" @click="retryLoadCharacters">/
  );
  assert.match(
    template,
    /<button class="ghost-button compact-button" type="button" :disabled="tagLoading" :aria-busy="tagLoading" @click="retryLoadTags">/
  );
  assert.match(
    template,
    /<button class="home-primary-action" type="button" :disabled="loading" :aria-busy="loading" @click="retryLoadCharacters">/
  );
});
