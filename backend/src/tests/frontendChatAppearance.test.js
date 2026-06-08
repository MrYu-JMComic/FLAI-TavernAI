import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText, readVueBlocks } from './frontendSfcTestUtils.js';

const { useChatAppearance } = await import('../../../frontend/src/composables/chat/useChatAppearance.js');
const { useChatConversation } = await import('../../../frontend/src/composables/chat/useChatConversation.js');
const { buildScopedChatCss, mergeChatAppearance, runChatCustomScript } = await import('../../../frontend/src/utils/chatAppearance.js');

const chatAppearanceSource = readRepoText('frontend/src/composables/chat/useChatAppearance.js');
const chatAppearanceUtilsSource = readRepoText('frontend/src/utils/chatAppearance.js');
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

test('chat appearance merges layered text fields without filter arrays', () => {
  assert.deepEqual(
    mergeChatAppearance(
      {
        desktopBackgroundUrl: '/author.png',
        customCss: '.author {}',
        customJs: 'author();',
        statusBarPrompt: 'Author prompt'
      },
      {
        mobileBackgroundUrl: '/user-mobile.png',
        customCss: '.user {}',
        customJs: '',
        statusBarPrompt: 'User prompt'
      }
    ),
    {
      desktopBackgroundUrl: '/author.png',
      mobileBackgroundUrl: '/user-mobile.png',
      customCss: '.author {}\n\n.user {}',
      customJs: 'author();',
      statusBarPrompt: 'Author prompt\n\nUser prompt'
    }
  );
  assert.match(
    chatAppearanceUtilsSource,
    /function mergeAppearanceText\(authorText, userText\) \{[\s\S]*if \(authorText && userText\) \{[\s\S]*return `\$\{authorText\}\\n\\n\$\{userText\}`;[\s\S]*return authorText \|\| userText \|\| '';[\s\S]*\}/
  );
  assert.doesNotMatch(chatAppearanceUtilsSource, /\[authorSettings\.(?:customCss|customJs|statusBarPrompt), userSettings\.(?:customCss|customJs|statusBarPrompt)\]\.filter\(Boolean\)\.join/);
});

test('chat appearance scopes selector lists with a direct comma scanner', () => {
  assert.equal(
    buildScopedChatCss('.message:is(.sent, .failed), [data-label="HP, MP"], :root { color: red; }', '[data-chat-scope="conv"]'),
    '\n[data-chat-scope="conv"] .message:is(.sent, .failed), [data-chat-scope="conv"] [data-label="HP, MP"], [data-chat-scope="conv"] { color: red; }'
  );
  assert.match(
    chatAppearanceUtilsSource,
    /function scopeCssSelectorList\(selectorText, scopeSelector\) \{[\s\S]*for \(let index = 0; index <= selectorText\.length; index \+= 1\) \{[\s\S]*appendScopedCssSelector/
  );
  assert.doesNotMatch(chatAppearanceUtilsSource, /selectorText\s*\.split\(',/);
  assert.doesNotMatch(chatAppearanceUtilsSource, /\.map\(\(selector\) => scopeSelectorSelector/);
  assert.doesNotMatch(chatAppearanceUtilsSource, /\.filter\(Boolean\)\s*\.join\(', '\)/);
});

test('chat appearance background mutations validate before invalidating upload tokens', () => {
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
    /if \(input\) \{\s*input\.value = '';\s*\}\s*if \(appearanceDisposed \|\| appearanceSaving\.value \|\| !file\) \{\s*return;\s*\}\s*if \(!\['image\/png', 'image\/jpeg', 'image\/webp', 'image\/gif'\]\.includes\(file\.type\)\) \{/
  );
  assert.doesNotMatch(
    uploadHandler,
    /if \(appearanceDisposed \|\| appearanceSaving\.value \|\| !file\) \{\s*return;\s*\}\s*const uploadToken = nextBackgroundUploadToken\(field\);/
  );
  assert.match(
    uploadHandler,
    /if \(file\.size > 4 \* 1024 \* 1024\) \{[\s\S]*return;\s*\}\s*try \{\s*const uploadToken = nextBackgroundUploadToken\(field\);\s*const result = await readFileAsDataUrl\(file\);/
  );
  assert.match(
    clearHandler,
    /if \(appearanceDisposed \|\| appearanceSaving\.value\) \{\s*return;\s*\}\s*nextBackgroundUploadToken\(field\);/
  );
});

test('invalid background uploads do not cancel a pending valid upload', async () => {
  const originalFileReader = globalThis.FileReader;
  const readers = [];
  const warnings = [];

  class MockFileReader {
    constructor() {
      this.result = '';
      this.onload = null;
      this.onerror = null;
      readers.push(this);
    }

    readAsDataURL(file) {
      this.file = file;
    }
  }

  globalThis.FileReader = MockFileReader;

  try {
    const chat = createAppearance({
      notify: {
        warning(message) {
          warnings.push(message);
        }
      }
    });
    const validUpload = chat.handleAppearanceBackgroundUpload({
      target: {
        files: [{ type: 'image/png', size: 1024 }],
        value: 'valid-file'
      }
    }, 'desktopBackgroundUrl');

    assert.equal(readers.length, 1);

    await chat.handleAppearanceBackgroundUpload({
      target: {
        files: [{ type: 'text/plain', size: 12 }],
        value: 'invalid-file'
      }
    }, 'desktopBackgroundUrl');

    readers[0].result = 'data:image/png;base64,valid';
    readers[0].onload();
    await validUpload;

    assert.equal(chat.chatAppearanceForm.desktopBackgroundUrl, 'data:image/png;base64,valid');
    assert.equal(warnings.length, 1);
  } finally {
    if (originalFileReader === undefined) {
      delete globalThis.FileReader;
    } else {
      globalThis.FileReader = originalFileReader;
    }
  }
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

test('chat custom script queryAll scans DOM collections directly', async () => {
  const requestedSelectors = [];
  const state = {};
  const firstNode = { id: 'first-node' };
  const secondNode = { id: 'second-node' };
  const root = {
    querySelectorAll(selector) {
      requestedSelectors.push(selector);
      if (selector !== '.item') {
        return { length: 0 };
      }
      return {
        length: 2,
        0: firstNode,
        1: secondNode
      };
    }
  };

  await runChatCustomScript(`
    const matches = queryAll('.item');
    state.count = matches.length;
    state.first = matches[0]?.id || '';
    state.second = matches[1]?.id || '';
    state.emptyCount = queryAll('.missing', null).length;
  `, { root, state });

  assert.deepEqual(requestedSelectors, ['.item']);
  assert.deepEqual(state, {
    count: 2,
    first: 'first-node',
    second: 'second-node',
    emptyCount: 0
  });
  assert.match(
    chatAppearanceUtilsSource,
    /queryAll\(selector, root = ctx\.root\) \{\s*return collectCustomScriptQueryAll\(selector, root\);[\s\S]*function collectCustomScriptQueryAll\(selector, root\) \{[\s\S]*if \(!root \|\| typeof root\.querySelectorAll !== 'function'\) \{[\s\S]*const nodes = root\.querySelectorAll\(selector\);[\s\S]*for \(let index = 0; index < nodes\.length; index \+= 1\) \{[\s\S]*results\.push\(nodes\[index\]\);[\s\S]*return results;/
  );
  assert.doesNotMatch(chatAppearanceUtilsSource, /Array\.from\(root\.querySelectorAll\(selector\)\)/);
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
  assert.match(
    chatAppearanceSource,
    /function sameWorldBookList\(currentBooks, nextBooks\) \{[\s\S]*if \(!Array\.isArray\(currentBooks\) \|\| !Array\.isArray\(nextBooks\)\) \{[\s\S]*return false;[\s\S]*for \(let index = 0; index < currentBooks\.length; index \+= 1\) \{[\s\S]*!sameWorldBookSummary\(currentBooks\[index\], nextBooks\[index\]\)[\s\S]*return true;[\s\S]*\}/
  );
  assert.doesNotMatch(chatAppearanceSource, /worldBooks\.value\s*=\s*books/);
  assert.doesNotMatch(chatAppearanceSource, /currentBooks\.every/);
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
  assert.match(
    chatAppearanceSource,
    /function invalidateBackgroundUploads\(\) \{[\s\S]*for \(const key in backgroundUploadTokens\) \{[\s\S]*Object\.prototype\.hasOwnProperty\.call\(backgroundUploadTokens, key\)[\s\S]*backgroundUploadTokens\[key\] \+= 1;[\s\S]*\}/
  );
  assert.match(chatAppearanceSource, /function scopedAppearanceAction\(applyToken, conversationId, action\)/);
  assert.match(chatAppearanceSource, /function scopedAppearanceNotify\(applyToken, conversationId\)/);
  assert.doesNotMatch(chatAppearanceSource, /Array\.from\(root\.querySelectorAll/);
  assert.doesNotMatch(applyBody, /queryAll:\s*\(/);
  assert.doesNotMatch(applyBody, /query:\s*\(/);
  assert.doesNotMatch(chatAppearanceSource, /Object\.keys\(backgroundUploadTokens\)\.forEach/);
});
