import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText, readVueBlocks } from './frontendSfcTestUtils.js';

const { useChatConversation } = await import('../../../frontend/src/composables/chat/useChatConversation.js');
const chatConversationSource = readRepoText('frontend/src/composables/chat/useChatConversation.js');
const { script: chatViewScript } = readVueBlocks('frontend/src/views/ChatView.vue');

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function unwrapVueProxy(value) {
  return value && typeof value === 'object' && value.__v_raw ? value.__v_raw : value;
}

function createActiveConversation(overrides = {}) {
  return {
    id: 'conv-active',
    characterId: 'char-1',
    title: 'Active story',
    chatLorebookId: 'book-1',
    createdAt: '2026-06-08T00:00:00.000Z',
    updatedAt: '2026-06-08T00:00:00.000Z',
    character: {
      name: 'Alice',
      avatarUrl: '/avatars/alice.png'
    },
    settings: {
      chatLorebookId: 'book-1',
      customCss: '.user {}',
      accessorySkills: {
        statusBarAgent: {
          enabled: true,
          modelOverride: 'model-a'
        }
      }
    },
    authorSettings: {
      customCss: '.author {}',
      statusBarPrompt: 'Author prompt'
    },
    userSettings: {
      customCss: '.user {}',
      accessorySkills: {
        statusBarAgent: {
          enabled: true,
          modelOverride: 'model-a'
        }
      }
    },
    usage: {
      totalTokens: 10,
      totalCostCny: 0.01
    },
    ...overrides
  };
}

function createEquivalentActiveConversation() {
  return {
    usage: {
      totalCostCny: 0.01,
      totalTokens: 10
    },
    userSettings: {
      accessorySkills: {
        statusBarAgent: {
          modelOverride: 'model-a',
          enabled: true
        }
      },
      customCss: '.user {}'
    },
    authorSettings: {
      statusBarPrompt: 'Author prompt',
      customCss: '.author {}'
    },
    settings: {
      accessorySkills: {
        statusBarAgent: {
          modelOverride: 'model-a',
          enabled: true
        }
      },
      customCss: '.user {}',
      chatLorebookId: 'book-1'
    },
    character: {
      avatarUrl: '/avatars/alice.png',
      name: 'Alice'
    },
    updatedAt: '2026-06-08T00:00:00.000Z',
    createdAt: '2026-06-08T00:00:00.000Z',
    chatLorebookId: 'book-1',
    title: 'Active story',
    characterId: 'char-1',
    id: 'conv-active'
  };
}

function createMessage(overrides = {}) {
  return {
    id: 'msg-1',
    role: 'assistant',
    content: 'Hello',
    reasoning: '',
    usage: {
      total_tokens: 3,
      totalTokens: 3
    },
    createdAt: '2026-06-08T00:00:00.000Z',
    ...overrides
  };
}

function createEquivalentMessage() {
  return {
    createdAt: '2026-06-08T00:00:00.000Z',
    usage: {
      totalTokens: 3,
      total_tokens: 3
    },
    reasoning: '',
    content: 'Hello',
    role: 'assistant',
    id: 'msg-1'
  };
}

test('active chat conversation setter preserves unchanged object references', () => {
  const chat = useChatConversation({
    route: { params: { id: 'conv-active' } },
    emit() {},
    showError() {}
  });

  const activeConversation = createActiveConversation();

  assert.equal(chat.setActiveConversationIfChanged(activeConversation), true);

  const activeReference = unwrapVueProxy(chat.conversation.value);
  assert.equal(chat.conversation.value.id, activeConversation.id);
  assert.equal(chat.setActiveConversationIfChanged(createEquivalentActiveConversation()), false);
  assert.equal(unwrapVueProxy(chat.conversation.value), activeReference);

  const changedSettings = createEquivalentActiveConversation();
  changedSettings.userSettings = {
    ...changedSettings.userSettings,
    customCss: '.changed {}'
  };
  assert.equal(chat.setActiveConversationIfChanged(changedSettings), true);
  assert.equal(chat.conversation.value.userSettings.customCss, '.changed {}');

  const settingsReference = unwrapVueProxy(chat.conversation.value);
  const changedUsage = createEquivalentActiveConversation();
  changedUsage.usage = {
    totalTokens: 11,
    totalCostCny: 0.01
  };
  assert.equal(chat.setActiveConversationIfChanged(changedUsage), true);
  assert.notEqual(unwrapVueProxy(chat.conversation.value), settingsReference);
  assert.equal(chat.conversation.value.usage.totalTokens, 11);

  assert.equal(chat.setActiveConversationIfChanged(null), true);
  assert.equal(chat.conversation.value, null);
  assert.equal(chat.setActiveConversationIfChanged(null), false);
});

test('ChatView routes active conversation refreshes through the stable setter', () => {
  assert.match(chatViewScript, /setActiveConversationIfChanged,/);
  assert.match(chatViewScript, /setActiveConversationIfChanged\(null\);/);
  assert.match(chatViewScript, /setActiveConversationIfChanged\(result\.conversation\);/);
  assert.doesNotMatch(chatViewScript, /conversation\.value\s*=\s*result\.conversation/);
  assert.doesNotMatch(chatViewScript, /conversation\.value\s*=\s*null/);
});

test('ChatView NPC panel global event handlers tolerate missing event targets', () => {
  assert.match(chatViewScript, /import \{ callEventMethod \} from '\.\.\/utils\/eventMethods';/);
  assert.match(
    chatViewScript,
    /function handleGlobalPointerDown\(event\) \{[\s\S]*const target = event\?\.target;[\s\S]*target\?\.closest\?\.\('\.npc-close'\) \|\| target\?\.classList\?\.contains\('npc-panel-overlay'\)[\s\S]*callEventMethod\(event, 'preventDefault'\);[\s\S]*callEventMethod\(event, 'stopPropagation'\);[\s\S]*\}/
  );
  assert.match(
    chatViewScript,
    /function handleGlobalClick\(event\) \{[\s\S]*suppressNpcPanelClick = false;[\s\S]*callEventMethod\(event, 'preventDefault'\);[\s\S]*callEventMethod\(event, 'stopPropagation'\);[\s\S]*\}/
  );
  assert.doesNotMatch(chatViewScript, /const target = event\.target/);
});

