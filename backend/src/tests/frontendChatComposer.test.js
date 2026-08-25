import assert from 'node:assert/strict';
import test from 'node:test';
import { readFrontendStyles, readRepoText, readVueBlocks } from './frontendSfcTestUtils.js';

const { script: chatComposerScript, template: chatComposerTemplate } = readVueBlocks(
  'frontend/src/components/chat/ChatComposer.vue'
);
const stylesSource = readFrontendStyles();
const chatSubmitSource = readRepoText('frontend/src/composables/chat/useChatSubmit.js');
const { script: chatViewScript, template: chatViewTemplate, style: chatViewStyle } = readVueBlocks(
  'frontend/src/views/ChatView.vue',
  ['script', 'template', 'style']
);
const { script: statusBarScript } = readVueBlocks('frontend/src/components/StatusBar.vue', ['script']);

function readStyleRange(startMarker, endMarker, fromIndex = 0) {
  const startIndex = stylesSource.indexOf(startMarker, fromIndex);
  assert.notEqual(startIndex, -1, `missing style marker: ${startMarker}`);
  const endIndex = stylesSource.indexOf(endMarker, startIndex + startMarker.length);
  assert.notEqual(endIndex, -1, `missing style marker: ${endMarker}`);
  return stylesSource.slice(startIndex, endIndex);
}

