import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText, readVueBlock } from './frontendSfcTestUtils.js';

const { useChatAppearance } = await import('../../../frontend/src/composables/chat/useChatAppearance.js');

const chatAppearanceSource = readRepoText('frontend/src/composables/chat/useChatAppearance.js');
const chatViewSource = readRepoText('frontend/src/views/ChatView.vue');

function sourceBetween(startMarker, endMarker) {
  const start = chatAppearanceSource.indexOf(startMarker);
  const end = chatAppearanceSource.indexOf(endMarker, start + startMarker.length);

  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);

  return chatAppearanceSource.slice(start, end);
}

test('chat appearance background mutations ignore saving events before invalidating upload tokens', () => {
  const uploadHandler = sourceBetween(
    'async function handleAppearanceBackgroundUpload',
    'function clearAppearanceField'
  );
  const clearHandler = sourceBetween(
    'function clearAppearanceField',
    'function handleSettingsBackgroundUpload'
  );

  assert.match(
    uploadHandler,
    /if \(input\) \{\s*input\.value = '';\s*\}\s*if \(appearanceDisposed \|\| appearanceSaving\.value \|\| !file\) \{\s*return;\s*\}\s*const uploadToken = nextBackgroundUploadToken\(field\);/
  );
  assert.doesNotMatch(
    uploadHandler,
    /const uploadToken = nextBackgroundUploadToken\(field\);\s*if \(appearanceDisposed \|\| appearanceSaving\.value \|\| !file\)/
  );
  assert.match(
    clearHandler,
    /if \(appearanceDisposed \|\| appearanceSaving\.value\) \{\s*return;\s*\}\s*nextBackgroundUploadToken\(field\);/
  );
});

test('chat lorebook updates ignore saving events through the composable entry point', () => {
  const chat = useChatAppearance({
    conversation: { value: { id: 'conv-1', chatLorebookId: 'book-original' } },
    characters: { value: [] },
    chatShellRef: { value: null },
    messageScroller: { value: null },
    composerWrap: { value: null },
    composerTextarea: { value: null },
    user: { value: null },
    provider: { value: null },
    messages: { value: [] },
    notify: { warning() {} },
    openSidebar() {},
    closeSidebar() {},
    openSettings() {},
    closeSettings() {},
    scrollToBottom() {},
    showActionNotice() {},
    showError() {}
  });

  chat.syncConversationAppearance({ chatLorebookId: 'book-original' });
  chat.appearanceSaving.value = true;
  chat.setChatLorebookId('book-during-save');
  assert.equal(chat.chatLorebookId.value, 'book-original');

  chat.appearanceSaving.value = false;
  chat.setChatLorebookId('book-after-save');
  assert.equal(chat.chatLorebookId.value, 'book-after-save');
  chat.setChatLorebookId('');
  assert.equal(chat.chatLorebookId.value, null);
});

test('chat appearance reset ignores saving events through the composable entry point', () => {
  const chat = useChatAppearance({
    conversation: { value: { id: 'conv-1', chatLorebookId: 'book-original' } },
    characters: { value: [] },
    chatShellRef: { value: null },
    messageScroller: { value: null },
    composerWrap: { value: null },
    composerTextarea: { value: null },
    user: { value: null },
    provider: { value: null },
    messages: { value: [] },
    notify: { warning() {} },
    openSidebar() {},
    closeSidebar() {},
    openSettings() {},
    closeSettings() {},
    scrollToBottom() {},
    showActionNotice() {},
    showError() {}
  });

  chat.syncConversationAppearance({ customCss: '.original {}', chatLorebookId: 'book-original' });
  chat.chatAppearanceForm.customCss = '.draft {}';
  chat.chatLorebookId.value = 'book-draft';
  chat.appearanceSaving.value = true;

  chat.resetConversationAppearance({ customCss: '.server {}', chatLorebookId: 'book-server' });
  assert.equal(chat.chatAppearanceForm.customCss, '.draft {}');
  assert.equal(chat.chatLorebookId.value, 'book-draft');

  chat.appearanceSaving.value = false;
  chat.resetConversationAppearance({ customCss: '.server {}', chatLorebookId: 'book-server' });
  assert.equal(chat.chatAppearanceForm.customCss, '.server {}');
  assert.equal(chat.chatLorebookId.value, 'book-server');
});

test('ChatView routes chat appearance reset and lorebook updates through guarded setters', () => {
  const scriptSetup = readVueBlock(chatViewSource, 'script');
  const template = readVueBlock(chatViewSource, 'template');

  assert.match(scriptSetup, /syncConversationAppearance, resetConversationAppearance, saveConversationAppearanceChanges/);
  assert.match(scriptSetup, /setChatLorebookId, applyConversationAppearance/);
  assert.match(template, /@reset-appearance="resetConversationAppearance\(conversation\?\.settings\)"/);
  assert.match(template, /@update:chat-lorebook-id="setChatLorebookId"/);
  assert.doesNotMatch(template, /@reset-appearance="syncConversationAppearance/);
  assert.doesNotMatch(template, /@update:chat-lorebook-id="\([^"]+\) => chatLorebookId =/);
});
