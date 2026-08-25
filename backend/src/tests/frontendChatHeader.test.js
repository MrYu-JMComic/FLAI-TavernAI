import assert from 'node:assert/strict';
import test from 'node:test';
import { readFrontendStyles, readRepoText, readVueBlocks } from './frontendSfcTestUtils.js';

const { script: chatHeaderScript, template: chatHeaderTemplate } = readVueBlocks(
  'frontend/src/components/chat/ChatHeader.vue'
);
const { template: chatViewTemplate } = readVueBlocks('frontend/src/views/ChatView.vue', ['template']);
const chatConversationSource = readRepoText('frontend/src/composables/chat/useChatConversation.js');
const stylesSource = readFrontendStyles();

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
  assert.match(chatHeaderTemplate, /<span>上下文检查器<\/span>/);
  assert.match(chatHeaderTemplate, /runMoreAction\('open-context', \$event\)/);
  assert.match(chatHeaderTemplate, /aria-label="角色状态"[\s\S]*:disabled="!conversationReady"/);
  assert.equal((chatHeaderTemplate.match(/:disabled="!conversationReady"/g) || []).length, 8);
  assert.equal((chatHeaderTemplate.match(/:aria-busy="!conversationReady"/g) || []).length, 0);
});

test('ChatHeader keeps NPC management reachable from the compact mobile tools menu', () => {
  assert.match(
    chatHeaderTemplate,
    /class="chat-header-overflow-tool"[\s\S]*runMoreAction\('open-npc', \$event\)[\s\S]*<span>NPC 管理<\/span>/
  );
  assert.match(
    stylesSource,
    /\.chat-header-more-menu \.chat-header-overflow-tool\s*\{\s*display:\s*none;\s*\}/
  );
  assert.match(
    stylesSource,
    /@media \(max-width: 900px\) \{[\s\S]*\.chat-header-more-menu \.chat-header-overflow-tool\s*\{\s*display:\s*flex;\s*\}/
  );
});

test('Chat mobile conversation history uses a full-height side drawer', () => {
  assert.match(
    stylesSource,
    /@media \(max-width: 620px\) \{[\s\S]*\.deep-chat-shell \.deep-sidebar\s*\{[\s\S]*width:\s*100vw;[\s\S]*height:\s*var\(--chat-visual-viewport-height, 100dvh\);[\s\S]*max-height:\s*none;[\s\S]*border-radius:\s*0;[\s\S]*overflow:\s*hidden;/
  );
  assert.match(
    stylesSource,
    /\.deep-chat-shell \.deep-sidebar::before\s*\{\s*content:\s*none;\s*\}/
  );
  assert.match(
    stylesSource,
    /\.deep-chat-shell\.sidebar-collapsed \.deep-sidebar,[\s\S]*transform:\s*translateX\(-100%\) !important;/
  );
});
