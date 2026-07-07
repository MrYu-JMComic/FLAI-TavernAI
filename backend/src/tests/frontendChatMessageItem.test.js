import assert from 'node:assert/strict';
import test from 'node:test';
import { readFrontendStyles, readRepoText, readVueBlocks } from './frontendSfcTestUtils.js';

const { script: chatMessageItemScript, template: chatMessageItemTemplate } = readVueBlocks(
  'frontend/src/components/chat/ChatMessageItem.vue'
);
const { script: chatViewScript, template: chatViewTemplate } = readVueBlocks('frontend/src/views/ChatView.vue');
const chatMessageActionsSource = readRepoText('frontend/src/composables/chat/useChatMessageActions.js');
const stylesSource = readFrontendStyles();

test('ChatMessageItem freezes the edit box while a message action is busy', () => {
  assert.match(chatMessageItemScript, /messageActionBusy: \{ type: Boolean, default: false \}/);
  assert.match(chatViewTemplate, /:message-action-busy="messageActionBusy === message\.id \|\| branchBusy"/);
  assert.match(chatViewTemplate, /@update:editing-message-content="setEditingMessageContent"/);
  assert.match(chatMessageItemTemplate, /<div v-if="editingMessageId === message\.id" class="message-edit-box" :aria-busy="messageActionBusy">/);
  assert.match(chatMessageItemTemplate, /<textarea[\s\S]*:disabled="messageActionBusy"[\s\S]*@input="onEditingMessageInput"/);
  assert.match(
    chatMessageItemTemplate,
    /<button type="button" class="message-action-button primary" :disabled="messageActionBusy" :aria-busy="messageActionBusy" @click="emit\('save-edit', message\)">/
  );
  assert.match(
    chatMessageItemTemplate,
    /<button type="button" class="message-action-button" :disabled="messageActionBusy" @click="emit\('cancel-edit', message\)">/
  );
  assert.match(
    chatMessageActionsSource,
    /async function cancelEditMessage\(message = null\) \{\s*if \(isMessageMutationLocked\(\)\) \{/
  );
  assert.match(
    chatMessageActionsSource,
    /function setEditingMessageContent\(value\) \{\s*if \(isMessageMutationLocked\(\)\) \{/
  );
});

test('ChatMessageItem wires edit-and-rerun through the chat orchestration layer', () => {
  assert.match(chatMessageItemScript, /RotateCcw,/);
  assert.match(chatMessageItemScript, /canRerunEdit: \{ type: Boolean, default: false \}/);
  assert.match(chatMessageItemScript, /'save-edit-rerun',/);
  assert.match(
    chatMessageItemTemplate,
    /v-if="canRerunEdit"[\s\S]*class="message-action-button primary"[\s\S]*@click="emit\('save-edit-rerun', message\)"[\s\S]*<RotateCcw :size="15" \/>[\s\S]*<span>保存并重跑<\/span>/
  );
  assert.match(chatViewScript, /canEditMessage, canDeleteMessage, canRerunMessageEdit, canBranchMessage,/);
  assert.match(chatViewScript, /setEditingMessageContent, saveMessageEdit, prepareMessageEditRerun, removeMessage, copyMessage,/);
  assert.match(chatViewScript, /submitDraft, submit, continueGeneration, stop, restoreLastFailureInput, retryLastFailure, dismissLastFailure,/);
  assert.match(chatViewScript, /const composerHasDraft = computed\(\(\) => Boolean\(input\.value\.trim\(\) \|\| chatAttachments\.value\.length\)\);/);
  assert.match(
    chatViewScript,
    /function canSaveMessageEditAndRerun\(message\) \{[\s\S]*canRerunMessageEdit\(message\)[\s\S]*!sending\.value[\s\S]*!attachmentBusy\.value;[\s\S]*}/
  );
  assert.match(
    chatViewScript,
    /async function saveMessageEditAndRerun\(message\) \{[\s\S]*if \(composerHasDraft\.value\) \{[\s\S]*请先处理输入框草稿后再重跑[\s\S]*const draft = await prepareMessageEditRerun\(message\);[\s\S]*await submitDraft\(draft\.content, draft\.attachments\);/
  );
  assert.match(chatViewTemplate, /:can-rerun-edit="canSaveMessageEditAndRerun\(message\)"/);
  assert.match(chatViewTemplate, /@save-edit-rerun="saveMessageEditAndRerun"/);
  assert.match(
    chatMessageActionsSource,
    /function canRerunMessageEdit\(message\) \{\s*return message\?\.role === 'user' && canEditMessage\(message\);/
  );
  assert.match(
    chatMessageActionsSource,
    /async function prepareMessageEditRerun\(message\) \{[\s\S]*const tailMessageIds = collectPersistedMessageIdsFrom\(messageId\);[\s\S]*for \(let index = tailMessageIds\.length - 1; index >= 0; index -= 1\) {[\s\S]*await deleteMessage\(conversationId, targetId\);[\s\S]*return \{ content, attachments \};/
  );
});

test('ChatMessageItem binds continue generation to the latest message row', () => {
  assert.match(chatMessageItemScript, /StepForward,/);
  assert.match(chatMessageItemScript, /canContinue: \{ type: Boolean, default: false \}/);
  assert.match(chatMessageItemScript, /'continue-generation',/);
  assert.match(
    chatMessageItemTemplate,
    /v-if="canContinue"[\s\S]*class="message-action-button primary continue-message-button"[\s\S]*aria-label="继续生成"[\s\S]*@click="emitMessageAction\('continue-generation'\)"[\s\S]*<StepForward :size="14" \/>[\s\S]*<span>继续<\/span>/
  );
  assert.match(
    chatViewScript,
    /const latestMessage = computed\(\(\) => \{\s*const messageList = Array\.isArray\(messages\.value\) \? messages\.value : \[\];\s*for \(let index = messageList\.length - 1; index >= 0; index -= 1\) \{[\s\S]*if \(message\?\.id\) \{[\s\S]*return message;[\s\S]*return null;\s*\}\);/
  );
  assert.match(chatViewTemplate, /:can-continue="canContinueGeneration && latestMessage\?\.id === message\.id"/);
  assert.match(chatViewTemplate, /@continue-generation="continueGeneration"/);
  assert.doesNotMatch(chatViewTemplate, /<ChatComposer[\s\S]*@continue-generation=/);
});

test('ChatMessageItem edit input tolerates missing event targets', () => {
  assert.match(
    chatMessageItemScript,
    /function onEditingMessageInput\(event\) {\s*const target = event\?\.target;\s*if \(!target \|\| target\.value === undefined\) {\s*return;\s*}\s*emit\('update:editingMessageContent', target\.value\);\s*}/
  );
  assert.match(chatMessageItemTemplate, /@input="onEditingMessageInput"/);
  assert.doesNotMatch(chatMessageItemTemplate, /\$event\.target\.value/);
});

test('ChatMessageItem locks copy action while clipboard work is busy', () => {
  assert.match(chatMessageItemScript, /copyBusy: \{ type: Boolean, default: false \}/);
  assert.match(chatViewScript, /editingMessageId, editingMessageContent, messageActionBusy, copyBusy,/);
  assert.match(chatViewTemplate, /:copy-busy="copyBusy"/);
  assert.match(
    chatMessageItemTemplate,
    /<button[\s\S]*title="复制消息"[\s\S]*:disabled="copyBusy"[\s\S]*:aria-busy="copyBusy"[\s\S]*@click="emitMessageAction\('copy'\)"/
  );
  assert.match(chatMessageActionsSource, /const copyBusy = ref\(false\);/);
  assert.match(
    chatMessageActionsSource,
    /async function copyMessage\(message\) \{\s*if \(copyBusy\.value\) \{/
  );
  assert.match(
    chatMessageActionsSource,
    /function isCurrentCopyAction\(actionToken\) \{\s*return !disposed && actionToken === copyActionToken;/
  );
  assert.match(chatMessageActionsSource, /onCopyFallback,/);
  assert.match(chatMessageActionsSource, /function applyCopyFallback\(text\) \{[\s\S]*return onCopyFallback\(text\) === true;/);
  assert.match(chatViewScript, /onCopyFallback: appendCopyFallbackToComposer/);
  assert.match(
    chatViewScript,
    /function appendCopyFallbackToComposer\(text\) \{[\s\S]*input\.value = current \+ sep \+ normalizedText;[\s\S]*scheduleComposerLayoutUpdate\(\{ focus: true \}\);[\s\S]*return true;/
  );
});

test('ChatMessageItem keeps message actions directly visible without a folded mobile menu', () => {
  assert.match(chatMessageItemScript, /import \{ computed, nextTick, ref, watch \} from 'vue';/);
  assert.doesNotMatch(chatMessageItemScript, /actionMenu/);
  assert.doesNotMatch(chatMessageItemScript, /MoreHorizontal/);
  assert.match(
    chatMessageItemScript,
    /function emitMessageAction\(eventName\) \{\s*emit\(eventName, props\.message\);\s*\}/
  );
  assert.match(chatMessageItemTemplate, /<div class="message-actions" :class="message\.role">/);
  assert.match(chatMessageItemTemplate, /<div class="message-action-list" role="group" aria-label="消息操作">/);
  assert.doesNotMatch(chatMessageItemTemplate, /message-action-menu-toggle/);
  assert.doesNotMatch(chatMessageItemTemplate, /is-menu-open/);
  assert.doesNotMatch(chatMessageItemTemplate, /aria-expanded="String\(actionMenuOpen\)"/);
  assert.match(
    stylesSource,
    /\.message-action-list\s*{\s*display:\s*flex;[\s\S]*flex-wrap:\s*wrap;/
  );
  assert.doesNotMatch(stylesSource, /message-action-menu-toggle/);
  assert.doesNotMatch(stylesSource, /message-actions\.is-menu-open/);
  assert.doesNotMatch(stylesSource, /\.message-action-list\s*{\s*display:\s*none;/);
});

test('ChatMessageItem focuses the edit textarea when edit mode opens', () => {
  assert.match(chatMessageItemScript, /const editTextareaRef = ref\(null\);/);
  assert.match(chatMessageItemTemplate, /<textarea[\s\S]*ref="editTextareaRef"[\s\S]*aria-label="编辑消息内容"/);
  assert.match(
    chatMessageItemScript,
    /watch\(isEditingCurrentMessage, async \(active\) => \{[\s\S]*await nextTick\(\);[\s\S]*editTextareaRef\.value\?\.focus\?\.\(\);[\s\S]*\}\);/
  );
});

test('ChatMessageItem defers Markdown rendering only while a message is typing', () => {
  assert.match(chatMessageItemScript, /isReasoningTyping: \{ type: Boolean, default: false \}/);
  assert.match(chatMessageItemScript, /isContentTyping: \{ type: Boolean, default: false \}/);
  assert.match(
    chatMessageItemTemplate,
    /<MarkdownContent class="typing-text" :text="message\.reasoning" :render-plugins="renderPlugins" :defer-updates="isReasoningTyping" \/>/
  );
  assert.match(
    chatMessageItemTemplate,
    /<MarkdownContent[\s\S]*:text="message\.content \|\| messagePlaceholder"[\s\S]*:render-plugins="renderPlugins"[\s\S]*:defer-updates="isContentTyping"[\s\S]*\/>/
  );
  assert.doesNotMatch(chatMessageItemTemplate, /:defer-updates="true"/);
});

test('ChatMessageItem renders persisted asset URL attachments', () => {
  assert.match(chatMessageItemScript, /const url = String\(attachment\?\.url \|\| attachment\?\.dataUrl \|\| ''\)\.trim\(\);/);
  assert.match(chatMessageItemScript, /id: String\(attachment\.id \|\| url\.slice\(0, 48\)\),/);
  assert.match(chatMessageItemTemplate, /:href="attachment\.url"/);
  assert.match(chatMessageItemTemplate, /<img :src="attachment\.url" :alt="attachment\.alt" \/>/);
});

test('ChatMessageItem locks swipe navigation while a swipe is loading', () => {
  assert.match(chatViewTemplate, /:swipe-loading="swipeLoading\.has\(message\.id\) \|\| messageActionBusy === message\.id \|\| branchBusy"/);
  assert.match(chatMessageItemTemplate, /:disabled="!swipeCanPrev \|\| swipeLoading"/);
  assert.match(chatMessageItemTemplate, /:disabled="!swipeCanNext \|\| swipeLoading"/);
  assert.match(chatMessageItemTemplate, /:aria-busy="swipeLoading"/);
  assert.match(
    chatMessageActionsSource,
    /function isSwipeActionLocked\(messageId\) \{\s*const stateId = normalizeMessageUiId\(messageId\);\s*return Boolean\(messageActionBusy\.value \|\| branchBusy\.value \|\| swipeLoading\.value\.has\(stateId\)\);/
  );
  assert.match(chatMessageActionsSource, /const target = getCurrentSwipeTarget\(message\);\s*if \(!target \|\| isSwipeActionLocked\(target\.messageId\)\) return;/);
});

test('ChatMessageItem disables branch creation for messages that cannot be branched', () => {
  assert.match(chatMessageItemScript, /branchCan: \{ type: Boolean, default: true \}/);
  assert.match(chatViewScript, /canEditMessage, canDeleteMessage, canRerunMessageEdit, canBranchMessage,/);
  assert.match(chatViewTemplate, /:branch-can="canBranchMessage\(message\)"/);
  assert.match(chatMessageItemTemplate, /:disabled="!branchCan \|\| branchBusy"/);
  assert.match(
    chatMessageActionsSource,
    /function canBranchMessage\(message\) \{\s*return canPersistMessage\(message\) && !isMessageMutationLocked\(\);/
  );
  assert.match(
    chatMessageActionsSource,
    /async function handleBranchMessage\(message, conversationId, onBranched\) \{\s*if \(disposed \|\| !conversationId \|\| !canBranchMessage\(message\)\) \{/
  );
});

test('ChatMessageItem locks edit and delete actions while a branch action is busy', () => {
  assert.match(
    chatMessageActionsSource,
    /function isMessageMutationLocked\(\) \{\s*return Boolean\(messageActionBusy\.value \|\| branchBusy\.value\);/
  );
  assert.match(
    chatMessageActionsSource,
    /function canEditMessage\(message\) \{\s*return canPersistMessage\(message\) && !isMessageMutationLocked\(\);/
  );
  assert.match(
    chatMessageActionsSource,
    /function canDeleteMessage\(message\) \{\s*return canPersistMessage\(message\) && !isMessageMutationLocked\(\);/
  );
  assert.match(chatViewTemplate, /:can-edit="canEditMessage\(message\)"/);
  assert.match(chatViewTemplate, /:can-delete="canDeleteMessage\(message\)"/);
  assert.match(chatViewTemplate, /:message-action-busy="messageActionBusy === message\.id \|\| branchBusy"/);
});
