import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText, readVueBlocks } from './frontendSfcTestUtils.js';

const { script: chatHeaderScript, template: chatHeaderTemplate } = readVueBlocks(
  'frontend/src/components/chat/ChatHeader.vue'
);
const { template: chatViewTemplate } = readVueBlocks('frontend/src/views/ChatView.vue', ['template']);
const chatConversationSource = readRepoText('frontend/src/composables/chat/useChatConversation.js');

test('ChatHeader locks conversation panel actions until the conversation is ready', () => {
  assert.match(chatHeaderScript, /conversationReady: \{ type: Boolean, default: false \}/);
  assert.match(chatViewTemplate, /:conversation-ready="conversationReady"/);
  assert.match(chatConversationSource, /const conversationReady = computed\(\(\) => Boolean\(conversation\.value\?\.id\) && !loading\.value\)/);
  assert.match(
    chatConversationSource,
    /function openSavePanel\(\)\s*{\s*if \(!conversationReady\.value\) {\s*return;\s*}/
  );
  assert.match(
    chatConversationSource,
    /async function openNpcPanel\(\)\s*{\s*const panelConversationId = conversation\.value\?\.id \|\| '';\s*if \(!isCurrentPanelConversation\(panelConversationId\)\) {\s*return;\s*}/
  );
  assert.match(
    chatConversationSource,
    /function isCurrentPanelConversation\(conversationId\) \{[\s\S]*&& conversationReady\.value[\s\S]*&& route\.params\.id === conversationId;/
  );
  assert.match(
    chatConversationSource,
    /function openEconomyPanel\(\)\s*{\s*if \(!conversationReady\.value\) {\s*return;\s*}/
  );
  assert.equal((chatHeaderTemplate.match(/:disabled="!conversationReady"/g) || []).length, 3);
  assert.equal((chatHeaderTemplate.match(/:aria-busy="!conversationReady"/g) || []).length, 3);
});
