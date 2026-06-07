import assert from 'node:assert/strict';
import test from 'node:test';

const { useChatConversation } = await import('../../../frontend/src/composables/chat/useChatConversation.js');

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
