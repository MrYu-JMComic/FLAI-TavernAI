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
