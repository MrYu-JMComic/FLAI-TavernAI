import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText, readVueBlocks } from './frontendSfcTestUtils.js';

test('scene workspace entry is allowed and mounted in ChatView', () => {
  const workspaceSource = readRepoText('frontend/src/composables/chat/useChatWorkspaceUi.js');
  const chatViewTemplate = readVueBlocks('frontend/src/views/ChatView.vue', ['template']).template;
  const headerTemplate = readVueBlocks('frontend/src/components/chat/ChatHeader.vue', ['template']).template;
  assert.match(workspaceSource, /['"]scene['"]/);
  assert.match(headerTemplate, /runMoreAction\('open-scene', \$event\)/);
  assert.match(chatViewTemplate, /<ScenePanel[\s\S]*activeTool === 'scene'/);
});
