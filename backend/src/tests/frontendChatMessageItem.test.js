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
  assert.match(chatViewScript, /canEditMessage, canDeleteMessage, canBranchMessage,/);
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