test('ChatComposer locks configuration controls while sending', () => {
  assert.match(chatComposerTemplate, /<form class="deep-composer" :aria-busy="sending" @submit\.prevent="submitComposer\(\{ isEnter: false \}\)">/);
  assert.match(chatComposerTemplate, /@keydown\.enter\.exact="submitComposer\(\{ isEnter: true, event: \$event \}\)"/);
  assert.match(chatComposerScript, /function submitComposer\(payload\) {\s*emit\('submit', payload\);\s*}/);
  assert.match(chatComposerTemplate, /class="visually-hidden"[\s\S]*type="file"[\s\S]*aria-label="选择聊天图片"[\s\S]*:disabled="!canAddAttachments"[\s\S]*@change="onAttachmentChange"/);
  assert.match(chatComposerTemplate, /class="mode-pill attachment-pill"[\s\S]*:disabled="sending \|\| attachmentBusy \|\| !canAddAttachments"[\s\S]*@click="openAttachmentPicker"/);
  assert.match(chatComposerTemplate, /class="preset-select"[\s\S]*:disabled="sending"[\s\S]*@change="onPresetChange"/);
  assert.match(chatComposerScript, /const modelSwitchLocked = computed\(\(\) => props\.sending \|\| props\.modelSaving\);/);
  assert.match(chatComposerTemplate, /class="model-quick-select"[\s\S]*:disabled="modelSwitchLocked \|\| !canQuickSwitchModel"[\s\S]*@change="onQuickModelChange"/);
  assert.match(chatComposerTemplate, /v-if="!quickModelOptions\.length"[\s\S]*class="mode-pill model-switch-pill"[\s\S]*:disabled="sending"[\s\S]*:aria-busy="sending"[\s\S]*@click="emit\('open-model-switcher'\)"/);
  assert.match(chatComposerTemplate, /:aria-pressed="String\(canUseStream && useStream\)"[\s\S]*:disabled="sending \|\| !canUseStream"[\s\S]*:aria-busy="sending"[\s\S]*@click="emit\('toggle-stream'\)"/);
  assert.match(chatComposerTemplate, /:disabled="sending \|\| !canToggleThinking"[\s\S]*:aria-busy="sending"[\s\S]*@click="emit\('toggle-thinking'\)"/);
  assert.doesNotMatch(chatComposerTemplate, /image-generation-pill|continue-pill|toggle-image-generation|continue-generation/);
  assert.doesNotMatch(chatComposerScript, /canContinue:|canToggleImageGeneration:|imageGenerationEnabled:/);

  assert.match(chatSubmitSource, /function toggleUseStream\(\)\s*{\s*if \(sending\.value \|\| !canUseStream\.value\) {\s*return;\s*}/);
  assert.match(chatSubmitSource, /function toggleThinking\(\)\s*{\s*if \(sending\.value \|\| !canToggleThinking\.value\) {\s*return;\s*}/);
  assert.match(chatSubmitSource, /function toggleImageGeneration\(\)\s*{\s*if \(sending\.value \|\| !canToggleImageGeneration\.value\) {\s*return;\s*}/);
});

test('ChatComposer input handlers tolerate missing event targets', () => {
  assert.match(
    chatComposerScript,
    /function readEventTargetValue\(event\) {\s*const target = event\?\.target;\s*return target && target\.value !== undefined \? target\.value : undefined;\s*}/
  );
  assert.match(
    chatComposerScript,
    /function onComposerInput\(event\) {\s*const value = readEventTargetValue\(event\);\s*if \(value === undefined\) {\s*return;\s*}\s*emit\('update:input', value\);\s*emit\('composer-input', event\);\s*}/
  );
  assert.match(
    chatComposerScript,
    /function onPresetChange\(event\) {\s*const value = readEventTargetValue\(event\);\s*if \(value === undefined\) {\s*return;\s*}\s*emit\('update:selectedPresetId', value\);\s*}/
  );
  assert.match(
    chatComposerScript,
    /function onQuickModelChange\(event\) {\s*const value = readEventTargetValue\(event\);[\s\S]*emit\('quick-model-change', nextModel\);[\s\S]*}/
  );
  assert.match(chatComposerTemplate, /@input="onComposerInput"/);
  assert.match(chatComposerTemplate, /@change="onPresetChange"/);
  assert.match(chatComposerTemplate, /@change="onQuickModelChange"/);
  assert.doesNotMatch(chatComposerTemplate, /\$event\.target\.value/);
});

test('ChatComposer previews both fresh and persisted image attachments', () => {
  assert.match(
    chatComposerScript,
    /function attachmentPreviewUrl\(attachment = \{\}\) \{\s*return attachment\.dataUrl \|\| attachment\.url \|\| '';\s*}/
  );
  assert.match(chatComposerTemplate, /<img :src="attachmentPreviewUrl\(attachment\)" :alt="attachmentLabel\(attachment\)" \/>/);
  assert.doesNotMatch(chatComposerTemplate, /<img :src="attachment\.dataUrl"/);
});

test('ChatComposer keeps the composer single-path without shortcut toolbar chrome', () => {
  assert.match(chatComposerScript, /import \{ computed, ref \} from 'vue';/);
  assert.doesNotMatch(chatComposerScript, /nextTick|INPUT_HISTORY_LIMIT|composerHistory|historyCursor|historyDraft/);
  assert.doesNotMatch(chatComposerScript, /applyMarkdownShortcut|wrapComposerSelection|insertComposerText|rememberComposerHistory|browseInputHistory/);
  assert.doesNotMatch(chatComposerTemplate, /composer-shortcuts|composer-shortcut-button|history-shortcut-button|variable-shortcut-button/);
  assert.doesNotMatch(chatComposerTemplate, /aria-label="Bold"|aria-label="Italic"|aria-label="Insert \{user\}"|aria-label="Previous input"|aria-label="Next input"/);
  assert.equal((chatComposerTemplate.match(/<textarea\b/g) || []).length, 1);
  assert.doesNotMatch(chatComposerTemplate, /@submit\.prevent="emit\('submit'/);
  assert.doesNotMatch(chatComposerTemplate, /@keydown\.enter\.exact="emit\('submit'/);
});

test('ChatComposer exposes an inline quick model selector with deduped options', () => {
  assert.match(chatComposerScript, /const quickModelOptions = computed\(\(\) => buildQuickModelOptions\(props\.modelOptions, props\.currentModel\)\);/);
  assert.match(chatComposerScript, /const canQuickSwitchModel = computed\(\(\) => \{[\s\S]*return !props\.currentModel \|\| quickModelOptions\.value\.length > 1;[\s\S]*\}\);/);
  assert.match(
    chatComposerScript,
    /function buildQuickModelOptions\(sourceModels, currentModel\) {[\s\S]*const byId = new Map\(\);[\s\S]*byId\.set\(current,[\s\S]*const models = Array\.isArray\(sourceModels\) \? sourceModels : \[\];[\s\S]*for \(const item of models\) {[\s\S]*byId\.set\(id,[\s\S]*return collectQuickModelOptions\(byId\);[\s\S]*}/
  );
  assert.match(
    chatComposerScript,
    /function collectQuickModelOptions\(byId\) {\s*const options = \[\];\s*for \(const option of byId\.values\(\)\) {\s*options\.push\(option\);[\s\S]*return options;[\s\S]*}/
  );
  assert.match(chatComposerTemplate, /<label v-if="quickModelOptions\.length" class="model-quick-select"/);
  assert.match(chatComposerTemplate, /aria-label="快速切换聊天模型"/);
  assert.match(chatComposerTemplate, /<option v-for="model in quickModelOptions" :key="model\.id" :value="model\.id">/);
  assert.match(chatComposerScript, /const normalizedModelCapabilities = computed\(\(\) => props\.modelCapabilities && typeof props\.modelCapabilities === 'object'/);
  assert.match(chatComposerScript, /const modelCapabilityChips = computed\(\(\) => \{[\s\S]*chips\.push\(\{ key: 'reasoning', label: '推理' \}\);[\s\S]*chips\.push\(\{ key: 'vision', label: '视觉' \}\);[\s\S]*chips\.push\(\{ key: 'imageGeneration', label: '绘图' \}\);[\s\S]*chips\.push\(\{ key: 'streaming', label: '流式' \}\);[\s\S]*return chips;[\s\S]*\}\);/);
  assert.match(chatComposerTemplate, /<span v-for="chip in modelCapabilityChips" :key="chip\.key" class="model-ability-chip">\{\{ chip\.label \}\}<\/span>/);
  assert.match(chatComposerTemplate, /class="mode-pill stream-pill"/);
  assert.match(chatComposerTemplate, /class="mode-pill thinking-pill"/);
  assert.doesNotMatch(chatComposerTemplate, /image-generation-pill|continue-pill/);
  assert.doesNotMatch(chatComposerScript, /modelOptions\.map\(/);
  assert.doesNotMatch(chatComposerScript, /return\s+\[\.\.\.byId\.values\(\)\];/);
});

test('ChatComposer keeps mobile model switching to one stable control with dark theme colors', () => {
  assert.match(
    stylesSource,
    /\.model-quick-select,[\s\S]*:root\[data-theme="dark"\] \.model-quick-select\s*{[\s\S]*border-color:\s*var\(--line\);[\s\S]*color:\s*var\(--text\);[\s\S]*background:\s*var\(--surface\);/
  );
  assert.match(stylesSource, /:root\[data-theme="dark"\] \.model-quick-select select\s*{\s*color-scheme:\s*dark;\s*}/);
  assert.match(
    stylesSource,
    /:root\[data-theme="dark"\] \.model-quick-select select option\s*{[\s\S]*color:\s*#e5e7eb;[\s\S]*background:\s*#111827;[\s\S]*}/
  );

  const composerPhoneStart = stylesSource.indexOf('grid-template-columns: minmax(0, 1fr) repeat(3, 44px) 44px;');
  assert.notEqual(composerPhoneStart, -1, 'missing phone composer grid marker');
  const composerPhoneBlockStart = stylesSource.lastIndexOf('@media (max-width: 620px) {', composerPhoneStart);
  const composerPhoneBlockEnd = stylesSource.indexOf('  .model-picker {', composerPhoneStart);
  assert.notEqual(composerPhoneBlockStart, -1, 'missing phone composer block start');
  assert.notEqual(composerPhoneBlockEnd, -1, 'missing phone composer block end');
  const phoneBlock = stylesSource.slice(composerPhoneBlockStart, composerPhoneBlockEnd);
  assert.match(phoneBlock, /\.composer-actions\s*{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) repeat\(3, 44px\) 44px;[\s\S]*gap:\s*8px;/);
  assert.match(phoneBlock, /\.composer-actions\.has-preset\s*{[\s\S]*grid-template-rows:\s*44px 44px;/);
  assert.match(phoneBlock, /\.composer-actions\.has-preset \.preset-select\s*{[\s\S]*grid-column:\s*1 \/ -1;[\s\S]*grid-row:\s*1;/);
  assert.match(phoneBlock, /\.model-quick-select\s*{[\s\S]*grid-column:\s*1;[\s\S]*grid-row:\s*1;/);
  assert.match(phoneBlock, /\.composer-actions\.has-preset \.model-quick-select,[\s\S]*\.composer-actions\.has-preset \.model-switch-pill\s*{[\s\S]*grid-row:\s*2;/);
  assert.match(phoneBlock, /\.attachment-pill\s*{[\s\S]*grid-column:\s*2;/);
  assert.match(phoneBlock, /\.stream-pill\s*{[\s\S]*grid-column:\s*3;/);
  assert.match(phoneBlock, /\.thinking-pill\s*{[\s\S]*grid-column:\s*4;/);
  assert.match(phoneBlock, /\.round-send\s*{[\s\S]*grid-column:\s*5;/);
  assert.doesNotMatch(phoneBlock, /image-generation-pill|continue-pill/);
  assert.doesNotMatch(phoneBlock, /\.model-switch-pill\s*{[^}]*display:\s*none;/);
});

test('ChatComposer presents thinking strength as a stable desktop control', () => {
  assert.match(chatComposerTemplate, /class="thinking-level-brain"/);
  assert.match(chatComposerTemplate, /class="thinking-level-copy"[\s\S]*class="thinking-level-name">思考<[\s\S]*class="thinking-level-value">\{\{ currentThinkingLabel \}\}/);
  assert.match(chatComposerTemplate, /class="thinking-level-select"[\s\S]*:aria-label="`思考强度，当前\$\{currentThinkingLabel\}`"/);

  const thinkingControlStyles = readStyleRange('.thinking-level-control {', '.model-switch-pill {');
  assert.match(thinkingControlStyles, /min-width:\s*132px;/);
  assert.match(thinkingControlStyles, /\.thinking-level-copy\s*{[\s\S]*display:\s*grid;[\s\S]*text-align:\s*left;/);
  assert.match(thinkingControlStyles, /\.thinking-level-select\s*{[\s\S]*position:\s*absolute;[\s\S]*inset:\s*0;[\s\S]*width:\s*100%;[\s\S]*height:\s*100%;[\s\S]*opacity:\s*0;/);
});

test('ChatComposer removed shortcut toolbar styles after removing the toolbar UI', () => {
  assert.doesNotMatch(stylesSource, /\.composer-shortcuts|\.composer-shortcut-button|\.composer-shortcuts-divider|\.variable-shortcut-button/);
});

test('ChatComposer follows readable width when desktop sidebar is collapsed', () => {
  assert.match(
    stylesSource,
    /\.deep-chat-shell\.sidebar-collapsed\s*{\s*--chat-readable-width:\s*min\(100%, calc\(100vw - 32px\)\);\s*--chat-composer-width:\s*var\(--chat-readable-width\);/
  );
});

test('ChatComposer only uses edge-to-edge layout at the phone breakpoint', () => {
  const tabletBlock = readStyleRange('@media (max-width: 1179px) {', '@media (max-width: 520px) {');
  assert.doesNotMatch(tabletBlock, /\.deep-composer-wrap\s*{[\s\S]*?padding:\s*0\s*;/);
  assert.doesNotMatch(tabletBlock, /\.deep-composer\s*{[\s\S]*?width:\s*100%\s*;/);

  const phoneSearchStart = stylesSource.indexOf('@media (max-width: 520px) {');
  assert.notEqual(phoneSearchStart, -1, 'missing phone search marker');
  const phoneBlock = readStyleRange('@media (max-width: 620px) {', '.chat-model-switcher-overlay {', phoneSearchStart);
  assert.match(phoneBlock, /\.deep-composer-wrap\s*{[\s\S]*?position:\s*fixed\s*;[\s\S]*?padding:\s*0 0 calc\(var\(--chat-keyboard-inset\) \+ env\(safe-area-inset-bottom, 0px\)\)\s*;/);
  assert.match(phoneBlock, /\.deep-composer\s*{[\s\S]*?width:\s*100%\s*;/);
  assert.match(
    stylesSource,
    /\.deep-composer-wrap\s*\{\s*padding:\s*0 0 calc\(var\(--chat-keyboard-inset\) \+ env\(safe-area-inset-bottom, 0px\)\);[\s\S]*background:\s*color-mix\(in srgb, var\(--surface\) 86%, transparent\);[\s\S]*backdrop-filter:\s*blur\(24px\) saturate\(1\.08\);/
  );
  assert.match(
    stylesSource,
    /\.deep-composer\s*\{\s*justify-self:\s*stretch;\s*width:\s*100%;\s*max-width:\s*none;[\s\S]*border-right:\s*0;[\s\S]*border-left:\s*0;[\s\S]*background:\s*color-mix\(in srgb, var\(--surface\) 88%, transparent\);/
  );
});

test('ChatComposer constrains desktop content to the available width', () => {
  assert.match(stylesSource, /\.deep-composer-wrap\s*\{[\s\S]*box-sizing:\s*border-box;[\s\S]*max-width:\s*100%;[\s\S]*min-width:\s*0;/);
  assert.match(stylesSource, /\.deep-composer\s*\{[\s\S]*box-sizing:\s*border-box;[\s\S]*min-width:\s*0;[\s\S]*max-width:\s*100%;/);
  assert.match(stylesSource, /\.composer-actions\s*\{[\s\S]*min-width:\s*0;[\s\S]*max-width:\s*100%;/);
  assert.match(stylesSource, /\.preset-select,[\s\S]*\.model-quick-select,[\s\S]*\.model-switch-pill\s*\{\s*min-width:\s*0;/);
  assert.doesNotMatch(stylesSource, /@media \(min-width: 1180px\) \{[\s\S]*\.deep-chat-shell \.deep-composer-wrap\s*\{[\s\S]*position:\s*fixed;/);
  assert.doesNotMatch(stylesSource, /@media \(min-width: 1180px\) \{[\s\S]*\.deep-message-scroll::after\s*\{[\s\S]*var\(--chat-composer-height\)/);
  assert.match(stylesSource, /@media \(min-width: 1180px\) \{[\s\S]*\.deep-chat-shell:not\(\.sidebar-collapsed\)\s*\{[\s\S]*grid-template-rows:\s*minmax\(0, 1fr\);/);
});

test('ChatView ignores model switcher open events while sending', () => {
  assert.match(
    chatViewScript,
    /function openModelSwitcher\(\) {\s*if \(sending\.value\) {\s*return;\s*}\s*syncProviderModels\(\);\s*modelSwitcherOpen\.value = true;\s*}/
  );
});

test('ChatView routes preset selection through the guarded submit setter', () => {
  assert.match(chatViewScript, /submit, continueGeneration, stop,[\s\S]*setSelectedPresetId, toggleUseStream, toggleThinking, toggleImageGeneration/);
  assert.match(chatViewScript, /canSend, canContinueGeneration, canToggleThinking, canToggleImageGeneration/);
  assert.match(chatViewTemplate, /<ChatSettingsDrawer[\s\S]*:image-generation-enabled="imageGenerationEnabled"[\s\S]*:can-toggle-image-generation="canToggleImageGeneration"[\s\S]*@toggle-image-generation="toggleImageGeneration"/);
  assert.match(chatViewTemplate, /<ChatMessageItem[\s\S]*:can-continue="canContinueGeneration && latestMessage\?\.id === message\.id"[\s\S]*@continue-generation="continueGeneration"/);
  assert.match(chatViewTemplate, /@update:selected-preset-id="setSelectedPresetId"/);
  assert.doesNotMatch(chatViewTemplate, /<ChatComposer[\s\S]*:can-continue=/);
  assert.doesNotMatch(chatViewTemplate, /<ChatComposer[\s\S]*@continue-generation=/);
  assert.doesNotMatch(chatViewTemplate, /<ChatComposer[\s\S]*:image-generation-enabled=/);
  assert.doesNotMatch(chatViewTemplate, /<ChatComposer[\s\S]*@toggle-image-generation=/);
  assert.doesNotMatch(chatViewTemplate, /@update:selected-preset-id="\([^"]+\) => selectedPresetId =/);
});

test('ChatView wires composer quick model changes through the guarded model save path', () => {
  assert.match(chatViewTemplate, /:model-options="providerModels"/);
  assert.match(chatViewTemplate, /:model-saving="modelSwitcherSaving"/);
  assert.match(chatViewScript, /canSend, canContinueGeneration, canToggleThinking, canToggleImageGeneration, canUseStream, canAddAttachments, chatProviderCapabilities/);
  assert.match(chatViewTemplate, /:can-use-stream="canUseStream"/);
  assert.match(chatViewTemplate, /:can-add-attachments="canAddAttachments"/);
  assert.match(chatViewTemplate, /:model-capabilities="chatProviderCapabilities"/);
  assert.match(chatViewTemplate, /:current-model-supports-reasoning="Boolean\(chatProviderCapabilities\?\.reasoning\)"/);
  assert.match(chatViewTemplate, /@quick-model-change="saveQuickModel"/);
  assert.match(chatViewScript, /async function saveQuickModel\(model\)\s*{\s*if \(modelSwitcherSaving\.value\)/);
});

test('ChatView exposes chat failure recovery and world book match dialog entry', () => {
  assert.match(chatViewScript, /lastFailure, latestWorldBookMatches/);
  assert.match(chatViewScript, /restoreLastFailureInput, retryLastFailure, dismissLastFailure/);
  assert.match(chatViewScript, /const activeChatFailure = computed\(\(\) => \{[\s\S]*failure\?\.conversationId === props\.route\.params\.id/);
  assert.match(chatViewScript, /const worldBookMatchSummary = computed\(\(\) => \{[\s\S]*positionLabel: worldBookPositionLabel\(match\.position\)[\s\S]*roleLabel: worldBookRoleLabel\(match\.role\)/);
  assert.match(chatViewScript, /const showWorldBookMatchSummary = computed\(\(\) => effectiveChatAppearance\.value\.showWorldBookMatches !== false\);/);
  assert.match(chatViewScript, /const worldBookMatchDialogOpen = ref\(false\);/);
  assert.match(chatViewScript, /function hasWorldBookMatchesForMessage\(message\) \{[\s\S]*latestAssistantMessage\.value\?\.id === message\.id[\s\S]*worldBookMatchSummary\.value\.length/);
  assert.match(chatViewScript, /function openWorldBookMatchDialog\(message\) \{[\s\S]*worldBookMatchDialogOpen\.value = true;/);
  assert.match(chatViewTemplate, /v-if="activeChatFailure"[\s\S]*class="chat-recovery-panel"/);
  assert.match(chatViewTemplate, /@click="restoreFailureToComposer"/);
  assert.match(chatViewTemplate, /@click="retryFailureFromPanel"/);
  assert.match(chatViewTemplate, /@click="openModelSwitcher"/);
  assert.match(chatViewTemplate, /@click="emit\('navigate', 'settings'\)"/);
  assert.match(chatViewTemplate, /:world-book-match-count="hasWorldBookMatchesForMessage\(message\) \? worldBookMatchSummary\.length : 0"/);
  assert.match(chatViewTemplate, /@open-worldbook-matches="openWorldBookMatchDialog"/);
  assert.match(chatViewTemplate, /v-if="worldBookMatchDialogOpen && showWorldBookMatchSummary && worldBookMatchSummary\.length"[\s\S]*class="chat-worldbook-match-overlay"/);
  assert.match(chatViewTemplate, /class="chat-worldbook-match-dialog"[\s\S]*role="dialog"[\s\S]*aria-modal="true"/);
  assert.match(chatViewTemplate, /class="chat-worldbook-match-list"[\s\S]*v-for="match in worldBookMatchSummary"/);
  assert.match(chatViewTemplate, /本轮命中 \{\{ worldBookMatchSummary\.length \}\} 条世界书/);
  assert.doesNotMatch(chatViewTemplate, /class="chat-worldbook-explain"/);
  assert.doesNotMatch(chatViewScript, /handleWorldBookExplainToggle|scrollWorldBookExplainIntoView/);
  assert.match(chatViewStyle, /\.chat-worldbook-match-overlay\s*{/);
  assert.match(chatViewStyle, /\.chat-worldbook-match-dialog\s*{/);
  assert.match(chatViewStyle, /\.chat-worldbook-match-list li\s*{/);
});

test('ChatView composer layout work falls back when animation frames are unavailable', () => {
  assert.match(
    chatViewScript,
    /function scheduleChatFrame\(callback\) \{\s*if \(typeof requestAnimationFrame !== 'function'\) \{\s*callback\(\);\s*return null;\s*\}\s*return requestAnimationFrame\(callback\);\s*\}/
  );
  assert.match(
    chatViewScript,
    /function cancelChatFrame\(frameId\) \{\s*if \(frameId !== null && typeof cancelAnimationFrame === 'function'\) \{\s*cancelAnimationFrame\(frameId\);\s*\}\s*\}/
  );
  assert.match(chatViewScript, /autoSizingTextareaRafId = scheduleChatFrame\(\(\) =>/);
  assert.match(chatViewScript, /textareaResizeRafId = scheduleChatFrame\(\(\) =>/);
  assert.match(chatViewScript, /viewportLayoutRafId = scheduleChatFrame\(\(\) =>/);
  assert.match(chatViewScript, /composerDockRafId = scheduleChatFrame\(\(\) =>/);
  assert.doesNotMatch(chatViewScript, /= requestAnimationFrame\(\(\) =>/);
  assert.doesNotMatch(chatViewScript, /cancelAnimationFrame\((composerDockRafId|autoSizingTextareaRafId|viewportLayoutRafId|textareaResizeRafId)\)/);
});

test('ChatView requests mobile status bar collapse before assistant-reply anchoring', () => {
  assert.match(chatViewScript, /const statusBarCollapseRequest = ref\(0\)/);
  assert.match(chatViewScript, /function prepareExpandedStatusBarForSubmit\(\) {[\s\S]*aria-expanded'[\s\S]*const hasExpandedStatus = statusSummaryExpanded\.value \|\| statusBarExpanded;[\s\S]*hasExpandedStatus && chatViewportIsPhone\.value[\s\S]*statusSummaryExpanded\.value = false;[\s\S]*statusBarCollapseRequest\.value \+= 1;[\s\S]*return hasExpandedStatus;/);
  assert.match(chatViewScript, /prepareExpandedStatusBarForSubmit,/);
  assert.match(chatViewTemplate, /:collapse-request="statusBarCollapseRequest"/);
  assert.match(statusBarScript, /collapseRequest: \{\s*type: Number,\s*default: 0\s*\}/);
  assert.match(statusBarScript, /watch\(\(\) => props\.collapseRequest,[\s\S]*setCollapsed\(true\);[\s\S]*\}\);/);
});
