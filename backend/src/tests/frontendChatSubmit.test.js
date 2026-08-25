import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { readRepoText } from './frontendSfcTestUtils.js';

const { useChatSubmit } = await import('../../../frontend/src/composables/chat/useChatSubmit.js');
const chatSubmitSource = readRepoText('frontend/src/composables/chat/useChatSubmit.js');
const requireFromFrontend = createRequire(new URL('../../../frontend/package.json', import.meta.url));
const { nextTick, shallowRef, watch } = requireFromFrontend('vue');

function refValue(value) {
  return { value };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function sseResponse(blocks, signal, options = {}) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`${blocks.join('\n\n')}\n\n`));
      if (options.close) {
        controller.close();
      }
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

test('chat thinking preference can be turned off for always-reasoning models', () => {
  const { submit } = createSubmitState({
    provider: refValue({
      providerType: 'xai',
      model: 'grok-4.6',
      supportsReasoning: true
    })
  });

  assert.deepEqual(
    submit.thinkingOptions.value.map((option) => option.value),
    ['off', 'low', 'medium', 'high', 'xhigh']
  );
  submit.setThinkingLevel('high');
  assert.equal(submit.thinkingEnabled.value, true);
  submit.setThinkingLevel('off');
  assert.equal(submit.thinkingLevel.value, 'off');
  assert.equal(submit.thinkingEnabled.value, false);
});

