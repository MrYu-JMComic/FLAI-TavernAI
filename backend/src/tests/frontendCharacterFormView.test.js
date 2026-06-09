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

test('CharacterFormView validates image uploads before invalidating upload tokens', () => {
  const avatarStart = characterFormScript.indexOf('async function handleAvatar(event) {');
  const avatarEnd = characterFormScript.indexOf('\nfunction isCurrentAvatarUpload', avatarStart);
  const avatarHandler = characterFormScript.slice(avatarStart, avatarEnd);
  const backgroundStart = characterFormScript.indexOf('async function handleAdvancedBackground(event, field) {');
  const backgroundEnd = characterFormScript.indexOf('\nfunction clearAdvancedBackground', backgroundStart);
  const backgroundHandler = characterFormScript.slice(backgroundStart, backgroundEnd);

  assert.match(
    avatarHandler,
    /if \(!file\) \{\s*return;\s*\}[\s\S]*if \(!\['image\/png', 'image\/jpeg', 'image\/webp'\]\.includes\(file\.type\)\) \{[\s\S]*return;\s*\}[\s\S]*if \(file\.size > 2 \* 1024 \* 1024\) \{[\s\S]*return;\s*\}\s*const uploadToken = \+\+avatarUploadToken;\s*try \{/
  );
  assert.doesNotMatch(
    avatarHandler,
    /const uploadToken = \+\+avatarUploadToken;\s*if \(!file\)/
  );

  assert.match(
    backgroundHandler,
    /if \(!file\) \{\s*return;\s*\}[\s\S]*if \(!\['image\/png', 'image\/jpeg', 'image\/webp', 'image\/gif'\]\.includes\(file\.type\)\) \{[\s\S]*return;\s*\}[\s\S]*if \(file\.size > 4 \* 1024 \* 1024\) \{[\s\S]*return;\s*\}\s*backgroundUploading\[field\] = true;\s*const uploadToken = nextBackgroundUploadToken\(field\);\s*try \{/
  );
  assert.doesNotMatch(
    backgroundHandler,
    /const uploadToken = nextBackgroundUploadToken\(field\);\s*if \(!file\)/
  );
  assert.doesNotMatch(
    backgroundHandler,
    /if \(!file\) \{\s*backgroundUploading\[field\] = false;/
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
    /const tag = await createTag\(\{ name \}\);[\s\S]*if \(!isCurrentTagCreate\(createToken, name\)\) return;[\s\S]*appendAvailableTagIfMissing\(tag\);/
  );
  assert.match(
    characterFormScript,
    /function appendAvailableTagIfMissing\(tag\) \{[\s\S]*if \(!tag\?\.name\) \{[\s\S]*return false;[\s\S]*const currentTags = Array\.isArray\(availableTags\.value\) \? availableTags\.value : \[\];[\s\S]*const nextTags = \[\];[\s\S]*let tagExists = false;[\s\S]*for \(const currentTag of currentTags\) \{[\s\S]*currentTag\?\.name === tag\?\.name[\s\S]*tagExists = true;[\s\S]*nextTags\.push\(currentTag\);[\s\S]*if \(tagExists\) \{[\s\S]*return false;[\s\S]*nextTags\.push\(tag\);[\s\S]*return setAvailableTagsIfChanged\(nextTags\);[\s\S]*\}/
  );
  assert.doesNotMatch(characterFormScript, /availableTags\.value\.some\(/);
  assert.doesNotMatch(characterFormScript, /setAvailableTagsIfChanged\(\[\.\.\.availableTags\.value, tag\]\);/);
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
    /tags: form\.selectedTags\.length \? form\.selectedTags : parseTagsTextForPayload\(form\.tagsText\)/
  );
  assert.match(
    characterFormScript,
    /function parseTagsTextForPayload\(value = ''\) \{[\s\S]*const tags = \[\];[\s\S]*const source = String\(value \|\| ''\);[\s\S]*for \(let index = 0; index <= source\.length; index \+= 1\) \{[\s\S]*source\[index\] !== ','[\s\S]*const tag = source\.slice\(start, index\)\.trim\(\);[\s\S]*tags\.push\(tag\);[\s\S]*return tags;[\s\S]*\}/
  );
  assert.doesNotMatch(characterFormScript, /form\.tagsText\.split\(','\)\.map/);

  assert.match(
    characterFormScript,
    /const filteredTags = computed\(\(\) => filterTagsBySearch\(availableTags\.value, tagSearch\.value\)\);/
  );
  assert.match(
    characterFormScript,
    /const canCreateSearchedTag = computed\(\(\) => canCreateTagFromSearch\(availableTags\.value, tagSearch\.value\)\);/
  );
  assert.match(
    characterFormScript,
    /function filterTagsBySearch\(tags, rawSearch\) \{\s*const currentTags = Array\.isArray\(tags\) \? tags : \[\];\s*const search = String\(rawSearch \|\| ''\)\.trim\(\)\.toLowerCase\(\);[\s\S]*if \(!search\) \{\s*return currentTags;\s*\}[\s\S]*const matches = \[\];\s*for \(const tag of currentTags\) \{[\s\S]*matches\.push\(tag\);[\s\S]*\}\s*return matches;\s*\}/
  );
  assert.match(
    characterFormScript,
    /function canCreateTagFromSearch\(tags, rawSearch\) \{\s*const name = String\(rawSearch \|\| ''\)\.trim\(\);[\s\S]*if \(!name\) \{[\s\S]*return false;[\s\S]*for \(const tag of Array\.isArray\(tags\) \? tags : \[\]\) \{[\s\S]*if \(tag\?\.name === name\) \{[\s\S]*return false;[\s\S]*return true;[\s\S]*\}/
  );
  assert.match(characterFormTemplate, /v-if="canCreateSearchedTag"[\s\S]*class="ghost-button tag-create-btn"/);
  assert.doesNotMatch(characterFormScript, /availableTags\.value\.filter\(/);
  assert.doesNotMatch(characterFormTemplate, /availableTags\.some\(/);
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

test('CharacterFormView normalizes status blueprint variables with direct loops', () => {
  const normalizeStart = characterFormScript.indexOf('function normalizeStatusBarBlueprintForPayload(input = {}) {');
  const normalizeEnd = characterFormScript.indexOf('\nfunction normalizeStatusVariableForPayload', normalizeStart);
  const sameStart = characterFormScript.indexOf('function sameStatusVariableList(left = [], right = []) {');
  const sameEnd = characterFormScript.indexOf('\nfunction normalizeHtmlText', sameStart);
  assert.notEqual(normalizeStart, -1);
  assert.notEqual(normalizeEnd, -1);
  assert.notEqual(sameStart, -1);
  assert.notEqual(sameEnd, -1);
  const normalizeSnippet = characterFormScript.slice(normalizeStart, normalizeEnd);
  const sameSnippet = characterFormScript.slice(sameStart, sameEnd);

  assert.match(
    characterFormScript,
    /function syncStatusBlueprintVariablesFromTemplate\(\{ notifyUser = false \} = \{\}\) \{[\s\S]*const normalized = normalizeStatusBarBlueprintForPayload\(blueprint\);[\s\S]*const changed = !sameStatusVariableList\(blueprint\.variables, normalized\.variables\);[\s\S]*if \(changed\) \{[\s\S]*blueprint\.variables = cloneStatusVariableList\(normalized\.variables\);[\s\S]*\}/
  );
  assert.match(
    characterFormScript,
    /function normalizeStatusBarBlueprintForPayload\(input = \{\}\) \{[\s\S]*const variables = normalizeStatusVariableListForPayload\(source\.variables, template\);[\s\S]*variables: inferStatusVariablesFromTemplate\(template, variables\),/
  );
  assert.match(
    characterFormScript,
    /function inferStatusVariablesFromTemplate\(template, variables = \[\]\) \{[\s\S]*const inferred = dedupeStatusVariables\(variables, template\);[\s\S]*const seen = collectStatusVariableKeys\(inferred\);/
  );
  assert.match(
    characterFormScript,
    /function collectStatusVariableKeys\(variables = \[\]\) \{\s*const keys = new Set\(\);\s*for \(const item of Array\.isArray\(variables\) \? variables : \[\]\) \{\s*keys\.add\(normalizeStatusVariableKey\(item\?\.name\)\);\s*\}\s*return keys;\s*\}/
  );
  assert.match(
    characterFormScript,
    /function normalizeStatusVariableListForPayload\(variables = \[\], template = ''\) \{[\s\S]*const normalizedVariables = \[\];[\s\S]*for \(const variable of Array\.isArray\(variables\) \? variables : \[\]\) \{[\s\S]*const normalized = normalizeStatusVariableForPayload\(variable, template\);[\s\S]*normalizedVariables\.push\(normalized\);[\s\S]*return normalizedVariables;[\s\S]*\}/
  );
  assert.match(
    characterFormScript,
    /function sameStatusVariableList\(left = \[\], right = \[\]\) \{[\s\S]*const currentList = Array\.isArray\(left\) \? left : \[\];[\s\S]*const nextList = Array\.isArray\(right\) \? right : \[\];[\s\S]*for \(let index = 0; index < currentList\.length; index \+= 1\) \{[\s\S]*!sameStatusVariableForPayload\(currentList\[index\], nextList\[index\]\)[\s\S]*return true;[\s\S]*\}/
  );
  assert.match(
    characterFormScript,
    /function sameStatusVariableForPayload\(current, next\) \{[\s\S]*const currentVariable = normalizeStatusVariableForPayload\(current\);[\s\S]*const nextVariable = normalizeStatusVariableForPayload\(next\);[\s\S]*Object\.is\(currentVariable\.value, nextVariable\.value\)[\s\S]*String\(currentVariable\.color \|\| ''\) === String\(nextVariable\.color \|\| ''\);[\s\S]*\}/
  );
  assert.match(
    characterFormScript,
    /function cloneStatusVariableList\(variables = \[\]\) \{[\s\S]*const clonedVariables = \[\];[\s\S]*for \(const variable of Array\.isArray\(variables\) \? variables : \[\]\) \{[\s\S]*clonedVariables\.push\(\{ \.\.\.variable \}\);[\s\S]*return clonedVariables;[\s\S]*\}/
  );
  assert.doesNotMatch(normalizeSnippet, /\.map\(\(variable\) => normalizeStatusVariableForPayload/);
  assert.doesNotMatch(normalizeSnippet, /\.filter\(/);
  assert.doesNotMatch(sameSnippet, /\.every\(/);
  assert.doesNotMatch(sameSnippet, /JSON\.stringify/);
  assert.doesNotMatch(characterFormScript, /new Set\(inferred\.map/);
  assert.doesNotMatch(characterFormScript, /normalized\.variables\.map\(\(variable\) => \(\{ \.\.\.variable \}\)\)/);
});

test('CharacterFormView builds status blueprint editor rows without intermediate mapping arrays', () => {
  assert.match(
    characterFormScript,
    /import \{ parseStatusTemplateToken \} from '\.\.\/\.\.\/\.\.\/shared\/statusTemplateTokens\.js';/
  );
  const extractPartsStart = characterFormScript.indexOf('function extractCompositePlaceholderParts(value = \'\', label = \'\') {');
  const extractPartsEnd = characterFormScript.indexOf('\nfunction isMeterTemplateProperty', extractPartsStart);
  assert.notEqual(extractPartsStart, -1);
  assert.notEqual(extractPartsEnd, -1);
  const extractPartsSnippet = characterFormScript.slice(extractPartsStart, extractPartsEnd);
  assert.match(extractPartsSnippet, /const parsed = parseStatusTemplateToken\(token\);/);
  assert.match(extractPartsSnippet, /const rawProperty = parsed\.rawProperty\.trim\(\) \|\| 'value';/);
  assert.match(extractPartsSnippet, /const name = normalizeTemplateVariableName\(parsed\.rawName\.trim\(\)\);/);
  assert.doesNotMatch(extractPartsSnippet, /token\.split\('\.'\)\.map/);

  assert.match(
    characterFormScript,
    /const statusBlueprintEditorRows = computed\(\(\) => \{[\s\S]*const rows = \[\];\s*for \(let index = 0; index < compositeRows\.length; index \+= 1\) \{[\s\S]*let compositePartKey = '';[\s\S]*for \(let partIndex = 0; partIndex < row\.parts\.length; partIndex \+= 1\) \{[\s\S]*compositePartKey \+= `\$\{partIndex > 0 \? '\|' : ''\}\$\{part\?\.name \?\? ''\}`;[\s\S]*key: `composite:\$\{index\}:\$\{row\.label\}:\$\{compositePartKey\}`,[\s\S]*for \(let index = 0; index < variables\.length; index \+= 1\) \{[\s\S]*const variable = variables\[index\];[\s\S]*continue;[\s\S]*key: `variable:\$\{index\}:\$\{key\}`,/
  );
  assert.doesNotMatch(characterFormScript, /compositeRows\.map\(/);
  assert.doesNotMatch(characterFormScript, /row\.parts\.map\(/);
  assert.doesNotMatch(characterFormScript, /variables\.forEach\(/);
});

test('CharacterFormView status blueprint input handlers tolerate missing event targets', () => {
  assert.match(
    characterFormScript,
    /function readEventTargetValue\(event\) {\s*const target = event\?\.target;\s*return target && target\.value !== undefined \? target\.value : undefined;\s*}/
  );
  assert.match(
    characterFormScript,
    /function setStatusBlueprintVariableValueFromEvent\(name, event\) {\s*const value = readEventTargetValue\(event\);\s*if \(value === undefined\) {\s*return;\s*}\s*setStatusBlueprintVariableValue\(name, value\);\s*}/
  );
  assert.match(
    characterFormScript,
    /function setStatusBlueprintVariableModeFromEvent\(variable, event\) {\s*const value = readEventTargetValue\(event\);\s*if \(value === undefined\) {\s*return;\s*}\s*setStatusBlueprintVariableMode\(variable, value\);\s*}/
  );
  assert.match(
    characterFormScript,
    /function setColorValueFromEvent\(target, key, event\) {\s*const value = readEventTargetValue\(event\);\s*if \(value === undefined\) {\s*return;\s*}\s*setColorValue\(target, key, value\);\s*}/
  );
  assert.match(characterFormTemplate, /@input="setStatusBlueprintVariableValueFromEvent\(part\.name, \$event\)"/);
  assert.match(characterFormTemplate, /@change="setStatusBlueprintVariableModeFromEvent\(row\.variable, \$event\)"/);
  assert.match(characterFormTemplate, /@input="setColorValueFromEvent\(row\.variable, 'color', \$event\)"/);
  assert.doesNotMatch(characterFormTemplate, /\$event\.target\.value/);
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

  const nonDefaultStart = characterFormScript.indexOf('function hasNonDefaultAccessorySkills(skills = {}) {');
  const nonDefaultEnd = characterFormScript.indexOf('\nfunction normalizeSkillEnabled', nonDefaultStart);
  assert.notEqual(nonDefaultStart, -1);
  assert.notEqual(nonDefaultEnd, -1);
  const nonDefaultSnippet = characterFormScript.slice(nonDefaultStart, nonDefaultEnd);
  assert.match(nonDefaultSnippet, /const defaults = createDefaultAccessorySkills\(\);/);
  assert.match(nonDefaultSnippet, /for \(const key in defaults\)/);
  assert.match(nonDefaultSnippet, /Object\.prototype\.hasOwnProperty\.call\(defaults, key\)/);
  assert.match(nonDefaultSnippet, /normalizeSkillEnabled\(current\.enabled, fallback\.enabled\) !== fallback\.enabled/);
  assert.match(nonDefaultSnippet, /return true;/);
  assert.match(nonDefaultSnippet, /return false;/);
  assert.doesNotMatch(nonDefaultSnippet, /Object\.keys\(defaults\)\.some/);
});

test('CharacterFormView scans AI draft seed fields without key-array callbacks', () => {
  assert.match(
    characterFormScript,
    /const AI_DRAFT_SEED_FIELDS = \['name', 'gender', 'age', 'background', 'worldview', 'persona', 'openingMessage'\];/
  );
  assert.match(
    characterFormScript,
    /function hasDraftSeed\(\) \{\s*const payload = toPayload\(\);[\s\S]*if \(hasDraftSeedText\(payload\)\) \{[\s\S]*return true;[\s\S]*return \(Array\.isArray\(payload\.tags\) && payload\.tags\.length > 0\)[\s\S]*\|\| \(Array\.isArray\(payload\.regexRules\) && payload\.regexRules\.length > 0\);[\s\S]*\}/
  );
  assert.match(
    characterFormScript,
    /function hasDraftSeedText\(payload = \{\}\) \{\s*for \(const key of AI_DRAFT_SEED_FIELDS\) \{[\s\S]*if \(String\(payload\[key\] \|\| ''\)\.trim\(\)\) \{[\s\S]*return true;[\s\S]*return false;[\s\S]*\}/
  );
  assert.doesNotMatch(characterFormScript, /\['name', 'gender', 'age', 'background', 'worldview', 'persona', 'openingMessage'\]\s*\.\s*some/);
  assert.doesNotMatch(characterFormScript, /Object\.keys\(payload\)\.some/);
});

test('CharacterFormView preserves unchanged AI process panel references', () => {
  assert.match(characterFormScript, /import \{ countOwnObjectKeys \} from '\.\.\/utils\/objectKeys';/);
  assert.match(characterFormScript, /import \{ samePlainValue \} from '\.\.\/utils\/plainValues';/);
  assert.match(
    characterFormScript,
    /function toolResultLabel\(result = \{\}\) \{[\s\S]*result\?\.applied && typeof result\.applied === 'object'[\s\S]*countOwnObjectKeys\(result\.applied\)[\s\S]*\}/
  );
  assert.doesNotMatch(characterFormScript, /function countOwnObjectKeys\(value\)/);
  assert.doesNotMatch(characterFormScript, /Object\.keys\(result\.applied\)\.length/);
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
  assert.doesNotMatch(
    characterFormScript,
    /function samePlainValue\(/
  );
  assert.doesNotMatch(characterFormScript, /Object\.keys\(current\)/);
  assert.doesNotMatch(characterFormScript, /currentList\.every\(/);
  assert.doesNotMatch(characterFormScript, /current\.every\(/);
  assert.doesNotMatch(characterFormScript, /currentKeys\.every\(/);
  assert.match(
    characterFormScript,
    /function updateAiProcessStep\(round = 1, updateStep\) \{[\s\S]*const currentProcess = Array\.isArray\(aiProcess\.value\) \? aiProcess\.value : \[\];[\s\S]*let stepIndex = -1;[\s\S]*for \(let index = 0; index < currentProcess\.length; index \+= 1\) \{[\s\S]*currentProcess\[index\]\?\.round === round[\s\S]*break;[\s\S]*const nextProcess = \[\];[\s\S]*for \(let index = 0; index < currentProcess\.length; index \+= 1\) \{[\s\S]*nextProcess\.push\(index === stepIndex \? nextStep : currentProcess\[index\]\);[\s\S]*if \(stepIndex < 0\) \{[\s\S]*nextProcess\.push\(nextStep\);[\s\S]*setAiProcessIfChanged\(nextProcess\);[\s\S]*\}/
  );
  assert.match(
    characterFormScript,
    /function appendAiToolCall\(log\) \{[\s\S]*const currentToolCalls = Array\.isArray\(aiToolCalls\.value\) \? aiToolCalls\.value : \[\];[\s\S]*const nextToolCalls = \[\];[\s\S]*for \(const toolCall of currentToolCalls\) \{[\s\S]*nextToolCalls\.push\(toolCall\);[\s\S]*nextToolCalls\.push\(log\);[\s\S]*setAiToolCallsIfChanged\(nextToolCalls\);[\s\S]*\}/
  );
  assert.match(
    characterFormScript,
    /import \{ appendAiToolList, cloneAiToolList \} from '\.\.\/utils\/aiToolLists';/
  );
  assert.doesNotMatch(characterFormScript, /function cloneAiToolList\(/);
  assert.doesNotMatch(characterFormScript, /function appendAiToolList\(/);
  assert.doesNotMatch(characterFormScript, /currentProcess\.findIndex\(/);
  assert.doesNotMatch(characterFormScript, /currentProcess\.map\(\(item, index\) => \(index === stepIndex \? nextStep : item\)\)/);
  assert.doesNotMatch(characterFormScript, /\[\.\.\.currentProcess, nextStep\]/);
  assert.doesNotMatch(characterFormScript, /setAiToolCallsIfChanged\(\[\.\.\.currentToolCalls, log\]\);/);
  assert.doesNotMatch(characterFormScript, /Array\.isArray\(currentStep\.tools\) \? \[\.\.\.currentStep\.tools\] : \[\]/);
  assert.doesNotMatch(characterFormScript, /Array\.isArray\(step\.tools\) \? \[\.\.\.step\.tools\] : \[\]/);
  assert.doesNotMatch(characterFormScript, /\[\.\.\.\(Array\.isArray\(target\.tools\) \? target\.tools : \[\]\), log\]/);
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
    /function aiStreamHandlers\(isCurrent = \(\) => !characterFormDisposed\) \{[\s\S]*step: \(step = \{\}\) => \{[\s\S]*updateAiProcessStep\(step\.round \|\| 1, \(target\) => \(\{[\s\S]*tools: target\.tools\?\.length \? target\.tools : cloneAiToolList\(step\.tools\)[\s\S]*tool: \(call = \{\}\) => \{[\s\S]*updateAiProcessStep\(call\.round \|\| 1, \(target\) => \(\{[\s\S]*tools: appendAiToolList\(target\.tools, log\)[\s\S]*appendAiToolCall\(log\);/
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
  assert.match(characterFormScript, /import \{ callEventMethod \} from '\.\.\/utils\/eventMethods';/);
  assert.match(characterFormScript, /const AI_PANEL_DRAG_THRESHOLD = 8;/);
  assert.match(characterFormScript, /const AI_PANEL_MIN_WIDTH = 320;/);
  assert.match(characterFormScript, /const AI_PANEL_MIN_HEIGHT = 180;/);
  assert.match(characterFormScript, /let aiPanelLayoutRafId = null;/);
  assert.match(characterFormScript, /let aiPanelResizeObserver = null;/);
  assert.match(characterFormScript, /let pendingAiPanelSizeSync = false;/);
  assert.match(
    characterFormScript,
    /function readAiPanelPointerPoint\(event\) \{[\s\S]*const source = event\?\.touches\?\.\[0\] \|\| event;[\s\S]*Number\.isFinite\(clientX\)[\s\S]*Number\.isFinite\(clientY\)[\s\S]*return \{ clientX, clientY \};[\s\S]*\}/
  );
  assert.match(
    characterFormScript,
    /function onAiPanelDragStart\(e\) \{[\s\S]*const point = readAiPanelPointerPoint\(e\);[\s\S]*if \(!point\) return;[\s\S]*dragStartX = point\.clientX;[\s\S]*dragOffsetY = point\.clientY - rect\.top;/
  );
  assert.match(
    characterFormScript,
    /function onAiPanelDragMove\(e\) \{[\s\S]*callEventMethod\(e, 'preventDefault'\);[\s\S]*const point = readAiPanelPointerPoint\(e\);[\s\S]*if \(!point\) return;[\s\S]*clampAiPanelPos\(point\.clientX - dragOffsetX, point\.clientY - dragOffsetY\);/
  );
  assert.match(
    characterFormScript,
    /function onAiPanelResizeStart\(e\) \{[\s\S]*const point = readAiPanelPointerPoint\(e\);[\s\S]*if \(!point\) return;[\s\S]*callEventMethod\(e, 'preventDefault'\);[\s\S]*resizeStartX = point\.clientX;/
  );
  assert.match(
    characterFormScript,
    /function onAiPanelResizeMove\(e\) \{[\s\S]*callEventMethod\(e, 'preventDefault'\);[\s\S]*const point = readAiPanelPointerPoint\(e\);[\s\S]*Math\.round\(resizeStartWidth \+ point\.clientX - resizeStartX\)/
  );
  assert.match(
    characterFormScript,
    /function syncAiPanelSizeAndPosition\(\) \{[\s\S]*Math\.max\(AI_PANEL_MIN_WIDTH, Math\.round\(rect\.width\)\)[\s\S]*Math\.max\(AI_PANEL_MIN_HEIGHT, Math\.round\(rect\.height\)\)[\s\S]*saveAiPanelState\(\);/
  );
  assert.match(characterFormScript, /function scheduleAiPanelLayoutSync\(\{ includeSize = false \} = \{\}\) \{[\s\S]*requestAnimationFrame\(flushScheduledAiPanelLayout\);/);
  assert.match(characterFormScript, /function onObservedAiPanelResize\(\) \{[\s\S]*scheduleAiPanelLayoutSync\(\{ includeSize: true \}\);/);
  assert.match(
    characterFormScript,
    /function syncAiPanelResizeObserver\(el = aiPanelRef\.value\) \{[\s\S]*typeof window\.ResizeObserver !== 'function'[\s\S]*new window\.ResizeObserver\(onObservedAiPanelResize\)/
  );
  assert.match(characterFormScript, /function onAiPanelResizeStart\(e\) \{[\s\S]*document\.addEventListener\('pointermove', onAiPanelResizeMove/);
  assert.match(characterFormScript, /function onAiPanelResizeEnd\(\) \{[\s\S]*saveAiPanelState\(\);/);
  assert.doesNotMatch(characterFormScript, /e\.preventDefault\(\);/);

  assert.match(characterFormTemplate, /ref="aiPanelRef"/);
  assert.match(characterFormTemplate, /:class="\{ 'ai-panel-dragging': aiPanelDragging \}"/);
  assert.match(characterFormTemplate, /--ai-panel-h': aiPanelSize\.h \+ 'px'/);
  assert.match(characterFormTemplate, /class="inline-heading ai-panel-heading" @pointerdown="onAiPanelDragStart"/);
  assert.match(characterFormTemplate, /class="ai-panel-reset"[\s\S]*@pointerdown\.stop[\s\S]*@click\.stop="resetAiPanel"/);
  assert.match(characterFormTemplate, /class="ai-panel-resize-handle" aria-hidden="true" @pointerdown\.stop="onAiPanelResizeStart"/);

  assert.match(
    stylesSource,
    /@media \(min-width: 761px\) \{[\s\S]*\.ai-draft-panel\s*\{[\s\S]*position:\s*fixed;[\s\S]*height:\s*min\(var\(--ai-panel-h, 640px\), calc\(100dvh - var\(--ai-panel-y, 0px\)\)\);[\s\S]*min-width:\s*320px;[\s\S]*min-height:\s*180px;[\s\S]*resize:\s*both;[\s\S]*scrollbar-gutter:\s*stable;/
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
});
