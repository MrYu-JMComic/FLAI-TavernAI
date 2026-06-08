import assert from 'node:assert/strict';
import test from 'node:test';
import { countMatches, readFrontendStyles, readVueBlocks } from './frontendSfcTestUtils.js';

const {
  script: characterFormScript,
  template: characterFormTemplate
} = readVueBlocks('frontend/src/views/CharacterFormView.vue');
const stylesSource = readFrontendStyles();

test('CharacterFormView locks AI actions behind one shared busy state', () => {
  assert.match(
    characterFormScript,
    /const characterAiActionBusy = computed\(\(\) => \([\s\S]*aiLoading\.value[\s\S]*advancedAiLoading\.value[\s\S]*saving\.value[\s\S]*!canEdit\.value[\s\S]*\)\);/
  );
  assert.match(
    characterFormScript,
    /async function completeWithAi\(\)\s*{\s*if \(characterAiActionBusy\.value\) return;/
  );
  assert.match(
    characterFormScript,
    /async function completeAdvancedSettingsWithAi\(\)\s*{\s*if \(characterAiActionBusy\.value\) return;/
  );

  assert.ok(countMatches(characterFormTemplate, /:disabled="characterAiActionBusy"/g) >= 8);
  assert.match(characterFormTemplate, /class="primary-button ai-draft-button" type="button" :disabled="characterAiActionBusy" :aria-busy="aiLoading"/);
  assert.match(characterFormTemplate, /class="ghost-button"\s+type="button"\s+:disabled="characterAiActionBusy"\s+:aria-busy="advancedAiLoading"/);
  assert.doesNotMatch(characterFormTemplate, /:disabled="aiLoading \|\| advancedAiLoading"/);
  assert.doesNotMatch(characterFormTemplate, /class="primary-button ai-draft-button" type="button" :disabled="aiLoading"/);
  assert.doesNotMatch(characterFormTemplate, /:disabled="advancedAiLoading \|\| !canEdit"/);
});

test('CharacterFormView footer actions share one busy state', () => {
  assert.match(
    characterFormScript,
    /const characterFooterActionBusy = computed\(\(\) => saving\.value \|\| deleting\.value \|\| exporting\.value\);/
  );
  assert.match(
    characterFormScript,
    /async function submit\(\)\s*{\s*if \(characterFormDisposed \|\| characterFooterActionBusy\.value \|\| !canEdit\.value\)/
  );
  assert.match(
    characterFormScript,
    /async function removeCharacter\(\)\s*{\s*if \(characterFormDisposed \|\| characterFooterActionBusy\.value \|\| !isEditing\.value \|\| !canEdit\.value\)/
  );
  assert.match(
    characterFormScript,
    /async function handleExport\(\)\s*{\s*if \(characterFormDisposed \|\| characterFooterActionBusy\.value \|\| !isEditing\.value\)/
  );

  assert.equal(countMatches(characterFormTemplate, /:disabled="characterFooterActionBusy"/g), 3);
  assert.match(characterFormTemplate, /class="danger-button" type="button" :disabled="characterFooterActionBusy" :aria-busy="deleting"/);
  assert.match(characterFormTemplate, /class="ghost-button" type="button" :disabled="characterFooterActionBusy" :aria-busy="exporting"/);
  assert.match(characterFormTemplate, /class="primary-button" type="submit" :disabled="characterFooterActionBusy" :aria-busy="saving"/);
  assert.doesNotMatch(characterFormTemplate, /:disabled="deleting"/);
  assert.doesNotMatch(characterFormTemplate, /:disabled="exporting"/);
  assert.doesNotMatch(characterFormTemplate, /type="submit" :disabled="saving"/);
});

test('CharacterFormView tag creation freezes tag controls while pending', () => {
  assert.match(characterFormScript, /const tagCreating = ref\(false\);/);
  assert.match(
    characterFormScript,
    /tagCreateToken \+= 1;\s*tagCreating\.value = false;/
  );
  assert.match(
    characterFormScript,
    /async function createAndSelectTag\(\)\s*{\s*if \(characterFormDisposed \|\| tagCreating\.value \|\| !canEdit\.value\) return;/
  );
  assert.match(
    characterFormScript,
    /const createToken = \+\+tagCreateToken;\s*tagCreating\.value = true;/
  );
  assert.match(
    characterFormScript,
    /finally {\s*if \(isActiveTagCreate\(createToken\)\) {\s*tagCreating\.value = false;/
  );
  assert.match(
    characterFormScript,
    /function isCurrentTagCreate\(createToken, name\) {\s*return isActiveTagCreate\(createToken\)[\s\S]*tagSearch\.value\.trim\(\) === name;/
  );
  assert.match(
    characterFormScript,
    /function isActiveTagCreate\(createToken\) {\s*return !characterFormDisposed && createToken === tagCreateToken;/
  );
  assert.match(
    characterFormScript,
    /function toggleTagSelection\(name\) {\s*if \(!canEdit\.value \|\| tagCreating\.value\) {\s*return;/
  );

  assert.match(characterFormTemplate, /<div class="tag-selector" :class="\{ disabled: !canEdit \|\| tagCreating \}">/);
  assert.match(characterFormTemplate, /@click="canEdit && !tagCreating && toggleTagSelection\(tagName\)"/);
  assert.match(characterFormTemplate, /<span v-if="canEdit && !tagCreating" class="tag-remove">/);
  assert.match(
    characterFormTemplate,
    /class="tag-search-input" aria-label="搜索或创建角色标签" :disabled="tagCreating" :aria-busy="tagCreating"/
  );
  assert.match(
    characterFormTemplate,
    /class="ghost-button tag-create-btn"[\s\S]*:disabled="tagCreating"[\s\S]*:aria-busy="tagCreating"[\s\S]*{{ tagCreating \? '创建中\.\.\.' : '创建' }}/
  );
  assert.match(
    characterFormTemplate,
    /class="tag-option"[\s\S]*:disabled="tagCreating"[\s\S]*@click="toggleTagSelection\(tag\.name\)"/
  );
});

test('CharacterFormView preserves unchanged option-list references during loads', () => {
  assert.match(
    characterFormScript,
    /const \[nextWorldBooks, nextTags\] = await Promise\.all\(\[fetchWorldBooks\(\), fetchTags\(\)\]\);[\s\S]*setWorldBooksIfChanged\(nextWorldBooks\);[\s\S]*setAvailableTagsIfChanged\(nextTags\);/
  );
  assert.match(
    characterFormScript,
    /setSelectedWorldBookIdsFromBooksIfChanged\(linkedBooks\);/
  );
  assert.match(
    characterFormScript,
    /setAvailableTagsIfChanged\(\[\.\.\.availableTags\.value, tag\]\);/
  );
  assert.match(
    characterFormScript,
    /function setWorldBooksIfChanged\(nextBooks\) \{[\s\S]*sameListItems\(worldBooks\.value, normalizedBooks, sameWorldBookOption\)[\s\S]*worldBooks\.value = normalizedBooks;[\s\S]*return true;[\s\S]*\}/
  );
  assert.match(
    characterFormScript,
    /function setAvailableTagsIfChanged\(nextTags\) \{[\s\S]*sameListItems\(availableTags\.value, normalizedTags, sameTagOption\)[\s\S]*availableTags\.value = normalizedTags;[\s\S]*return true;[\s\S]*\}/
  );
  assert.match(
    characterFormScript,
    /function normalizeWorldBookIds\(nextIds\) \{[\s\S]*const normalizedIds = \[\];[\s\S]*for \(const id of Array\.isArray\(nextIds\) \? nextIds : \[\]\) \{[\s\S]*normalizedIds\.push\(String\(id \|\| ''\)\);[\s\S]*return normalizedIds;[\s\S]*\}/
  );
  assert.match(
    characterFormScript,
    /function setSelectedWorldBookIdsFromBooksIfChanged\(nextBooks\) \{[\s\S]*const nextIds = \[\];[\s\S]*for \(const book of Array\.isArray\(nextBooks\) \? nextBooks : \[\]\) \{[\s\S]*nextIds\.push\(book\?\.id\);[\s\S]*return setSelectedWorldBookIdsIfChanged\(nextIds\);[\s\S]*\}/
  );
  assert.match(
    characterFormScript,
    /function setSelectedWorldBookIdsIfChanged\(nextIds\) \{[\s\S]*const normalizedIds = normalizeWorldBookIds\(nextIds\);[\s\S]*sameListItems\(selectedWorldBookIds\.value, normalizedIds, Object\.is\)[\s\S]*selectedWorldBookIds\.value = normalizedIds;[\s\S]*return true;[\s\S]*\}/
  );
  assert.match(
    characterFormScript,
    /function sameListItems\(currentItems, nextItems, sameItem\) \{[\s\S]*for \(let index = 0; index < currentList\.length; index \+= 1\) \{[\s\S]*sameItem\(currentList\[index\], nextList\[index\]\)[\s\S]*return true;[\s\S]*\}/
  );
  assert.match(
    characterFormScript,
    /function toggleWorldBook\(bookId\) \{[\s\S]*const normalizedId = String\(bookId \|\| ''\);[\s\S]*if \(!normalizedId\) \{[\s\S]*return;[\s\S]*\}[\s\S]*const currentIds = selectedWorldBookIds\.value;[\s\S]*const nextIds = \[\];[\s\S]*let removedSelectedId = false;[\s\S]*for \(const id of currentIds\) \{[\s\S]*if \(id === normalizedId\) \{[\s\S]*removedSelectedId = true;[\s\S]*continue;[\s\S]*\}[\s\S]*nextIds\.push\(id\);[\s\S]*if \(!removedSelectedId\) \{[\s\S]*nextIds\.push\(normalizedId\);[\s\S]*\}[\s\S]*setSelectedWorldBookIdsIfChanged\(nextIds\);[\s\S]*\}/
  );
  assert.match(
    characterFormScript,
    /function sameWorldBookOption\(current = \{\}, next = \{\}\) \{[\s\S]*String\(current\?\.id \|\| ''\) === String\(next\?\.id \|\| ''\)[\s\S]*Number\(current\?\.entryCount \|\| 0\) === Number\(next\?\.entryCount \|\| 0\);[\s\S]*\}/
  );
  assert.match(
    characterFormScript,
    /function sameTagOption\(current = \{\}, next = \{\}\) \{[\s\S]*String\(current\?\.name \|\| ''\) === String\(next\?\.name \|\| ''\)[\s\S]*Number\(current\?\.usageCount \|\| 0\) === Number\(next\?\.usageCount \|\| 0\);[\s\S]*\}/
  );
  assert.doesNotMatch(characterFormScript, /worldBooks\.value\s*=\s*nextWorldBooks/);
  assert.doesNotMatch(characterFormScript, /availableTags\.value\s*=\s*nextTags/);
  assert.doesNotMatch(characterFormScript, /selectedWorldBookIds\.value\s*=\s*linkedBooks\.map/);
  assert.doesNotMatch(characterFormScript, /linkedBooks\.map\(\(book\) => book\.id\)/);
  assert.doesNotMatch(characterFormScript, /currentLinked\.map\(\(book\) => book\.id\)/);
  assert.doesNotMatch(characterFormScript, /currentIds\.filter\(\(id\) => id !== normalizedId\)/);
  assert.doesNotMatch(characterFormScript, /selectedWorldBookIds\.value\.(?:push|splice)\(/);
});

test('CharacterFormView uses a searchable paged dialog for world book linking', () => {
  assert.match(characterFormScript, /const showWorldBookDialog = ref\(false\);/);
  assert.match(characterFormScript, /const worldBookSearch = ref\(''\);/);
  assert.match(characterFormScript, /const worldBookSort = ref\('updatedDesc'\);/);
  assert.match(characterFormScript, /const worldBookPage = ref\(1\);/);
  assert.match(characterFormScript, /const WORLD_BOOK_SELECTOR_PAGE_SIZE = 8;/);
  assert.match(characterFormScript, /const WORLD_BOOK_SORT_OPTIONS = \[[\s\S]*updatedDesc[\s\S]*nameAsc[\s\S]*entryCountDesc[\s\S]*\];/);
  assert.match(
    characterFormScript,
    /const selectedWorldBooks = computed\(\(\) => getSelectedWorldBooks\(worldBooks\.value, selectedWorldBookIds\.value\)\);/
  );
  assert.match(
    characterFormScript,
    /const filteredWorldBooks = computed\(\(\) => filterAndSortWorldBooks\(worldBooks\.value, worldBookSearch\.value, worldBookSort\.value\)\);/
  );
  assert.match(
    characterFormScript,
    /const pagedWorldBooks = computed\(\(\) => getWorldBookPageItems\(filteredWorldBooks\.value, worldBookPage\.value, WORLD_BOOK_SELECTOR_PAGE_SIZE\)\);/
  );
  assert.match(
    characterFormScript,
    /watch\(\[worldBookSearch, worldBookSort\], \(\) => \{\s*setWorldBookPage\(1\);/
  );
  assert.match(
    characterFormScript,
    /function filterAndSortWorldBooks\(books, rawSearch, sortKey\) \{[\s\S]*haystack\.includes\(search\)[\s\S]*return sortWorldBooks\(matches, sortKey\);/
  );
  assert.match(
    characterFormScript,
    /function sortWorldBooks\(books, sortKey\) \{[\s\S]*sortKey === 'nameAsc'[\s\S]*sortKey === 'entryCountDesc'[\s\S]*getWorldBookSortTime\(next\) - getWorldBookSortTime\(current\)/
  );
  assert.match(
    characterFormScript,
    /function getWorldBookPageItems\(books, page, pageSize\) \{[\s\S]*return currentBooks\.slice\(start, start \+ safePageSize\);/
  );
  assert.match(
    characterFormScript,
    /function openWorldBookDialog\(\) \{[\s\S]*showWorldBookDialog\.value = true;[\s\S]*setWorldBookPage\(worldBookPage\.value\);/
  );
  assert.match(
    characterFormScript,
    /function setWorldBookPage\(page\) \{[\s\S]*clampWorldBookPage\(page, worldBookPageCount\.value\)[\s\S]*worldBookPage\.value = nextPage;/
  );

  assert.match(characterFormTemplate, /class="field full-span world-book-field"/);
  assert.match(characterFormTemplate, /class="world-book-picker-button"[\s\S]*@click="openWorldBookDialog"/);
  assert.match(characterFormTemplate, /class="world-book-selected-preview"/);
  assert.match(characterFormTemplate, /v-if="showWorldBookDialog"[\s\S]*class="world-book-dialog-overlay"/);
  assert.match(characterFormTemplate, /class="world-book-dialog form-panel"[\s\S]*role="dialog"[\s\S]*aria-modal="true"/);
  assert.match(characterFormTemplate, /v-model="worldBookSearch"[\s\S]*type="search"/);
  assert.match(characterFormTemplate, /v-model="worldBookSort"[\s\S]*v-for="option in WORLD_BOOK_SORT_OPTIONS"/);
  assert.match(characterFormTemplate, /v-for="book in pagedWorldBooks"/);
  assert.match(characterFormTemplate, /@click="setWorldBookPage\(worldBookPage - 1\)"/);
  assert.match(characterFormTemplate, /@click="setWorldBookPage\(worldBookPage \+ 1\)"/);
  assert.doesNotMatch(characterFormTemplate, /class="world-book-selector"/);

  assert.match(stylesSource, /\.world-book-picker\s*\{[\s\S]*border:\s*1px solid var\(--line\);[\s\S]*background:\s*color-mix\(in srgb, var\(--surface\) 78%, transparent\);/);
  assert.match(stylesSource, /\.world-book-dialog-tools\s*\{[\s\S]*grid-template-columns:\s*minmax\(220px, 1fr\) minmax\(160px, 220px\) auto;/);
  assert.match(stylesSource, /\.world-book-dialog-list\s*\{[\s\S]*align-content:\s*start;[\s\S]*overflow:\s*auto;/);
  assert.match(stylesSource, /\.world-book-dialog-option\s*\{[\s\S]*grid-template-columns:\s*auto minmax\(0, 1fr\) auto;[\s\S]*align-items:\s*start;/);
  assert.match(
    stylesSource,
    /@media \(max-width: 760px\) \{[\s\S]*\.world-book-dialog-option\s*\{[\s\S]*grid-template-columns:\s*auto minmax\(0, 1fr\);[\s\S]*grid-template-areas:[\s\S]*"check main"[\s\S]*"check meta";/
  );
  assert.match(stylesSource, /\.world-book-dialog-option-main\s*\{[\s\S]*grid-area:\s*main;/);
  assert.match(stylesSource, /\.world-book-dialog-meta\s*\{[\s\S]*grid-area:\s*meta;/);
});

test('CharacterFormView filters tag search results in one pass', () => {
  assert.match(
    characterFormScript,
    /const filteredTags = computed\(\(\) => filterTagsBySearch\(availableTags\.value, tagSearch\.value\)\);/
  );
  assert.match(
    characterFormScript,
    /function filterTagsBySearch\(tags, rawSearch\) \{\s*const currentTags = Array\.isArray\(tags\) \? tags : \[\];\s*const search = String\(rawSearch \|\| ''\)\.trim\(\)\.toLowerCase\(\);[\s\S]*if \(!search\) \{\s*return currentTags;\s*\}[\s\S]*const matches = \[\];\s*for \(const tag of currentTags\) \{[\s\S]*matches\.push\(tag\);[\s\S]*\}\s*return matches;\s*\}/
  );
  assert.doesNotMatch(characterFormScript, /availableTags\.value\.filter\(/);
});

test('CharacterFormView counts status blueprint variable stats in one pass', () => {
  assert.match(
    characterFormScript,
    /const variableStats = countStatusBlueprintVariableStats\(normalized\.variables, template\);[\s\S]*inferred: variableStats\.inferred,[\s\S]*text: Math\.max\(0, normalized\.variables\.length - variableStats\.meter\),[\s\S]*meter: variableStats\.meter,/
  );
  assert.match(
    characterFormScript,
    /function collectInferredStatusVariableKeys\(template = ''\) \{\s*const inferredKeys = new Set\(\);\s*for \(const variable of inferStatusVariablesFromTemplate\(template, \[\]\)\) \{\s*inferredKeys\.add\(normalizeStatusVariableKey\(variable\.name\)\);\s*\}\s*return inferredKeys;\s*\}/
  );
  assert.match(
    characterFormScript,
    /function countStatusBlueprintVariableStats\(variables = \[\], template = ''\) \{\s*const inferredKeys = collectInferredStatusVariableKeys\(template\);\s*const stats = \{ inferred: 0, meter: 0 \};\s*for \(const variable of Array\.isArray\(variables\) \? variables : \[\]\) \{[\s\S]*stats\.inferred \+= 1;[\s\S]*stats\.meter \+= 1;[\s\S]*\}\s*return stats;\s*\}/
  );
  assert.doesNotMatch(
    characterFormScript,
    /inferStatusVariablesFromTemplate\(template, \[\]\)\.map\(\(variable\) => normalizeStatusVariableKey\(variable\.name\)\)/
  );
  assert.doesNotMatch(characterFormScript, /normalized\.variables\.filter\(/);
});

test('CharacterFormView builds status blueprint editor rows without intermediate mapping arrays', () => {
  assert.match(
    characterFormScript,
    /const statusBlueprintEditorRows = computed\(\(\) => \{[\s\S]*const rows = \[\];\s*for \(let index = 0; index < compositeRows\.length; index \+= 1\) \{[\s\S]*let compositePartKey = '';[\s\S]*for \(let partIndex = 0; partIndex < row\.parts\.length; partIndex \+= 1\) \{[\s\S]*compositePartKey \+= `\$\{partIndex > 0 \? '\|' : ''\}\$\{part\?\.name \?\? ''\}`;[\s\S]*key: `composite:\$\{index\}:\$\{row\.label\}:\$\{compositePartKey\}`,[\s\S]*for \(let index = 0; index < variables\.length; index \+= 1\) \{[\s\S]*const variable = variables\[index\];[\s\S]*continue;[\s\S]*key: `variable:\$\{index\}:\$\{key\}`,/
  );
  assert.doesNotMatch(characterFormScript, /compositeRows\.map\(/);
  assert.doesNotMatch(characterFormScript, /row\.parts\.map\(/);
  assert.doesNotMatch(characterFormScript, /variables\.forEach\(/);
});

test('CharacterFormView normalizes accessory skill payloads with a direct defaults loop', () => {
  const start = characterFormScript.indexOf('function normalizeAccessorySkillsForPayload(input = {}) {');
  const end = characterFormScript.indexOf('\nfunction createDefaultStatusBarBlueprint', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const snippet = characterFormScript.slice(start, end);

  assert.match(snippet, /const normalized = \{\};/);
  assert.match(snippet, /for \(const key in defaults\)/);
  assert.match(snippet, /normalized\[key\] = \{/);
  assert.match(snippet, /enabled: normalizeSkillEnabled\(source\.enabled, defaults\[key\]\.enabled\)/);
  assert.match(snippet, /modelOverride: String\(source\.modelOverride \|\| source\.model_override \|\| ''\)\.trim\(\)/);
  assert.match(snippet, /return normalized;/);
  assert.doesNotMatch(snippet, /Object\.fromEntries/);
  assert.doesNotMatch(snippet, /Object\.keys\(defaults\)\.map/);
});

test('CharacterFormView preserves unchanged AI process panel references', () => {
  assert.match(
    characterFormScript,
    /function setAiToolCallsIfChanged\(nextToolCalls\) \{\s*return setAiPlainListIfChanged\(aiToolCalls, nextToolCalls\);\s*\}/
  );
  assert.match(
    characterFormScript,
    /function setAiProcessIfChanged\(nextProcess\) \{\s*return setAiPlainListIfChanged\(aiProcess, nextProcess\);\s*\}/
  );
  assert.match(
    characterFormScript,
    /function setAiModSuggestionsIfChanged\(nextSuggestions\) \{\s*return setAiPlainListIfChanged\(aiModSuggestions, nextSuggestions\);\s*\}/
  );
  assert.match(
    characterFormScript,
    /function setAiPlainListIfChanged\(listRef, nextItems\) \{[\s\S]*sameListItems\(listRef\.value, normalizedItems, samePlainValue\)[\s\S]*listRef\.value = normalizedItems;[\s\S]*return true;[\s\S]*\}/
  );
  assert.match(
    characterFormScript,
    /function samePlainValue\(current, next\) \{[\s\S]*Object\.is\(current, next\)[\s\S]*Array\.isArray\(current\)[\s\S]*Object\.keys\(current\)[\s\S]*samePlainValue\(current\[key\], next\[key\]\)[\s\S]*\}/
  );
  assert.doesNotMatch(characterFormScript, /currentList\.every\(/);
  assert.doesNotMatch(characterFormScript, /current\.every\(/);
  assert.doesNotMatch(characterFormScript, /currentKeys\.every\(/);
  assert.match(
    characterFormScript,
    /function updateAiProcessStep\(round = 1, updateStep\) \{[\s\S]*const currentProcess = Array\.isArray\(aiProcess\.value\) \? aiProcess\.value : \[\];[\s\S]*const nextProcess = stepIndex >= 0[\s\S]*currentProcess\.map\(\(item, index\) => \(index === stepIndex \? nextStep : item\)\)[\s\S]*\[\.\.\.currentProcess, nextStep\][\s\S]*setAiProcessIfChanged\(nextProcess\);[\s\S]*\}/
  );
  assert.match(
    characterFormScript,
    /function appendAiToolCall\(log\) \{[\s\S]*const currentToolCalls = Array\.isArray\(aiToolCalls\.value\) \? aiToolCalls\.value : \[\];[\s\S]*setAiToolCallsIfChanged\(\[\.\.\.currentToolCalls, log\]\);[\s\S]*\}/
  );
  assert.match(
    characterFormScript,
    /async function completeWithAi\(\) \{[\s\S]*setAiToolCallsIfChanged\(\[\]\);[\s\S]*setAiProcessIfChanged\(\[\{ round: 1, reasoning: '等待模型响应\.\.\.', content: '', tools: \[\] \}\]\);[\s\S]*setAiModSuggestionsIfChanged\(\[\]\);/
  );
  assert.match(
    characterFormScript,
    /setAiModSuggestionsIfChanged\(result\.character\?\.modSuggestions\);[\s\S]*setAiToolCallsIfChanged\(result\.toolCalls\);[\s\S]*setAiProcessIfChanged\(result\.process\);/
  );
  assert.match(
    characterFormScript,
    /async function completeAdvancedSettingsWithAi\(\) \{[\s\S]*setAiProcessIfChanged\(\[\{ round: 1, reasoning: '等待模型响应\.\.\.', content: '', tools: \[\] \}\]\);[\s\S]*setAiToolCallsIfChanged\(\[\]\);/
  );
  assert.match(
    characterFormScript,
    /notify\.success\(`已创建 \$\{suggestions\.length\} 个 Mod`\);\s*setAiModSuggestionsIfChanged\(\[\]\);/
  );
  assert.match(
    characterFormScript,
    /function aiStreamHandlers\(isCurrent = \(\) => !characterFormDisposed\) \{[\s\S]*step: \(step = \{\}\) => \{[\s\S]*updateAiProcessStep\(step\.round \|\| 1, \(target\) => \(\{[\s\S]*content: target\.content \|\| step\.content \|\| ''[\s\S]*reasoning: target\.reasoning === '等待模型响应\.\.\.'[\s\S]*tools: target\.tools\?\.length \? target\.tools : Array\.isArray\(step\.tools\) \? \[\.\.\.step\.tools\] : \[\][\s\S]*tool: \(call = \{\}\) => \{[\s\S]*updateAiProcessStep\(call\.round \|\| 1, \(target\) => \(\{[\s\S]*tools: \[\.\.\.\(Array\.isArray\(target\.tools\) \? target\.tools : \[\]\), log\][\s\S]*appendAiToolCall\(log\);/
  );
  assert.ok(countMatches(characterFormScript, /setAiProcessIfChanged\(\[\{ round: 1, reasoning: err\.message, content: '', tools: \[\] \}\]\);/g) >= 2);
  assert.doesNotMatch(characterFormScript, /aiToolCalls\.value\s*=(?!=)/);
  assert.doesNotMatch(characterFormScript, /aiProcess\.value\s*=(?!=)/);
  assert.doesNotMatch(characterFormScript, /aiModSuggestions\.value\s*=(?!=)/);
  assert.doesNotMatch(characterFormScript, /(?:aiToolCalls|aiProcess)\.value\.(?:push|splice|unshift|shift|pop)\(/);
  assert.doesNotMatch(characterFormScript, /target\.tools\.push\(/);
  assert.doesNotMatch(characterFormScript, /function ensureAiProcessStep/);
});

test('CharacterFormView uses granular sticky section navigation', () => {
  assert.match(characterFormScript, /const sectionNavRef = ref\(null\);/);
  assert.match(characterFormScript, /let sectionNavRafId = null;/);
  assert.match(
    characterFormScript,
    /const formSections = \[[\s\S]*id: 'basic'[\s\S]*id: 'settings'[\s\S]*id: 'ai'[\s\S]*id: 'status-blueprint'[\s\S]*id: 'render-plugins'[\s\S]*id: 'regex'[\s\S]*\];/
  );
  assert.match(characterFormScript, /const visibleFormSections = computed\(\(\) => formSections\.filter\(isSectionVisible\)\);/);
  assert.match(characterFormScript, /window\.addEventListener\('scroll', onWindowScroll, \{ passive: true \}\);/);
  assert.match(
    characterFormScript,
    /onBeforeUnmount\(\(\) => \{[\s\S]*cancelCharacterSectionNavSync\(\);[\s\S]*window\.removeEventListener\('scroll', onWindowScroll\);/
  );
  assert.match(
    characterFormScript,
    /function scrollToSection\(id\) \{[\s\S]*getCharacterSectionTarget\(id\)[\s\S]*window\.scrollTo\(\{ top: Math\.max\(0, Math\.round\(top\)\), behavior: 'smooth' \}\);/
  );
  assert.match(
    characterFormScript,
    /function getTopbarBottom\(\) \{[\s\S]*document\.querySelector\('\.topbar'\)\?\.getBoundingClientRect\(\)\.bottom;/
  );
  assert.match(
    characterFormScript,
    /function syncCharacterSectionNavMetrics\(\) \{[\s\S]*nav\.style\.setProperty\('--character-section-nav-top', `\$\{getTopbarBottom\(\)\}px`\);/
  );
  assert.match(
    characterFormScript,
    /function syncActiveSectionFromScroll\(\) \{[\s\S]*getCharacterSectionActivationOffset\(\)[\s\S]*setActiveCharacterSection\(nextSectionId\);/
  );
  assert.match(
    characterFormScript,
    /tab\.scrollIntoView\(\{ behavior: 'auto', block: 'nearest', inline: 'center' \}\);/
  );

  assert.match(characterFormTemplate, /ref="sectionNavRef" class="form-section-nav character-section-nav"/);
  assert.match(characterFormTemplate, /v-for="section in visibleFormSections"/);
  assert.match(characterFormTemplate, /:data-section-id="section\.id"/);
  assert.match(characterFormTemplate, /:aria-current="activeSection === section\.id \? 'true' : undefined"/);
  assert.match(characterFormTemplate, /id="section-ai"[\s\S]*ref="aiPanelRef"/);
  assert.match(characterFormTemplate, /id="section-images" class="form-panel character-image-section"/);
  assert.match(characterFormTemplate, /id="section-talents" class="form-panel talent-panel"/);
  assert.match(characterFormTemplate, /id="section-advanced-settings" class="form-panel advanced-settings-panel"/);
  assert.match(characterFormTemplate, /id="section-status-blueprint" class="accessory-defaults-panel status-blueprint-panel"/);
  assert.match(characterFormTemplate, /id="section-accessories" class="accessory-defaults-panel"/);
  assert.match(characterFormTemplate, /id="section-render-plugins" class="form-panel render-plugin-panel"/);
  assert.match(characterFormTemplate, /id="section-regex" class="form-panel regex-panel"/);

  assert.match(
    stylesSource,
    /\.character-section-nav\s*\{[\s\S]*position:\s*sticky;[\s\S]*top:\s*calc\(var\(--character-section-nav-top, 78px\) \+ env\(safe-area-inset-top, 0px\)\);[\s\S]*backdrop-filter:\s*blur\(16px\);/
  );
  assert.match(stylesSource, /\.character-section-nav::-webkit-scrollbar\s*\{[^}]*height:\s*8px;/);
  assert.match(stylesSource, /\.character-section-nav \.form-section-tab::after\s*\{[\s\S]*transform:\s*scaleX\(0\.36\);/);
  assert.match(stylesSource, /\.character-section-nav \.form-section-tab\.active::after\s*\{[^}]*transform:\s*scaleX\(1\);/);
  assert.match(stylesSource, /#section-basic,[\s\S]*#section-status-blueprint,[\s\S]*#section-regex\s*\{[^}]*scroll-margin-top:\s*150px;/);
  assert.match(stylesSource, /@keyframes character-nav-settle/);
});

test('CharacterFormView uses a flowing card layout and modal status preview', () => {
  assert.match(characterFormScript, /const showStatusPreviewDialog = ref\(false\);/);
  assert.match(
    characterFormScript,
    /function getCharacterSectionTarget\(id\) \{[\s\S]*return el\.getClientRects\(\)\.length[\s\S]*el\.querySelector\('\.form-panel, \.form-section-group, \[id\^="section-"\]'\) \|\| el;/
  );

  assert.match(characterFormTemplate, /<div class="character-main-sections">/);
  assert.match(characterFormTemplate, /<section id="section-basic" class="form-panel form-section-group character-basic-panel">/);
  assert.match(characterFormTemplate, /<section id="section-settings" class="form-panel form-section-group character-settings-panel">/);
  assert.match(characterFormTemplate, /<div id="section-advanced" class="form-section-group-advanced">/);
  assert.match(characterFormTemplate, /class="status-blueprint-heading-actions"[\s\S]*showStatusPreviewDialog = true[\s\S]*<Eye :size="16" \/>/);
  assert.doesNotMatch(characterFormTemplate, /<div class="status-blueprint-preview">/);
  assert.match(characterFormTemplate, /v-if="showStatusPreviewDialog"[\s\S]*class="status-preview-overlay"/);
  assert.match(characterFormTemplate, /class="status-preview-dialog form-panel"[\s\S]*role="dialog"[\s\S]*aria-modal="true"/);
  assert.match(characterFormTemplate, /aria-label="关闭效果预览"[\s\S]*showStatusPreviewDialog = false[\s\S]*<X :size="18" \/>/);
  assert.match(characterFormTemplate, /<StatusBar[\s\S]*v-if="statusBarBlueprintPreview"[\s\S]*:template-config="statusBarBlueprintPreviewConfig"/);

  assert.match(stylesSource, /\.editor-layout\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;[^}]*align-items:\s*flex-start;/);
  assert.match(stylesSource, /\.character-main-sections,\s*\.editor-side,\s*\.form-section-group-advanced\s*\{[^}]*display:\s*contents;/);
  assert.match(stylesSource, /\.editor-layout \.character-settings-panel,[\s\S]*\.editor-layout \.advanced-settings-panel\s*\{[^}]*flex-basis:\s*640px;/);
  assert.match(stylesSource, /\.status-preview-overlay\s*\{[^}]*position:\s*fixed;[^}]*place-items:\s*center;/);
  assert.match(stylesSource, /\.status-preview-dialog\s*\{[^}]*width:\s*min\(720px, calc\(100vw - 32px\)\);[^}]*max-height:/);
  assert.doesNotMatch(stylesSource, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(300px,\s*430px\)/);
});

test('CharacterFormView keeps the floating AI draft panel layout stable on focus', () => {
  assert.match(characterFormScript, /const AI_PANEL_DRAG_THRESHOLD = 8;/);
  assert.match(characterFormScript, /const AI_PANEL_MIN_WIDTH = 320;/);
  assert.match(characterFormScript, /const AI_PANEL_MIN_HEIGHT = 180;/);
  assert.match(characterFormScript, /let aiPanelLayoutRafId = null;/);
  assert.match(characterFormScript, /function scheduleAiPanelLayoutSync\(\) \{[\s\S]*requestAnimationFrame\(flushScheduledAiPanelLayout\);/);
  assert.match(characterFormScript, /function onAiPanelResizeStart\(e\) \{[\s\S]*document\.addEventListener\('pointermove', onAiPanelResizeMove/);
  assert.match(characterFormScript, /function onAiPanelResizeEnd\(\) \{[\s\S]*saveAiPanelState\(\);/);
  assert.doesNotMatch(characterFormScript, /ResizeObserver|pendingAiPanelSizeSync|syncAiPanelSizeAndPosition/);

  assert.match(characterFormTemplate, /ref="aiPanelRef"/);
  assert.match(characterFormTemplate, /:class="\{ 'ai-panel-dragging': aiPanelDragging \}"/);
  assert.match(characterFormTemplate, /--ai-panel-h': aiPanelSize\.h \+ 'px'/);
  assert.match(characterFormTemplate, /class="inline-heading ai-panel-heading" @pointerdown="onAiPanelDragStart"/);
  assert.match(characterFormTemplate, /class="ai-panel-reset"[\s\S]*@pointerdown\.stop[\s\S]*@click\.stop="resetAiPanel"/);
  assert.match(characterFormTemplate, /class="ai-panel-resize-handle" aria-hidden="true" @pointerdown\.stop="onAiPanelResizeStart"/);

  assert.match(
    stylesSource,
    /@media \(min-width: 761px\) \{[\s\S]*\.ai-draft-panel\s*\{[\s\S]*position:\s*fixed;[\s\S]*height:\s*min\(var\(--ai-panel-h, 640px\), calc\(100dvh - var\(--ai-panel-y, 0px\)\)\);[\s\S]*scrollbar-gutter:\s*stable;/
  );
  assert.match(stylesSource, /\.ai-draft-panel \.field textarea\s*\{[^}]*height:\s*124px;[^}]*resize:\s*vertical;/);
  assert.doesNotMatch(stylesSource, /\.ai-draft-panel \.field textarea\s*\{[^}]*resize:\s*none;/);
  assert.match(
    stylesSource,
    /\.ai-draft-panel,\s*\.ai-draft-panel \.field textarea\s*\{[^}]*scrollbar-width:\s*thin;[^}]*scrollbar-color:/
  );
  assert.match(
    stylesSource,
    /\.ai-draft-panel::-webkit-scrollbar,\s*\.ai-draft-panel \.field textarea::-webkit-scrollbar\s*\{[^}]*width:\s*10px;[^}]*height:\s*10px;/
  );
  assert.match(
    stylesSource,
    /\.ai-draft-panel::-webkit-scrollbar-thumb,\s*\.ai-draft-panel \.field textarea::-webkit-scrollbar-thumb\s*\{[\s\S]*border-radius:\s*999px;[\s\S]*padding-box;/
  );
  assert.match(
    stylesSource,
    /\.ai-draft-panel \.ai-panel-resize-handle\s*\{[\s\S]*display:\s*block;[\s\S]*position:\s*fixed;[\s\S]*right:\s*auto;[\s\S]*bottom:\s*auto;/
  );
  assert.match(stylesSource, /\.ai-panel-resize-handle\s*\{[\s\S]*cursor:\s*nwse-resize;[\s\S]*touch-action:\s*none;/);
  assert.doesNotMatch(stylesSource, /resize:\s*both/);
});
