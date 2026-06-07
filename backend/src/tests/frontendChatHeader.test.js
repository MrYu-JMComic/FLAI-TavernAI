import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText, readVueBlock } from './frontendSfcTestUtils.js';

const chatHeaderSource = readRepoText('frontend/src/components/chat/ChatHeader.vue');
const chatViewSource = readRepoText('frontend/src/views/ChatView.vue');
const chatConversationSource = readRepoText('frontend/src/composables/chat/useChatConversation.js');

test('ChatHeader locks conversation panel actions until the conversation is ready', () => {
  const scriptSetup = readVueBlock(chatHeaderSource, 'script');
  const template = readVueBlock(chatHeaderSource, 'template');
  const chatViewTemplate = readVueBlock(chatViewSource, 'template');

  assert.match(scriptSetup, /conversationReady: \{ type: Boolean, default: false \}/);
  assert.match(chatViewTemplate, /:conversation-ready="conversationReady"/);
  assert.match(chatConversationSource, /const conversationReady = computed\(\(\) => Boolean\(conversation\.value\?\.id\) && !loading\.value\)/);
  assert.match(
    chatConversationSource,
    /function openSavePanel\(\)\s*{\s*if \(!conversationReady\.value\) {\s*return;\s*}/
  );
  assert.match(
    chatConversationSource,
    /async function openNpcPanel\(\)\s*{\s*if \(conversationDisposed \|\| !conversationReady\.value\) {\s*return;\s*}/
  );
  assert.match(
    chatConversationSource,
    /function openEconomyPanel\(\)\s*{\s*if \(!conversationReady\.value\) {\s*return;\s*}/
  );
  assert.equal((template.match(/:disabled="!conversationReady"/g) || []).length, 3);
  assert.equal((template.match(/:aria-busy="!conversationReady"/g) || []).length, 3);
});
