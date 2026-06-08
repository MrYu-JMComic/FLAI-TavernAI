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

test('WorldBookView preserves unchanged AI draft and process panel references', () => {
  assert.match(
    worldBookViewScript,
    /function setAiDraftIfChanged\(nextDraft\) {\s*return setAiPlainRefIfChanged\(aiDraft, nextDraft \|\| null\);\s*}/
  );
  assert.match(
    worldBookViewScript,
    /function setAiToolCallsIfChanged\(nextToolCalls\) {\s*return setAiPlainListIfChanged\(aiToolCalls, nextToolCalls\);\s*}/
  );
  assert.match(
    worldBookViewScript,
    /function setAiProcessIfChanged\(nextProcess\) {\s*return setAiPlainListIfChanged\(aiProcess, nextProcess\);\s*}/
  );
  assert.match(
    worldBookViewScript,
    /function setAiPlainRefIfChanged\(valueRef, nextValue\) {[\s\S]*samePlainValue\(valueRef\.value, nextValue\)[\s\S]*valueRef\.value = nextValue;[\s\S]*return true;[\s\S]*}/
  );
  assert.match(
    worldBookViewScript,
    /function samePlainValue\(current, next\) {[\s\S]*Object\.is\(current, next\)[\s\S]*Array\.isArray\(current\)[\s\S]*let currentKeyCount = 0;[\s\S]*for \(const key in current\) {[\s\S]*currentKeyCount \+= 1;[\s\S]*samePlainValue\(current\[key\], next\[key\]\)[\s\S]*let nextKeyCount = 0;[\s\S]*for \(const key in next\) {[\s\S]*nextKeyCount \+= 1;[\s\S]*return currentKeyCount === nextKeyCount;[\s\S]*}/
  );
  assert.doesNotMatch(worldBookViewScript, /(?:currentBooks|currentEntries|current|currentKeys)\.every\(/);
  assert.doesNotMatch(worldBookViewScript, /Object\.keys\(current\)/);
  assert.match(
    worldBookViewScript,
    /function updateAiProcessStep\(round = 1, updateStep\) {[\s\S]*const currentProcess = Array\.isArray\(aiProcess\.value\) \? aiProcess\.value : \[\];[\s\S]*let stepIndex = -1;[\s\S]*for \(let index = 0; index < currentProcess\.length; index \+= 1\) {[\s\S]*currentProcess\[index\]\?\.round === round[\s\S]*break;[\s\S]*const nextProcess = \[\];[\s\S]*for \(let index = 0; index < currentProcess\.length; index \+= 1\) {[\s\S]*nextProcess\.push\(index === stepIndex \? nextStep : currentProcess\[index\]\);[\s\S]*if \(stepIndex < 0\) {[\s\S]*nextProcess\.push\(nextStep\);[\s\S]*setAiProcessIfChanged\(nextProcess\);[\s\S]*}/
  );
  assert.match(
    worldBookViewScript,
    /function appendAiToolCall\(log\) {[\s\S]*const currentToolCalls = Array\.isArray\(aiToolCalls\.value\) \? aiToolCalls\.value : \[\];[\s\S]*const nextToolCalls = \[\];[\s\S]*for \(const toolCall of currentToolCalls\) {[\s\S]*nextToolCalls\.push\(toolCall\);[\s\S]*nextToolCalls\.push\(log\);[\s\S]*setAiToolCallsIfChanged\(nextToolCalls\);[\s\S]*}/
  );
  assert.match(
    worldBookViewScript,
    /import \{ appendAiToolList, cloneAiToolList \} from '\.\.\/utils\/aiToolLists';/
  );
  assert.doesNotMatch(worldBookViewScript, /function cloneAiToolList\(/);
  assert.doesNotMatch(worldBookViewScript, /function appendAiToolList\(/);
  assert.doesNotMatch(worldBookViewScript, /currentProcess\.findIndex\(/);
  assert.doesNotMatch(worldBookViewScript, /currentProcess\.map\(\(item, index\) => \(index === stepIndex \? nextStep : item\)\)/);
  assert.doesNotMatch(worldBookViewScript, /\[\.\.\.currentProcess, nextStep\]/);
  assert.doesNotMatch(worldBookViewScript, /setAiToolCallsIfChanged\(\[\.\.\.currentToolCalls, log\]\);/);
  assert.doesNotMatch(worldBookViewScript, /Array\.isArray\(step\.tools\) \? \[\.\.\.step\.tools\] : \[\]/);
  assert.doesNotMatch(worldBookViewScript, /\[\.\.\.\(Array\.isArray\(target\.tools\) \? target\.tools : \[\]\), log\]/);
  assert.doesNotMatch(worldBookViewScript, /Array\.isArray\(currentStep\.tools\) \? \[\.\.\.currentStep\.tools\] : \[\]/);
  assert.match(
    worldBookViewScript,
    /async function completeWorldBookWithAi\(\) {[\s\S]*setAiToolCallsIfChanged\(\[\]\);[\s\S]*setAiProcessIfChanged\(\[\{ round: 1, reasoning: '[^']+', content: '', tools: \[\] \}\]\);/
  );
  assert.match(
    worldBookViewScript,
    /setAiDraftIfChanged\(result\.worldBook\);[\s\S]*setAiToolCallsIfChanged\(result\.toolCalls\);[\s\S]*setAiProcessIfChanged\(result\.process\);/
  );
  assert.match(
    worldBookViewScript,
    /if \(!aiDraftEntryCount\.value\) {\s*setAiDraftIfChanged\(null\);/
  );
  assert.match(
    worldBookViewScript,
    /setAiProcessIfChanged\(\[\{ round: 1, reasoning: err\.message, content: '', tools: \[\] \}\]\);/
  );
  assert.match(
    worldBookViewScript,
    /notify\.success\(`[^`]*\$\{aiDraftEntryCount\.value\}[^`]*`\);\s*setAiDraftIfChanged\(null\);/
  );
  assert.match(
    worldBookViewScript,
    /function aiStreamHandlers\(mutationToken, routeKey\) {[\s\S]*step: \(step = \{\}\) => {[\s\S]*updateAiProcessStep\(step\.round \|\| 1, \(target\) => \({[\s\S]*content: target\.content \|\| step\.content \|\| ''[\s\S]*reasoning: target\.reasoning === '等待模型响应\.\.\.'[\s\S]*tools: target\.tools\?\.length \? target\.tools : cloneAiToolList\(step\.tools\)[\s\S]*tool: \(call = \{\}\) => {[\s\S]*updateAiProcessStep\(call\.round \|\| 1, \(target\) => \({[\s\S]*tools: appendAiToolList\(target\.tools, log\)[\s\S]*appendAiToolCall\(log\);/
  );
  assert.doesNotMatch(worldBookViewScript, /aiDraft\.value\s*=(?!=)/);
  assert.doesNotMatch(worldBookViewScript, /aiToolCalls\.value\s*=(?!=)/);
  assert.doesNotMatch(worldBookViewScript, /aiProcess\.value\s*=(?!=)/);
  assert.doesNotMatch(worldBookViewScript, /(?:aiToolCalls|aiProcess)\.value\.(?:push|splice|unshift|shift|pop)\(/);
  assert.doesNotMatch(worldBookViewScript, /target\.tools\.push\(/);
  assert.doesNotMatch(worldBookViewScript, /function ensureAiProcessStep/);
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
