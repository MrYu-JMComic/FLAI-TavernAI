import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText, readVueBlock } from './frontendSfcTestUtils.js';

const chatMessageItemSource = readRepoText('frontend/src/components/chat/ChatMessageItem.vue');
const chatViewSource = readRepoText('frontend/src/views/ChatView.vue');
const chatMessageActionsSource = readRepoText('frontend/src/composables/chat/useChatMessageActions.js');

test('ChatMessageItem freezes the edit box while a message action is busy', () => {
  const scriptSetup = readVueBlock(chatMessageItemSource, 'script');
  const template = readVueBlock(chatMessageItemSource, 'template');
  const chatViewTemplate = readVueBlock(chatViewSource, 'template');

  assert.match(scriptSetup, /messageActionBusy: \{ type: Boolean, default: false \}/);
  assert.match(chatViewTemplate, /:message-action-busy="messageActionBusy === message\.id"/);
  assert.match(chatViewTemplate, /@update:editing-message-content="setEditingMessageContent"/);
  assert.match(template, /<div v-if="editingMessageId === message\.id" class="message-edit-box" :aria-busy="messageActionBusy">/);
  assert.match(template, /<textarea[\s\S]*:disabled="messageActionBusy"[\s\S]*@input="emit\('update:editingMessageContent', \$event\.target\.value\)"/);
  assert.match(
    template,
    /<button type="button" class="message-action-button primary" :disabled="messageActionBusy" :aria-busy="messageActionBusy" @click="emit\('save-edit', message\)">/
  );
  assert.match(
    template,
    /<button type="button" class="message-action-button" :disabled="messageActionBusy" @click="emit\('cancel-edit', message\)">/
  );
});

test('ChatMessageItem locks swipe navigation while a swipe is loading', () => {
  const template = readVueBlock(chatMessageItemSource, 'template');

  assert.match(template, /:disabled="!swipeCanPrev \|\| swipeLoading"/);
  assert.match(template, /:disabled="swipeLoading"/);
  assert.match(template, /:aria-busy="swipeLoading"/);
  assert.match(
    chatMessageActionsSource,
    /async function swipeMessagePrev\(message\)\s*{\s*if \(disposed\) return;\s*if \(swipeLoading\.value\.has\(message\.id\)\) return;/
  );
});
