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