test('ChatView composer enter uses the safe event method helper', () => {
  assert.match(
    chatViewScript,
    /function handleComposerEnter\(payload\) \{[\s\S]*if \(isEnter && isPhoneViewport\(\)\) \{[\s\S]*return;[\s\S]*\}[\s\S]*callEventMethod\(payload\?\.event, 'preventDefault'\);[\s\S]*submit\(\);[\s\S]*\}/
  );
  assert.doesNotMatch(chatViewScript, /if \(event\?\.preventDefault\)/);
});

test('chat message setter preserves unchanged list references', () => {
  const chat = useChatConversation({
    route: { params: { id: 'conv-active' } },
    emit() {},
    showError() {}
  });

  assert.equal(chat.setMessagesIfChanged([
    createMessage(),
    createMessage({ id: 'msg-2', role: 'user', content: 'Hi', usage: null })
  ]), true);
  const messagesReference = chat.messages.value;

  assert.equal(chat.setMessagesIfChanged([
    createEquivalentMessage(),
    {
      createdAt: '2026-06-08T00:00:00.000Z',
      usage: null,
      reasoning: '',
      content: 'Hi',
      role: 'user',
      id: 'msg-2'
    }
  ]), false);
  assert.equal(chat.messages.value, messagesReference);

  const changedMessageReference = chat.messages.value;
  assert.equal(chat.setMessagesIfChanged([
    createEquivalentMessage(),
    {
      createdAt: '2026-06-08T00:00:00.000Z',
      usage: null,
      reasoning: '',
      content: 'Edited',
      role: 'user',
      id: 'msg-2'
    }
  ]), true);
  assert.notEqual(chat.messages.value, changedMessageReference);
  assert.equal(chat.messages.value[1].content, 'Edited');

  assert.equal(chat.setMessagesIfChanged([]), true);
  assert.equal(chat.messages.value.length, 0);
  const emptyReference = chat.messages.value;
  assert.equal(chat.setMessagesIfChanged([]), false);
  assert.equal(chat.messages.value, emptyReference);
});

test('ChatView routes loaded message refreshes through the stable setter', () => {
  assert.match(chatViewScript, /setActiveConversationIfChanged, setMessagesIfChanged,/);
  assert.match(chatViewScript, /setMessagesIfChanged\(\[\]\);/);
  assert.match(chatViewScript, /setMessagesIfChanged\(result\.messages\);/);
  assert.doesNotMatch(chatViewScript, /messages\.value\s*=\s*result\.messages/);
  assert.doesNotMatch(chatViewScript, /messages\.value\s*=\s*\[\]/);
});

