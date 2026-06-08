import assert from 'node:assert/strict';
import test from 'node:test';
import { readFrontendStyles, readRepoText, readVueBlocks } from './frontendSfcTestUtils.js';

const { script: chatSidebarScript, template: chatSidebarTemplate } = readVueBlocks(
  'frontend/src/components/chat/ChatSidebar.vue'
);
const { script: chatViewScript, template: chatViewTemplate } = readVueBlocks('frontend/src/views/ChatView.vue');
const chatConversationSource = readRepoText('frontend/src/composables/chat/useChatConversation.js');
const stylesSource = readFrontendStyles();
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

test('ChatSidebar search input tolerates missing event targets', () => {
  assert.match(
    chatSidebarScript,
    /function onHistorySearchInput\(event\) {\s*const target = event\?\.target;\s*if \(!target \|\| target\.value === undefined\) {\s*return;\s*}\s*emit\('update:historySearch', target\.value\);\s*}/
  );
  assert.match(chatSidebarTemplate, /@input="onHistorySearchInput"/);
  assert.doesNotMatch(chatSidebarTemplate, /\$event\.target\.value/);
});

test('ChatSidebar open conversation handler guards blank or stale ids', () => {
  assert.match(
    chatConversationSource,
    /const navigationId = normalizeConversationSelectionId\(conversationId\);\s*if \(!navigationId\) {\s*return;\s*}/
  );
  assert.match(
    chatConversationSource,
    /if \(!hasConversationListItem\(navigationId\)\) {\s*return;\s*}/
  );
  assert.match(
    chatConversationSource,
    /function hasConversationListItem\(conversationId\) \{\s*const targetId = normalizeConversationSelectionId\(conversationId\);[\s\S]*if \(!targetId\) \{[\s\S]*return false;[\s\S]*const currentConversations = Array\.isArray\(conversations\.value\) \? conversations\.value : \[\];[\s\S]*for \(const item of currentConversations\) \{[\s\S]*if \(item\?\.id === targetId\) \{[\s\S]*return true;[\s\S]*return false;[\s\S]*\}/
  );
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
  chat.conversations.value = [
    { id: 'conv-current', title: 'Current', character: { name: 'Current' }, usage: {} },
    { id: 'conv-next', title: 'Next', character: { name: 'Next' }, usage: {} }
  ];
  chat.conversationActionBusy.value = true;

  chat.openConversation('conv-next');

  assert.deepEqual(emissions, []);
  assert.equal(chat.sidebarOpen.value, true);

  chat.conversationActionBusy.value = false;
  chat.openConversation('conv-next');

  assert.deepEqual(emissions, [['navigate', 'chat', { id: 'conv-next' }]]);
  assert.equal(chat.sidebarOpen.value, false);
});

test('chat conversation open events ignore blank or stale conversation ids', () => {
  const emissions = [];
  const chat = useChatConversation({
    route: { params: { id: 'conv-current' } },
    emit(...args) {
      emissions.push(args);
    },
    showError() {}
  });

  chat.conversations.value = [
    { id: 'conv-current', title: 'Current', character: { name: 'Current' }, usage: {} },
    { id: 'conv-next', title: 'Next', character: { name: 'Next' }, usage: {} }
  ];
  chat.sidebarOpen.value = true;

  chat.openConversation('');
  chat.openConversation(null);
  chat.openConversation('conv-stale');

  assert.deepEqual(emissions, []);
  assert.equal(chat.sidebarOpen.value, true);

  chat.openConversation('conv-current');

  assert.deepEqual(emissions, []);
  assert.equal(chat.sidebarOpen.value, false);

  chat.sidebarOpen.value = true;
  chat.openConversation(' conv-next ');

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

test('ChatSidebar reload action uses the guarded manual reload path', () => {
  assert.match(
    chatSidebarTemplate,
    /<button\s+class="history-tool-button"\s+type="button"\s+:disabled="sidebarLoading \|\| conversationActionBusy \|\| startConversationBusy"\s+:aria-busy="sidebarLoading"\s+@click="emit\('reload-sidebar'\)"/
  );
  assert.match(
    chatConversationSource,
    /async function reloadSidebarData\(\) {\s*if \(conversationDisposed \|\| sidebarLoading\.value \|\| conversationActionBusy\.value \|\| startConversationBusy\.value\) {\s*return;\s*}/
  );
  assert.match(chatViewScript, /loadSidebarData, reloadSidebarData, startNewConversation, openConversation,/);
  assert.match(chatViewTemplate, /@reload-sidebar="reloadSidebarData"/);
});
