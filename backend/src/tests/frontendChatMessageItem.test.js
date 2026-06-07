import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText, readVueBlocks } from './frontendSfcTestUtils.js';

const { script: chatMessageItemScript, template: chatMessageItemTemplate } = readVueBlocks(
  'frontend/src/components/chat/ChatMessageItem.vue'
);
const { template: chatViewTemplate } = readVueBlocks('frontend/src/views/ChatView.vue', ['template']);
const chatMessageActionsSource = readRepoText('frontend/src/composables/chat/useChatMessageActions.js');

test('ChatMessageItem freezes the edit box while a message action is busy', () => {
  assert.match(chatMessageItemScript, /messageActionBusy: \{ type: Boolean, default: false \}/);
  assert.match(chatViewTemplate, /:message-action-busy="messageActionBusy === message\.id"/);
  assert.match(chatViewTemplate, /@update:editing-message-content="setEditingMessageContent"/);
  assert.match(chatMessageItemTemplate, /<div v-if="editingMessageId === message\.id" class="message-edit-box" :aria-busy="messageActionBusy">/);
  assert.match(chatMessageItemTemplate, /<textarea[\s\S]*:disabled="messageActionBusy"[\s\S]*@input="emit\('update:editingMessageContent', \$event\.target\.value\)"/);
  assert.match(
    chatMessageItemTemplate,
    /<button type="button" class="message-action-button primary" :disabled="messageActionBusy" :aria-busy="messageActionBusy" @click="emit\('save-edit', message\)">/
  );
  assert.match(
    chatMessageItemTemplate,
    /<button type="button" class="message-action-button" :disabled="messageActionBusy" @click="emit\('cancel-edit', message\)">/
  );
});

test('ChatMessageItem locks swipe navigation while a swipe is loading', () => {
  assert.match(chatMessageItemTemplate, /:disabled="!swipeCanPrev \|\| swipeLoading"/);
  assert.match(chatMessageItemTemplate, /:disabled="swipeLoading"/);
  assert.match(chatMessageItemTemplate, /:aria-busy="swipeLoading"/);
  assert.match(
    chatMessageActionsSource,
    /async function swipeMessagePrev\(message\)\s*{\s*if \(disposed\) return;\s*if \(swipeLoading\.value\.has\(message\.id\)\) return;/
  );
});
