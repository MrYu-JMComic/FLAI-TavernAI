import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText, readVueBlocks } from './frontendSfcTestUtils.js';

const { useChatAppearance } = await import('../../../frontend/src/composables/chat/useChatAppearance.js');
const { useChatConversation } = await import('../../../frontend/src/composables/chat/useChatConversation.js');

const chatAppearanceSource = readRepoText('frontend/src/composables/chat/useChatAppearance.js');
const { script: chatViewScript, template: chatViewTemplate } = readVueBlocks('frontend/src/views/ChatView.vue');

function sourceBetween(startMarker, endMarker) {
  const start = chatAppearanceSource.indexOf(startMarker);
  const end = chatAppearanceSource.indexOf(endMarker, start + startMarker.length);

  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);

  return chatAppearanceSource.slice(start, end);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function createAppearance(options = {}) {
  return useChatAppearance({
    conversation: options.conversation || { value: { id: 'conv-1', chatLorebookId: 'book-original' } },
    characters: options.characters || { value: [] },
    chatShellRef: options.chatShellRef || { value: null },
    messageScroller: { value: null },
    composerWrap: { value: null },
    composerTextarea: { value: null },
    user: { value: null },
    provider: { value: null },
    messages: { value: [] },
    notify: options.notify || { warning() {} },
    openSidebar: options.openSidebar || (() => {}),
    closeSidebar: options.closeSidebar || (() => {}),
    openSettings: options.openSettings || (() => {}),
    closeSettings: options.closeSettings || (() => {}),
    scrollToBottom() {},
    setActiveConversationIfChanged: options.setActiveConversationIfChanged,
    showActionNotice: options.showActionNotice || (() => {}),
    showError: options.showError || (() => {})
  });
}

test('chat appearance caches active character and render plugin lookups', () => {
  const renderPlugins = [
    {
      label: 'Fold profile',
      type: 'fold',
      pattern: '^Profile$',
      flags: 'u',
      enabled: true
    }
  ];
  const conversation = { value: { id: 'conv-1', characterId: 'char-1' } };
  const characters = {
    value: [
      { id: 'char-1', name: 'Alice', renderPlugins },
      { id: 'char-2', name: 'Bob', renderPlugins: [] }
    ]
  };
  const chat = createAppearance({ conversation, characters });

  assert.equal(chat.activeCharacter(), characters.value[0]);
  assert.equal(chat.activeRenderPlugins(), renderPlugins);

  const inlineConversation = { value: {
    id: 'conv-1',
    characterId: 'char-2',
    character: { id: 'char-inline', name: 'Inline', renderPlugins: [] }
  } };
  const inlineChat = createAppearance({ conversation: inlineConversation, characters });

  assert.equal(inlineChat.activeCharacter(), inlineConversation.value.character);
  assert.equal(inlineChat.activeRenderPlugins(), inlineConversation.value.character.renderPlugins);
});

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
  const chat = createAppearance();

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
  const chat = createAppearance();

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

test('chat appearance sync preserves local drafts for duplicate server snapshots', () => {
  const chat = createAppearance();
  const serverSettings = {
    customCss: '.server {}',
    statusBarPrompt: 'Server prompt',
    chatLorebookId: 'book-server'
  };

  assert.equal(chat.syncConversationAppearance(serverSettings), true);
  chat.chatAppearanceForm.customCss = '.draft {}';
  chat.chatLorebookId.value = 'book-draft';
  chat.customAppearanceState.value = { local: true };
  const customStateReference = chat.customAppearanceState.value;

  assert.equal(chat.syncConversationAppearance({
    chatLorebookId: 'book-server',
    statusBarPrompt: 'Server prompt',
    customCss: '.server {}'
  }), false);
  assert.equal(chat.chatAppearanceForm.customCss, '.draft {}');
  assert.equal(chat.chatLorebookId.value, 'book-draft');
  assert.equal(chat.customAppearanceState.value, customStateReference);

  chat.resetConversationAppearance(serverSettings);
  assert.equal(chat.chatAppearanceForm.customCss, '.server {}');
  assert.equal(chat.chatLorebookId.value, 'book-server');
  assert.notEqual(chat.customAppearanceState.value, customStateReference);
});

