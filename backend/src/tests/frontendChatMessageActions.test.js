import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { readRepoText } from './frontendSfcTestUtils.js';

const { useChatMessageActions } = await import('../../../frontend/src/composables/chat/useChatMessageActions.js');
const chatMessageActionsSource = readRepoText('frontend/src/composables/chat/useChatMessageActions.js');
const requireFromFrontend = createRequire(new URL('../../../frontend/package.json', import.meta.url));
const { nextTick, shallowRef, watch } = requireFromFrontend('vue');

function refValue(value) {
  return { value };
}

function createMessageActions({
  messages = [{ id: 'msg-1', role: 'user', content: 'Original' }],
  messagesRef = refValue(messages),
  route = { params: { id: 'conv-1' } },
  userRef = refValue({ username: 'tester' }),
  activeCharacter = () => null,
  loadSidebarData = async () => {},
  showActionNotice = () => {},
  showError = () => {}
} = {}) {
  return useChatMessageActions({
    messages: messagesRef,
    messageScroller: refValue(null),
    route,
    user: userRef,
    activeCharacter,
    loadSidebarData,
    showActionNotice,
    showError
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

test('message author helpers reuse cached identity summaries', () => {
  const assistantRef = shallowRef({
    name: 'Alice',
    avatarUrl: '/avatars/alice.png'
  });
  const userRef = shallowRef({
    displayName: 'Tester',
    avatarUrl: '/avatars/tester.png'
  });
  let activeCharacterReads = 0;
  const actions = createMessageActions({
    userRef,
    activeCharacter() {
      activeCharacterReads += 1;
      return assistantRef.value;
    }
  });

  const assistantMessage = { id: 'assistant-1', role: 'assistant' };
  assert.equal(actions.messageAuthorName(assistantMessage), 'Alice');
  assert.equal(actions.messageAuthorInitial(assistantMessage), 'A');
  assert.equal(actions.messageAvatarUrl(assistantMessage), '/avatars/alice.png');
  assert.equal(activeCharacterReads, 1);

  assistantRef.value = {
    name: 'Bai',
    avatarUrl: '/avatars/bai.png'
  };
  assert.equal(actions.messageAuthorName(assistantMessage), 'Bai');
  assert.equal(actions.messageAuthorInitial(assistantMessage), 'B');
  assert.equal(actions.messageAvatarUrl(assistantMessage), '/avatars/bai.png');
  assert.equal(activeCharacterReads, 2);

  const userMessage = { id: 'user-1', role: 'user' };
  assert.equal(actions.messageAuthorName(userMessage), 'Tester');
  assert.equal(actions.messageAuthorInitial(userMessage), 'T');
  assert.equal(actions.messageAvatarUrl(userMessage), '/avatars/tester.png');

  userRef.value = {
    accountName: 'Account User',
    avatarUrl: '/avatars/account.png'
  };
  assert.equal(actions.messageAuthorName(userMessage), 'Account User');
  assert.equal(actions.messageAuthorInitial(userMessage), 'A');
  assert.equal(actions.messageAvatarUrl(userMessage), '/avatars/account.png');
});

test('message author helper source uses cached identity summaries', () => {
  assert.match(
    chatMessageActionsSource,
    /const assistantMessageIdentity = computed\(\(\) => \{[\s\S]*const character = typeof activeCharacter === 'function' \? activeCharacter\(\) : null;[\s\S]*return buildMessageIdentity\(character\?\.name \|\| 'AI', character\?\.avatarUrl \|\| ''\);[\s\S]*\}\);/
  );
  assert.match(
    chatMessageActionsSource,
    /const userMessageIdentity = computed\(\(\) => \{[\s\S]*const currentUser = user\.value \|\| \{\};[\s\S]*currentUser\.displayName \|\| currentUser\.accountName \|\| currentUser\.username \|\| 'User'[\s\S]*\}\);/
  );
  assert.match(
    chatMessageActionsSource,
    /function getMessageIdentity\(message\) \{[\s\S]*return assistantMessageIdentity\.value;[\s\S]*return userMessageIdentity\.value;[\s\S]*return buildMessageIdentity\(message\.role \|\| 'Message'\);[\s\S]*\}/
  );
  assert.match(chatMessageActionsSource, /function messageAuthorName\(message\) \{\s*return getMessageIdentity\(message\)\.name;/);
  assert.match(chatMessageActionsSource, /function messageAuthorInitial\(message\) \{\s*return getMessageIdentity\(message\)\.initial;/);
  assert.match(chatMessageActionsSource, /function messageAvatarUrl\(message\) \{\s*return getMessageIdentity\(message\)\.avatarUrl;/);
  assert.doesNotMatch(chatMessageActionsSource, /return activeCharacter\(\)\?\.name \|\| 'AI'/);
  assert.doesNotMatch(chatMessageActionsSource, /return activeCharacter\(\)\?\.avatarUrl \|\| ''/);
});

test('message edit draft entry points ignore updates while message or branch actions are busy', async () => {
  const actions = createMessageActions();
  actions.editingMessageId.value = 'msg-1';
  actions.editingMessageContent.value = 'Draft';
  actions.messageActionBusy.value = 'msg-1';

  actions.setEditingMessageContent('Changed while busy');
  await actions.cancelEditMessage({ id: 'msg-1' });

  assert.equal(actions.editingMessageId.value, 'msg-1');
  assert.equal(actions.editingMessageContent.value, 'Draft');

  actions.messageActionBusy.value = '';
  actions.branchBusy.value = true;
  actions.setEditingMessageContent('Changed while branch busy');
  await actions.cancelEditMessage({ id: 'msg-1' });

  assert.equal(actions.editingMessageId.value, 'msg-1');
  assert.equal(actions.editingMessageContent.value, 'Draft');

  actions.branchBusy.value = false;
  actions.setEditingMessageContent('Changed after busy');
  await actions.cancelEditMessage({ id: 'msg-1' });

  assert.equal(actions.editingMessageId.value, '');
  assert.equal(actions.editingMessageContent.value, '');
});

test('message copy ignores duplicate clicks while clipboard work is busy', async () => {
  const originalWindow = globalThis.window;
  const notices = [];
  const writes = [];
  let resolveWrite;
  let resolveWriteStarted;
  const writeStarted = new Promise((resolve) => {
    resolveWriteStarted = resolve;
  });
  const writePending = new Promise((resolve) => {
    resolveWrite = resolve;
  });
  const actions = createMessageActions({
    showActionNotice(messageText, type) {
      notices.push([messageText, type]);
    }
  });

  globalThis.window = {
    navigator: {
      permissions: {
        query: async () => ({ state: 'granted' })
      },
      clipboard: {
        writeText: async (text) => {
          writes.push(text);
          resolveWriteStarted();
          await writePending;
        }
      }
    }
  };

  try {
    const copyPromise = actions.copyMessage({ id: 'msg-1', content: '  First copy  ' });
    await writeStarted;

    assert.equal(actions.copyBusy.value, true);
    await actions.copyMessage({ id: 'msg-2', content: 'Second copy' });

    assert.deepEqual(writes, ['First copy']);
    assert.deepEqual(notices, []);

    resolveWrite();
    await copyPromise;

    assert.equal(actions.copyBusy.value, false);
    assert.equal(notices.length, 1);
    assert.equal(notices[0][1], undefined);
  } finally {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('reasoning state ignores blank ids without replacing refs', () => {
  const actions = createMessageActions();
  const initialReasoning = actions.expandedReasoning.value;

  actions.toggleReasoning('');
  actions.toggleReasoning(null);
  actions.expandReasoning(undefined);

  assert.equal(actions.expandedReasoning.value, initialReasoning);
  assert.equal(actions.expandedReasoning.value.size, 0);
  assert.equal(actions.reasoningOpen(''), false);

  actions.toggleReasoning(0);
  const populatedReasoning = actions.expandedReasoning.value;

  assert.notEqual(populatedReasoning, initialReasoning);
  assert.equal(actions.reasoningOpen(0), true);

  actions.expandReasoning(0);
  assert.equal(actions.expandedReasoning.value, populatedReasoning);
});

test('unchanged message edits close the draft without API or sidebar refresh work', async () => {
  const originalFetch = globalThis.fetch;
  const notices = [];
  let sidebarLoads = 0;
  const message = { id: 'msg-1', role: 'user', content: 'Original' };
  const actions = createMessageActions({
    messages: [message],
    loadSidebarData() {
      sidebarLoads += 1;
    },
    showActionNotice(messageText, type) {
      notices.push([messageText, type]);
    }
  });
  actions.editingMessageId.value = 'msg-1';
  actions.editingMessageContent.value = '  Original  ';

  globalThis.fetch = async (url) => {
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    await actions.saveMessageEdit(message);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(actions.editingMessageId.value, '');
  assert.equal(actions.editingMessageContent.value, '');
  assert.equal(actions.messageActionBusy.value, '');
  assert.equal(message.content, 'Original');
  assert.equal(sidebarLoads, 0);
  assert.deepEqual(notices, []);
});

test('message edit drafts use the current list item for stale same-id events', async () => {
  const currentMessage = { id: 'msg-1', role: 'user', content: 'Current content' };
  const actions = createMessageActions({
    messages: [currentMessage]
  });

  await actions.beginEditMessage({ id: 'msg-1', role: 'user', content: 'Stale content' });

  assert.equal(actions.editingMessageId.value, 'msg-1');
  assert.equal(actions.editingMessageContent.value, 'Current content');
});

test('message edit saves update the current list item for stale same-id events', async () => {
  const originalFetch = globalThis.fetch;
  const currentMessage = { id: 'msg-1', role: 'user', content: 'Current content' };
  const staleMessage = { id: 'msg-1', role: 'user', content: 'Stale content' };
  const messagesRef = refValue([currentMessage]);
  let sidebarLoads = 0;
  const notices = [];
  const actions = createMessageActions({
    messagesRef,
    loadSidebarData() {
      sidebarLoads += 1;
    },
    showActionNotice(messageText, type) {
      notices.push([messageText, type]);
    }
  });
  actions.editingMessageId.value = 'msg-1';
  actions.editingMessageContent.value = 'Updated content';

  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    const method = String(options.method || 'GET').toUpperCase();

    if (requestUrl === '/api/csrf-token') {
      return jsonResponse({ csrfToken: 'edit-token' });
    }
    if (requestUrl === '/api/conversations/conv-1/messages/msg-1' && method === 'PATCH') {
      return jsonResponse({ id: 'msg-1', role: 'user', content: 'Updated content' });
    }
    throw new Error(`Unexpected request: ${requestUrl}`);
  };

  try {
    await actions.saveMessageEdit(staleMessage);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(currentMessage.content, 'Updated content');
  assert.equal(staleMessage.content, 'Stale content');
  assert.equal(messagesRef.value[0], currentMessage);
  assert.equal(actions.editingMessageId.value, '');
  assert.equal(actions.messageActionBusy.value, '');
  assert.equal(sidebarLoads, 1);
  assert.equal(notices.length, 1);
});

test('message edit save ignores completions after the same-id list item is replaced', async () => {
  const originalFetch = globalThis.fetch;
  const originalMessage = { id: 'msg-1', role: 'user', content: 'Original content' };
  const replacementMessage = { id: 'msg-1', role: 'user', content: 'Replacement content' };
  const messagesRef = shallowRef([originalMessage]);
  const notices = [];
  let sidebarLoads = 0;
  let patchBody = null;
  let resolvePatchStarted;
  const patchStarted = new Promise((resolve) => {
    resolvePatchStarted = resolve;
  });
  const patchResponse = deferredResponse({ id: 'msg-1', role: 'user', content: 'Updated content' });
  const actions = createMessageActions({
    messagesRef,
    loadSidebarData() {
      sidebarLoads += 1;
    },
    showActionNotice(messageText, type) {
      notices.push([messageText, type]);
    }
  });
  actions.editingMessageId.value = 'msg-1';
  actions.editingMessageContent.value = 'Updated content';

  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    const method = String(options.method || 'GET').toUpperCase();

    if (requestUrl === '/api/csrf-token') {
      return jsonResponse({ csrfToken: 'edit-token' });
    }
    if (requestUrl === '/api/conversations/conv-1/messages/msg-1' && method === 'PATCH') {
      patchBody = JSON.parse(String(options.body || '{}'));
      resolvePatchStarted();
      return patchResponse.promise;
    }
    throw new Error(`Unexpected request: ${requestUrl}`);
  };

  try {
    const savePromise = actions.saveMessageEdit(originalMessage);
    await patchStarted;

    messagesRef.value = [replacementMessage];

    patchResponse.resolve();
    await savePromise;
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(patchBody, { content: 'Updated content' });
  assert.equal(originalMessage.content, 'Original content');
  assert.equal(replacementMessage.content, 'Replacement content');
  assert.deepEqual(messagesRef.value, [replacementMessage]);
  assert.equal(actions.editingMessageId.value, 'msg-1');
  assert.equal(actions.editingMessageContent.value, 'Updated content');
  assert.equal(actions.messageActionBusy.value, '');
  assert.equal(sidebarLoads, 0);
  assert.deepEqual(notices, []);
});

test('message mutation guards use current list streaming state for stale same-id events', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const actions = createMessageActions({
    messages: [{ id: 'msg-1', role: 'assistant', content: 'Streaming', streaming: true }]
  });
  const staleMessage = { id: 'msg-1', role: 'assistant', content: 'Old complete content', streaming: false };
  let confirmCount = 0;
  let branchCallbacks = 0;

  globalThis.window = {
    confirm: () => {
      confirmCount += 1;
      return true;
    }
  };
  globalThis.fetch = async (url) => {
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    assert.equal(actions.canEditMessage(staleMessage), false);
    assert.equal(actions.canDeleteMessage(staleMessage), false);
    assert.equal(actions.canBranchMessage(staleMessage), false);

    await actions.beginEditMessage(staleMessage);
    await actions.saveMessageEdit(staleMessage);
    await actions.removeMessage(staleMessage);
    await actions.handleBranchMessage(staleMessage, 'conv-1', () => {
      branchCallbacks += 1;
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }

  assert.equal(actions.editingMessageId.value, '');
  assert.equal(actions.messageActionBusy.value, '');
  assert.equal(actions.branchBusy.value, false);
  assert.equal(confirmCount, 0);
  assert.equal(branchCallbacks, 0);
});

test('stale message delete ignores missing current-list items before confirm or request', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const messagesRef = refValue([{ id: 'msg-2', role: 'assistant', content: 'Still visible' }]);
  const initialMessages = messagesRef.value;
  const notices = [];
  let sidebarLoads = 0;
  let confirmCount = 0;
  const requests = [];
  const actions = createMessageActions({
    messagesRef,
    loadSidebarData() {
      sidebarLoads += 1;
    },
    showActionNotice(messageText, type) {
      notices.push([messageText, type]);
    }
  });

  globalThis.window = {
    confirm: () => {
      confirmCount += 1;
      return true;
    },
    requestAnimationFrame(callback) {
      callback();
      return 1;
    },
    cancelAnimationFrame() {}
  };
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    const method = String(options.method || 'GET').toUpperCase();
    requests.push([requestUrl, method]);

    if (requestUrl === '/api/csrf-token') {
      return jsonResponse({ csrfToken: 'delete-token' });
    }
    throw new Error(`Unexpected request: ${requestUrl}`);
  };

  try {
    await actions.removeMessage({ id: 'msg-1', role: 'user', content: 'Already removed' });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }

  assert.equal(messagesRef.value, initialMessages);
  assert.equal(messagesRef.value.length, 1);
  assert.equal(messagesRef.value[0].id, 'msg-2');
  assert.equal(confirmCount, 0);
  assert.deepEqual(requests, []);
  assert.equal(sidebarLoads, 0);
  assert.deepEqual(notices, []);
  assert.equal(actions.messageActionBusy.value, '');
});

test('message delete ignores completions after the same-id list item is replaced', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalMessage = { id: 'msg-1', role: 'assistant', content: 'Original content' };
  const replacementMessage = { id: 'msg-1', role: 'assistant', content: 'Replacement content' };
  const messagesRef = shallowRef([originalMessage]);
  const notices = [];
  let sidebarLoads = 0;
  let confirmCount = 0;
  let resolveDeleteStarted;
  const deleteStarted = new Promise((resolve) => {
    resolveDeleteStarted = resolve;
  });
  const deleteResponse = deferredResponse({ deletedReasoning: false });
  const actions = createMessageActions({
    messagesRef,
    loadSidebarData() {
      sidebarLoads += 1;
    },
    showActionNotice(messageText, type) {
      notices.push([messageText, type]);
    }
  });
  actions.editingMessageId.value = 'msg-1';
  actions.editingMessageContent.value = 'Replacement draft';

  globalThis.window = {
    confirm: () => {
      confirmCount += 1;
      return true;
    }
  };
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    const method = String(options.method || 'GET').toUpperCase();

    if (requestUrl === '/api/csrf-token') {
      return jsonResponse({ csrfToken: 'delete-token' });
    }
    if (requestUrl === '/api/conversations/conv-1/messages/msg-1' && method === 'DELETE') {
      resolveDeleteStarted();
      return deleteResponse.promise;
    }
    throw new Error(`Unexpected request: ${requestUrl}`);
  };

  try {
    const deletePromise = actions.removeMessage(originalMessage);
    await deleteStarted;

    messagesRef.value = [replacementMessage];

    deleteResponse.resolve();
    await deletePromise;
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }

  assert.equal(confirmCount, 1);
  assert.deepEqual(messagesRef.value, [replacementMessage]);
  assert.equal(originalMessage.content, 'Original content');
  assert.equal(replacementMessage.content, 'Replacement content');
  assert.equal(actions.editingMessageId.value, 'msg-1');
  assert.equal(actions.editingMessageContent.value, 'Replacement draft');
  assert.equal(actions.messageActionBusy.value, '');
  assert.equal(sidebarLoads, 0);
  assert.deepEqual(notices, []);
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

test('message swipe generation replaces loading Set refs when pending state changes', async () => {
  const originalFetch = globalThis.fetch;
  const message = { id: 'msg-1', role: 'assistant', content: 'Current', reasoning: '' };
  const actions = createMessageActions({ messages: [message] });
  const swipeResponse = deferredResponse({ id: 'swipe-1', content: 'Alternative', reasoning: 'Reasoned' });
  let swipeRequests = 0;

  actions.messageSwipeState['msg-1'] = { swipes: [], activeIndex: 0, swipeCount: 1 };

  try {
    globalThis.fetch = async (url, options = {}) => {
      const path = String(url);
      const method = String(options.method || 'GET').toUpperCase();

      if (path === '/api/csrf-token') {
        return jsonResponse({ csrfToken: 'swipe-token' });
      }
      if (path === '/api/messages/msg-1/swipes' && method === 'POST') {
        swipeRequests += 1;
        return swipeResponse.promise;
      }
      throw new Error(`Unexpected request: ${path}`);
    };

    const initialLoading = actions.swipeLoading.value;
    const swipePromise = actions.swipeMessageNext(message, 'conv-1');
    const pendingLoading = actions.swipeLoading.value;

    assert.notEqual(pendingLoading, initialLoading);
    assert.equal(pendingLoading.has('msg-1'), true);

    swipeResponse.resolve();
    await swipePromise;

    assert.equal(swipeRequests, 1);
    assert.equal(message.content, 'Alternative');
    assert.equal(message.reasoning, 'Reasoned');
    assert.notEqual(actions.swipeLoading.value, pendingLoading);
    assert.equal(actions.swipeLoading.value.has('msg-1'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('message swipe content triggers shallow message refs only when visible text changes', async () => {
  const changedMessage = { id: 'msg-1', role: 'assistant', content: 'Current', reasoning: '' };
  const changedMessages = shallowRef([changedMessage]);
  const changedActions = createMessageActions({ messagesRef: changedMessages });
  let changedTriggers = 0;
  const stopChangedWatch = watch(changedMessages, () => {
    changedTriggers += 1;
  });

  changedActions.messageSwipeState['msg-1'] = {
    swipes: [{ id: 'swipe-1', content: 'Alternative', reasoning: 'Reasoned' }],
    activeIndex: 0,
    swipeCount: 2
  };

  try {
    await changedActions.swipeMessageNext(changedMessage, 'conv-1');
    await nextTick();

    assert.equal(changedMessage.content, 'Alternative');
    assert.equal(changedMessage.reasoning, 'Reasoned');
    assert.equal(changedTriggers, 1);
  } finally {
    stopChangedWatch();
  }

  const sameMessage = { id: 'msg-2', role: 'assistant', content: 'Same', reasoning: '' };
  const sameMessages = shallowRef([sameMessage]);
  const sameActions = createMessageActions({ messagesRef: sameMessages });
  let sameTriggers = 0;
  const stopSameWatch = watch(sameMessages, () => {
    sameTriggers += 1;
  });

  sameActions.messageSwipeState['msg-2'] = {
    swipes: [{ id: 'swipe-2', content: 'Same', reasoning: '' }],
    activeIndex: 0,
    swipeCount: 2
  };

  try {
    await sameActions.swipeMessageNext(sameMessage, 'conv-1');
    await nextTick();

    assert.equal(sameMessage.content, 'Same');
    assert.equal(sameMessage.reasoning, '');
    assert.equal(sameActions.messageSwipeState['msg-2'].activeIndex, 1);
    assert.equal(sameTriggers, 0);
  } finally {
    stopSameWatch();
  }
});

test('message swipe navigation uses current list items for stale same-id events', async () => {
  const currentMessage = { id: 'msg-1', role: 'assistant', content: 'Original', reasoning: 'Base' };
  const staleMessage = { id: 'msg-1', role: 'assistant', content: 'Stale', reasoning: 'Old' };
  const messagesRef = shallowRef([currentMessage]);
  const actions = createMessageActions({ messagesRef });
  let triggers = 0;
  const stopWatch = watch(messagesRef, () => {
    triggers += 1;
  });

  actions.messageSwipeState['msg-1'] = {
    original: { content: 'Original', reasoning: 'Base' },
    swipes: [{ id: 'swipe-1', content: 'Alternative', reasoning: 'Reasoned' }],
    activeIndex: 0,
    swipeCount: 2
  };

  try {
    await actions.swipeMessageNext(staleMessage, 'conv-1');
    await nextTick();

    assert.equal(currentMessage.content, 'Alternative');
    assert.equal(currentMessage.reasoning, 'Reasoned');
    assert.equal(staleMessage.content, 'Stale');
    assert.equal(staleMessage.reasoning, 'Old');
    assert.equal(triggers, 1);

    await actions.swipeMessagePrev(staleMessage);
    await nextTick();

    assert.equal(currentMessage.content, 'Original');
    assert.equal(currentMessage.reasoning, 'Base');
    assert.equal(staleMessage.content, 'Stale');
    assert.equal(staleMessage.reasoning, 'Old');
    assert.equal(actions.messageSwipeState['msg-1'].activeIndex, 0);
    assert.equal(triggers, 2);
  } finally {
    stopWatch();
  }
});

test('message swipe generation uses current list item payloads for stale same-id events', async () => {
  const originalFetch = globalThis.fetch;
  const currentMessage = {
    id: 'msg-1',
    role: 'assistant',
    content: 'Current content',
    reasoning: 'Current reasoning',
    usage: { totalTokens: 5 }
  };
  const staleMessage = {
    id: 'msg-1',
    role: 'assistant',
    content: 'Stale content',
    reasoning: 'Stale reasoning',
    usage: { totalTokens: 1 }
  };
  const actions = createMessageActions({ messages: [currentMessage] });
  let swipeBody = null;

  actions.messageSwipeState['msg-1'] = {
    original: { content: 'Current content', reasoning: 'Current reasoning' },
    swipes: [],
    activeIndex: 0,
    swipeCount: 1
  };

  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    const method = String(options.method || 'GET').toUpperCase();

    if (requestUrl === '/api/csrf-token') {
      return jsonResponse({ csrfToken: 'swipe-token' });
    }
    if (requestUrl === '/api/messages/msg-1/swipes' && method === 'POST') {
      swipeBody = JSON.parse(String(options.body || '{}'));
      return jsonResponse({ id: 'swipe-1', content: 'Generated', reasoning: 'Generated reasoning' });
    }
    throw new Error(`Unexpected request: ${requestUrl}`);
  };

  try {
    await actions.swipeMessageNext(staleMessage, 'conv-1');
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(swipeBody, {
    content: 'Current content',
    reasoning: 'Current reasoning',
    usage: { totalTokens: 5 }
  });
  assert.equal(currentMessage.content, 'Generated');
  assert.equal(currentMessage.reasoning, 'Generated reasoning');
  assert.equal(staleMessage.content, 'Stale content');
  assert.equal(staleMessage.reasoning, 'Stale reasoning');
  assert.equal(actions.messageSwipeState['msg-1'].activeIndex, 1);
});

test('message swipe generation ignores completions after the same-id list item is replaced', async () => {
  const originalFetch = globalThis.fetch;
  const originalMessage = {
    id: 'msg-1',
    role: 'assistant',
    content: 'Original content',
    reasoning: 'Original reasoning',
    usage: { totalTokens: 5 }
  };
  const replacementMessage = {
    id: 'msg-1',
    role: 'assistant',
    content: 'Replacement content',
    reasoning: 'Replacement reasoning',
    usage: { totalTokens: 9 }
  };
  const messagesRef = shallowRef([originalMessage]);
  const actions = createMessageActions({ messagesRef });
  const swipeResponse = deferredResponse({ id: 'swipe-1', content: 'Generated', reasoning: 'Generated reasoning' });
  let resolvePostStarted;
  const postStarted = new Promise((resolve) => {
    resolvePostStarted = resolve;
  });

  actions.messageSwipeState['msg-1'] = {
    original: { content: 'Original content', reasoning: 'Original reasoning' },
    swipes: [],
    activeIndex: 0,
    swipeCount: 1
  };

  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    const method = String(options.method || 'GET').toUpperCase();

    if (requestUrl === '/api/csrf-token') {
      return jsonResponse({ csrfToken: 'swipe-token' });
    }
    if (requestUrl === '/api/messages/msg-1/swipes' && method === 'POST') {
      resolvePostStarted();
      return swipeResponse.promise;
    }
    throw new Error(`Unexpected request: ${requestUrl}`);
  };

  try {
    const swipePromise = actions.swipeMessageNext(originalMessage, 'conv-1');
    await postStarted;

    messagesRef.value = [replacementMessage];
    actions.messageSwipeState['msg-1'] = {
      original: { content: 'Replacement content', reasoning: 'Replacement reasoning' },
      swipes: [],
      activeIndex: 0,
      swipeCount: 1
    };

    swipeResponse.resolve();
    await swipePromise;
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(originalMessage.content, 'Original content');
  assert.equal(originalMessage.reasoning, 'Original reasoning');
  assert.equal(replacementMessage.content, 'Replacement content');
  assert.equal(replacementMessage.reasoning, 'Replacement reasoning');
  assert.deepEqual(actions.messageSwipeState['msg-1'].swipes, []);
  assert.equal(actions.messageSwipeState['msg-1'].activeIndex, 0);
  assert.equal(actions.messageSwipeState['msg-1'].swipeCount, 1);
  assert.equal(actions.swipeLoading.value.size, 0);
});

test('message swipe navigation stays locked while message or branch actions are busy', async () => {
  const originalFetch = globalThis.fetch;
  const message = { id: 'msg-1', role: 'assistant', content: 'Current', reasoning: '' };
  const actions = createMessageActions({ messages: [message] });
  actions.messageSwipeState['msg-1'] = {
    swipes: [{ id: 'swipe-1', content: 'Alternative', reasoning: 'Reasoned' }],
    activeIndex: 0,
    swipeCount: 2
  };

  globalThis.fetch = async (url) => {
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    actions.messageActionBusy.value = 'msg-1';
    await actions.swipeMessageNext(message, 'conv-1');

    assert.equal(actions.messageSwipeState['msg-1'].activeIndex, 0);
    assert.equal(message.content, 'Current');
    assert.equal(message.reasoning, '');

    actions.messageActionBusy.value = '';
    actions.branchBusy.value = true;
    await actions.swipeMessageNext(message, 'conv-1');

    assert.equal(actions.messageSwipeState['msg-1'].activeIndex, 0);
    assert.equal(message.content, 'Current');
    assert.equal(message.reasoning, '');
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test('branch actions ignore messages that cannot be persisted before API or busy state', async () => {
  const originalFetch = globalThis.fetch;
  const actions = createMessageActions();
  let branchCallbacks = 0;

  globalThis.fetch = async (url) => {
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    assert.equal(actions.canBranchMessage({ id: 'msg-1', role: 'assistant', content: 'Ready' }), true);
    assert.equal(actions.canBranchMessage({ id: 'local-msg-1', role: 'assistant', content: 'Draft' }), false);
    assert.equal(actions.canBranchMessage({ id: 'msg-2', role: 'assistant', streaming: true }), false);
    assert.equal(actions.canBranchMessage({ role: 'assistant', content: 'Missing id' }), false);
    assert.equal(actions.canBranchMessage({ id: 'msg-stale', role: 'assistant', content: 'Stale' }), false);

    actions.messageActionBusy.value = 'msg-1';
    assert.equal(actions.canBranchMessage({ id: 'msg-1', role: 'assistant', content: 'Ready' }), false);
    await actions.handleBranchMessage({ id: 'msg-1', role: 'assistant', content: 'Ready' }, 'conv-1', () => {
      branchCallbacks += 1;
    });

    actions.messageActionBusy.value = '';
    await actions.handleBranchMessage({ id: 'local-msg-1', role: 'assistant', content: 'Draft' }, 'conv-1', () => {
      branchCallbacks += 1;
    });
    await actions.handleBranchMessage({ id: 'msg-2', role: 'assistant', streaming: true }, 'conv-1', () => {
      branchCallbacks += 1;
    });
    await actions.handleBranchMessage({ id: 'msg-3', role: 'assistant', content: 'Ready' }, '', () => {
      branchCallbacks += 1;
    });
    await actions.handleBranchMessage({ id: 'msg-stale', role: 'assistant', content: 'Stale' }, 'conv-1', () => {
      branchCallbacks += 1;
    });

    assert.equal(branchCallbacks, 0);
    assert.equal(actions.branchBusy.value, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('branch action completions ignore callbacks after message UI reset', async () => {
  const originalFetch = globalThis.fetch;
  const branchResponse = deferredResponse({ id: 'branch-reset' });
  const actions = createMessageActions({
    messages: [{ id: 'msg-1', role: 'assistant', content: 'Ready' }]
  });
  let branchCallbacks = 0;

  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    const method = String(options.method || 'GET').toUpperCase();
    if (requestUrl === '/api/csrf-token') {
      return jsonResponse({ csrfToken: 'branch-reset-token' });
    }
    if (requestUrl === '/api/conversations/conv-1/branch' && method === 'POST') {
      return branchResponse.promise;
    }
    throw new Error(`Unexpected request: ${requestUrl}`);
  };

  try {
    const branchPromise = actions.handleBranchMessage(
      { id: 'msg-1', role: 'assistant', content: 'Ready' },
      'conv-1',
      () => {
        branchCallbacks += 1;
      }
    );

    assert.equal(actions.branchBusy.value, true);
    actions.resetMessageUiState();
    assert.equal(actions.branchBusy.value, false);

    branchResponse.resolve();
    await branchPromise;

    assert.equal(branchCallbacks, 0);
    assert.equal(actions.branchBusy.value, false);
  } finally {
    globalThis.fetch = originalFetch;
    branchResponse.resolve();
  }
});

test('branch callbacks receive a stale-route context guard', async () => {
  const originalFetch = globalThis.fetch;
  const route = { params: { id: 'conv-1' } };
  const actions = createMessageActions({
    route,
    messages: [{ id: 'msg-1', role: 'assistant', content: 'Ready' }]
  });
  let callbackRuns = 0;
  let guardWasCurrent = false;
  let guardWasStale = false;

  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    const method = String(options.method || 'GET').toUpperCase();
    if (requestUrl === '/api/csrf-token') {
      return jsonResponse({ csrfToken: 'branch-context-token' });
    }
    if (requestUrl === '/api/conversations/conv-1/branch' && method === 'POST') {
      return jsonResponse({ id: 'branch-context' });
    }
    throw new Error(`Unexpected request: ${requestUrl}`);
  };

  try {
    await actions.handleBranchMessage(
      { id: 'msg-1', role: 'assistant', content: 'Ready' },
      'conv-1',
      async (branchId, isCurrentBranchAction) => {
        callbackRuns += 1;
        assert.equal(branchId, 'branch-context');
        guardWasCurrent = isCurrentBranchAction();
        route.params.id = 'conv-2';
        await Promise.resolve();
        guardWasStale = !isCurrentBranchAction();
      }
    );

    assert.equal(callbackRuns, 1);
    assert.equal(guardWasCurrent, true);
    assert.equal(guardWasStale, true);
    assert.equal(actions.branchBusy.value, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('message edit and delete actions stay locked while a branch action is busy', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const actions = createMessageActions();
  const message = { id: 'msg-1', role: 'assistant', content: 'Ready' };

  globalThis.window = {
    confirm: () => true,
    requestAnimationFrame(callback) {
      callback();
      return 1;
    },
    cancelAnimationFrame() {}
  };
  globalThis.fetch = async (url) => {
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    actions.branchBusy.value = true;
    actions.editingMessageId.value = 'msg-1';
    actions.editingMessageContent.value = 'Changed';

    assert.equal(actions.canEditMessage(message), false);
    assert.equal(actions.canDeleteMessage(message), false);
    await actions.beginEditMessage(message);
    await actions.saveMessageEdit(message);
    await actions.removeMessage(message);

    assert.equal(actions.editingMessageId.value, 'msg-1');
    assert.equal(actions.editingMessageContent.value, 'Changed');
    assert.equal(actions.messageActionBusy.value, '');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('message scroll lookup and swipe initialization avoid list clone helpers', () => {
  assert.match(
    chatMessageActionsSource,
    /function findMessageElement\(messageId\) \{[\s\S]*const elements = messageScroller\.value\.querySelectorAll\('\.deep-message'\);[\s\S]*for \(const element of elements\) \{[\s\S]*return element;[\s\S]*return null;\s*\}/
  );
  assert.match(
    chatMessageActionsSource,
    /function getPersistedMessageListItemId\(message\) \{[\s\S]*message\?\.streaming[\s\S]*return messageId;[\s\S]*\}/
  );
  assert.match(
    chatMessageActionsSource,
    /const messageListIndex = computed\(\(\) => \{[\s\S]*const index = new Map\(\);[\s\S]*for \(const item of messageList\) \{[\s\S]*if \(itemId && !index\.has\(itemId\)\) \{[\s\S]*index\.set\(itemId, item\);[\s\S]*return index;\s*\}\);/
  );
  assert.match(
    chatMessageActionsSource,
    /function findMessageListItem\(messageId\) \{[\s\S]*return messageListIndex\.value\.get\(targetId\) \|\| null;[\s\S]*\}/
  );
  assert.match(
    chatMessageActionsSource,
    /const swipeLoads = \[\];[\s\S]*for \(const message of messages\.value\) \{[\s\S]*const messageId = getPersistedMessageListItemId\(message\);[\s\S]*swipeLoads\.push\(initMessageSwipe\(conversationId, messageId, requestToken\)\);[\s\S]*await Promise\.all\(swipeLoads\);/
  );
  assert.match(
    chatMessageActionsSource,
    /const currentMessage = getCurrentSwipeInitMessage\(requestToken, conversationId, swipeMessageId\);[\s\S]*function getCurrentSwipeInitMessage\(requestToken, conversationId, messageId\) \{[\s\S]*return findMessageListItem\(messageId\);[\s\S]*\}/
  );
  assert.doesNotMatch(chatMessageActionsSource, /\[\.\.\.messageScroller\.value\.querySelectorAll/);
  assert.doesNotMatch(chatMessageActionsSource, /const assistantMessages = messages\.value\.filter/);
  assert.doesNotMatch(chatMessageActionsSource, /assistantMessages\.map/);
  assert.doesNotMatch(chatMessageActionsSource, /messages\.value\.find/);
  assert.doesNotMatch(chatMessageActionsSource, /for \(const message of messages\.value\) \{[\s\S]{0,200}getPersistedMessageActionId\(message\)/);
  assert.doesNotMatch(chatMessageActionsSource, /function isCurrentConversationMessage/);
  assert.doesNotMatch(chatMessageActionsSource, /isCurrentSwipeInit\(requestToken, conversationId, swipeMessageId\)[\s\S]*findMessageListItem\(swipeMessageId\)/);
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

test('message swipe initialization skips local and streaming assistant messages', async () => {
  const actions = createMessageActions({
    messages: [
      { id: 'assistant-ready', role: 'assistant', content: 'Ready assistant' },
      { id: 'local-assistant', role: 'assistant', content: 'Draft assistant' },
      { id: 'assistant-streaming', role: 'assistant', content: 'Streaming assistant', streaming: true }
    ]
  });
  const originalFetch = globalThis.fetch;
  const requests = [];

  try {
    globalThis.fetch = async (url) => {
      const path = String(url);
      requests.push(path);
      if (path === '/api/messages/assistant-ready/swipes') {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request: ${path}`);
    };

    await actions.initMessageSwipes('conv-1');
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests, ['/api/messages/assistant-ready/swipes']);
  assert.equal(actions.messageSwipeState['assistant-ready'].swipeCount, 1);
  assert.equal(actions.messageSwipeState['local-assistant'], undefined);
  assert.equal(actions.messageSwipeState['assistant-streaming'], undefined);
});

test('message swipe initialization ignores stale route conversations without clearing current state', async () => {
  const originalFetch = globalThis.fetch;
  const route = { params: { id: 'conv-2' } };
  const actions = createMessageActions({
    route,
    messages: [
      { id: 'assistant-1', role: 'assistant', content: 'Visible assistant' }
    ]
  });
  const existingState = {
    original: { content: 'Visible assistant', reasoning: '' },
    swipes: [{ id: 'swipe-existing', content: 'Existing alt', reasoning: '' }],
    activeIndex: 0,
    swipeCount: 2
  };
  actions.messageSwipeState['assistant-1'] = existingState;
  let requests = 0;

  globalThis.fetch = async (url) => {
    requests += 1;
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    await actions.initMessageSwipes('conv-1');
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requests, 0);
  assert.equal(actions.messageSwipeState['assistant-1'].swipes[0].id, existingState.swipes[0].id);
  assert.equal(actions.messageSwipeState['assistant-1'].swipeCount, existingState.swipeCount);
  assert.equal(actions.messageSwipeState['assistant-1'].activeIndex, existingState.activeIndex);
  assert.deepEqual(Object.keys(actions.messageSwipeState), ['assistant-1']);
  assert.equal(actions.swipeLoading.value.size, 0);
});
