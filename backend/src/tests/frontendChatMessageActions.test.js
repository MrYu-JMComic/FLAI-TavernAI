import assert from 'node:assert/strict';
import test from 'node:test';

const { useChatMessageActions } = await import('../../../frontend/src/composables/chat/useChatMessageActions.js');

function refValue(value) {
  return { value };
}

function createMessageActions({
  messages = [{ id: 'msg-1', role: 'user', content: 'Original' }]
} = {}) {
  return useChatMessageActions({
    messages: refValue(messages),
    messageScroller: refValue(null),
    route: { params: { id: 'conv-1' } },
    user: refValue({ username: 'tester' }),
    activeCharacter: () => null,
    loadSidebarData: async () => {},
    showActionNotice() {},
    showError() {}
  });
}

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload)
  };
}

function deferredResponse(payload) {
  let resolveResponse;
  const promise = new Promise((resolve) => {
    resolveResponse = () => resolve(jsonResponse(payload));
  });
  return { promise, resolve: resolveResponse };
}

test('message edit draft entry points ignore updates while a message action is busy', async () => {
  const actions = createMessageActions();
  actions.editingMessageId.value = 'msg-1';
  actions.editingMessageContent.value = 'Draft';
  actions.messageActionBusy.value = 'msg-1';

  actions.setEditingMessageContent('Changed while busy');
  await actions.cancelEditMessage({ id: 'msg-1' });

  assert.equal(actions.editingMessageId.value, 'msg-1');
  assert.equal(actions.editingMessageContent.value, 'Draft');

  actions.messageActionBusy.value = '';
  actions.setEditingMessageContent('Changed after busy');
  await actions.cancelEditMessage({ id: 'msg-1' });

  assert.equal(actions.editingMessageId.value, '');
  assert.equal(actions.editingMessageContent.value, '');
});

test('message UI reset preserves empty collection references', () => {
  const actions = createMessageActions();
  const expandedReasoning = actions.expandedReasoning.value;
  const swipeLoading = actions.swipeLoading.value;
  const conversationBranches = actions.conversationBranches.value;

  actions.resetMessageUiState();

  assert.equal(actions.expandedReasoning.value, expandedReasoning);
  assert.equal(actions.swipeLoading.value, swipeLoading);
  assert.equal(actions.conversationBranches.value, conversationBranches);
});

test('message UI reset clears populated collection state', () => {
  const actions = createMessageActions();
  actions.toggleReasoning('msg-1');
  actions.swipeLoading.value.add('msg-1');
  actions.messageSwipeState['msg-1'] = { swipes: [], activeIndex: 0, swipeCount: 1 };
  actions.conversationBranches.value = [{ id: 'branch-1' }];
  const expandedReasoning = actions.expandedReasoning.value;
  const swipeLoading = actions.swipeLoading.value;
  const conversationBranches = actions.conversationBranches.value;

  actions.resetMessageUiState();

  assert.notEqual(actions.expandedReasoning.value, expandedReasoning);
  assert.notEqual(actions.swipeLoading.value, swipeLoading);
  assert.notEqual(actions.conversationBranches.value, conversationBranches);
  assert.equal(actions.expandedReasoning.value.size, 0);
  assert.equal(actions.swipeLoading.value.size, 0);
  assert.equal(actions.conversationBranches.value.length, 0);
  assert.deepEqual(Object.keys(actions.messageSwipeState), []);
});

test('branch list load preserves empty branch array references', async () => {
  const actions = createMessageActions();
  const originalFetch = globalThis.fetch;
  const initialBranches = actions.conversationBranches.value;

  try {
    globalThis.fetch = async (url) => {
      assert.equal(String(url), '/api/conversations/conv-1/branches');
      return jsonResponse([]);
    };

    await actions.loadConversationBranches('conv-1');
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(actions.conversationBranches.value, initialBranches);
});

test('branch list load preserves references for unchanged branch data', async () => {
  const actions = createMessageActions();
  const originalFetch = globalThis.fetch;
  let calls = 0;

  try {
    globalThis.fetch = async () => {
      calls += 1;
      return jsonResponse([
        {
          id: 'branch-1',
          title: 'Branch',
          branchedFromMessageId: 'msg-1',
          createdAt: '2026-06-08T00:00:00.000Z',
          characterName: 'Tester'
        }
      ]);
    };

    await actions.loadConversationBranches('conv-1');
    const loadedBranches = actions.conversationBranches.value;
    await actions.loadConversationBranches('conv-1');

    assert.equal(actions.conversationBranches.value, loadedBranches);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('message swipe initialization starts assistant swipe loads in parallel', async () => {
  const actions = createMessageActions({
    messages: [
      { id: 'user-1', role: 'user', content: 'User message' },
      { id: 'assistant-1', role: 'assistant', content: 'First assistant' },
      { id: 'assistant-2', role: 'assistant', content: 'Second assistant' }
    ]
  });
  const originalFetch = globalThis.fetch;
  const requests = [];
  const firstResponse = deferredResponse([{ id: 'swipe-1', content: 'Alt', reasoning: '' }]);
  const secondResponse = deferredResponse([]);

  try {
    globalThis.fetch = async (url) => {
      const path = String(url);
      requests.push(path);
      if (path === '/api/messages/assistant-1/swipes') {
        return firstResponse.promise;
      }
      if (path === '/api/messages/assistant-2/swipes') {
        return secondResponse.promise;
      }
      throw new Error(`Unexpected request: ${path}`);
    };

    const initPromise = actions.initMessageSwipes('conv-1');
    await Promise.resolve();

    assert.deepEqual(requests, [
      '/api/messages/assistant-1/swipes',
      '/api/messages/assistant-2/swipes'
    ]);

    secondResponse.resolve();
    firstResponse.resolve();
    await initPromise;
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(actions.messageSwipeState['assistant-1'].swipeCount, 2);
  assert.equal(actions.messageSwipeState['assistant-2'].swipeCount, 1);
  assert.equal(actions.messageSwipeState['user-1'], undefined);
});
