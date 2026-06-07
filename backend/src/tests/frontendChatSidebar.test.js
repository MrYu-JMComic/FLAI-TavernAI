import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText, readVueBlocks } from './frontendSfcTestUtils.js';

const { template: chatSidebarTemplate } = readVueBlocks(
  'frontend/src/components/chat/ChatSidebar.vue',
  ['template']
);
const chatConversationSource = readRepoText('frontend/src/composables/chat/useChatConversation.js');
const stylesSource = readRepoText('frontend/src/styles.css');
const { useChatConversation } = await import('../../../frontend/src/composables/chat/useChatConversation.js');

test('ChatSidebar locks conversation open rows while conversation actions are busy', () => {
  assert.match(
    chatSidebarTemplate,
    /<button\s+class="history-item"\s+type="button"\s+:disabled="conversationActionBusy"\s+:aria-busy="conversationActionBusy"\s+@click="emit\('open-conversation', item\.id\)"/
  );
  assert.match(
    chatConversationSource,
    /function openConversation\(conversationId\) {\s*if \(conversationDisposed \|\| conversationActionBusy\.value\) {\s*return;\s*}/
  );
  assert.match(stylesSource, /\.history-item:disabled\s*{\s*cursor: not-allowed;\s*opacity: 0\.55;\s*}/);
});

test('chat conversation open events are ignored while conversation actions are busy', () => {
  const emissions = [];
  const chat = useChatConversation({
    route: { params: { id: 'conv-current' } },
    emit(...args) {
      emissions.push(args);
    },
    showError() {}
  });

  chat.sidebarOpen.value = true;
  chat.conversationActionBusy.value = true;

  chat.openConversation('conv-next');

  assert.deepEqual(emissions, []);
  assert.equal(chat.sidebarOpen.value, true);

  chat.conversationActionBusy.value = false;
  chat.openConversation('conv-next');

  assert.deepEqual(emissions, [['navigate', 'chat', { id: 'conv-next' }]]);
  assert.equal(chat.sidebarOpen.value, false);
});

test('ChatSidebar locks new-chat creation while conversation actions are busy', async () => {
  assert.match(
    chatSidebarTemplate,
    /class="new-chat-button"[\s\S]*:disabled="startConversationBusy \|\| conversationActionBusy"[\s\S]*:aria-busy="startConversationBusy \|\| conversationActionBusy"[\s\S]*@click="emit\('start-new'\)"/
  );
  assert.match(
    chatConversationSource,
    /async function startNewConversation\(\) {\s*if \(conversationDisposed \|\| startConversationBusy\.value \|\| conversationActionBusy\.value\) {\s*return;\s*}/
  );

  const emissions = [];
  const chat = useChatConversation({
    route: { params: { id: 'conv-current' } },
    emit(...args) {
      emissions.push(args);
    },
    showError() {}
  });

  chat.conversation.value = { id: 'conv-current', characterId: 'char-current' };
  chat.conversationActionBusy.value = true;

  await chat.startNewConversation();

  assert.deepEqual(emissions, []);
  assert.equal(chat.startConversationBusy.value, false);
});
