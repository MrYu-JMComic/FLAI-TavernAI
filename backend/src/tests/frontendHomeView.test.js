import assert from 'node:assert/strict';
import test from 'node:test';
import { countMatches, readFrontendStyles, readVueBlocks } from './frontendSfcTestUtils.js';

const { script: homeViewScript, template: homeViewTemplate } = readVueBlocks('frontend/src/views/HomeView.vue');
const stylesSource = readFrontendStyles();

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

test('HomeView load error state offers filtering, creation, and settings exits', () => {
  assert.match(
    homeViewTemplate,
    /<section v-else-if="loadError" class="home-empty-panel error-state">[\s\S]*@click="retryLoadCharacters"[\s\S]*@click="clearFilters"[\s\S]*清除筛选[\s\S]*@click="emit\('navigate', 'characterNew'\)"[\s\S]*创建角色[\s\S]*@click="emit\('navigate', 'settings'\)"[\s\S]*检查设置/
  );
});

test('HomeView debounces search reloads while keeping sort and tag changes immediate', () => {
  assert.match(homeViewScript, /const SEARCH_LOAD_DEBOUNCE_MS = 180;/);
  assert.match(homeViewScript, /let searchLoadTimer = null;/);
  assert.match(homeViewScript, /let filterClearInProgress = false;/);
  assert.match(
    homeViewScript,
    /watch\(search, \(\) => \{\s*if \(filterClearInProgress\) return;\s*scheduleSearchLoad\(\);\s*}\);/
  );
  assert.match(
    homeViewScript,
    /watch\(\[sort, selectedTag\], \(\) => {\s*if \(filterClearInProgress\) return;\s*clearSearchLoadTimer\(\);\s*loadCharacters\(\);/
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
    homeViewScript,
    /async function clearFilters\(\) {\s*if \(!hasActiveFilters\.value\) return;\s*filterClearInProgress = true;\s*search\.value = '';\s*selectedTag\.value = '';\s*clearSearchLoadTimer\(\);\s*loadCharacters\(\);\s*await nextTick\(\);\s*filterClearInProgress = false;\s*}/
  );

  assert.match(
    homeViewTemplate,
    /<input v-model\.trim="search" placeholder="[^"]+" aria-label="[^"]+" \/>/
  );
  assert.match(homeViewTemplate, /<select v-model="sort" aria-label="[^"]+">/);
});

test('HomeView mobile filter controls stick to the internal scroll top', () => {
  assert.match(
    stylesSource,
    /\.home-layout-shell\s*\{[\s\S]*--home-control-sticky-top:\s*10px;[\s\S]*\}/
  );
  assert.match(
    stylesSource,
    /\.home-control-panel\s*\{[\s\S]*top:\s*var\(--home-control-sticky-top, 10px\);[\s\S]*z-index:\s*19;/
  );
  assert.match(
    stylesSource,
    /@media \(max-width: 760px\) \{[\s\S]*\.home-layout-shell\s*\{[\s\S]*--home-control-sticky-top:\s*0px;[\s\S]*\}[\s\S]*\.home-control-panel\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(104px, 128px\);/
  );
  assert.doesNotMatch(
    stylesSource,
    /@media \(max-width: 760px\) \{[\s\S]*\.home-layout-shell\s*\{[\s\S]*--home-control-sticky-top:\s*calc\(76px \+ env\(safe-area-inset-top, 0px\)\);/
  );
  assert.doesNotMatch(
    stylesSource,
    /@media \(max-width: 760px\) \{[\s\S]*\.home-control-panel\s*\{[\s\S]*top:\s*8px;/
  );
});

test('HomeView keeps home workbench interactions from changing scrollable overflow', () => {
  const homeWorkbenchIndex = stylesSource.indexOf('HOME WORKBENCH REDESIGN');
  const homeWorkbenchStyles = stylesSource.slice(homeWorkbenchIndex);

  assert.notEqual(homeWorkbenchIndex, -1);
  assert.equal(countMatches(stylesSource, /\.home-character-card:hover/g), 1);
  assert.match(
    homeWorkbenchStyles,
    /Transformed hover states alter the internal home scroller's scrollable overflow\./
  );
  assert.match(
    homeWorkbenchStyles,
    /@media \(hover: hover\) and \(pointer: fine\) \{[\s\S]*\.home-character-card:hover\s*\{[\s\S]*border-color:\s*color-mix\(in srgb, var\(--green\) 30%, var\(--line\)\);[\s\S]*inset 0 0 0 1px color-mix\(in srgb, var\(--green\) 18%, transparent\),[\s\S]*0 10px 28px rgba\(48, 56, 64, 0\.08\);[\s\S]*\}[\s\S]*\}/
  );
  assert.doesNotMatch(homeWorkbenchStyles, /transform\s*:/);
  assert.doesNotMatch(homeWorkbenchStyles, /transform\s+[0-9.]/);
  assert.doesNotMatch(homeWorkbenchStyles, /0 18px 42px/);
});

test('HomeView keeps reaction buttons as stable click targets while counts update', () => {
  assert.match(
    stylesSource,
    /\.home-reaction-button\s*\{[\s\S]*min-width:\s*54px;[\s\S]*font-variant-numeric:\s*tabular-nums;[\s\S]*\}/
  );
  assert.match(
    stylesSource,
    /\.home-reaction-button span\s*\{[\s\S]*min-width:\s*2ch;[\s\S]*text-align:\s*right;[\s\S]*\}/
  );
});

test('HomeView keeps reaction clicks from becoming scroll anchors without trapping page wheel scroll', () => {
  assert.doesNotMatch(homeViewScript, /\bmeasureElement\b/);
  assert.doesNotMatch(homeViewScript, /function measureVirtualRow/);
  assert.doesNotMatch(homeViewTemplate, /:ref="measureVirtualRow"/);
  assert.match(
    stylesSource,
    /\.home-layout-shell \.page-shell\s*\{[\s\S]*overflow-anchor:\s*none;[\s\S]*\}/
  );
  assert.match(
    stylesSource,
    /\.home-control-panel,\s*[\r\n]+\.home-character-scroll,\s*[\r\n]+\.home-character-spacer,\s*[\r\n]+\.home-character-list,\s*[\r\n]+\.home-character-row,\s*[\r\n]+\.home-character-card\s*\{[\s\S]*overflow-anchor:\s*none;[\s\S]*\}/
  );
  assert.match(
    stylesSource,
    /\.home-character-scroll\s*\{[^}]*overscroll-behavior:\s*auto;[^}]*\}/
  );
  assert.doesNotMatch(
    stylesSource,
    /\.home-character-scroll\s*\{[^}]*overscroll-behavior:\s*contain;[^}]*\}/
  );
  assert.match(
    stylesSource,
    /\.home-character-row \.home-character-card\s*\{[\s\S]*height:\s*372px;[\s\S]*\}/
  );
});

test('HomeView scans sort options and selected hot tags directly', () => {
  assert.match(homeViewScript, /const currentSortOption = computed\(\(\) => getSortOptionByValue\(sort\.value\)\);/);
  assert.match(
    homeViewScript,
    /const selectedHotTag = computed\(\(\) => \{[\s\S]*if \(!selectedTag\.value\) \{[\s\S]*return null;[\s\S]*return getTagByName\(tags\.value, selectedTag\.value\);[\s\S]*\}\);/
  );
  assert.match(
    homeViewScript,
    /function getSortOptionByValue\(value\) \{\s*const normalizedValue = String\(value \|\| ''\);[\s\S]*for \(const option of sortOptions\) \{[\s\S]*if \(option\.value === normalizedValue\) \{[\s\S]*return option;[\s\S]*return sortOptions\[0\];[\s\S]*\}/
  );
  assert.match(
    homeViewScript,
    /function getNextSortValue\(value\) \{\s*const normalizedValue = String\(value \|\| ''\);[\s\S]*for \(let index = 0; index < sortOptions\.length; index \+= 1\) \{[\s\S]*const nextIndex = \(index \+ 1\) % sortOptions\.length;[\s\S]*return sortOptions\[nextIndex\]\?\.value \|\| sortOptions\[0\]\.value;[\s\S]*return sortOptions\[0\]\.value;[\s\S]*\}/
  );
  assert.match(
    homeViewScript,
    /function getTagByName\(sourceTags, name\) \{\s*const selectedName = String\(name \|\| ''\);[\s\S]*const list = Array\.isArray\(sourceTags\) \? sourceTags : \[\];[\s\S]*for \(const tag of list\) \{[\s\S]*if \(tag\?\.name === selectedName\) \{[\s\S]*return tag;[\s\S]*return null;[\s\S]*\}/
  );
  assert.match(
    homeViewScript,
    /function cycleSort\(\) \{\s*sort\.value = getNextSortValue\(sort\.value\);[\s\S]*\}/
  );
  assert.doesNotMatch(homeViewScript, /sortOptions\.find\(/);
  assert.doesNotMatch(homeViewScript, /sortOptions\.findIndex\(/);
  assert.doesNotMatch(homeViewScript, /tags\.value\.find\(/);
});

test('HomeView keeps chat-open pending state guarded during route navigation', () => {
  assert.match(homeViewScript, /let chatOpenNavigationToken = 0;/);
  assert.match(
    homeViewScript,
    /function resetHomeAsyncScope\(\) \{[\s\S]*chatOpenNavigationToken \+= 1;[\s\S]*chatOpenPending\.reset\(\);/
  );
  assert.match(
    homeViewScript,
    /async function openChat\(character\) \{[\s\S]*const navigationToken = chatOpenNavigationToken;[\s\S]*if \(!isCurrentChatOpenNavigation\(navigationToken\)\) return;[\s\S]*navigateFromChatOpen\('chat', \{ id: conversation\.id \}\);[\s\S]*finally \{[\s\S]*if \(!isCurrentChatOpenNavigation\(navigationToken\)\) return;[\s\S]*chatOpenPending\.finish\(key\);/
  );
  assert.match(
    homeViewScript,
    /function isCurrentChatOpenNavigation\(navigationToken\) \{\s*return isHomeActive\(\) && navigationToken === chatOpenNavigationToken;\s*\}/
  );
  assert.match(
    homeViewScript,
    /function navigateFromChatOpen\(page, params\) \{\s*chatOpenNavigationToken \+= 1;\s*emit\('navigate', page, params\);\s*\}/
  );
  assert.doesNotMatch(homeViewScript, /emit\('navigate', 'chat', \{ id: conversation\.id \}\);/);
});

test('HomeView formats provider labels without filter join arrays', () => {
  assert.match(
    homeViewScript,
    /const providerLabel = computed\(\(\) => \{[\s\S]*return formatProviderLabel\(props\.provider\);[\s\S]*\}\);/
  );
  assert.match(
    homeViewScript,
    /function formatProviderLabel\(provider = \{\}\) \{[\s\S]*const gatewayName = provider\?\.gatewayName;[\s\S]*const model = provider\?\.model;[\s\S]*if \(gatewayName && model\) \{[\s\S]*return `\$\{gatewayName\} · \$\{model\}`;[\s\S]*return gatewayName \|\| model \|\| '';[\s\S]*}/
  );
  assert.doesNotMatch(homeViewScript, /\[props\.provider\.gatewayName, props\.provider\.model\]\.filter\(Boolean\)\.join/);
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
  assert.match(
    homeViewScript,
    /watch\(isMobileListLayout, async \(\) => \{\s*await nextTick\(\);\s*if \(!isHomeActive\(\)\) return;\s*refreshScrollMeasurements\(\);\s*}\);/
  );
});

test('HomeView virtualizes character rows without prebuilding every row slice', () => {
  assert.match(
    homeViewScript,
    /const characterRowCount = computed\(\(\) => Math\.ceil\(characters\.value\.length \/ columnsPerRow\.value\)\);/
  );
  assert.match(
    homeViewScript,
    /const virtualizerOptions = computed\(\(\) => \(\{[\s\S]*count: characterRowCount\.value,[\s\S]*getScrollElement: \(\) => scrollContainerRef\.value,[\s\S]*overscan: 3[\s\S]*\}\)\);/
  );
  assert.match(
    homeViewScript,
    /function getCharacterRowItems\(rowIndex\) {\s*const normalizedRowIndex = Math\.max\(0, Math\.floor\(Number\(rowIndex\) \|\| 0\)\);[\s\S]*const startIndex = normalizedRowIndex \* columnsPerRow\.value;[\s\S]*return characters\.value\.slice\(startIndex, startIndex \+ columnsPerRow\.value\);[\s\S]*}/
  );
  assert.match(homeViewTemplate, /v-for="character in getCharacterRowItems\(virtualRow\.index\)"/);
  assert.doesNotMatch(homeViewScript, /const characterRows = computed/);
  assert.doesNotMatch(homeViewTemplate, /characterRows\[virtualRow\.index\]/);
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
    /function sameListItems\(currentItems, nextItems, sameItem\)\s*{[\s\S]*if \(currentItems === nextItems\) {\s*return true;\s*}[\s\S]*if \(currentItems\.length !== nextItems\.length\) {\s*return false;\s*}[\s\S]*for \(let index = 0; index < currentItems\.length; index \+= 1\) {[\s\S]*!sameItem\(currentItems\[index\], nextItems\[index\]\)[\s\S]*return false;[\s\S]*return true;[\s\S]*}/
  );
  assert.doesNotMatch(homeViewScript, /currentItems\.every\(/);
  assert.match(
    homeViewScript,
    /function sameCharacterSummary\(current = {}, next = {}\)\s*{[\s\S]*current\?\.id === next\?\.id[\s\S]*current\?\.name === next\?\.name[\s\S]*Boolean\(current\?\.favoritedByMe\) === Boolean\(next\?\.favoritedByMe\)[\s\S]*Number\(current\?\.likeCount \|\| 0\) === Number\(next\?\.likeCount \|\| 0\)[\s\S]*sameCharacterTags\(current, next\);[\s\S]*}/
  );
  assert.match(
    homeViewScript,
    /function sameTagSummary\(current = {}, next = {}\)\s*{[\s\S]*String\(current\?\.id \|\| ''\) === String\(next\?\.id \|\| ''\)[\s\S]*String\(current\?\.name \|\| ''\) === String\(next\?\.name \|\| ''\)[\s\S]*Number\(current\?\.usageCount \|\| 0\) === Number\(next\?\.usageCount \|\| 0\);[\s\S]*}/
  );
  assert.match(homeViewScript, /setTagsIfChanged\(nextTags\);/);
  assert.match(homeViewScript, /setTagsIfChanged\(\[\]\);/);
  assert.match(homeViewScript, /setCharactersIfChanged\(nextCharacters\);/);
  assert.match(
    homeViewScript,
    /function updateCharacterByIdIfChanged\(nextCharacter\)\s*{\s*const targetId = String\(nextCharacter\?\.id \|\| ''\);[\s\S]*for \(let index = 0; index < currentCharacters\.length; index \+= 1\) \{[\s\S]*const mergedCharacter = \{ \.\.\.character, \.\.\.nextCharacter \};[\s\S]*if \(sameCharacterSummary\(character, mergedCharacter\)\) \{[\s\S]*return false;[\s\S]*const nextCharacters = currentCharacters\.slice\(\);[\s\S]*nextCharacters\[index\] = mergedCharacter;[\s\S]*return setCharactersIfChanged\(nextCharacters\);[\s\S]*return false;[\s\S]*}/
  );
  assert.match(
    homeViewScript,
    /function mergeCharacter\(nextCharacter\) {\s*updateCharacterByIdIfChanged\(nextCharacter\);[\s\S]*}/
  );
  assert.doesNotMatch(homeViewScript, /setCharactersIfChanged\(characters\.value\.map/);
  assert.ok(countMatches(homeViewScript, /setCharactersIfChanged\(/g) >= 3);
  assert.ok(countMatches(homeViewScript, /setTagsIfChanged\(/g) >= 3);
});

test('HomeView compares character tag summaries without mapped fallback arrays', () => {
  assert.match(
    homeViewScript,
    /function sameCharacterSummary\(current = \{\}, next = \{\}\) \{[\s\S]*&& sameCharacterTags\(current, next\);[\s\S]*}/
  );
  assert.match(
    homeViewScript,
    /function sameCharacterTags\(current = \{\}, next = \{\}\) \{[\s\S]*const currentUsesCharacterTags = currentCharacterTags\.length > 0;[\s\S]*const currentTags = currentUsesCharacterTags \? currentCharacterTags : \(Array\.isArray\(current\?\.tags\) \? current\.tags : \[\]\);[\s\S]*for \(let index = 0; index < currentTags\.length; index \+= 1\) \{[\s\S]*sameCharacterTagSummary\(currentTags\[index\], currentUsesCharacterTags, nextTags\[index\], nextUsesCharacterTags\)[\s\S]*return true;[\s\S]*}/
  );
  assert.match(
    homeViewScript,
    /function sameCharacterTagSummary\(currentTag, currentStructured, nextTag, nextStructured\) \{[\s\S]*const currentName = currentStructured \? currentTag\?\.name : currentTag;[\s\S]*const nextName = nextStructured \? nextTag\?\.name : nextTag;[\s\S]*Number\(currentUsage \|\| 0\) === Number\(nextUsage \|\| 0\);[\s\S]*}/
  );
  assert.doesNotMatch(homeViewScript, /function normalizeCharacterTagList/);
  assert.doesNotMatch(homeViewScript, /\.tags\.map\(\(name\) => \(\{ name \}\)\)/);
});

test('HomeView aggregates dashboard character stats in one pass', () => {
  assert.match(
    homeViewScript,
    /const homeStats = computed\(\(\) => \{\s*const stats = countHomeCharacterStats\(characters\.value\);[\s\S]*const total = stats\.total;[\s\S]*const publicCount = stats\.publicCount;[\s\S]*const favoriteCount = stats\.favoriteCount;/
  );
  assert.match(
    homeViewScript,
    /function countHomeCharacterStats\(items\) \{\s*const stats = \{\s*total: 0,\s*publicCount: 0,\s*favoriteCount: 0\s*};[\s\S]*const list = Array\.isArray\(items\) \? items : \[\];[\s\S]*for \(const item of list\) \{[\s\S]*stats\.total \+= 1;[\s\S]*stats\.publicCount \+= 1;[\s\S]*stats\.favoriteCount \+= 1;[\s\S]*return stats;[\s\S]*}/
  );
  assert.doesNotMatch(homeViewScript, /characters\.value\.filter\(/);
});

test('HomeView builds hot tag rail options with direct helper loops', () => {
  assert.match(homeViewScript, /const popularTags = computed\(\(\) => collectPopularTags\(tags\.value\)\);/);
  assert.match(homeViewScript, /const selectedOutsidePopular = selected && !tagListContains\(popularTags\.value, selected\);/);
  assert.match(
    homeViewScript,
    /function collectPopularTags\(sourceTags\) \{\s*const nextTags = \[\];\s*const list = Array\.isArray\(sourceTags\) \? sourceTags : \[\];[\s\S]*for \(const tag of list\) \{[\s\S]*if \(Number\(tag\?\.usageCount \|\| 0\) > 0\) \{[\s\S]*nextTags\.push\(tag\);[\s\S]*return nextTags\.sort\(compareTagPopularity\);[\s\S]*\}/
  );
  assert.match(
    homeViewScript,
    /const randomizedTags = pickRandomizedHotTags\(source, hotTagSeed\.value, limit\);/
  );
  assert.match(
    homeViewScript,
    /function pickRandomizedHotTags\(sourceTags, seed, limit\) \{\s*const poolLimit = Math\.max\(limit, HOT_TAG_RANDOM_POOL_LIMIT\);[\s\S]*for \(let index = 0; index < poolSize; index \+= 1\) \{[\s\S]*scoredTags\.push\(\{[\s\S]*score: hashHotTag\(`\$\{seed\}:\$\{tag\.id \|\| tag\.name\}:\$\{index\}`\)[\s\S]*scoredTags\.sort\(\(left, right\) => left\.score - right\.score\);[\s\S]*for \(let index = 0; index < count; index \+= 1\) \{[\s\S]*nextTags\.push\(scoredTags\[index\]\.tag\);[\s\S]*return nextTags\.sort\(compareTagPopularity\);[\s\S]*\}/
  );
  assert.match(
    homeViewScript,
    /function tagListContains\(list, selected\) \{\s*const tags = Array\.isArray\(list\) \? list : \[\];[\s\S]*for \(const tag of tags\) \{[\s\S]*if \(isSameTag\(tag, selected\)\) \{[\s\S]*return true;[\s\S]*return false;[\s\S]*}/
  );
  assert.doesNotMatch(homeViewScript, /tags\.value\s*\.\s*filter/);
  assert.doesNotMatch(homeViewScript, /pool\s*\.\s*map/);
  assert.doesNotMatch(homeViewScript, /popularTags\.value\.some/);
  assert.doesNotMatch(homeViewScript, /list\.some\(\(tag\) => isSameTag/);
});

test('HomeView builds card tag previews with bounded direct loops', () => {
  assert.match(homeViewScript, /const CHARACTER_CARD_TAG_LIMIT = 5;/);
  assert.match(
    homeViewScript,
    /function getCharacterTags\(character\) {\s*const nextTags = \[\];\s*const characterTags = Array\.isArray\(character\?\.characterTags\) \? character\.characterTags : \[\];[\s\S]*for \(let index = 0; index < characterTags\.length && nextTags\.length < CHARACTER_CARD_TAG_LIMIT; index \+= 1\) \{[\s\S]*nextTags\.push\(characterTags\[index\]\);[\s\S]*const tagNames = Array\.isArray\(character\?\.tags\) \? character\.tags : \[\];[\s\S]*for \(let index = 0; index < tagNames\.length && nextTags\.length < CHARACTER_CARD_TAG_LIMIT; index \+= 1\) \{[\s\S]*nextTags\.push\(\{ name: tagNames\[index\] \}\);[\s\S]*return nextTags;[\s\S]*}/
  );
  assert.match(
    homeViewScript,
    /function getExtraTagCount\(character\) {\s*return Math\.max\(0, countCharacterTags\(character\) - CHARACTER_CARD_TAG_LIMIT\);[\s\S]*}/
  );
  assert.match(
    homeViewScript,
    /function countCharacterTags\(character\) {\s*const characterTags = Array\.isArray\(character\?\.characterTags\) \? character\.characterTags : \[\];[\s\S]*if \(characterTags\.length\) \{[\s\S]*return characterTags\.length;[\s\S]*return Array\.isArray\(character\?\.tags\) \? character\.tags\.length : 0;[\s\S]*}/
  );
  assert.doesNotMatch(homeViewScript, /\(character\.tags \|\| \[\]\)\.map\(\(name\) => \(\{ name \}\)\)/);
  assert.doesNotMatch(homeViewScript, /return source\.slice\(0, 5\);/);
});

test('HomeView ignores stale character import file reads', () => {
  assert.match(homeViewScript, /let importFileReadToken = 0;/);
  assert.match(
    homeViewScript,
    /function resetHomeAsyncScope\(\)[\s\S]*importFileReadToken \+= 1;[\s\S]*clearSearchLoadTimer\(\);/
  );
  assert.match(
    homeViewScript,
    /async function handleImportFile\(event\) {[\s\S]*const input = event\?\.target;[\s\S]*const file = input\?\.files\?\.\[0\];[\s\S]*if \(input\) {\s*input\.value = '';[\s\S]*await previewImportFile\(file\);[\s\S]*}/
  );
  assert.match(
    homeViewScript,
    /async function previewImportFile\(file\) {[\s\S]*if \(importLoading\.value \|\| !file \|\| !isHomeActive\(\)\) return;[\s\S]*const readToken = \+\+importFileReadToken;[\s\S]*importPreview\.value = null;[\s\S]*importError\.value = '';[\s\S]*importFileName\.value = file\.name \|\| '';[\s\S]*const text = await file\.text\(\);[\s\S]*if \(!isCurrentImportFileRead\(readToken\)\) return;[\s\S]*importPreview\.value = data;[\s\S]*} catch {[\s\S]*if \(!isCurrentImportFileRead\(readToken\)\) return;[\s\S]*importError\.value = '无法解析角色卡文件，请确认是有效的 JSON 文件';/
  );
  assert.match(
    homeViewScript,
    /function isCurrentImportFileRead\(readToken\) {\s*return isHomeActive\(\) && readToken === importFileReadToken;\s*}/
  );
  assert.match(
    homeViewScript,
    /function cancelImport\(\) {[\s\S]*importFileReadToken \+= 1;[\s\S]*importPreview\.value = null;[\s\S]*}/
  );
  assert.equal(countMatches(homeViewTemplate, /class="home-secondary-action home-file-action" :class="\{ disabled: importLoading \}"/g), 2);
  assert.equal(countMatches(homeViewTemplate, /<input type="file" accept="\.json" :disabled="importLoading" @change="handleImportFile" \/>/g), 2);
});

test('HomeView keeps character import preview inline with direct edit and import actions', () => {
  assert.match(homeViewTemplate, /class="page-stack home-workbench" @dragover\.prevent @drop\.prevent="handleImportDrop"/);
  assert.match(homeViewTemplate, /<section v-if="importPreview \|\| importError" class="home-import-panel"/);
  assert.match(homeViewTemplate, /<p v-if="importError" class="home-import-error">\{\{ importError \}\}<\/p>/);
  assert.match(homeViewTemplate, /@click="confirmImport\(true\)"[\s\S]*导入并编辑/);
  assert.match(homeViewTemplate, /@click="confirmImport\(false\)"[\s\S]*直接导入/);
  assert.doesNotMatch(homeViewTemplate, /<Teleport to="body">/);
  assert.doesNotMatch(homeViewTemplate, /class="import-overlay"/);
  assert.match(
    homeViewScript,
    /async function confirmImport\(editAfter = false\) {[\s\S]*const savedCharacter = await importCharacter\(nextImport\);[\s\S]*if \(editAfter && savedCharacter\?\.id\) {[\s\S]*emit\('navigate', 'characterEdit', { id: savedCharacter\.id }\);[\s\S]*return;[\s\S]*}/
  );
});