test('ChatView accepts save-loaded events only for the active route conversation', () => {
  assert.match(
    chatViewScript,
    /async function onSavesLoaded\(payload = \{\}\) \{[\s\S]*const eventConversationId = payload\?\.conversationId \|\| '';[\s\S]*if \(chatViewDisposed \|\| !eventConversationId \|\| eventConversationId !== props\.route\.params\.id\) \{\s*return;\s*\}[\s\S]*await loadConversation\(\);[\s\S]*if \(\s*chatViewDisposed \|\|[\s\S]*props\.route\.params\.id !== eventConversationId \|\|[\s\S]*conversation\.value\?\.id !== eventConversationId\s*\) \{\s*return;\s*\}[\s\S]*await loadSidebarData\(\);[\s\S]*}/
  );
  assert.doesNotMatch(
    chatViewScript,
    /async function onSavesLoaded\(\)\s*{\s*await loadConversation\(\);\s*await loadSidebarData\(\);/
  );
});

test('ChatView guards conversation load side effects after route-changing awaits', () => {
  assert.match(
    chatViewScript,
    /function isCurrentConversationLoad\(requestToken, conversationId\) \{\s*return !chatViewDisposed\s*&& requestToken === conversationLoadToken\s*&& props\.route\.params\.id === conversationId;\s*}/
  );
  assert.match(
    chatViewScript,
    /await nextTick\(\);\s*if \(!isCurrentConversationLoad\(requestToken, conversationId\)\) return;\s*loading\.value = false;\s*syncConversationAppearance/
  );
  assert.match(
    chatViewScript,
    /await applyConversationAppearance\(\);\s*if \(!isCurrentConversationLoad\(requestToken, conversationId\)\) return;\s*\/\/ Parallel: these 4 operations are independent of each other/
  );
  assert.match(
    chatViewScript,
    /catch \(err\) \{\s*if \(!isCurrentConversationLoad\(requestToken, conversationId\)\) return;\s*showError\(err\.message\);\s*} finally \{\s*if \(isCurrentConversationLoad\(requestToken, conversationId\)\) \{/
  );
  assert.doesNotMatch(chatViewScript, /requestToken !== conversationLoadToken \|\| props\.route\.params\.id !== conversationId/);
});

test('ChatView guards branch navigation after sidebar refresh awaits', () => {
  assert.match(
    chatViewScript,
    /async function createBranchFromMessage\(message\) \{\s*const branchConversationId = props\.route\.params\.id;\s*await handleBranchMessage\(message, branchConversationId, async \(branchId, isCurrentBranchAction\) => \{\s*if \(!isCurrentBranchAction\(\)\) \{\s*return;\s*\}\s*await loadSidebarData\(\);\s*if \(!isCurrentBranchAction\(\)\) \{\s*return;\s*\}\s*emit\('navigate', 'chat', \{ id: branchId \}\);\s*\}\);\s*}/
  );
});

test('chat NPC panel reopen ignores stale route changes after next tick', async () => {
  const route = { params: { id: 'conv-1' } };
  const chat = useChatConversation({
    route,
    emit() {},
    showError() {}
  });

  chat.setActiveConversationIfChanged(createActiveConversation({ id: 'conv-1' }));
  chat.npcPanelOpen.value = true;

  const openPromise = chat.openNpcPanel();
  assert.equal(chat.npcPanelOpen.value, false);

  route.params.id = 'conv-2';
  chat.setActiveConversationIfChanged(createActiveConversation({ id: 'conv-2' }));
  await openPromise;

  assert.equal(chat.npcPanelOpen.value, false);
});

test('chat NPC panel reopen rechecks current conversation before reopening', () => {
  assert.match(
    chatConversationSource,
    /async function openNpcPanel\(\) \{\s*const panelConversationId = conversation\.value\?\.id \|\| '';\s*if \(!isCurrentPanelConversation\(panelConversationId\)\) \{\s*return;\s*\}[\s\S]*await nextTick\(\);[\s\S]*if \(!isCurrentPanelConversation\(panelConversationId\)\) \{\s*return;\s*\}[\s\S]*npcPanelOpen\.value = true;/
  );
  assert.match(
    chatConversationSource,
    /function isCurrentPanelConversation\(conversationId\) \{\s*return !conversationDisposed\s*&& conversationReady\.value\s*&& conversation\.value\?\.id === conversationId\s*&& route\.params\.id === conversationId;\s*}/
  );
});

test('chat sidebar visible selection state is summarized without filter allocations', () => {
  assert.match(
    chatConversationSource,
    /const visibleConversationSelection = computed\(\(\) => \{\s*return summarizeVisibleConversationSelection\(visibleConversationIds\.value, selectedConversationIds\.value\);\s*}\);/
  );
  assert.match(
    chatConversationSource,
    /function summarizeVisibleConversationSelection\(visibleIds, selectedIds\) \{[\s\S]*for \(const id of visibleIds\) \{[\s\S]*selectedCount \+= 1;[\s\S]*allSelected: visibleIds\.length > 0 && selectedCount === visibleIds\.length/
  );
  assert.doesNotMatch(chatConversationSource, /visibleConversationIds\.value\.filter\(/);
  assert.doesNotMatch(chatConversationSource, /\[\.\.\.selectedIds\]\.filter/);
  assert.doesNotMatch(chatConversationSource, /conversations\.value\.map\(\(item\) => item\.id\)/);
});

test('chat conversation list summary comparisons use direct loops', () => {
  assert.match(
    chatConversationSource,
    /function sameListItems\(currentItems, nextItems, sameItem\) \{[\s\S]*for \(let index = 0; index < currentItems\.length; index \+= 1\) \{[\s\S]*!sameItem\(currentItems\[index\], nextItems\[index\]\)[\s\S]*return true;[\s\S]*\}/
  );
  assert.match(
    chatConversationSource,
    /function sameRenderPluginList\(currentItems = \[\], nextItems = \[\]\) \{[\s\S]*for \(let index = 0; index < currentList\.length; index \+= 1\) \{[\s\S]*!sameRenderPlugin\(currentList\[index\], nextList\[index\]\)[\s\S]*return true;[\s\S]*\}/
  );
  assert.doesNotMatch(chatConversationSource, /currentItems\.every\(/);
  assert.doesNotMatch(chatConversationSource, /currentList\.every\(/);
});

test('chat conversation stable serialization uses direct loops', () => {
  assert.match(
    chatConversationSource,
    /function stableSerialize\(value\) \{[\s\S]*if \(Array\.isArray\(value\)\) \{\s*return stableSerializeArray\(value\);[\s\S]*return stableSerializeObject\(value\);[\s\S]*\}/
  );
  assert.match(
    chatConversationSource,
    /function stableSerializeArray\(items\) \{\s*let serialized = '\[';[\s\S]*for \(let index = 0; index < items\.length; index \+= 1\) \{[\s\S]*Object\.prototype\.hasOwnProperty\.call\(items, index\)[\s\S]*const serializedItem = stableSerialize\(items\[index\]\);[\s\S]*if \(typeof serializedItem !== 'undefined'\) \{[\s\S]*serialized \+= serializedItem;[\s\S]*return `\$\{serialized\}\]`;[\s\S]*\}/
  );
  assert.match(
    chatConversationSource,
    /function stableSerializeObject\(value\) \{\s*const keys = collectStableObjectKeys\(value\);[\s\S]*for \(let index = 0; index < keys\.length; index \+= 1\) \{[\s\S]*const key = keys\[index\];[\s\S]*serialized \+= `\$\{JSON\.stringify\(key\)\}:\$\{stableSerialize\(value\[key\]\)\}`;[\s\S]*return `\$\{serialized\}\}`;[\s\S]*\}/
  );
  assert.match(
    chatConversationSource,
    /function collectStableObjectKeys\(value\) \{\s*const keys = \[\];[\s\S]*for \(const key in value\) \{[\s\S]*Object\.prototype\.hasOwnProperty\.call\(value, key\)[\s\S]*keys\.push\(key\);[\s\S]*return keys\.sort\(\);[\s\S]*\}/
  );
  assert.doesNotMatch(chatConversationSource, /value\.map\(\(item\) => stableSerialize\(item\)\)\.join/);
  assert.doesNotMatch(chatConversationSource, /\.map\(\(key\) => `\$\{JSON\.stringify\(key\)\}:\$\{stableSerialize\(value\[key\]\)\}`\)/);
  assert.doesNotMatch(chatConversationSource, /Object\.keys\(value\)\.sort\(\)/);
});

test('chat sidebar initial open state falls back to window width without matchMedia', () => {
  const originalWindow = globalThis.window;

  try {
    globalThis.window = { innerWidth: 1180 };
    const desktopChat = useChatConversation({
      route: { params: {} },
      emit() {},
      showError() {}
    });
    assert.equal(desktopChat.sidebarOpen.value, true);

    globalThis.window = { innerWidth: 760 };
    const phoneChat = useChatConversation({
      route: { params: {} },
      emit() {},
      showError() {}
    });
    assert.equal(phoneChat.sidebarOpen.value, false);
  } finally {
    if (typeof originalWindow === 'undefined') {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('chat sidebar data load reports partial failures without discarding successful resources', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    requests.push(requestUrl);

    if (requestUrl === '/api/conversations?characterId=char-1') {
      return jsonResponse([
        {
          id: 'conv-1',
          title: 'Current story',
          characterId: 'char-1',
          character: { name: 'Alice' },
          usage: {}
        }
      ]);
    }

    if (requestUrl === '/api/characters?search=&sort=created&tag=') {
      return jsonResponse({ message: 'Characters service unavailable' }, 503);
    }

    if (requestUrl === '/api/presets') {
      return jsonResponse([
        { id: 'preset-default', name: 'Default', isDefault: true }
      ]);
    }

    return jsonResponse({ message: `Unexpected request: ${requestUrl}` }, 500);
  };

  try {
    const chat = useChatConversation({
      route: { params: { id: 'conv-1' } },
      emit() {},
      showError() {}
    });

    chat.conversation.value = { id: 'conv-1', characterId: 'char-1' };

    await chat.loadSidebarData();

    assert.deepEqual(requests, [
      '/api/conversations?characterId=char-1',
      '/api/characters?search=&sort=created&tag=',
      '/api/presets'
    ]);
    assert.equal(chat.conversations.value.length, 1);
    assert.equal(chat.conversations.value[0].id, 'conv-1');
    assert.deepEqual(chat.characters.value, []);
    assert.equal(chat.presetList.value.length, 1);
    assert.equal(chat.selectedPresetId.value, 'preset-default');
    assert.match(chat.sidebarLoadError.value, /角色列表加载失败/);
    assert.match(chat.sidebarLoadError.value, /Characters service unavailable/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chat sidebar load error summaries use direct loops', () => {
  assert.match(
    chatConversationSource,
    /function formatSidebarLoadError\(failures\) \{[\s\S]*let labels = '';[\s\S]*let firstMessage = '';[\s\S]*for \(let index = 0; index < failures\.length; index \+= 1\) \{[\s\S]*const \[label, reason\] = failures\[index\];[\s\S]*const labelText = label == null \? '' : String\(label\);[\s\S]*labels = labels \? `\$\{labels\}、\$\{labelText\}` : labelText;[\s\S]*if \(!firstMessage && reason\?\.message\) \{[\s\S]*firstMessage = reason\.message;[\s\S]*\}/
  );
  assert.doesNotMatch(chatConversationSource, /failures\.map\(\(\[label\]\) => label\)\.join/);
  assert.doesNotMatch(chatConversationSource, /failures\.map\(\(\[, reason\]\) => reason\?\.message\)\.find/);
});

test('chat sidebar data load summarizes multiple failures in source order', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    const requestUrl = String(url);

    if (requestUrl === '/api/conversations?characterId=char-1') {
      return jsonResponse({ message: 'History unavailable' }, 503);
    }

    if (requestUrl === '/api/characters?search=&sort=created&tag=') {
      return jsonResponse({ message: 'Characters unavailable' }, 503);
    }

    if (requestUrl === '/api/presets') {
      return jsonResponse({ message: 'Presets unavailable' }, 503);
    }

    return jsonResponse({ message: `Unexpected request: ${requestUrl}` }, 500);
  };

  try {
    const chat = useChatConversation({
      route: { params: { id: 'conv-1' } },
      emit() {},
      showError() {}
    });

    chat.conversation.value = { id: 'conv-1', characterId: 'char-1' };
    chat.selectedPresetId.value = 'stale-preset';

    await chat.loadSidebarData();

    assert.deepEqual(chat.conversations.value, []);
    assert.deepEqual(chat.characters.value, []);
    assert.deepEqual(chat.presetList.value, []);
    assert.equal(chat.selectedPresetId.value, '');
    assert.equal(chat.sidebarLoadError.value, '会话历史、角色列表、预设列表加载失败：History unavailable');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chat sidebar data load preserves unchanged resource references', async () => {
  const originalFetch = globalThis.fetch;
  let totalTokens = 10;

  globalThis.fetch = async (url) => {
    const requestUrl = String(url);

    if (requestUrl === '/api/conversations?characterId=char-1') {
      return jsonResponse([
        {
          id: 'conv-1',
          title: 'Current story',
          characterId: 'char-1',
          character: { name: 'Alice' },
          usage: { totalTokens, totalCostCny: 0.01 }
        }
      ]);
    }

    if (requestUrl === '/api/characters?search=&sort=created&tag=') {
      return jsonResponse([
        {
          id: 'char-1',
          name: 'Alice',
          avatarUrl: '/avatars/alice.png',
          visibility: 'private',
          renderPlugins: [
            {
              label: 'Fold profile',
              type: 'fold',
              pattern: '^Profile$',
              flags: 'u',
              enabled: true
            }
          ]
        }
      ]);
    }

    if (requestUrl === '/api/presets') {
      return jsonResponse([
        { id: 'preset-default', name: 'Default', isDefault: true }
      ]);
    }

    return jsonResponse({ message: `Unexpected request: ${requestUrl}` }, 500);
  };

  try {
    const chat = useChatConversation({
      route: { params: { id: 'conv-1' } },
      emit() {},
      showError() {}
    });

    chat.conversation.value = { id: 'conv-1', characterId: 'char-1' };

    await chat.loadSidebarData();
    const conversations = chat.conversations.value;
    const characters = chat.characters.value;
    const presetList = chat.presetList.value;

    await chat.loadSidebarData();

    assert.equal(chat.conversations.value, conversations);
    assert.equal(chat.characters.value, characters);
    assert.equal(chat.presetList.value, presetList);

    totalTokens = 11;
    await chat.loadSidebarData();

    assert.notEqual(chat.conversations.value, conversations);
    assert.equal(chat.characters.value, characters);
    assert.equal(chat.presetList.value, presetList);
    assert.equal(chat.conversations.value[0].usage.totalTokens, 11);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chat sidebar preset selection sync scans refreshed presets once', () => {
  assert.match(
    chatConversationSource,
    /function syncSelectedPresetId\(\) \{\s*const currentId = selectedPresetId\.value;\s*let fallbackId = '';[\s\S]*for \(const preset of presetList\.value\) \{[\s\S]*if \(!fallbackId && preset\?\.isDefault\) \{[\s\S]*fallbackId = preset\?\.id \|\| '';[\s\S]*if \(preset\?\.id === currentId\) \{[\s\S]*return false;[\s\S]*if \(currentId === fallbackId\) \{[\s\S]*return false;[\s\S]*selectedPresetId\.value = fallbackId;[\s\S]*return true;[\s\S]*\}/
  );
  assert.doesNotMatch(chatConversationSource, /presetList\.value\.some/);
  assert.doesNotMatch(chatConversationSource, /presetList\.value\.find/);
});

test('chat sidebar data load ignores stale responses from older conversations', async () => {
  const originalFetch = globalThis.fetch;
  const slowHistory = createDeferred();

  globalThis.fetch = async (url) => {
    const requestUrl = String(url);

    if (requestUrl === '/api/conversations?characterId=char-slow') {
      return slowHistory.promise;
    }

    if (requestUrl === '/api/conversations?characterId=char-fast') {
      return jsonResponse([
        {
          id: 'conv-fast',
          title: 'Fast story',
          characterId: 'char-fast',
          character: { name: 'Fast' },
          usage: {}
        }
      ]);
    }

    if (requestUrl === '/api/characters?search=&sort=created&tag=') {
      return jsonResponse([
        { id: 'char-fast', name: 'Fast', visibility: 'private' }
      ]);
    }

    if (requestUrl === '/api/presets') {
      return jsonResponse([
        { id: 'preset-fast', name: 'Fast preset', isDefault: true }
      ]);
    }

    return jsonResponse({ message: `Unexpected request: ${requestUrl}` }, 500);
  };

  try {
    const chat = useChatConversation({
      route: { params: { id: 'conv-fast' } },
      emit() {},
      showError() {}
    });

    chat.conversation.value = { id: 'conv-slow', characterId: 'char-slow' };
    const staleLoad = chat.loadSidebarData();

    chat.conversation.value = { id: 'conv-fast', characterId: 'char-fast' };
    await chat.loadSidebarData();

    assert.equal(chat.conversations.value.length, 1);
    assert.equal(chat.conversations.value[0].id, 'conv-fast');
    assert.equal(chat.characters.value[0].id, 'char-fast');
    assert.equal(chat.selectedPresetId.value, 'preset-fast');

    slowHistory.resolve(jsonResponse([
      {
        id: 'conv-slow',
        title: 'Slow story',
        characterId: 'char-slow',
        character: { name: 'Slow' },
        usage: {}
      }
    ]));
    await staleLoad;

    assert.equal(chat.conversations.value.length, 1);
    assert.equal(chat.conversations.value[0].id, 'conv-fast');
    assert.equal(chat.characters.value[0].id, 'char-fast');
    assert.equal(chat.selectedPresetId.value, 'preset-fast');
    assert.equal(chat.sidebarLoadError.value, '');
  } finally {
    globalThis.fetch = originalFetch;
    slowHistory.resolve(jsonResponse([]));
  }
});

test('chat sidebar data load ignores completions after cleanup', async () => {
  const originalFetch = globalThis.fetch;
  const slowHistory = createDeferred();
  const requests = [];

  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    requests.push(requestUrl);

    if (requestUrl === '/api/conversations?characterId=char-cleanup') {
      return slowHistory.promise;
    }

    if (requestUrl === '/api/characters?search=&sort=created&tag=') {
      return jsonResponse([
        { id: 'char-cleanup', name: 'Cleanup', visibility: 'private' }
      ]);
    }

    if (requestUrl === '/api/presets') {
      return jsonResponse([
        { id: 'preset-cleanup', name: 'Cleanup preset', isDefault: true }
      ]);
    }

    return jsonResponse({ message: `Unexpected request: ${requestUrl}` }, 500);
  };

  try {
    const chat = useChatConversation({
      route: { params: { id: 'conv-cleanup' } },
      emit() {},
      showError() {}
    });

    chat.conversation.value = { id: 'conv-cleanup', characterId: 'char-cleanup' };
    const cleanupLoad = chat.loadSidebarData();
    assert.equal(chat.sidebarLoading.value, true);
    chat.cleanup();
    assert.equal(chat.sidebarLoading.value, false);

    slowHistory.resolve(jsonResponse([
      {
        id: 'conv-cleanup',
        title: 'Cleanup story',
        characterId: 'char-cleanup',
        character: { name: 'Cleanup' },
        usage: {}
      }
    ]));
    await cleanupLoad;

    assert.deepEqual(chat.conversations.value, []);
    assert.deepEqual(chat.characters.value, []);
    assert.deepEqual(chat.presetList.value, []);
    assert.equal(chat.selectedPresetId.value, '');
    assert.equal(chat.sidebarLoadError.value, '');

    const requestCount = requests.length;
    await chat.loadSidebarData();
    assert.equal(requests.length, requestCount);
  } finally {
    globalThis.fetch = originalFetch;
    slowHistory.resolve(jsonResponse([]));
  }
});

test('chat sidebar data load exposes pending state until the latest load settles', async () => {
  const originalFetch = globalThis.fetch;
  const slowHistory = createDeferred();

  globalThis.fetch = async (url) => {
    const requestUrl = String(url);

    if (requestUrl === '/api/conversations?characterId=char-loading') {
      return slowHistory.promise;
    }

    if (requestUrl === '/api/characters?search=&sort=created&tag=') {
      return jsonResponse([
        { id: 'char-loading', name: 'Loading', visibility: 'private' }
      ]);
    }

    if (requestUrl === '/api/presets') {
      return jsonResponse([
        { id: 'preset-loading', name: 'Loading preset', isDefault: true }
      ]);
    }

    return jsonResponse({ message: `Unexpected request: ${requestUrl}` }, 500);
  };

  try {
    const chat = useChatConversation({
      route: { params: { id: 'conv-loading' } },
      emit() {},
      showError() {}
    });

    chat.conversation.value = { id: 'conv-loading', characterId: 'char-loading' };
    const load = chat.loadSidebarData();

    assert.equal(chat.sidebarLoading.value, true);

    slowHistory.resolve(jsonResponse([
      {
        id: 'conv-loading',
        title: 'Loading story',
        characterId: 'char-loading',
        character: { name: 'Loading' },
        usage: {}
      }
    ]));
    await load;

    assert.equal(chat.sidebarLoading.value, false);
    assert.equal(chat.conversations.value[0].id, 'conv-loading');
  } finally {
    globalThis.fetch = originalFetch;
    slowHistory.resolve(jsonResponse([]));
  }
});

test('chat sidebar data load keeps pending state when an older load settles first', async () => {
  const originalFetch = globalThis.fetch;
  const firstHistory = createDeferred();
  const secondHistory = createDeferred();

  globalThis.fetch = async (url) => {
    const requestUrl = String(url);

    if (requestUrl === '/api/conversations?characterId=char-first') {
      return firstHistory.promise;
    }

    if (requestUrl === '/api/conversations?characterId=char-second') {
      return secondHistory.promise;
    }

    if (requestUrl === '/api/characters?search=&sort=created&tag=') {
      return jsonResponse([
        { id: 'char-first', name: 'First', visibility: 'private' },
        { id: 'char-second', name: 'Second', visibility: 'private' }
      ]);
    }

    if (requestUrl === '/api/presets') {
      return jsonResponse([
        { id: 'preset-overlap', name: 'Overlap preset', isDefault: true }
      ]);
    }

    return jsonResponse({ message: `Unexpected request: ${requestUrl}` }, 500);
  };

  try {
    const chat = useChatConversation({
      route: { params: { id: 'conv-second' } },
      emit() {},
      showError() {}
    });

    chat.conversation.value = { id: 'conv-first', characterId: 'char-first' };
    const staleLoad = chat.loadSidebarData();

    chat.conversation.value = { id: 'conv-second', characterId: 'char-second' };
    const latestLoad = chat.loadSidebarData();

    assert.equal(chat.sidebarLoading.value, true);

    firstHistory.resolve(jsonResponse([
      {
        id: 'conv-first',
        title: 'First story',
        characterId: 'char-first',
        character: { name: 'First' },
        usage: {}
      }
    ]));
    await staleLoad;

    assert.equal(chat.sidebarLoading.value, true);
    assert.deepEqual(chat.conversations.value, []);

    secondHistory.resolve(jsonResponse([
      {
        id: 'conv-second',
        title: 'Second story',
        characterId: 'char-second',
        character: { name: 'Second' },
        usage: {}
      }
    ]));
    await latestLoad;

    assert.equal(chat.sidebarLoading.value, false);
    assert.equal(chat.conversations.value[0].id, 'conv-second');
  } finally {
    globalThis.fetch = originalFetch;
    firstHistory.resolve(jsonResponse([]));
    secondHistory.resolve(jsonResponse([]));
  }
});

test('chat sidebar manual reload ignores duplicate or busy reload events', async () => {
  const originalFetch = globalThis.fetch;
  const pendingHistory = createDeferred();
  const requests = [];
  let historyPending = true;

  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    requests.push(requestUrl);

    if (requestUrl === '/api/conversations?characterId=char-reload') {
      if (historyPending) {
        return pendingHistory.promise;
      }
      return jsonResponse([
        {
          id: 'conv-reload',
          title: 'Reloaded story',
          characterId: 'char-reload',
          character: { name: 'Reload' },
          usage: {}
        }
      ]);
    }
    if (requestUrl === '/api/characters') {
      return jsonResponse([]);
    }
    if (requestUrl === '/api/presets') {
      return jsonResponse([]);
    }
    throw new Error(`Unexpected request: ${requestUrl}`);
  };

  try {
    const chat = useChatConversation({
      route: { params: { id: 'conv-reload' } },
      emit() {},
      showError() {}
    });
    chat.conversation.value = { id: 'conv-reload', characterId: 'char-reload' };

    const pendingLoad = chat.loadSidebarData();
    assert.equal(chat.sidebarLoading.value, true);

    await chat.reloadSidebarData();
    assert.equal(requests.length, 3);

    historyPending = false;
    pendingHistory.resolve(jsonResponse([]));
    await pendingLoad;
    assert.equal(chat.sidebarLoading.value, false);

    chat.conversationActionBusy.value = true;
    await chat.reloadSidebarData();
    assert.equal(requests.length, 3);

    chat.conversationActionBusy.value = false;
    chat.startConversationBusy.value = true;
    await chat.reloadSidebarData();
    assert.equal(requests.length, 3);

    chat.startConversationBusy.value = false;
    await chat.reloadSidebarData();
    assert.equal(requests.length, 6);
    assert.equal(chat.conversations.value[0].id, 'conv-reload');
  } finally {
    globalThis.fetch = originalFetch;
    pendingHistory.resolve(jsonResponse([]));
  }
});

test('chat sidebar selection controls freeze while conversation actions are busy', () => {
  const chat = useChatConversation({
    route: { params: { id: 'conv-a' } },
    emit() {},
    showError() {}
  });

  chat.conversations.value = [
    { id: 'conv-a', title: 'A', character: { name: 'A' }, usage: {} },
    { id: 'conv-b', title: 'B', character: { name: 'B' }, usage: {} }
  ];
  chat.selectedConversationIds.value = new Set(['conv-a']);
  chat.conversationActionBusy.value = true;

  chat.toggleConversationSelection('conv-b');
  assert.deepEqual([...chat.selectedConversationIds.value], ['conv-a']);

  chat.toggleAllVisibleConversations();
  assert.deepEqual([...chat.selectedConversationIds.value], ['conv-a']);

  chat.conversationActionBusy.value = false;
  chat.toggleConversationSelection('conv-b');
  assert.deepEqual([...chat.selectedConversationIds.value].sort(), ['conv-a', 'conv-b']);
});

test('chat sidebar selection ignores blank or unknown conversation ids without replacing refs', () => {
  const chat = useChatConversation({
    route: { params: { id: 'conv-a' } },
    emit() {},
    showError() {}
  });

  chat.conversations.value = [
    { id: 'conv-a', title: 'A', character: { name: 'A' }, usage: {} }
  ];
  chat.selectedConversationIds.value = new Set(['conv-a']);
  const selectionReference = chat.selectedConversationIds.value;

  chat.toggleConversationSelection('');
  chat.toggleConversationSelection(null);
  chat.toggleConversationSelection('conv-missing');

  assert.equal(chat.selectedConversationIds.value, selectionReference);
  assert.deepEqual([...chat.selectedConversationIds.value], ['conv-a']);

  chat.selectedConversationIds.value = new Set(['conv-a', 'conv-stale']);
  const staleSelectionReference = chat.selectedConversationIds.value;
  chat.toggleConversationSelection('conv-stale');

  assert.notEqual(chat.selectedConversationIds.value, staleSelectionReference);
  assert.deepEqual([...chat.selectedConversationIds.value], ['conv-a']);
});

test('chat sidebar stale conversation row guard scans current list directly', () => {
  assert.match(
    chatConversationSource,
    /function hasConversationListItem\(conversationId\) \{\s*const targetId = normalizeConversationSelectionId\(conversationId\);[\s\S]*if \(!targetId\) \{[\s\S]*return false;[\s\S]*const currentConversations = Array\.isArray\(conversations\.value\) \? conversations\.value : \[\];[\s\S]*for \(const item of currentConversations\) \{[\s\S]*if \(item\?\.id === targetId\) \{[\s\S]*return true;[\s\S]*return false;[\s\S]*\}/
  );
  assert.doesNotMatch(chatConversationSource, /conversations\.value\.some/);
});

test('chat sidebar single delete ignores blank or stale row events before confirm', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const requests = [];
  let confirmCount = 0;

  globalThis.window = {
    ...(originalWindow || {}),
    confirm() {
      confirmCount += 1;
      return true;
    }
  };
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    const method = String(options.method || 'GET').toUpperCase();
    requests.push([requestUrl, method]);

    if (requestUrl === '/api/csrf-token') {
      return jsonResponse({ csrfToken: 'single-delete-token' });
    }

    if (requestUrl === '/api/conversations/conv-visible' && method === 'DELETE') {
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ message: `Unexpected request: ${requestUrl}` }, 500);
  };

  try {
    const chat = useChatConversation({
      route: { params: { id: 'conv-current' } },
      emit() {},
      showError() {}
    });

    chat.conversations.value = [
      { id: 'conv-visible', title: 'Visible story', character: { name: 'Alice' }, usage: {} }
    ];

    await chat.deleteOneConversation({ id: '', title: 'Blank story' });
    await chat.deleteOneConversation({ id: null, title: 'Null story' });
    await chat.deleteOneConversation({ id: 'conv-stale', title: 'Stale story' });

    assert.equal(confirmCount, 0);
    assert.deepEqual(requests, []);

    await chat.deleteOneConversation({ id: ' conv-visible ', title: 'Visible story' });

    assert.equal(confirmCount, 1);
    assert.deepEqual(
      requests.filter(([, method]) => method === 'DELETE'),
      [['/api/conversations/conv-visible', 'DELETE']]
    );
    assert.deepEqual(chat.conversations.value, []);
  } finally {
    globalThis.fetch = originalFetch;
    if (typeof originalWindow === 'undefined') {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('chat sidebar bulk selection skips reactive updates when no conversations are visible', () => {
  const chat = useChatConversation({
    route: { params: { id: 'conv-a' } },
    emit() {},
    showError() {}
  });

  chat.conversations.value = [
    { id: 'conv-a', title: 'A', character: { name: 'A' }, usage: {} },
    { id: 'conv-b', title: 'B', character: { name: 'B' }, usage: {} }
  ];
  const selected = new Set(['conv-a']);
  chat.selectedConversationIds.value = selected;
  const selectionReference = chat.selectedConversationIds.value;
  chat.historySearch.value = 'no matching conversations';

  chat.toggleAllVisibleConversations();
  assert.equal(chat.selectedConversationIds.value, selectionReference);
  assert.deepEqual([...chat.selectedConversationIds.value], ['conv-a']);

  chat.historySearch.value = '';
  chat.toggleAllVisibleConversations();
  assert.notEqual(chat.selectedConversationIds.value, selectionReference);
  assert.deepEqual([...chat.selectedConversationIds.value].sort(), ['conv-a', 'conv-b']);

  const fullySelected = chat.selectedConversationIds.value;
  chat.toggleAllVisibleConversations();
  assert.notEqual(chat.selectedConversationIds.value, fullySelected);
  assert.deepEqual([...chat.selectedConversationIds.value], []);
});

test('chat sidebar selection pruning keeps reactive references stable when nothing changes', () => {
  const chat = useChatConversation({
    route: { params: { id: 'conv-a' } },
    emit() {},
    showError() {}
  });

  const conversations = [
    { id: 'conv-a', title: 'A', character: { name: 'A' }, usage: {} },
    { id: 'conv-b', title: 'B', character: { name: 'B' }, usage: {} }
  ];
  const selected = new Set(['conv-a']);
  chat.conversations.value = conversations;
  chat.selectedConversationIds.value = selected;
  const conversationsReference = chat.conversations.value;
  const selectionReference = chat.selectedConversationIds.value;

  chat.pruneSelectedConversations();
  assert.equal(chat.selectedConversationIds.value, selectionReference);

  chat.removeDeletedConversations(['conv-missing']);
  assert.equal(chat.conversations.value, conversationsReference);
  assert.equal(chat.selectedConversationIds.value, selectionReference);

  const staleSelection = new Set(['conv-a', 'conv-b']);
  chat.selectedConversationIds.value = staleSelection;
  chat.removeDeletedConversations(['conv-b']);

  assert.notEqual(chat.selectedConversationIds.value, staleSelection);
  assert.deepEqual([...chat.selectedConversationIds.value], ['conv-a']);
  assert.deepEqual(chat.conversations.value.map((item) => item.id), ['conv-a']);
});

test('chat sidebar bulk delete only sends visible selected conversation ids', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  let bulkDeleteBody = null;

  globalThis.window = { ...(originalWindow || {}), confirm: () => true };
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    const method = String(options.method || 'GET').toUpperCase();

    if (requestUrl === '/api/csrf-token') {
      return jsonResponse({ csrfToken: 'bulk-delete-token' });
    }

    if (requestUrl === '/api/conversations/bulk-delete' && method === 'POST') {
      bulkDeleteBody = JSON.parse(String(options.body || '{}'));
      return jsonResponse({ deletedIds: bulkDeleteBody.ids });
    }

    return jsonResponse({ message: `Unexpected request: ${requestUrl}` }, 500);
  };

  try {
    const emissions = [];
    const chat = useChatConversation({
      route: { params: { id: 'conv-hidden' } },
      emit(...args) {
        emissions.push(args);
      },
      showError() {}
    });

    chat.conversations.value = [
      { id: 'conv-visible', title: 'Visible story', character: { name: 'Alice' }, usage: {} },
      { id: 'conv-hidden', title: 'Hidden story', character: { name: 'Bob' }, usage: {} }
    ];
    chat.selectedConversationIds.value = new Set(['conv-visible', 'conv-hidden']);
    chat.historySearch.value = 'visible';

    await chat.deleteSelectedConversations();

    assert.deepEqual(bulkDeleteBody, { ids: ['conv-visible'] });
    assert.deepEqual([...chat.selectedConversationIds.value], ['conv-hidden']);
    assert.deepEqual(chat.conversations.value.map((item) => item.id), ['conv-hidden']);
    assert.deepEqual(emissions, []);
  } finally {
    globalThis.fetch = originalFetch;
    if (typeof originalWindow === 'undefined') {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('starting a new chat blocks duplicate create requests while pending', async () => {
  const originalFetch = globalThis.fetch;
  const slowCreate = createDeferred();
  const emissions = [];
  const errors = [];
  let createRequests = 0;

  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    const method = String(options.method || 'GET').toUpperCase();

    if (requestUrl === '/api/csrf-token') {
      return jsonResponse({ csrfToken: 'test-token' });
    }

    if (requestUrl === '/api/conversations' && method === 'POST') {
      createRequests += 1;
      return slowCreate.promise;
    }

    if (requestUrl === '/api/conversations?characterId=char-new') {
      return jsonResponse([
        {
          id: 'conv-created',
          title: 'New story',
          characterId: 'char-new',
          character: { name: 'New' },
          usage: {}
        }
      ]);
    }

    if (requestUrl === '/api/characters?search=&sort=created&tag=') {
      return jsonResponse([
        { id: 'char-new', name: 'New', visibility: 'private' }
      ]);
    }

    if (requestUrl === '/api/presets') {
      return jsonResponse([
        { id: 'preset-new', name: 'New preset', isDefault: true }
      ]);
    }

    return jsonResponse({ message: `Unexpected request: ${requestUrl}` }, 500);
  };

  try {
    const chat = useChatConversation({
      route: { params: { id: 'conv-current' } },
      emit(page, routeName, params) {
        emissions.push([page, routeName, params]);
      },
      showError(message) {
        errors.push(message);
      }
    });

    chat.conversation.value = { id: 'conv-current', characterId: 'char-new' };
    const firstStart = chat.startNewConversation();
    const duplicateStart = chat.startNewConversation();

    assert.equal(chat.startConversationBusy.value, true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(createRequests, 1);

    slowCreate.resolve(jsonResponse({ id: 'conv-created', characterId: 'char-new' }));
    await Promise.all([firstStart, duplicateStart]);

    assert.equal(createRequests, 1);
    assert.equal(chat.startConversationBusy.value, false);
    assert.deepEqual(errors, []);
    assert.deepEqual(emissions, [['navigate', 'chat', { id: 'conv-created' }]]);
  } finally {
    globalThis.fetch = originalFetch;
    slowCreate.resolve(jsonResponse({ id: 'conv-created' }));
  }
});

test('starting a new chat ignores completions after cleanup', async () => {
  const originalFetch = globalThis.fetch;
  const slowCreate = createDeferred();
  const emissions = [];
  const errors = [];
  const requests = [];

  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    const method = String(options.method || 'GET').toUpperCase();
    requests.push([requestUrl, method]);

    if (requestUrl === '/api/conversations' && method === 'POST') {
      return slowCreate.promise;
    }

    return jsonResponse({ message: `Unexpected request: ${requestUrl}` }, 500);
  };

  try {
    const chat = useChatConversation({
      route: { params: { id: 'conv-current' } },
      emit(page, routeName, params) {
        emissions.push([page, routeName, params]);
      },
      showError(message) {
        errors.push(message);
      }
    });

    chat.conversation.value = { id: 'conv-current', characterId: 'char-new' };
    const start = chat.startNewConversation();

    assert.equal(chat.startConversationBusy.value, true);
    chat.cleanup();
    assert.equal(chat.startConversationBusy.value, false);

    slowCreate.resolve(jsonResponse({ id: 'conv-created', characterId: 'char-new' }));
    await start;

    assert.deepEqual(requests, [['/api/conversations', 'POST']]);
    assert.deepEqual(errors, []);
    assert.deepEqual(emissions, []);
    assert.deepEqual(chat.conversations.value, []);
  } finally {
    globalThis.fetch = originalFetch;
    slowCreate.resolve(jsonResponse({ id: 'conv-created' }));
  }
});
