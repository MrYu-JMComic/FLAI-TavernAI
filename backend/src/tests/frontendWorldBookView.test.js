import assert from 'node:assert/strict';
import test from 'node:test';
import { countMatches, readRepoText, readVueBlock } from './frontendSfcTestUtils.js';

const worldBookViewSource = readRepoText('frontend/src/views/WorldBookView.vue');

function assertSavingGuard(scriptSetup, functionName) {
  assert.match(
    scriptSetup,
    new RegExp(`(?:async\\s+)?function ${functionName}\\([^)]*\\)\\s*{\\s*if \\([^;]*saving\\.value[^;]*\\) return;`)
  );
}

test('WorldBookView retry action ignores events while loading is active', () => {
  const scriptSetup = readVueBlock(worldBookViewSource, 'script');
  const template = readVueBlock(worldBookViewSource, 'template');

  assert.match(
    scriptSetup,
    /function retryLoad\(\)\s*{\s*if \(loading\.value\) return;[\s\S]*?loadBook\(bookId\.value\);[\s\S]*?loadBooks\(\);/
  );
  assert.equal(
    countMatches(template, /<button class="ghost-button" :disabled="loading" :aria-busy="loading" @click="retryLoad">/g),
    2
  );
});

test('WorldBookView locks world book mutations while saving is active', () => {
  const scriptSetup = readVueBlock(worldBookViewSource, 'script');
  const template = readVueBlock(worldBookViewSource, 'template');

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
  ].forEach((functionName) => assertSavingGuard(scriptSetup, functionName));

  assert.match(
    scriptSetup,
    /async function removeBook\(id\)[\s\S]*?saving\.value = true;[\s\S]*?finally\s*{[\s\S]*?isCurrentWorldBookRouteMutation\(mutationToken, routeKey\)[\s\S]*?saving\.value = false;/
  );
  assert.match(
    scriptSetup,
    /async function removeEntry\(entryId\)[\s\S]*?saving\.value = true;[\s\S]*?finally\s*{[\s\S]*?isCurrentWorldBookMutation\(mutationToken, targetBookId\)[\s\S]*?saving\.value = false;/
  );
  assert.match(
    scriptSetup,
    /async function toggleEntry\(entry\)[\s\S]*?saving\.value = true;[\s\S]*?finally\s*{[\s\S]*?isCurrentWorldBookMutation\(mutationToken, targetBookId\)[\s\S]*?saving\.value = false;/
  );
  assert.match(
    scriptSetup,
    /async function moveEntry\(index, direction\)[\s\S]*?saving\.value = true;[\s\S]*?finally\s*{[\s\S]*?isCurrentWorldBookMutation\(mutationToken, targetBookId\)[\s\S]*?saving\.value = false;/
  );

  assert.ok(countMatches(template, /:disabled="saving"/g) >= 10);
  assert.ok(countMatches(template, /:aria-busy="saving"/g) >= 10);
  assert.equal(countMatches(template, /:disabled="saving \|\| index === 0"/g), 1);
  assert.equal(countMatches(template, /:disabled="saving \|\| index === currentBook\.entries\.length - 1"/g), 1);
  assert.match(template, /:disabled="aiLoading \|\| saving"/);
  assert.match(template, /:disabled="!aiDraft \|\| !aiDraftEntryCount \|\| aiLoading \|\| saving"/);
});