test('chat appearance save preserves active conversation references for unchanged settings', async () => {
  const originalFetch = globalThis.fetch;
  const normalizedAppearance = {
    desktopBackgroundUrl: '',
    mobileBackgroundUrl: '',
    customCss: '',
    customJs: '',
    statusBarPrompt: ''
  };
  const savedSettings = {
    ...normalizedAppearance,
    chatLorebookId: 'book-original'
  };
  const requests = [];

  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    const method = String(options.method || 'GET').toUpperCase();
    requests.push([requestUrl, method]);

    if (requestUrl === '/api/csrf-token') {
      return jsonResponse({ csrfToken: 'appearance-save-token' });
    }

    if (requestUrl === '/api/conversations/conv-1/settings' && method === 'PUT') {
      return jsonResponse(savedSettings);
    }

    return jsonResponse({ message: `Unexpected request: ${requestUrl}` }, 500);
  };

  try {
    const chat = useChatConversation({
      route: { params: { id: 'conv-1' } },
      emit() {},
      showError() {}
    });
    chat.setActiveConversationIfChanged({
      id: 'conv-1',
      chatLorebookId: 'book-original',
      settings: savedSettings,
      authorSettings: normalizedAppearance,
      userSettings: normalizedAppearance
    });
    const conversationReference = chat.conversation.value;
    const appearance = createAppearance({
      conversation: chat.conversation,
      setActiveConversationIfChanged: chat.setActiveConversationIfChanged
    });

    appearance.syncConversationAppearance(savedSettings);
    await appearance.saveConversationAppearanceChanges();

    assert.equal(chat.conversation.value, conversationReference);
    assert.equal(appearance.appearanceSaving.value, false);
    assert.deepEqual(requests, [
      ['/api/csrf-token', 'GET'],
      ['/api/conversations/conv-1/settings', 'PUT']
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chat custom script UI helpers ignore stale resumes after the active conversation changes', async () => {
  const originalWindow = globalThis.window;
  const timerCallbacks = [];
  const helperCalls = [];
  const shell = {
    style: {
      setProperty(name, value) {
        helperCalls.push(['setCssVar', name, value]);
      }
    },
    querySelector() {
      return null;
    }
  };
  const conversation = { value: { id: 'conv-1', chatLorebookId: 'book-original' } };

  globalThis.window = {
    setTimeout(callback) {
      timerCallbacks.push(callback);
      return timerCallbacks.length;
    }
  };

  try {
    const appearance = createAppearance({
      conversation,
      chatShellRef: { value: shell },
      notify: {
        warning(message) {
          helperCalls.push(['warning', message]);
        }
      },
      openSettings() {
        helperCalls.push(['openSettings']);
      },
      closeSidebar() {
        helperCalls.push(['closeSidebar']);
      }
    });
    appearance.chatAppearanceForm.customJs = `
      await wait(5);
      setCssVar('--stale-appearance', '1');
      openSettings();
      closeSidebar();
      notify.warning('stale script');
    `;

    const apply = appearance.applyConversationAppearance();
    assert.equal(timerCallbacks.length, 1);

    conversation.value = { id: 'conv-2', chatLorebookId: 'book-next' };
    timerCallbacks.shift()();
    await apply;

    assert.deepEqual(helperCalls, []);
  } finally {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('chat appearance world-book refresh preserves unchanged list references', async () => {
  const originalFetch = globalThis.fetch;
  const responses = [
    [
      {
        id: 'book-1',
        name: 'Main Lore',
        description: 'Shared world',
        characterId: null,
        scanDepth: 4,
        lorebookContextPercent: 25,
        entryCount: 2
      }
    ],
    [
      {
        lorebookContextPercent: 25,
        entryCount: 2,
        scanDepth: 4,
        characterId: null,
        description: 'Shared world',
        name: 'Main Lore',
        id: 'book-1'
      }
    ],
    [
      {
        id: 'book-1',
        name: 'Main Lore',
        description: 'Shared world',
        characterId: null,
        scanDepth: 4,
        lorebookContextPercent: 25,
        entryCount: 3
      }
    ]
  ];
  const requests = [];

  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    requests.push(requestUrl);

    if (requestUrl === '/api/world-books') {
      const payload = responses.shift();
      assert.ok(payload, 'unexpected world-book fetch');
      return jsonResponse(payload);
    }

    return jsonResponse({ message: `Unexpected request: ${requestUrl}` }, 500);
  };

  try {
    const chat = createAppearance();

    await chat.loadWorldBooks();
    const firstWorldBooks = chat.worldBooks.value;
    assert.equal(firstWorldBooks[0].entryCount, 2);

    await chat.loadWorldBooks();
    assert.equal(chat.worldBooks.value, firstWorldBooks);

    await chat.loadWorldBooks();
    assert.notEqual(chat.worldBooks.value, firstWorldBooks);
    assert.equal(chat.worldBooks.value[0].entryCount, 3);
    assert.deepEqual(requests, [
      '/api/world-books',
      '/api/world-books',
      '/api/world-books'
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ChatView routes chat appearance reset and lorebook updates through guarded setters', () => {
  assert.match(chatViewScript, /syncConversationAppearance, resetConversationAppearance, saveConversationAppearanceChanges/);
  assert.match(chatViewScript, /setChatLorebookId, applyConversationAppearance/);
  assert.match(chatViewScript, /setActiveConversationIfChanged,\s*showActionNotice, showError/);
  assert.match(chatViewTemplate, /@reset-appearance="resetConversationAppearance\(conversation\?\.settings\)"/);
  assert.match(chatViewTemplate, /@update:chat-lorebook-id="setChatLorebookId"/);
  assert.doesNotMatch(chatViewTemplate, /@reset-appearance="syncConversationAppearance/);
  assert.doesNotMatch(chatViewTemplate, /@update:chat-lorebook-id="\([^"]+\) => chatLorebookId =/);
});

test('ChatView passes cached render plugins to each message item', () => {
  assert.match(
    chatAppearanceSource,
    /const activeCharacterValue = computed\(\(\) => \{[\s\S]*const currentConversation = conversation\.value \|\| \{\};[\s\S]*const characterList = Array\.isArray\(characters\.value\) \? characters\.value : \[\];[\s\S]*for \(const item of characterList\) \{[\s\S]*if \(item\?\.id === characterId\) \{[\s\S]*return item;[\s\S]*return null;[\s\S]*\}\);/
  );
  assert.match(
    chatAppearanceSource,
    /const activeRenderPluginList = computed\(\(\) => activeCharacterValue\.value\?\.renderPlugins \|\| \[\]\);[\s\S]*function activeCharacter\(\) \{\s*return activeCharacterValue\.value;[\s\S]*function activeRenderPlugins\(\) \{\s*return activeRenderPluginList\.value;[\s\S]*}/
  );
  assert.match(chatViewScript, /const chatRenderPlugins = computed\(\(\) => activeRenderPlugins\(\)\);/);
  assert.match(chatViewTemplate, /:render-plugins="chatRenderPlugins"/);
  assert.doesNotMatch(chatViewTemplate, /:render-plugins="activeRenderPlugins\(\)"/);
  assert.doesNotMatch(chatAppearanceSource, /characters\.value\.find\(/);
});

test('chat appearance world-book refreshes use stable list updates', () => {
  assert.match(
    chatAppearanceSource,
    /const books = await fetchWorldBooks\(\);[\s\S]*setWorldBooksIfChanged\(books\);/
  );
  assert.match(
    chatAppearanceSource,
    /function setWorldBooksIfChanged\(nextBooks\) \{[\s\S]*sameWorldBookList\(worldBooks\.value, normalizedNextBooks\)[\s\S]*worldBooks\.value = normalizedNextBooks;[\s\S]*return true;[\s\S]*\}/
  );
  assert.doesNotMatch(chatAppearanceSource, /worldBooks\.value\s*=\s*books/);
});

test('chat custom script helpers are scoped to the active appearance apply', () => {
  const applyBody = sourceBetween(
    'async function applyConversationAppearance',
    'function isCurrentAppearanceSave'
  );

  assert.match(applyBody, /notify: scopedAppearanceNotify\(applyToken, conversationId\)/);
  assert.match(applyBody, /openSettings: scopedAppearanceAction\(applyToken, conversationId, openSettings\)/);
  assert.match(applyBody, /closeSidebar: scopedAppearanceAction\(applyToken, conversationId, closeSidebar\)/);
  assert.match(applyBody, /scrollToBottom: scopedAppearanceAction\(applyToken, conversationId, \(\) => scrollToBottom\(true, true\)\)/);
  assert.match(applyBody, /setCssVar: scopedAppearanceAction\(applyToken, conversationId, \(name, value\) => \{/);
  assert.match(chatAppearanceSource, /function scopedAppearanceAction\(applyToken, conversationId, action\)/);
  assert.match(chatAppearanceSource, /function scopedAppearanceNotify\(applyToken, conversationId\)/);
});
