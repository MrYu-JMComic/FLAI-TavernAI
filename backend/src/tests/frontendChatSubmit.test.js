import assert from 'node:assert/strict';
import test from 'node:test';

const { useChatSubmit } = await import('../../../frontend/src/composables/chat/useChatSubmit.js');

function refValue(value) {
  return { value };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function sseResponse(blocks, signal) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`${blocks.join('\n\n')}\n\n`));
      signal?.addEventListener('abort', () => {
        controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      }, { once: true });
    }
  }), {
    headers: { 'Content-Type': 'text/event-stream' }
  });
}

function createSubmitState(overrides = {}) {
  const selectedPresetId = overrides.selectedPresetId || refValue('preset-initial');
  const submit = useChatSubmit({
    route: { params: { id: 'conv-1' } },
    messages: refValue([]),
    provider: refValue({ supportsReasoning: true }),
    selectedPresetId,
    statusBar: refValue(null),
    syncStatusBarForm() {},
    handleSkillResult() {},
    loadStatusBar: async () => {},
    loadSidebarData: async () => {},
    loadEconomyBalance: async () => {},
    stickToBottomIfNeeded() {},
    expandReasoning() {},
    showError() {},
    ...overrides
  });

  return { selectedPresetId, submit };
}

test('chat submit preset selection ignores updates while sending', () => {
  const { selectedPresetId, submit } = createSubmitState();

  submit.sending.value = true;
  submit.setSelectedPresetId('preset-during-send');
  assert.equal(selectedPresetId.value, 'preset-initial');

  submit.sending.value = false;
  submit.setSelectedPresetId('preset-after-send');
  assert.equal(selectedPresetId.value, 'preset-after-send');

  submit.setSelectedPresetId('');
  assert.equal(selectedPresetId.value, '');
});

test('chat submit anchors the assistant reply when an expanded status bar is already pinned', async () => {
  const originalFetch = globalThis.fetch;
  const messages = refValue([]);
  const scrollCalls = [];
  const stickCalls = [];

  globalThis.fetch = async (url, request = {}) => {
    assert.equal(String(url), '/api/conversations/conv-1/messages');
    assert.equal(JSON.parse(request.body).stream, false);
    return jsonResponse({
      userMessage: {
        id: 'user-1',
        role: 'user',
        content: 'Hello'
      },
      assistantMessage: {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Hi'
      },
      provider: 'test-provider',
      usage: null
    });
  };

  try {
    const { submit } = createSubmitState({
      messages,
      selectedPresetId: refValue(''),
      isPinnedToBottom: () => true,
      prepareExpandedStatusBarForSubmit: () => true,
      scrollToMessage(messageId, options) {
        scrollCalls.push({ messageId, options });
        return true;
      },
      stickToBottomIfNeeded(...args) {
        stickCalls.push(args);
      }
    });

    submit.useStream.value = false;
    submit.input.value = 'Hello';

    await submit.submit();

    assert.equal(scrollCalls.length, 2);
    assert.match(scrollCalls[0].messageId, /^local-assistant-/);
    assert.deepEqual(scrollCalls[0].options, { smooth: true, block: 'end' });
    assert.equal(scrollCalls[1].messageId, 'assistant-1');
    assert.deepEqual(scrollCalls[1].options, { smooth: false, block: 'end' });
    assert.equal(stickCalls.length, 0);
    assert.equal(messages.value[0].id, 'user-1');
    assert.equal(messages.value[1].id, 'assistant-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chat submit reconciles a stopped stream to the persisted partial assistant message', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const messages = refValue([]);
  const fetchCalls = [];

  globalThis.window = {
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem() { return null; },
      setItem() {}
    }
  };

  globalThis.fetch = async (url, request = {}) => {
    const requestUrl = String(url);
    fetchCalls.push(requestUrl);

    if (requestUrl === '/api/csrf-token') {
      return jsonResponse({ csrfToken: 'csrf-stop-test' });
    }

    if (requestUrl === '/api/conversations/conv-1/messages' && request.method === 'POST') {
      return sseResponse([
        `event: user_message\ndata: ${JSON.stringify({
          userMessage: { id: 'user-1', role: 'user', content: 'Hello' }
        })}`,
        `event: content\ndata: ${JSON.stringify({ text: 'Partial reply' })}`
      ], request.signal);
    }

    if (requestUrl === '/api/conversations/conv-1/messages' && (!request.method || request.method === 'GET')) {
      return jsonResponse({
        conversation: { id: 'conv-1' },
        messages: [
          { id: 'user-1', role: 'user', content: 'Hello', reasoning: '' },
          { id: 'assistant-1', role: 'assistant', content: 'Partial reply', reasoning: '' }
        ]
      });
    }

    return jsonResponse({ error: `Unexpected request: ${requestUrl}` }, 500);
  };

  try {
    const { submit } = createSubmitState({
      messages,
      selectedPresetId: refValue(''),
      stickToBottomIfNeeded() {}
    });

    submit.input.value = 'Hello';
    const submitPromise = submit.submit();
    await waitFor(() => messages.value.some((message) => message.role === 'assistant' && message.content === 'Partial reply'));

    submit.stop();
    await submitPromise;

    assert.equal(messages.value[0].id, 'user-1');
    assert.equal(messages.value[1].id, 'assistant-1');
    assert.equal(messages.value[1].content, 'Partial reply');
    assert.equal(messages.value[1].streaming, false);
    assert.equal(fetchCalls.filter((item) => item === '/api/conversations/conv-1/messages').length >= 2, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(predicate(), true);
}
