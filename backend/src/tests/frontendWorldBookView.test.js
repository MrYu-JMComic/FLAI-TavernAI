import assert from 'node:assert/strict';
import test from 'node:test';
import { countMatches, readVueBlocks } from './frontendSfcTestUtils.js';

const {
  script: worldBookViewScript,
  template: worldBookViewTemplate
} = readVueBlocks('frontend/src/views/WorldBookView.vue');

function assertSavingGuard(scriptSetup, functionName) {
  assert.match(
    scriptSetup,
    new RegExp(`(?:async\\s+)?function ${functionName}\\([^)]*\\)\\s*{\\s*if \\([^;]*saving\\.value[^;]*\\) return;`)
  );
}

test('WorldBookView retry action ignores events while loading is active', () => {
  assert.match(
    worldBookViewScript,
    /function retryLoad\(\)\s*{\s*if \(loading\.value\) return;[\s\S]*?loadBook\(bookId\.value\);[\s\S]*?loadBooks\(\);/
  );
  assert.equal(
    countMatches(worldBookViewTemplate, /<button class="ghost-button" :disabled="loading" :aria-busy="loading" @click="retryLoad">/g),
    2
  );
});

test('WorldBookView preserves unchanged book and entry references during refreshes', () => {
  assert.match(
    worldBookViewScript,
    /const nextBooks = await fetchWorldBooks\(\);[\s\S]*setBooksIfChanged\(nextBooks\);/
  );
  assert.match(
    worldBookViewScript,
    /const nextBook = await fetchWorldBook\(id\);[\s\S]*setCurrentBookIfChanged\(nextBook\);/
  );
  assert.match(
    worldBookViewScript,
    /function setBooksIfChanged\(nextBooks\) \{[\s\S]*sameBookList\(books\.value, normalizedNextBooks\)[\s\S]*books\.value = normalizedNextBooks;[\s\S]*return true;[\s\S]*\}/
  );
  assert.match(
    worldBookViewScript,
    /function sameEntrySummary\(currentEntry, nextEntry\) \{[\s\S]*currentEntry\?\.triggerKeys === nextEntry\?\.triggerKeys[\s\S]*nullableComparable\(currentEntry\?\.sticky\) === nullableComparable\(nextEntry\?\.sticky\)[\s\S]*Number\(currentEntry\?\.orderIndex \|\| 0\) === Number\(nextEntry\?\.orderIndex \|\| 0\);[\s\S]*\}/
  );
  assert.equal(countMatches(worldBookViewScript, /books\.value\s*=/g), 1);
  assert.equal(countMatches(worldBookViewScript, /currentBook\.value\s*=/g), 2);
});

test('WorldBookView locks world book mutations while saving is active', () => {
  [
    'openCreateBook',
    'openEditBook',
    'saveBook',
    'removeBook',
    'openCreateEntry',
    'openEditEntry',
    'saveEntry',
    'removeEntry',
    'toggleEntry',
    'moveEntry',
    'completeWorldBookWithAi',
    'createBookFromAiDraft'
  ].forEach((functionName) => assertSavingGuard(worldBookViewScript, functionName));

  assert.match(
    worldBookViewScript,
    /async function removeBook\(id\)[\s\S]*?saving\.value = true;[\s\S]*?finally\s*{[\s\S]*?isCurrentWorldBookRouteMutation\(mutationToken, routeKey\)[\s\S]*?saving\.value = false;/
  );
  assert.match(
    worldBookViewScript,
    /async function removeEntry\(entryId\)[\s\S]*?saving\.value = true;[\s\S]*?finally\s*{[\s\S]*?isCurrentWorldBookMutation\(mutationToken, targetBookId\)[\s\S]*?saving\.value = false;/
  );
  assert.match(
    worldBookViewScript,
    /async function toggleEntry\(entry\)[\s\S]*?saving\.value = true;[\s\S]*?finally\s*{[\s\S]*?isCurrentWorldBookMutation\(mutationToken, targetBookId\)[\s\S]*?saving\.value = false;/
  );
  assert.match(
    worldBookViewScript,
    /async function moveEntry\(index, direction\)[\s\S]*?saving\.value = true;[\s\S]*?finally\s*{[\s\S]*?isCurrentWorldBookMutation\(mutationToken, targetBookId\)[\s\S]*?saving\.value = false;/
  );

  assert.ok(countMatches(worldBookViewTemplate, /:disabled="saving"/g) >= 10);
  assert.ok(countMatches(worldBookViewTemplate, /:aria-busy="saving"/g) >= 10);
  assert.equal(countMatches(worldBookViewTemplate, /:disabled="saving \|\| index === 0"/g), 1);
  assert.equal(countMatches(worldBookViewTemplate, /:disabled="saving \|\| index === currentBook\.entries\.length - 1"/g), 1);
  assert.match(worldBookViewTemplate, /:disabled="aiLoading \|\| saving"/);
  assert.match(worldBookViewTemplate, /:disabled="!aiDraft \|\| !aiDraftEntryCount \|\| aiLoading \|\| saving"/);
});

test('WorldBookView freezes book and entry forms while saving is active', () => {
  ['closeBookForm', 'closeEntryForm'].forEach((functionName) => assertSavingGuard(worldBookViewScript, functionName));

  assert.match(worldBookViewTemplate, /<div class="modal-content form-panel" :aria-busy="saving">/);
  assert.match(worldBookViewTemplate, /<input v-model\.trim="editingBook\.name"[\s\S]*:disabled="saving" \/>/);
  assert.match(worldBookViewTemplate, /<textarea v-model="editingBook\.description"[\s\S]*:disabled="saving" \/>/);
  assert.match(worldBookViewTemplate, /<input v-model\.trim="editingBook\.characterId"[\s\S]*:disabled="saving" \/>/);
  assert.match(worldBookViewTemplate, /<input v-model\.number="editingBook\.scanDepth"[\s\S]*:disabled="saving" \/>/);
  assert.match(worldBookViewTemplate, /<input v-model\.number="editingBook\.lorebookContextPercent"[\s\S]*:disabled="saving" \/>/);
  assert.match(worldBookViewTemplate, /<button class="ghost-button" :disabled="saving" @click="closeBookForm">/);
  assert.match(worldBookViewTemplate, /<button class="primary-button" :disabled="saving" :aria-busy="saving" @click="saveBook">/);

  assert.match(worldBookViewTemplate, /<div class="modal-content form-panel entry-modal" :aria-busy="saving">/);
  assert.match(worldBookViewTemplate, /<input v-model\.trim="editingEntry\.name"[\s\S]*:disabled="saving" \/>/);
  assert.match(worldBookViewTemplate, /<input v-model="editingEntry\.triggerKeys"[\s\S]*:disabled="saving" \/>/);
  assert.match(worldBookViewTemplate, /<select v-model="editingEntry\.position" :disabled="saving">/);
  assert.match(worldBookViewTemplate, /<textarea v-model="editingEntry\.content"[\s\S]*:disabled="saving" \/>/);
  assert.match(worldBookViewTemplate, /<input v-model="editingEntry\.enabled" type="checkbox" :disabled="saving" \/>/);
  assert.match(worldBookViewTemplate, /<input v-model="editingEntry\.regexMode" type="checkbox" :disabled="saving" \/>/);
  assert.match(worldBookViewTemplate, /<input v-model="editingEntry\.alwaysActive" type="checkbox" :disabled="saving" \/>/);
  assert.match(worldBookViewTemplate, /<input v-model="editingEntry\.selective" type="checkbox" :disabled="saving" \/>/);
  assert.match(worldBookViewTemplate, /<input v-model="editingEntry\.useProbability" type="checkbox" :disabled="saving" \/>/);
  assert.match(worldBookViewTemplate, /<select v-model\.number="editingEntry\.selectiveLogic" :disabled="saving">/);
  assert.match(worldBookViewTemplate, /<select v-model\.number="editingEntry\.role" :disabled="saving">/);
  assert.match(worldBookViewTemplate, /<button class="ghost-button" :disabled="saving" @click="closeEntryForm">/);
  assert.match(worldBookViewTemplate, /<button class="primary-button" :disabled="saving" :aria-busy="saving" @click="saveEntry">/);
});
