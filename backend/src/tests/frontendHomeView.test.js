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
    /<input v-model\.trim="search" placeholder="[^"]+" aria-label="[^"]+" \/>/
  );
  assert.match(homeViewTemplate, /<select v-model="sort" aria-label="[^"]+">/);
});

test('HomeView coalesces character-list width measurements into animation frames', () => {
  assert.match(homeViewScript, /let containerMeasureRafId = null;/);
  assert.match(
    homeViewScript,
    /function scheduleContainerWidthMeasurement\(\) \{[\s\S]*if \(containerMeasureRafId !== null\) return;[\s\S]*requestAnimationFrame\(\(\) => \{[\s\S]*containerMeasureRafId = null;[\s\S]*measureContainerWidth\(\);/
  );
  assert.match(
    homeViewScript,
    /function cancelContainerWidthMeasurement\(\) \{[\s\S]*cancelAnimationFrame\(containerMeasureRafId\);[\s\S]*containerMeasureRafId = null;/
  );
  assert.match(
    homeViewScript,
    /function refreshScrollMeasurements\(\) \{[\s\S]*cancelContainerWidthMeasurement\(\);[\s\S]*measureContainerWidth\(\);[\s\S]*new ResizeObserver\(scheduleContainerWidthMeasurement\);/
  );
  assert.match(
    homeViewScript,
    /onUnmounted\(\(\) => \{[\s\S]*cancelContainerWidthMeasurement\(\);[\s\S]*removeMobileLayoutListener\(\);/
  );
});

test('HomeView preserves unchanged character and tag list references during refreshes', () => {
  assert.match(
    homeViewScript,
    /function setCharactersIfChanged\(nextCharacters\)\s*{\s*const normalizedCharacters = Array\.isArray\(nextCharacters\) \? nextCharacters : \[\];[\s\S]*if \(sameListItems\(currentCharacters, normalizedCharacters, sameCharacterSummary\)\) {\s*return false;\s*}[\s\S]*characters\.value = normalizedCharacters;[\s\S]*return true;[\s\S]*}/
  );
  assert.match(
    homeViewScript,
    /function setTagsIfChanged\(nextTags\)\s*{\s*const normalizedTags = Array\.isArray\(nextTags\) \? nextTags : \[\];[\s\S]*if \(sameListItems\(currentTags, normalizedTags, sameTagSummary\)\) {\s*return false;\s*}[\s\S]*tags\.value = normalizedTags;[\s\S]*return true;[\s\S]*}/
  );
  assert.match(
    homeViewScript,
    /function sameListItems\(currentItems, nextItems, sameItem\)\s*{[\s\S]*if \(currentItems === nextItems\) {\s*return true;\s*}[\s\S]*if \(currentItems\.length !== nextItems\.length\) {\s*return false;\s*}[\s\S]*currentItems\.every\(\(item, index\) => sameItem\(item, nextItems\[index\]\)\);[\s\S]*}/
  );
  assert.match(
    homeViewScript,
    /function sameCharacterSummary\(current = {}, next = {}\)\s*{[\s\S]*current\?\.id === next\?\.id[\s\S]*current\?\.name === next\?\.name[\s\S]*Boolean\(current\?\.favoritedByMe\) === Boolean\(next\?\.favoritedByMe\)[\s\S]*Number\(current\?\.likeCount \|\| 0\) === Number\(next\?\.likeCount \|\| 0\)[\s\S]*sameListItems\(normalizeCharacterTagList\(current\), normalizeCharacterTagList\(next\), sameTagSummary\);[\s\S]*}/
  );
  assert.match(
    homeViewScript,
    /function sameTagSummary\(current = {}, next = {}\)\s*{[\s\S]*String\(current\?\.id \|\| ''\) === String\(next\?\.id \|\| ''\)[\s\S]*String\(current\?\.name \|\| ''\) === String\(next\?\.name \|\| ''\)[\s\S]*Number\(current\?\.usageCount \|\| 0\) === Number\(next\?\.usageCount \|\| 0\);[\s\S]*}/
  );
  assert.match(homeViewScript, /setTagsIfChanged\(nextTags\);/);
  assert.match(homeViewScript, /setTagsIfChanged\(\[\]\);/);
  assert.match(homeViewScript, /setCharactersIfChanged\(nextCharacters\);/);
  assert.match(homeViewScript, /function mergeCharacter\(nextCharacter\) {\s*setCharactersIfChanged\(characters\.value\.map/);
  assert.ok(countMatches(homeViewScript, /setCharactersIfChanged\(/g) >= 3);
  assert.ok(countMatches(homeViewScript, /setTagsIfChanged\(/g) >= 3);
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
