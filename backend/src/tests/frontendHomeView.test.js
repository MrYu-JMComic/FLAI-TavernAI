import assert from 'node:assert/strict';
import test from 'node:test';
import { countMatches, readVueBlocks } from './frontendSfcTestUtils.js';

const { script: homeViewScript, template: homeViewTemplate } = readVueBlocks('frontend/src/views/HomeView.vue');

test('HomeView retry actions ignore events while their loads are active', () => {
  assert.match(homeViewScript, /const tagLoading = ref\(false\);/);
  assert.match(
    homeViewScript,
    /async function loadTags\(\)[\s\S]*tagLoading\.value = true;[\s\S]*finally\s*{[\s\S]*isCurrentTagLoad\(requestToken\)[\s\S]*tagLoading\.value = false;/
  );
  assert.match(homeViewScript, /function resetHomeAsyncScope\(\)[\s\S]*tagLoading\.value = false;/);
  assert.match(
    homeViewScript,
    /function retryLoadTags\(\)\s*{\s*if \(tagLoading\.value\) return;\s*loadTags\(\);/
  );
  assert.match(
    homeViewScript,
    /function retryLoadCharacters\(\)\s*{\s*if \(loading\.value\) return;\s*clearSearchLoadTimer\(\);\s*loadCharacters\(\);/
  );

  assert.equal(countMatches(homeViewTemplate, /@click="retryLoadCharacters"/g), 2);
  assert.match(
    homeViewTemplate,
    /<button class="home-icon-button" type="button" title="[^"]+" aria-label="[^"]+" :disabled="loading" :aria-busy="loading" @click="retryLoadCharacters">/
  );
  assert.match(
    homeViewTemplate,
    /<button class="ghost-button compact-button" type="button" :disabled="tagLoading" :aria-busy="tagLoading" @click="retryLoadTags">/
  );
  assert.match(
    homeViewTemplate,
    /<button class="home-primary-action" type="button" :disabled="loading" :aria-busy="loading" @click="retryLoadCharacters">/
  );
});

test('HomeView debounces search reloads while keeping sort and tag changes immediate', () => {
  assert.match(homeViewScript, /const SEARCH_LOAD_DEBOUNCE_MS = 180;/);
  assert.match(homeViewScript, /let searchLoadTimer = null;/);
  assert.match(homeViewScript, /watch\(search, scheduleSearchLoad\);/);
  assert.match(
    homeViewScript,
    /watch\(\[sort, selectedTag\], \(\) => {\s*clearSearchLoadTimer\(\);\s*loadCharacters\(\);/
  );
  assert.match(
    homeViewScript,
    /function resetHomeAsyncScope\(\)[\s\S]*characterLoadToken \+= 1;[\s\S]*tagLoadToken \+= 1;[\s\S]*clearSearchLoadTimer\(\);/
  );
  assert.match(
    homeViewScript,
    /function clearSearchLoadTimer\(\) {\s*if \(searchLoadTimer\) {\s*clearTimeout\(searchLoadTimer\);[\s\S]*searchLoadTimer = null;/
  );
  assert.match(
    homeViewScript,
    /function scheduleSearchLoad\(\) {\s*clearSearchLoadTimer\(\);[\s\S]*searchLoadTimer = setTimeout\(\(\) => {[\s\S]*if \(!isHomeActive\(\)\) return;[\s\S]*loadCharacters\(\);[\s\S]*}, SEARCH_LOAD_DEBOUNCE_MS\);/
  );
  assert.match(
    homeViewScript,
    /function retryLoadCharacters\(\)\s*{\s*if \(loading\.value\) return;\s*clearSearchLoadTimer\(\);\s*loadCharacters\(\);/
  );

  assert.match(
    homeViewTemplate,
    /<input v-model\.trim="search" placeholder="[^"]+" \/>/
  );
});

test('HomeView ignores stale character import file reads', () => {
  assert.match(homeViewScript, /let importFileReadToken = 0;/);
  assert.match(
    homeViewScript,
    /function resetHomeAsyncScope\(\)[\s\S]*importFileReadToken \+= 1;[\s\S]*clearSearchLoadTimer\(\);/
  );
  assert.match(
    homeViewScript,
    /async function handleImportFile\(event\) {[\s\S]*const readToken = \+\+importFileReadToken;[\s\S]*const text = await file\.text\(\);[\s\S]*if \(!isCurrentImportFileRead\(readToken\)\) return;[\s\S]*importPreview\.value = data;[\s\S]*} catch {[\s\S]*if \(!isCurrentImportFileRead\(readToken\)\) return;/
  );
  assert.match(
    homeViewScript,
    /function isCurrentImportFileRead\(readToken\) {\s*return isHomeActive\(\) && readToken === importFileReadToken;\s*}/
  );
  assert.match(
    homeViewScript,
    /function cancelImport\(\) {[\s\S]*importFileReadToken \+= 1;[\s\S]*importPreview\.value = null;[\s\S]*}/
  );
});