test('chat submit remembers failed prompts for visible recovery actions', async () => {
  const originalFetch = globalThis.fetch;
  const previousUser = { id: 'old-user', role: 'user', content: 'Old prompt' };
  const previousAssistant = { id: 'old-assistant', role: 'assistant', content: 'Old reply' };
  const messages = shallowRef([previousUser, previousAssistant]);
  const errors = [];

  globalThis.fetch = async (url, request = {}) => {
    assert.equal(String(url), '/api/conversations/conv-1/messages');
    assert.equal(JSON.parse(request.body).stream, false);
    return jsonResponse({
      error: 'AI 供应商配置不完整',
      accepted: false
    }, 400);
  };

  try {
    const { submit } = createSubmitState({
      messages,
      selectedPresetId: refValue(''),
      showError(message) {
        errors.push(message);
      }
    });

    submit.useStream.value = false;
    submit.input.value = 'Recover this prompt';
    await submit.submit();

    assert.equal(errors[0], 'AI 供应商配置不完整');
    assert.equal(submit.lastFailure.value.content, 'Recover this prompt');
    assert.equal(submit.lastFailure.value.conversationId, 'conv-1');
    assert.equal(submit.lastFailure.value.canRetry, true);
    assert.equal(submit.input.value, 'Recover this prompt');
    assert.deepEqual(messages.value, [previousUser, previousAssistant]);

    assert.equal(submit.restoreLastFailureInput(), true);
    assert.equal(submit.input.value, 'Recover this prompt');
    assert.equal(submit.lastFailure.value, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chat submitDraft reuses persisted asset URL attachments without overwriting drafts', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody = null;

  globalThis.fetch = async (url, request = {}) => {
    assert.equal(String(url), '/api/conversations/conv-1/messages');
    requestBody = JSON.parse(request.body);
    return jsonResponse({
      userMessage: {
        id: 'user-rerun-1',
        role: 'user',
        content: 'Retry with image',
        attachments: [
          {
            type: 'image',
            url: '/api/assets/asset-1/content',
            mimeType: 'image/png',
            name: 'scene.png'
          }
        ]
      },
      assistantMessage: {
        id: 'assistant-rerun-1',
        role: 'assistant',
        content: 'Image-aware reply'
      },
      provider: 'test-provider',
      usage: null
    });
  };

  try {
    const { submit } = createSubmitState({
      provider: refValue({
        providerType: 'openai',
        model: 'gpt-4.1',
        supportsReasoning: false
      }),
      selectedPresetId: refValue('')
    });

    submit.input.value = 'Existing draft';
    assert.equal(await submit.submitDraft('Blocked rerun', []), false);
    assert.equal(submit.input.value, 'Existing draft');

    submit.input.value = '';
    submit.useStream.value = false;
    assert.equal(await submit.submitDraft('Retry with image', [
      {
        type: 'image',
        url: '/api/assets/asset-1/content',
        mimeType: 'image/png',
        name: 'scene.png',
        alt: 'scene'
      }
    ]), true);

    assert.equal(requestBody.stream, false);
    assert.equal(requestBody.content, 'Retry with image');
    assert.deepEqual(requestBody.attachments, [
      {
        id: 'chat-image-0',
        type: 'image',
        mimeType: 'image/png',
        name: 'scene.png',
        alt: 'scene',
        size: 0,
        url: '/api/assets/asset-1/content'
      }
    ]);
    assert.equal(submit.input.value, '');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chat continueGeneration appends only an assistant draft and preserves composer drafts', async () => {
  const originalFetch = globalThis.fetch;
  const previousUser = { id: 'user-prev', role: 'user', content: 'Open the door' };
  const previousAssistant = { id: 'assistant-prev', role: 'assistant', content: 'The door opens with a groan.' };
  const messages = shallowRef([previousUser, previousAssistant]);
  let requestBody = null;

  globalThis.fetch = async (url, request = {}) => {
    assert.equal(String(url), '/api/conversations/conv-1/messages/continue');
    requestBody = JSON.parse(request.body);
    return jsonResponse({
      userMessage: null,
      assistantMessage: {
        id: 'assistant-continue-1',
        role: 'assistant',
        content: 'Cold blue light spills across the floor.'
      },
      provider: 'test-provider',
      usage: null
    });
  };

  try {
    const { submit } = createSubmitState({
      messages,
      selectedPresetId: refValue('preset-continue'),
      provider: refValue({
        providerType: 'openai',
        model: 'gpt-4.1',
        supportsReasoning: false
      })
    });

    submit.useStream.value = false;
    submit.input.value = 'Unsaved draft';
    submit.chatAttachments.value = [{
      id: 'draft-image',
      type: 'image',
      url: '/api/assets/draft-image',
      mimeType: 'image/png',
      name: 'draft.png'
    }];

    assert.equal(submit.canContinueGeneration.value, true);
    assert.equal(await submit.continueGeneration(), true);

    assert.equal(requestBody.stream, false);
    assert.equal(requestBody.content, undefined);
    assert.equal(requestBody.presetId, 'preset-continue');
    assert.equal(submit.input.value, 'Unsaved draft');
    assert.equal(submit.chatAttachments.value.length, 1);
    assert.deepEqual(messages.value.map((message) => message.role), ['user', 'assistant', 'assistant']);
    assert.equal(messages.value[2].id, 'assistant-continue-1');
    assert.equal(messages.value[2].content, 'Cold blue light spills across the floor.');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chat continueGeneration streams from the continue endpoint without a local user draft', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const previousUser = { id: 'user-prev', role: 'user', content: 'Begin the spell' };
  const previousAssistant = { id: 'assistant-prev', role: 'assistant', content: 'Silver sparks gather.' };
  const messages = shallowRef([previousUser, previousAssistant]);
  const requestedUrls = [];

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
    requestedUrls.push(requestUrl);
    if (requestUrl === '/api/csrf-token') {
      return jsonResponse({ csrfToken: 'csrf-continue-test' });
    }
    if (requestUrl === '/api/conversations/conv-1/messages/continue' && request.method === 'POST') {
      assert.equal(JSON.parse(request.body).stream, true);
      return sseResponse([
        `event: meta\ndata: ${JSON.stringify({ provider: 'test', model: 'continue-model' })}`,
        `event: content\ndata: ${JSON.stringify({ text: 'Then the spell blooms.' })}`,
        `event: done\ndata: ${JSON.stringify({
          userMessage: null,
          assistantMessage: { id: 'assistant-continue-2', role: 'assistant', content: 'Then the spell blooms.' },
          provider: 'test'
        })}`
      ], request.signal, { close: true });
    }
    if (requestUrl === '/api/conversations/conv-1/messages' && (!request.method || request.method === 'GET')) {
      return jsonResponse({ conversation: { id: 'conv-1' }, messages: [] });
    }
    return jsonResponse({ error: `Unexpected request: ${requestUrl}` }, 500);
  };

  try {
    const { submit } = createSubmitState({
      messages,
      selectedPresetId: refValue(''),
      provider: refValue({
        providerType: 'openai',
        model: 'gpt-4.1',
        supportsReasoning: false
      }),
      stickToBottomIfNeeded() {}
    });

    submit.input.value = 'Keep this draft';
    assert.equal(await submit.continueGeneration(), true);

    assert.equal(requestedUrls.includes('/api/conversations/conv-1/messages/continue'), true);
    assert.equal(requestedUrls.includes('/api/conversations/conv-1/messages'), false);
    assert.equal(submit.input.value, 'Keep this draft');
    assert.deepEqual(messages.value.map((message) => message.role), ['user', 'assistant', 'assistant']);
    assert.equal(messages.value[2].id, 'assistant-continue-2');
    assert.equal(messages.value[2].streaming, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('chat submit restores failed stream prompts without removing previous messages', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const previousUser = { id: 'old-user', role: 'user', content: 'Old prompt' };
  const previousAssistant = { id: 'old-assistant', role: 'assistant', content: 'Old reply' };
  const messages = shallowRef([previousUser, previousAssistant]);
  const errors = [];

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
    if (requestUrl === '/api/csrf-token') {
      return jsonResponse({ csrfToken: 'csrf-stream-failure-test' });
    }
    if (requestUrl === '/api/conversations/conv-1/messages' && request.method === 'POST') {
      return sseResponse([
        `event: user_message\ndata: ${JSON.stringify({
          userMessage: { id: 'user-stream-1', role: 'user', content: 'Stream failed prompt' }
        })}`,
        `event: error\ndata: ${JSON.stringify({ error: 'Provider failed' })}`
      ], request.signal, { close: true });
    }
    return jsonResponse({ error: `Unexpected request: ${requestUrl}` }, 500);
  };

  try {
    const { submit } = createSubmitState({
      messages,
      selectedPresetId: refValue(''),
      showError(message) {
        errors.push(message);
      }
    });

    submit.input.value = 'Stream failed prompt';
    await submit.submit();

    assert.equal(errors[0], 'Provider failed');
    assert.equal(submit.input.value, 'Stream failed prompt');
    assert.equal(submit.lastFailure.value.content, 'Stream failed prompt');
    assert.equal(messages.value[0], previousUser);
    assert.equal(messages.value[1], previousAssistant);
    assert.equal(messages.value[2].id, 'user-stream-1');
    assert.equal(messages.value[2].content, 'Stream failed prompt');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('chat submit enables image generation by default for image-capable models', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody = null;

  globalThis.fetch = async (url, request = {}) => {
    assert.equal(String(url), '/api/conversations/conv-1/messages');
    requestBody = JSON.parse(request.body);
    return jsonResponse({
      userMessage: {
        id: 'user-image-1',
        role: 'user',
        content: 'Draw a lantern'
      },
      assistantMessage: {
        id: 'assistant-image-1',
        role: 'assistant',
        content: 'Generated image',
        attachments: [{ id: 'image-1', type: 'image', dataUrl: 'data:image/png;base64,AQID' }]
      },
      provider: 'OpenAI',
      usage: null
    });
  };

  try {
    const { submit } = createSubmitState({
      provider: refValue({
        providerType: 'openai',
        model: 'gpt-image-2',
        supportsReasoning: false
      }),
      selectedPresetId: refValue('')
    });

    submit.useStream.value = true;
    submit.input.value = 'Draw a lantern';
    await submit.submit();

    assert.equal(requestBody.stream, false);
    assert.equal(requestBody.imageGeneration, true);
    assert.equal(requestBody.content, 'Draw a lantern');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chat submit image generation switch can explicitly disable image output', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody = null;

  globalThis.fetch = async (url, request = {}) => {
    assert.equal(String(url), '/api/conversations/conv-1/messages');
    requestBody = JSON.parse(request.body);
    return jsonResponse({
      userMessage: {
        id: 'user-text-1',
        role: 'user',
        content: 'Describe a lantern'
      },
      assistantMessage: {
        id: 'assistant-text-1',
        role: 'assistant',
        content: 'A brass lantern glows softly.'
      },
      provider: 'OpenAI',
      usage: null
    });
  };

  try {
    const { submit } = createSubmitState({
      provider: refValue({
        providerType: 'openai',
        model: 'gpt-image-2',
        supportsReasoning: false
      }),
      selectedPresetId: refValue('')
    });

    assert.equal(submit.canToggleImageGeneration.value, true);
    assert.equal(submit.imageGenerationEnabled.value, true);
    submit.toggleImageGeneration();
    assert.equal(submit.imageGenerationEnabled.value, false);

    submit.input.value = 'Describe a lantern';
    await submit.submit();

    assert.equal(requestBody.stream, false);
    assert.equal(requestBody.imageGeneration, false);
    assert.equal(requestBody.content, 'Describe a lantern');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chat submit does not overwrite a newer draft when restoring failed prompts', async () => {
  const originalFetch = globalThis.fetch;
  const previousUser = { id: 'old-user', role: 'user', content: 'Old prompt' };
  const previousAssistant = { id: 'old-assistant', role: 'assistant', content: 'Old reply' };
  const messages = shallowRef([previousUser, previousAssistant]);
  let fetchStarted = false;
  let resolveFetch = null;
  let fetchResolved = false;
  const fetchPromise = new Promise((resolve) => {
    resolveFetch = resolve;
  });

  globalThis.fetch = async (url, request = {}) => {
    assert.equal(String(url), '/api/conversations/conv-1/messages');
    assert.equal(JSON.parse(request.body).stream, false);
    fetchStarted = true;
    return fetchPromise;
  };

  const { submit } = createSubmitState({
    messages,
    selectedPresetId: refValue('')
  });
  submit.useStream.value = false;
  submit.input.value = 'Original failed prompt';
  const submitPromise = submit.submit();

  try {
    await waitFor(() => fetchStarted);
    submit.input.value = 'New draft';
    fetchResolved = true;
    resolveFetch(jsonResponse({
      error: 'Backend failed',
      accepted: false
    }, 503));
    await submitPromise;

    assert.equal(submit.input.value, 'New draft');
    assert.equal(submit.lastFailure.value.content, 'Original failed prompt');
    assert.deepEqual(messages.value, [previousUser, previousAssistant]);
  } finally {
    globalThis.fetch = originalFetch;
    if (!fetchResolved && resolveFetch) {
      fetchResolved = true;
      resolveFetch(jsonResponse({
        error: 'Backend failed',
        accepted: false
      }, 503));
      await submitPromise.catch(() => {});
    }
  }
});

test('chat submit exposes latest streamed world book matches', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;

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
    if (requestUrl === '/api/csrf-token') {
      return jsonResponse({ csrfToken: 'csrf-world-book-match-test' });
    }
    if (requestUrl === '/api/conversations/conv-1/messages' && request.method === 'POST') {
      return sseResponse([
        `event: meta\ndata: ${JSON.stringify({
          provider: 'test',
          model: 'test-model',
          worldBookMatches: [
            {
              id: 'entry-1',
              name: 'Secret gate',
              worldBookId: 'book-1',
              worldBookName: 'Castle lore',
              position: 'at_depth',
              depth: 2,
              role: 2
            }
          ]
        })}`,
        `event: user_message\ndata: ${JSON.stringify({
          userMessage: { id: 'user-1', role: 'user', content: 'Hello' }
        })}`,
        `event: content\ndata: ${JSON.stringify({ text: 'Reply' })}`,
        `event: done\ndata: ${JSON.stringify({
          userMessage: { id: 'user-1', role: 'user', content: 'Hello' },
          assistantMessage: { id: 'assistant-1', role: 'assistant', content: 'Reply' },
          worldBookMatches: [
            {
              id: 'entry-1',
              name: 'Secret gate',
              worldBookId: 'book-1',
              worldBookName: 'Castle lore',
              position: 'at_depth',
              depth: 2,
              role: 2
            }
          ]
        })}`
      ], request.signal, { close: true });
    }
    if (requestUrl === '/api/conversations/conv-1/messages' && (!request.method || request.method === 'GET')) {
      return jsonResponse({ conversation: { id: 'conv-1' }, messages: [] });
    }
    return jsonResponse({ error: `Unexpected request: ${requestUrl}` }, 500);
  };

  try {
    const { submit } = createSubmitState({
      selectedPresetId: refValue(''),
      stickToBottomIfNeeded() {}
    });

    submit.input.value = 'Hello';
    await submit.submit();

    assert.deepEqual(submit.latestWorldBookMatches.value, [
      {
        id: 'entry-1',
        name: 'Secret gate',
        worldBookId: 'book-1',
        worldBookName: 'Castle lore',
        position: 'at_depth',
        depth: 2,
        role: 2
      }
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('chat submit inserts local drafts with a message-list ref update', async () => {
  const originalFetch = globalThis.fetch;
  const messages = shallowRef(null);
  let fetchStarted = false;
  let resolveFetch = null;
  let fetchResolved = false;
  let messageListTriggers = 0;
  const fetchPromise = new Promise((resolve) => {
    resolveFetch = resolve;
  });
  const stopWatch = watch(messages, () => {
    messageListTriggers += 1;
  });

  globalThis.fetch = async (url, request = {}) => {
    assert.equal(String(url), '/api/conversations/conv-1/messages');
    assert.equal(JSON.parse(request.body).stream, false);
    fetchStarted = true;
    return fetchPromise;
  };

  const { submit } = createSubmitState({
    messages,
    selectedPresetId: refValue('')
  });
  submit.useStream.value = false;
  submit.input.value = 'Hello';
  const submitPromise = submit.submit();

  try {
    await waitFor(() => fetchStarted);
    await nextTick();

    assert.equal(messages.value.length, 2);
    assert.equal(messages.value[0].role, 'user');
    assert.equal(messages.value[0].content, 'Hello');
    assert.equal(messages.value[1].role, 'assistant');
    assert.equal(messages.value[1].streaming, true);
    assert.equal(messageListTriggers, 1);

    fetchResolved = true;
    resolveFetch(jsonResponse({
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
    }));
    await submitPromise;
  } finally {
    globalThis.fetch = originalFetch;
    if (!fetchResolved && resolveFetch) {
      fetchResolved = true;
      resolveFetch(jsonResponse({
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
      }));
      await submitPromise.catch(() => {});
    }
    stopWatch();
  }
});

test('chat submit finishAssistantDraft skips message-list triggers when the assistant is already settled', async () => {
  const assistant = {
    id: 'assistant-1',
    role: 'assistant',
    content: 'Done',
    reasoning: '',
    streaming: false,
    reasoningStreaming: false,
    contentStreaming: false
  };
  const messages = shallowRef([assistant]);
  let messageListTriggers = 0;
  const stopWatch = watch(messages, () => {
    messageListTriggers += 1;
  });

  try {
    const { submit } = createSubmitState({ messages });

    submit.finishAssistantDraft(assistant);
    await nextTick();

    assert.equal(messages.value.length, 1);
    assert.equal(messages.value[0], assistant);
    assert.equal(messageListTriggers, 0);
  } finally {
    stopWatch();
  }
});

test('chat submit finishAssistantDraft settles active drafts without invalidating the message list ref', async () => {
  const assistant = {
    id: 'assistant-1',
    role: 'assistant',
    content: 'Done',
    reasoning: '',
    streaming: true,
    reasoningStreaming: true,
    contentStreaming: true
  };
  const messages = shallowRef([assistant]);
  let messageListTriggers = 0;
  const stopWatch = watch(messages, () => {
    messageListTriggers += 1;
  });

  try {
    const { submit } = createSubmitState({ messages });

    submit.finishAssistantDraft(assistant);
    await nextTick();

    assert.equal(assistant.streaming, false);
    assert.equal(assistant.reasoningStreaming, false);
    assert.equal(assistant.contentStreaming, false);
    assert.equal(messages.value[0], assistant);
    assert.equal(messageListTriggers, 0);
  } finally {
    stopWatch();
  }
});

test('chat submit finishAssistantDraft removes empty drafts without no-op list replacements', async () => {
  const userMessage = {
    id: 'user-1',
    role: 'user',
    content: 'Hello',
    reasoning: ''
  };
  const assistant = {
    id: 'assistant-empty',
    role: 'assistant',
    content: '',
    reasoning: '',
    streaming: true,
    reasoningStreaming: false,
    contentStreaming: true
  };
  const messages = shallowRef([userMessage, assistant]);
  let messageListTriggers = 0;
  const stopWatch = watch(messages, () => {
    messageListTriggers += 1;
  });

  try {
    const { submit } = createSubmitState({ messages });

    submit.finishAssistantDraft(assistant);
    await nextTick();

    assert.deepEqual(messages.value, [userMessage]);
    assert.equal(messageListTriggers, 1);

    const settledMessages = messages.value;
    submit.finishAssistantDraft(assistant);
    await nextTick();

    assert.equal(messages.value, settledMessages);
    assert.equal(messageListTriggers, 1);
  } finally {
    stopWatch();
  }
});

test('chat submit finishAssistantDraft settles current same-id items without invalidating the list ref', async () => {
  const currentAssistant = {
    id: 'assistant-1',
    role: 'assistant',
    content: 'Done',
    reasoning: '',
    streaming: true,
    reasoningStreaming: true,
    contentStreaming: true
  };
  const staleAssistant = {
    id: 'assistant-1',
    role: 'assistant',
    content: 'Stale',
    reasoning: '',
    streaming: true,
    reasoningStreaming: true,
    contentStreaming: true
  };
  const messages = shallowRef([currentAssistant]);
  let messageListTriggers = 0;
  const stopWatch = watch(messages, () => {
    messageListTriggers += 1;
  });

  try {
    const { submit } = createSubmitState({ messages });

    submit.finishAssistantDraft(staleAssistant);
    await nextTick();

    assert.equal(currentAssistant.streaming, false);
    assert.equal(currentAssistant.reasoningStreaming, false);
    assert.equal(currentAssistant.contentStreaming, false);
    assert.equal(staleAssistant.streaming, true);
    assert.equal(staleAssistant.reasoningStreaming, true);
    assert.equal(staleAssistant.contentStreaming, true);
    assert.equal(messages.value[0], currentAssistant);
    assert.equal(messageListTriggers, 0);
  } finally {
    stopWatch();
  }
});

test('chat submit current-message lookup avoids cloned message-list scans', () => {
  assert.match(
    chatSubmitSource,
    /function appendMessageItems\(\.\.\.items\) \{[\s\S]*const messageList = Array\.isArray\(messages\.value\) \? messages\.value : \[\];[\s\S]*const nextMessages = \[\];[\s\S]*for \(const item of messageList\) \{[\s\S]*nextMessages\.push\(item\);[\s\S]*for \(const item of items\) \{[\s\S]*if \(!item\) \{[\s\S]*continue;[\s\S]*nextMessages\.push\(item\);[\s\S]*messages\.value = nextMessages;[\s\S]*return true;[\s\S]*\}/
  );
  assert.match(
    chatSubmitSource,
    /function findLastStreamingMessage\(\) \{[\s\S]*for \(let index = messageList\.length - 1; index >= 0; index -= 1\) \{[\s\S]*if \(message\?\.streaming\) \{[\s\S]*return message;[\s\S]*return null;\s*\}/
  );
  assert.match(
    chatSubmitSource,
    /function findMessageListItem\(messageId\) \{[\s\S]*const messageList = Array\.isArray\(messages\.value\) \? messages\.value : \[\];[\s\S]*for \(const item of messageList\) \{[\s\S]*if \(normalizeMessageId\(item\?\.id\) === targetId\) \{[\s\S]*return item;[\s\S]*return null;\s*\}/
  );
  assert.doesNotMatch(chatSubmitSource, /messages\.value = \[\.\.\.messages\.value/);
  assert.doesNotMatch(chatSubmitSource, /\[\.\.\.messages\.value\]\.reverse\(\)\.find/);
  assert.doesNotMatch(chatSubmitSource, /messages\.value\.find/);
});

test('chat submit appends only into the active reactive row and leaves scrolling to rendered Markdown', () => {
  assert.match(
    chatSubmitSource,
    /appendStreamText\(\s*assistant,\s*'reasoning',\s*data\.text,\s*anchorAssistantReply,\s*\(\) => isCurrentSubmit\(submitId, conversationId\)\s*\);/
  );
  assert.match(
    chatSubmitSource,
    /appendStreamText\(\s*assistant,\s*'content',\s*data\.text,\s*anchorAssistantReply,\s*\(\) => isCurrentSubmit\(submitId, conversationId\)\s*\);/
  );
  assert.match(
    chatSubmitSource,
    /function appendStreamText\(message, field, text, anchorAssistantReply = false, isStillCurrent = \(\) => true\) \{[\s\S]*if \(!isStillCurrent\(\)\) return;[\s\S]*currentMessage\[field\] \+= value;[\s\S]*}/
  );
  assert.doesNotMatch(chatSubmitSource, /triggerRef\(messages\)/);
  assert.doesNotMatch(chatSubmitSource, /pendingStreamFollow|scheduleStreamFollow|followSubmitScroll\(currentMessage/);
  assert.match(chatSubmitSource, /content: resolveFinalStreamText\(streamedContent, finalServerMessage\.content\)/);
});

test('chat submit image generation mode is controlled by model capability and switch state', () => {
  assert.match(
    chatSubmitSource,
    /const chatProviderCapabilities = computed\(\(\) => resolveProviderModelCapabilities\(provider\.value \|\| \{\}\)\);[\s\S]*const canGenerateImages = computed\(\(\) => Boolean\(chatProviderCapabilities\.value\.imageGeneration\)\);[\s\S]*const canToggleImageGeneration = computed\(\(\) => Boolean\(canGenerateImages\.value\)\);[\s\S]*const shouldGenerateImage = canToggleImageGeneration\.value && imageGenerationEnabled\.value;[\s\S]*const willStreamReply = useStream\.value && canUseStream\.value && !shouldGenerateImage;[\s\S]*imageGeneration: shouldGenerateImage[\s\S]*if \(willStreamReply\)/
  );
  assert.match(chatSubmitSource, /import \{ resolveProviderModelCapabilities \} from '\.\.\/\.\.\/\.\.\/\.\.\/shared\/providerCapabilities\.js';/);
  assert.match(chatSubmitSource, /const imageGenerationEnabled = ref\(readLocalBoolean\('flai-chat-image-generation-enabled', true\)\);/);
  assert.match(chatSubmitSource, /function toggleImageGeneration\(\)\s*{\s*if \(sending\.value \|\| !canToggleImageGeneration\.value\) {\s*return;\s*}[\s\S]*writeLocalBoolean\('flai-chat-image-generation-enabled', imageGenerationEnabled\.value\);[\s\S]*}/);
  assert.doesNotMatch(chatSubmitSource, /isAutomaticImageGenerationModel|IMAGE_GENERATION_MODELS_BY_PROVIDER/);
});

test('chat submit persisted draft matching avoids candidate list allocations', () => {
  assert.match(
    chatSubmitSource,
    /function findPersistedUserMessage\(messages, draft\) \{[\s\S]*for \(let index = messageList\.length - 1; index >= 0; index -= 1\) \{[\s\S]*message\?\.role === 'user'[\s\S]*return message;[\s\S]*return null;\s*\}/
  );
  assert.match(
    chatSubmitSource,
    /function findPersistedAssistantMessage\(messages, draft, userMessage = null\) \{[\s\S]*let lastPersistedAssistant = null;[\s\S]*for \(const message of messageList\) \{[\s\S]*lastPersistedAssistant = message;[\s\S]*for \(let index = messageList\.length - 1; index >= 0; index -= 1\) \{[\s\S]*return lastPersistedAssistant;[\s\S]*\}/
  );
  assert.match(
    chatSubmitSource,
    /function needsPersistedDraftReconcile\(\) \{[\s\S]*for \(let index = 0; index < arguments\.length; index \+= 1\) \{[\s\S]*const item = arguments\[index\];[\s\S]*findMessageListItem\(item\?\.id\);[\s\S]*return true;[\s\S]*return false;[\s\S]*\}/
  );
  assert.doesNotMatch(chatSubmitSource, /\[\.\.\.messages\]\.reverse\(\)\.find/);
  assert.doesNotMatch(chatSubmitSource, /const candidates = messages\.filter/);
  assert.doesNotMatch(chatSubmitSource, /messages\.findIndex/);
  assert.doesNotMatch(chatSubmitSource, /\.slice\(userIndex \+ 1\)/);
  assert.doesNotMatch(chatSubmitSource, /\[\.\.\.candidates\]\.reverse\(\)\.find/);
  assert.doesNotMatch(chatSubmitSource, /function needsPersistedDraftReconcile\(\.\.\.items\)/);
  assert.doesNotMatch(chatSubmitSource, /items\.some\(\(item\) =>/);
});

test('chat submit message removal avoids no-op filter replacements', () => {
  assert.match(
    chatSubmitSource,
    /function removeMessageItemsByReferenceIfPresent\(\.\.\.targets\) \{[\s\S]*const nextMessages = \[\];[\s\S]*for \(const item of messageList\) \{[\s\S]*if \(!removed\) \{[\s\S]*return false;[\s\S]*messages\.value = nextMessages;[\s\S]*return true;[\s\S]*\}/
  );
  assert.match(
    chatSubmitSource,
    /function removeMessageItemsByIdIfPresent\(messageId\) \{[\s\S]*const nextMessages = \[\];[\s\S]*for \(const item of messageList\) \{[\s\S]*if \(normalizeMessageId\(item\?\.id\) === targetId\) \{[\s\S]*if \(!removed\) \{[\s\S]*return false;[\s\S]*messages\.value = nextMessages;[\s\S]*return true;[\s\S]*\}/
  );
  assert.doesNotMatch(chatSubmitSource, /messages\.value\.filter/);
});

test('chat submit refresh and plain metadata comparisons avoid callback allocations', () => {
  assert.match(
    chatSubmitSource,
    /import \{ samePlainValue \} from '\.\.\/\.\.\/utils\/plainValues\.js';/
  );
  assert.match(
    chatSubmitSource,
    /function refreshConversationChrome\(\) \{[\s\S]*const tasks = \[\];[\s\S]*const sidebarTask = createRefreshTask\(loadSidebarData\);[\s\S]*tasks\.push\(sidebarTask\);[\s\S]*const economyTask = createRefreshTask\(loadEconomyBalance\);[\s\S]*tasks\.push\(economyTask\);[\s\S]*Promise\.allSettled\(tasks\);[\s\S]*\}/
  );
  assert.doesNotMatch(
    chatSubmitSource,
    /function samePlainValue\(/
  );
  assert.match(
    chatSubmitSource,
    /function setMessageStreamingState\(message, nextState = \{\}\) \{[\s\S]*for \(const key in nextState\) \{[\s\S]*Object\.prototype\.hasOwnProperty\.call\(nextState, key\)[\s\S]*const value = nextState\[key\];[\s\S]*currentMessage\[key\] = value;[\s\S]*return currentMessage;[\s\S]*\}/
  );
  assert.doesNotMatch(chatSubmitSource, /\.filter\(Boolean\)/);
  assert.doesNotMatch(chatSubmitSource, /current\.every\(/);
  assert.doesNotMatch(chatSubmitSource, /currentKeys\.every\(/);
  assert.doesNotMatch(chatSubmitSource, /Object\.keys\(current\)/);
  assert.doesNotMatch(chatSubmitSource, /Object\.entries\(nextState\)/);
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

test('chat submit final anchor uses current list item after same-id draft replacement', async () => {
  const originalFetch = globalThis.fetch;
  const messages = shallowRef([]);
  const scrollCalls = [];
  let replacedDrafts = false;

  globalThis.fetch = async (url, request = {}) => {
    assert.equal(String(url), '/api/conversations/conv-1/messages');
    assert.equal(JSON.parse(request.body).stream, false);
    if (!replacedDrafts) {
      messages.value = messages.value.map((message) => ({ ...message }));
      replacedDrafts = true;
    }
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
      stickToBottomIfNeeded() {}
    });

    submit.useStream.value = false;
    submit.input.value = 'Hello';

    await submit.submit();

    assert.equal(scrollCalls.length, 2);
    assert.match(scrollCalls[0].messageId, /^local-assistant-/);
    assert.equal(scrollCalls[1].messageId, 'assistant-1');
    assert.deepEqual(scrollCalls[1].options, { smooth: false, block: 'end' });
    assert.equal(messages.value[0].id, 'user-1');
    assert.equal(messages.value[1].id, 'assistant-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chat submit non-stream finalization triggers shallow message refs', async () => {
  const originalFetch = globalThis.fetch;
  const messages = shallowRef([]);
  let messageListTriggers = 0;
  const stopWatch = watch(messages, () => {
    messageListTriggers += 1;
  });

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
      selectedPresetId: refValue('')
    });

    submit.useStream.value = false;
    submit.input.value = 'Hello';

    await submit.submit();
    await nextTick();

    assert.equal(messages.value[0].id, 'user-1');
    assert.equal(messages.value[1].id, 'assistant-1');
    assert.equal(messages.value[1].streaming, false);
    assert.equal(messageListTriggers > 0, true);
  } finally {
    globalThis.fetch = originalFetch;
    stopWatch();
  }
});

test('chat submit ignores non-stream completions after the active conversation changes', async () => {
  const originalFetch = globalThis.fetch;
  const route = { params: { id: 'conv-1' } };
  const messages = shallowRef([]);
  const appliedStatusBars = [];
  const skillResults = [];
  let fetchStarted = false;
  let resolveFetch = null;
  let fetchResolved = false;
  let sidebarRefreshes = 0;
  let economyRefreshes = 0;
  const fetchPromise = new Promise((resolve) => {
    resolveFetch = resolve;
  });

  globalThis.fetch = async (url, request = {}) => {
    assert.equal(String(url), '/api/conversations/conv-1/messages');
    assert.equal(JSON.parse(request.body).stream, false);
    fetchStarted = true;
    return fetchPromise;
  };

  try {
    const { submit } = createSubmitState({
      route,
      messages,
      selectedPresetId: refValue(''),
      applyStatusBarUpdate(nextStatusBar) {
        appliedStatusBars.push(nextStatusBar);
      },
      handleSkillResult(data) {
        skillResults.push(data);
      },
      loadSidebarData() {
        sidebarRefreshes += 1;
      },
      loadEconomyBalance() {
        economyRefreshes += 1;
      }
    });

    submit.useStream.value = false;
    submit.input.value = 'Hello';
    const submitPromise = submit.submit();
    await waitFor(() => fetchStarted);
    assert.equal(messages.value.length, 2);

    route.params.id = 'conv-2';
    messages.value = [];
    fetchResolved = true;
    resolveFetch(jsonResponse({
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
      usage: null,
      statusBar: { id: 'status-1', conversationId: 'conv-1', variables: [] },
      skillResults: [
        { skill: 'statusBarAgent', ok: true, result: { updates: ['HP'] } }
      ],
      accessoryBackground: true
    }));
    await submitPromise;

    assert.deepEqual(messages.value, []);
    assert.deepEqual(appliedStatusBars, []);
    assert.deepEqual(skillResults, []);
    assert.equal(submit.sending.value, false);
    assert.equal(sidebarRefreshes, 0);
    assert.equal(economyRefreshes, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (!fetchResolved && resolveFetch) {
      fetchResolved = true;
      resolveFetch(jsonResponse({
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
      }));
    }
  }
});

test('chat submit keeps usage and provider metadata references stable for equivalent non-stream results', async () => {
  const originalFetch = globalThis.fetch;
  let postCount = 0;

  globalThis.fetch = async (url, request = {}) => {
    assert.equal(String(url), '/api/conversations/conv-1/messages');
    assert.equal(JSON.parse(request.body).stream, false);
    postCount += 1;
    return jsonResponse({
      userMessage: {
        id: `user-${postCount}`,
        role: 'user',
        content: `Hello ${postCount}`
      },
      assistantMessage: {
        id: `assistant-${postCount}`,
        role: 'assistant',
        content: 'Hi'
      },
      provider: 'test-provider',
      usage: {
        total_tokens: 12,
        prompt_tokens: 5,
        completion_tokens: 7
      }
    });
  };

  try {
    const { submit } = createSubmitState({
      selectedPresetId: refValue('')
    });

    submit.useStream.value = false;
    submit.input.value = 'Hello 1';
    await submit.submit();

    const firstUsage = submit.usage.value;
    const firstProviderMeta = submit.providerMeta.value;
    assert.deepEqual(firstUsage, {
      total_tokens: 12,
      prompt_tokens: 5,
      completion_tokens: 7
    });
    assert.deepEqual(firstProviderMeta, { provider: 'test-provider' });

    submit.input.value = 'Hello 2';
    await submit.submit();

    assert.equal(postCount, 2);
    assert.equal(submit.usage.value, firstUsage);
    assert.equal(submit.providerMeta.value, firstProviderMeta);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chat submit applies non-stream status bar updates through the provided helper', async () => {
  const originalFetch = globalThis.fetch;
  const statusBar = {
    id: 'status-1',
    conversationId: 'conv-1',
    name: 'Vitals',
    template: '',
    updatedAt: '2026-06-08T00:00:00.000Z',
    variables: [{ name: 'HP', value: 10, max: 10, color: '#ff0000' }]
  };
  const sameStatusBar = {
    ...statusBar,
    variables: [{ name: 'HP', value: 10, max: 10, color: '#ff0000' }]
  };
  const statusBarRef = refValue(statusBar);
  const appliedStatusBars = [];

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
      usage: null,
      statusBar: sameStatusBar
    });
  };

  try {
    const { submit } = createSubmitState({
      statusBar: statusBarRef,
      selectedPresetId: refValue(''),
      applyStatusBarUpdate(nextStatusBar) {
        appliedStatusBars.push(nextStatusBar);
        return false;
      },
      syncStatusBarForm() {
        throw new Error('submit should not sync status bar forms directly');
      }
    });

    submit.useStream.value = false;
    submit.input.value = 'Hello';

    await submit.submit();

    assert.deepEqual(appliedStatusBars, [sameStatusBar]);
    assert.equal(statusBarRef.value, statusBar);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chat submit scopes non-stream skill results to the active conversation', async () => {
  const originalFetch = globalThis.fetch;
  const skillResults = [];

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
      usage: null,
      skillResults: [
        { skill: 'statusBarAgent', ok: true, result: { updates: ['HP'] } },
        { conversationId: 'conv-stale', skill: 'sceneAgent', ok: true, result: { changes: [] } }
      ]
    });
  };

  try {
    const { submit } = createSubmitState({
      selectedPresetId: refValue(''),
      handleSkillResult(data) {
        skillResults.push(data);
      }
    });

    submit.useStream.value = false;
    submit.input.value = 'Hello';
    await submit.submit();

    assert.deepEqual(skillResults.map((item) => item.conversationId), ['conv-1', 'conv-1']);
    assert.equal(skillResults[0].skill, 'statusBarAgent');
    assert.equal(skillResults[1].skill, 'sceneAgent');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chat submit applies stream status bar updates through the provided helper', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const statusBar = {
    id: 'status-1',
    conversationId: 'conv-1',
    name: 'Vitals',
    template: '',
    updatedAt: '2026-06-08T00:00:00.000Z',
    variables: [{ name: 'HP', value: 10, max: 10, color: '#ff0000' }]
  };
  const sameStatusBar = {
    ...statusBar,
    variables: [{ name: 'HP', value: 10, max: 10, color: '#ff0000' }]
  };
  const statusBarRef = refValue(statusBar);
  const appliedStatusBars = [];

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

    if (requestUrl === '/api/csrf-token') {
      return jsonResponse({ csrfToken: 'csrf-status-test' });
    }

    if (requestUrl === '/api/conversations/conv-1/messages' && request.method === 'POST') {
      return sseResponse([
        `event: user_message\ndata: ${JSON.stringify({
          userMessage: { id: 'user-1', role: 'user', content: 'Hello' }
        })}`,
        `event: tool\ndata: ${JSON.stringify({
          result: { statusBar: sameStatusBar }
        })}`,
        `event: content\ndata: ${JSON.stringify({ text: 'Hi' })}`,
        `event: done\ndata: ${JSON.stringify({
          userMessage: { id: 'user-1', role: 'user', content: 'Hello' },
          assistantMessage: { id: 'assistant-1', role: 'assistant', content: 'Hi' },
          statusBar: sameStatusBar
        })}`
      ], request.signal, { close: true });
    }

    return jsonResponse({ error: `Unexpected request: ${requestUrl}` }, 500);
  };

  try {
    const { submit } = createSubmitState({
      statusBar: statusBarRef,
      selectedPresetId: refValue(''),
      applyStatusBarUpdate(nextStatusBar) {
        appliedStatusBars.push(nextStatusBar);
        return false;
      },
      syncStatusBarForm() {
        throw new Error('submit should not sync status bar forms directly');
      }
    });

    submit.input.value = 'Hello';
    await submit.submit();

    assert.deepEqual(appliedStatusBars, [sameStatusBar, sameStatusBar]);
    assert.equal(statusBarRef.value, statusBar);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('chat submit skips accessory refresh timers when the start callback cancels polling', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const timerCalls = [];
  const refreshStartPayloads = [];
  let statusRefreshes = 0;
  let economyRefreshes = 0;
  let refreshCallbacks = 0;

  globalThis.window = {
    setTimeout(callback, delay) {
      timerCalls.push({ callback, delay });
      return timerCalls.length;
    },
    clearTimeout() {},
    localStorage: {
      getItem() { return null; },
      setItem() {}
    }
  };

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
      usage: null,
      accessoryBackground: true
    });
  };

  try {
    const { submit } = createSubmitState({
      selectedPresetId: refValue(''),
      onAccessoryRefreshStart(payload) {
        refreshStartPayloads.push(payload);
        return false;
      },
      onAccessoryRefresh() {
        refreshCallbacks += 1;
      },
      loadStatusBar() {
        statusRefreshes += 1;
      },
      loadEconomyBalance() {
        economyRefreshes += 1;
      }
    });

    submit.useStream.value = false;
    submit.input.value = 'Hello';
    await submit.submit();

    assert.deepEqual(timerCalls, []);
    assert.equal(refreshStartPayloads.length, 1);
    assert.equal(Number.isInteger(refreshStartPayloads[0].runId), true);
    assert.equal(refreshStartPayloads[0].conversationId, 'conv-1');
    assert.equal(statusRefreshes, 0);
    assert.equal(economyRefreshes, 1);
    assert.equal(refreshCallbacks, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('chat submit cancels pending accessory refresh timers when the refresh callback is settled', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const timerCallbacks = [];
  const clearedTimers = [];
  const refreshDelays = [];
  let statusRefreshes = 0;
  let economyRefreshes = 0;

  globalThis.window = {
    setTimeout(callback, delay) {
      const timerId = timerCallbacks.length + 1;
      timerCallbacks.push({ callback, delay, timerId });
      return timerId;
    },
    clearTimeout(timerId) {
      clearedTimers.push(timerId);
    },
    localStorage: {
      getItem() { return null; },
      setItem() {}
    }
  };

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
      usage: null,
      accessoryBackground: true
    });
  };

  try {
    const { submit } = createSubmitState({
      selectedPresetId: refValue(''),
      loadStatusBar() {
        statusRefreshes += 1;
        return { id: 'status-1' };
      },
      loadEconomyBalance() {
        economyRefreshes += 1;
        return [{ id: 'acct-1' }];
      },
      onAccessoryRefresh(payload) {
        refreshDelays.push(payload.delay);
        return false;
      }
    });

    submit.useStream.value = false;
    submit.input.value = 'Hello';
    await submit.submit();

    const postSubmitEconomyRefreshes = economyRefreshes;
    assert.equal(timerCallbacks.length, 7);
    await timerCallbacks[0].callback();
    assert.deepEqual(refreshDelays, [1200]);
    assert.equal(statusRefreshes, 1);
    assert.equal(economyRefreshes, postSubmitEconomyRefreshes + 1);
    assert.deepEqual(clearedTimers, [7, 6, 5, 4, 3, 2, 1]);

    await timerCallbacks[1].callback();
    assert.deepEqual(refreshDelays, [1200]);
    assert.equal(statusRefreshes, 1);
    assert.equal(economyRefreshes, postSubmitEconomyRefreshes + 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('chat submit skips delayed accessory refreshes after the active conversation changes', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const route = { params: { id: 'conv-1' } };
  const timerCallbacks = [];
  const refreshPayloads = [];
  let statusRefreshes = 0;
  let economyRefreshes = 0;

  globalThis.window = {
    setTimeout(callback, delay) {
      const timerId = timerCallbacks.length + 1;
      timerCallbacks.push({ callback, delay, timerId });
      return timerId;
    },
    clearTimeout() {},
    localStorage: {
      getItem() { return null; },
      setItem() {}
    }
  };

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
      usage: null,
      accessoryBackground: true
    });
  };

  try {
    const { submit } = createSubmitState({
      route,
      selectedPresetId: refValue(''),
      loadStatusBar() {
        statusRefreshes += 1;
      },
      loadEconomyBalance() {
        economyRefreshes += 1;
      },
      onAccessoryRefresh(payload) {
        refreshPayloads.push(payload);
      }
    });

    submit.useStream.value = false;
    submit.input.value = 'Hello';
    await submit.submit();

    const postSubmitEconomyRefreshes = economyRefreshes;
    assert.equal(timerCallbacks.length, 7);

    route.params.id = 'conv-2';
    await timerCallbacks[0].callback();

    assert.equal(statusRefreshes, 0);
    assert.equal(economyRefreshes, postSubmitEconomyRefreshes);
    assert.deepEqual(refreshPayloads, []);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('chat submit skips persisted stream reconciliation when replaced drafts are already finalized', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const messages = shallowRef([]);
  let replacedDrafts = false;
  let messageRefreshes = 0;

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

    if (requestUrl === '/api/csrf-token') {
      return jsonResponse({ csrfToken: 'csrf-reconcile-skip-test' });
    }

    if (requestUrl === '/api/conversations/conv-1/messages' && request.method === 'POST') {
      if (!replacedDrafts) {
        messages.value = messages.value.map((message) => ({ ...message }));
        replacedDrafts = true;
      }
      return sseResponse([
        `event: user_message\ndata: ${JSON.stringify({
          userMessage: { id: 'user-1', role: 'user', content: 'Hello' }
        })}`,
        `event: content\ndata: ${JSON.stringify({ text: 'Finished reply' })}`,
        `event: done\ndata: ${JSON.stringify({
          userMessage: { id: 'user-1', role: 'user', content: 'Hello' },
          assistantMessage: { id: 'assistant-1', role: 'assistant', content: 'Finished reply' }
        })}`
      ], request.signal, { close: true });
    }

    if (requestUrl === '/api/conversations/conv-1/messages' && (!request.method || request.method === 'GET')) {
      messageRefreshes += 1;
      return jsonResponse({
        conversation: { id: 'conv-1' },
        messages: [
          { id: 'user-1', role: 'user', content: 'Hello', reasoning: '' },
          { id: 'assistant-1', role: 'assistant', content: 'Finished reply', reasoning: '' }
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
    await submit.submit();

    assert.equal(replacedDrafts, true);
    assert.equal(messageRefreshes, 0);
    assert.equal(messages.value[0].id, 'user-1');
    assert.equal(messages.value[1].id, 'assistant-1');
    assert.equal(messages.value[1].content, 'Finished reply');
    assert.equal(messages.value[1].streaming, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('chat submit does not scroll for network chunks before Markdown commits', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const messages = refValue([]);
  const scrollCalls = [];
  const stickCalls = [];
  let autoScrollPaused = false;

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

    if (requestUrl === '/api/csrf-token') {
      return jsonResponse({ csrfToken: 'csrf-anchor-test' });
    }

    if (requestUrl === '/api/conversations/conv-1/messages' && request.method === 'POST') {
      return sseResponse([
        `event: user_message\ndata: ${JSON.stringify({
          userMessage: { id: 'user-1', role: 'user', content: 'Hello' }
        })}`,
        `event: content\ndata: ${JSON.stringify({ text: 'Chunk one' })}`,
        `event: content\ndata: ${JSON.stringify({ text: ' and two' })}`,
        `event: done\ndata: ${JSON.stringify({
          userMessage: { id: 'user-1', role: 'user', content: 'Hello' },
          assistantMessage: { id: 'assistant-1', role: 'assistant', content: 'Chunk one and two' }
        })}`
      ], request.signal, { close: true });
    }

    if (requestUrl === '/api/conversations/conv-1/messages' && (!request.method || request.method === 'GET')) {
      return jsonResponse({
        conversation: { id: 'conv-1' },
        messages: [
          { id: 'user-1', role: 'user', content: 'Hello', reasoning: '' },
          { id: 'assistant-1', role: 'assistant', content: 'Chunk one and two', reasoning: '' }
        ]
      });
    }

    return jsonResponse({ error: `Unexpected request: ${requestUrl}` }, 500);
  };

  try {
    const { submit } = createSubmitState({
      messages,
      selectedPresetId: refValue(''),
      isPinnedToBottom: () => true,
      hasUserPausedAutoScroll: () => autoScrollPaused,
      prepareExpandedStatusBarForSubmit: () => true,
      scrollToMessage(messageId, options) {
        scrollCalls.push({ messageId, options });
        autoScrollPaused = true;
        return true;
      },
      stickToBottomIfNeeded(...args) {
        stickCalls.push(args);
      }
    });

    submit.input.value = 'Hello';
    await submit.submit();

    assert.equal(scrollCalls.length, 0);
    assert.equal(stickCalls.length > 0, true);
    assert.equal(messages.value[0].id, 'user-1');
    assert.equal(messages.value[1].id, 'assistant-1');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
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

test('chat submit stops interrupted stream reconciliation retries after the active conversation changes', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const route = { params: { id: 'conv-1' } };
  const messages = refValue([]);
  const fetchCalls = [];
  const sleepCallbacks = [];
  let sleepTimerId = 0;
  let submit;
  let submitPromise;

  globalThis.window = {
    setTimeout: originalSetTimeout,
    clearTimeout: originalClearTimeout,
    localStorage: {
      getItem() { return null; },
      setItem() {}
    }
  };

  globalThis.fetch = async (url, request = {}) => {
    const requestUrl = String(url);
    fetchCalls.push(`${request.method || 'GET'} ${requestUrl}`);

    if (requestUrl === '/api/csrf-token') {
      return jsonResponse({ csrfToken: 'csrf-route-change-reconcile-test' });
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
        messages: []
      });
    }

    return jsonResponse({ error: `Unexpected request: ${requestUrl}` }, 500);
  };

  try {
    ({ submit } = createSubmitState({
      route,
      messages,
      selectedPresetId: refValue(''),
      stickToBottomIfNeeded() {}
    }));

    submit.input.value = 'Hello';
    submitPromise = submit.submit();
    await waitFor(() => messages.value.some((message) => message.role === 'assistant' && message.content === 'Partial reply'));

    globalThis.setTimeout = (callback, delay) => {
      const timerId = ++sleepTimerId;
      sleepCallbacks.push({ callback, delay, timerId });
      return timerId;
    };
    globalThis.clearTimeout = () => {};

    submit.stop();
    await waitForWithTimer(() => sleepCallbacks.length > 0, originalSetTimeout);

    assert.equal(fetchCalls.filter((item) => item === 'GET /api/conversations/conv-1/messages').length, 1);
    assert.equal(sleepCallbacks[0].delay, 120);

    route.params.id = 'conv-2';
    sleepCallbacks.shift().callback();
    const completion = await Promise.race([
      submitPromise.then(() => 'done'),
      new Promise((resolve) => originalSetTimeout(() => resolve('pending'), 50))
    ]);

    assert.equal(completion, 'done');
    assert.equal(fetchCalls.filter((item) => item === 'GET /api/conversations/conv-1/messages').length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    route.params.id = 'conv-2';
    while (sleepCallbacks.length) {
      sleepCallbacks.shift().callback();
    }
    if (submitPromise) {
      await Promise.race([
        submitPromise.catch(() => {}),
        new Promise((resolve) => originalSetTimeout(resolve, 20))
      ]);
    }
    submit?.cleanup();
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('chat submit stream state and interrupted reconciliation use current list items for stale same-id drafts', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const messages = shallowRef([]);
  let staleAssistant = null;
  let replacedDrafts = false;

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

    if (requestUrl === '/api/csrf-token') {
      return jsonResponse({ csrfToken: 'csrf-stale-reconcile-test' });
    }

    if (requestUrl === '/api/conversations/conv-1/messages' && request.method === 'POST') {
      if (!replacedDrafts) {
        const localDrafts = messages.value;
        staleAssistant = localDrafts.find((message) => message.role === 'assistant');
        messages.value = localDrafts.map((message) => ({ ...message }));
        replacedDrafts = true;
      }
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
    await waitFor(() => messages.value.some((message) => (
      message.role === 'assistant' &&
      message.content === 'Partial reply'
    )));

    const currentAssistantDuringStream = messages.value.find((message) => message.role === 'assistant');
    assert.notEqual(currentAssistantDuringStream, staleAssistant);
    assert.equal(currentAssistantDuringStream.contentStreaming, true);
    assert.equal(staleAssistant.contentStreaming, false);

    submit.stop();
    await submitPromise;

    const currentAssistant = messages.value.find((message) => message.role === 'assistant');
    assert.equal(currentAssistant.id, 'assistant-1');
    assert.equal(currentAssistant.content, 'Partial reply');
    assert.equal(currentAssistant.streaming, false);
    assert.equal(currentAssistant.contentStreaming, false);
    assert.match(staleAssistant.id, /^local-assistant-/);
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

async function waitForWithTimer(predicate, timer) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => timer(resolve, 10));
  }
  assert.equal(predicate(), true);
}
