import assert from 'node:assert/strict';
import test from 'node:test';
import { countMatches, readRepoText, readVueBlocks } from './frontendSfcTestUtils.js';

const {
  script: worldBookViewScript,
  template: worldBookViewTemplate
} = readVueBlocks('frontend/src/views/WorldBookView.vue');

const worldBookAiScript = readRepoText('frontend/src/composables/worldbook/useWorldBookAi.js');
const { script: worldBookAiPanelScript, template: worldBookAiPanelTemplate } = readVueBlocks('frontend/src/components/worldbook/WorldBookAiPanel.vue');

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

test('WorldBookView list error state offers creation and navigation exits', () => {
  assert.match(
    worldBookViewTemplate,
    /<div v-else-if="error" class="empty-state error-state">[\s\S]*@click="retryLoad"[\s\S]*@click="openCreateBook"[\s\S]*新建世界书[\s\S]*@click="emit\('navigate', 'home'\)"[\s\S]*返回首页/
  );
});

test('WorldBookView preserves unchanged book and entry references during refreshes', () => {
  assert.match(
    worldBookViewScript,
    /const nextBooks = await fetchWorldBooks\(\);[\s\S]*setBooksIfChanged\(nextBooks\);/
  );
  assert.match(
    worldBookViewScript,
    /const \[nextBook, nextBooks\] = await Promise\.all\(\[fetchWorldBook\(id\), fetchWorldBooks\(\)\]\);[\s\S]*setBooksIfChanged\(nextBooks\);[\s\S]*setCurrentBookIfChanged\(nextBook\);/
  );
  assert.match(
    worldBookViewScript,
    /function setBooksIfChanged\(nextBooks\) \{[\s\S]*sameBookList\(books\.value, normalizedNextBooks\)[\s\S]*books\.value = normalizedNextBooks;[\s\S]*return true;[\s\S]*\}/
  );
  assert.match(
    worldBookViewScript,
    /function removeBookFromListIfPresent\(id\) \{[\s\S]*const currentBooks = Array\.isArray\(books\.value\) \? books\.value : \[\];[\s\S]*let nextBooks = null;[\s\S]*for \(let index = 0; index < currentBooks\.length; index \+= 1\) \{[\s\S]*const book = currentBooks\[index\];[\s\S]*if \(book\?\.id === id\) \{[\s\S]*for \(let copyIndex = 0; copyIndex < index; copyIndex \+= 1\) \{[\s\S]*nextBooks\.push\(currentBooks\[copyIndex\]\);[\s\S]*continue;[\s\S]*if \(nextBooks\) \{[\s\S]*nextBooks\.push\(book\);[\s\S]*return nextBooks \? setBooksIfChanged\(nextBooks\) : false;[\s\S]*\}/
  );
  assert.match(worldBookViewScript, /removeBookFromListIfPresent\(id\);/);
  assert.match(
    worldBookViewScript,
    /function sameEntrySummary\(currentEntry, nextEntry\) \{[\s\S]*currentEntry\?\.triggerKeys === nextEntry\?\.triggerKeys[\s\S]*nullableComparable\(currentEntry\?\.sticky\) === nullableComparable\(nextEntry\?\.sticky\)[\s\S]*Number\(currentEntry\?\.orderIndex \|\| 0\) === Number\(nextEntry\?\.orderIndex \|\| 0\);[\s\S]*\}/
  );
  assert.match(
    worldBookViewScript,
    /function sameBookList\(currentBooks, nextBooks\) \{[\s\S]*for \(let index = 0; index < currentBooks\.length; index \+= 1\) \{[\s\S]*sameBookSummary\(currentBooks\[index\], nextBooks\[index\]\)[\s\S]*return true;[\s\S]*\}/
  );
  assert.match(
    worldBookViewScript,
    /function sameEntryList\(currentEntries, nextEntries\) \{[\s\S]*for \(let index = 0; index < currentEntries\.length; index \+= 1\) \{[\s\S]*sameEntrySummary\(currentEntries\[index\], nextEntries\[index\]\)[\s\S]*return true;[\s\S]*\}/
  );
  assert.equal(countMatches(worldBookViewScript, /books\.value\s*=/g), 1);
  assert.equal(countMatches(worldBookViewScript, /currentBook\.value\s*=/g), 2);
  assert.doesNotMatch(worldBookViewScript, /books\.value\.filter\(\(book\) => book\.id !== id\)/);
  assert.doesNotMatch(worldBookViewScript, /let hasBook = false/);
});

test('WorldBookView delegates the assistant and exposes selection, creation and transaction results', () => {
  assert.match(worldBookViewScript, /useWorldBookAi\(/);
  assert.equal(countMatches(worldBookViewTemplate, /<WorldBookAiPanel /g), 2);
  assert.match(worldBookViewScript, /selectedIds: aiSelectedBookIds\.value/);
  assert.match(worldBookViewScript, /changes: aiChanges\.value/);
  assert.match(worldBookViewScript, /history: aiHistory\.value/);
  assert.match(worldBookViewScript, /'new-book': prepareNewWorldBook/);
  assert.match(worldBookViewScript, /apply: applyWorldBookAiResults/);
  assert.match(worldBookAiPanelTemplate, /<WorldBookTargetPicker /);
  assert.match(worldBookAiPanelTemplate, /<WorldBookChanges /);
  assert.match(worldBookAiPanelScript, /'new-book'/);
  assert.match(worldBookAiPanelScript, /'apply'/);
  assert.doesNotMatch(worldBookViewScript, /createBookFromAiDraft|rollbackCreatedWorldBook/);
});

test('WorldBookView aggregates current entry stats in one pass', () => {
  assert.match(
    worldBookViewScript,
    /const currentEntryStats = computed\(\(\) => \{[\s\S]*const stats = \{[\s\S]*enabled: 0,[\s\S]*disabled: 0,[\s\S]*alwaysActive: 0,[\s\S]*probability: 0[\s\S]*\};[\s\S]*const entries = Array\.isArray\(currentEntries\.value\) \? currentEntries\.value : \[\];[\s\S]*for \(const entry of entries\) \{[\s\S]*stats\.enabled \+= 1;[\s\S]*stats\.alwaysActive \+= 1;[\s\S]*stats\.probability \+= 1;[\s\S]*\}[\s\S]*stats\.disabled = Math\.max\(0, entries\.length - stats\.enabled\);[\s\S]*return stats;[\s\S]*\}\);/
  );
  assert.match(worldBookViewScript, /const enabledEntryCount = computed\(\(\) => currentEntryStats\.value\.enabled\);/);
  assert.match(worldBookViewScript, /const disabledEntryCount = computed\(\(\) => currentEntryStats\.value\.disabled\);/);
  assert.match(worldBookViewScript, /const alwaysActiveEntryCount = computed\(\(\) => currentEntryStats\.value\.alwaysActive\);/);
  assert.match(worldBookViewScript, /const probabilityEntryCount = computed\(\(\) => currentEntryStats\.value\.probability\);/);
  assert.doesNotMatch(worldBookViewScript, /const enabledEntryCount = computed\(\(\) => currentEntries\.value\.filter/);
  assert.doesNotMatch(worldBookViewScript, /const alwaysActiveEntryCount = computed\(\(\) => currentEntries\.value\.filter/);
  assert.doesNotMatch(worldBookViewScript, /const probabilityEntryCount = computed\(\(\) => currentEntries\.value\.filter/);
});

test('WorldBookView aggregates book list stats in one pass', () => {
  assert.match(
    worldBookViewScript,
    /const bookListStats = computed\(\(\) => \{[\s\S]*const sourceBooks = Array\.isArray\(books\.value\) \? books\.value : \[\];[\s\S]*let totalEntries = 0;[\s\S]*let withEntries = 0;[\s\S]*for \(const book of sourceBooks\) \{[\s\S]*const entryCount = Number\(book\?\.entryCount \|\| 0\);[\s\S]*totalEntries \+= entryCount;[\s\S]*withEntries \+= 1;[\s\S]*averageEntries: sourceBooks\.length \? Math\.round\(totalEntries \/ sourceBooks\.length\) : 0[\s\S]*\}\);/
  );
  assert.match(worldBookViewScript, /const totalEntryCount = computed\(\(\) => bookListStats\.value\.totalEntries\);/);
  assert.match(worldBookViewScript, /const booksWithEntriesCount = computed\(\(\) => bookListStats\.value\.withEntries\);/);
  assert.match(worldBookViewScript, /const averageEntryCount = computed\(\(\) => bookListStats\.value\.averageEntries\);/);
  assert.doesNotMatch(worldBookViewScript, /const totalEntryCount = computed\(\(\) => books\.value\.reduce/);
  assert.doesNotMatch(worldBookViewScript, /const booksWithEntriesCount = computed\(\(\) => books\.value\.filter/);
});

test('WorldBookView scans position options directly for manual entry labels', () => {
  assert.match(
    worldBookViewScript,
    /function positionLabel\(value\) \{\s*return getPositionOptionByValue\(value\)\?\.label \|\| value;\s*\}/
  );
  assert.match(
    worldBookViewScript,
    /function getPositionOptionByValue\(value\) \{\s*for \(const option of positionOptions\) \{\s*if \(option\.value === value\) \{\s*return option;\s*\}\s*\}\s*return null;\s*\}/
  );
  assert.doesNotMatch(worldBookViewScript, /positionOptions\.find/);
  assert.doesNotMatch(worldBookViewScript, /positionOptions\.some/);
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
    'runWorldBookAi',
    'runWorldBookPlan',
    'replanWorldBook'
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
  assert.match(worldBookViewScript, /saving: saving\.value \|\| aiSaving\.value/);
  assert.match(worldBookAiPanelScript, /props\.loading \|\| props\.saving/);
  assert.match(worldBookAiScript, /if \(aiLoading\.value \|\| aiSaving\.value \|\| !selectedChanges\?\.length\) return;/);
});

test('WorldBookView invalidates mutation tokens before mutation-triggered navigation', () => {
  assert.match(
    worldBookViewScript,
    /function navigateFromWorldBookMutation\(page, params\) \{\s*worldBookMutationToken \+= 1;\s*emit\('navigate', page, params\);\s*\}/
  );
  assert.match(
    worldBookViewScript,
    /const book = await createWorldBook\(payload\);[\s\S]*?navigateFromWorldBookMutation\('worldBookDetail', \{ id: book\.id \}\);/
  );
  assert.match(
    worldBookViewScript,
    /if \(isDetailView\.value\) \{\s*navigateFromWorldBookMutation\('worldBooks'\);\s*\} else \{/
  );
  assert.equal(countMatches(worldBookViewScript, /emit\('navigate'/g), 1);
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

  assert.match(worldBookViewTemplate, /<div\b(?=[^>]*\bclass="modal-content form-panel entry-modal")(?=[^>]*:aria-busy="saving")[^>]*>/);
  assert.match(worldBookViewTemplate, /<input v-model\.trim="editingEntry\.name"[\s\S]*:disabled="saving" \/>/);
  assert.match(worldBookViewTemplate, /<input v-model="editingEntry\.triggerKeys"[\s\S]*:disabled="saving" \/>/);
  assert.match(worldBookViewTemplate, /<select v-model="editingEntry\.position" :disabled="saving">/);
  assert.match(worldBookViewTemplate, /<textarea v-model="editingEntry\.content"[\s\S]*:disabled="saving" \/>/);
  assert.match(worldBookViewTemplate, /<select v-model="editingEntry\.knowledgeVisibility" :disabled="saving">/);
  assert.match(worldBookViewTemplate, /<input v-model="editingEntry\.audienceCastKeysText"[^>]*:disabled="saving"/);
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

test('WorldBookView closes saved forms from internal save completions', () => {
  assert.match(
    worldBookViewScript,
    /function closeBookForm\(\) \{\s*if \(saving\.value\) return;\s*resetBookFormState\(\);\s*\}/
  );
  assert.match(
    worldBookViewScript,
    /function resetBookFormState\(\) \{\s*showBookForm\.value = false;\s*editingBookId\.value = null;\s*\}/
  );
  assert.match(
    worldBookViewScript,
    /if \(targetBookId\) \{[\s\S]*?if \(!isCurrentWorldBookRouteMutation\(mutationToken, routeKey\)\) return;\s*resetBookFormState\(\);\s*notify\.success/
  );
  assert.match(
    worldBookViewScript,
    /const book = await createWorldBook\(payload\);[\s\S]*?if \(!isCurrentWorldBookRouteMutation\(mutationToken, routeKey\)\) return;\s*resetBookFormState\(\);\s*notify\.success/
  );
  assert.match(
    worldBookViewScript,
    /function closeEntryForm\(\) \{\s*if \(saving\.value\) return;\s*resetEntryFormState\(\);\s*\}/
  );
  assert.match(
    worldBookViewScript,
    /function resetEntryFormState\(\) \{\s*showEntryForm\.value = false;\s*editingEntryId\.value = null;\s*\}/
  );
  assert.match(
    worldBookViewScript,
    /if \(!isCurrentWorldBookMutation\(mutationToken, targetBookId\)\) return;\s*resetEntryFormState\(\);\s*await loadBook\(targetBookId\);/
  );
  assert.doesNotMatch(
    worldBookViewScript,
    /if \(!isCurrentWorldBookMutation\(mutationToken, targetBookId\)\) return;\s*closeEntryForm\(\);\s*await loadBook\(targetBookId\);/
  );
});
