import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { streamAssistantResponse } from '../services/conversationStreamResponse.js';

test('stream lifecycle records a partial assistant when transport fails after content', async () => {
  const result = await runLifecycle({
    fetchImpl: async () => sseResponse([
      { choices: [{ delta: { content: 'saved partial' } }] },
      { error: { message: 'deterministic provider failure' } }
    ]),
    interruptedAssistant(partial) {
      assert.equal(partial.content, 'saved partial');
      return { id: 'partial-assistant', usage: { outputTokens: 2 } };
    }
  });

  assert.equal(result.trace.status, 'partial');
  assert.equal(result.trace.assistantMessageId, 'partial-assistant');
  assert.equal(result.interruptedSaves, 1);
  assert.notEqual(result.trace.status, 'pending');
});

test('stream lifecycle records cancellation without creating an empty assistant', async () => {
  const result = await runLifecycle({
    fetchImpl: async () => { throw new DOMException('request aborted', 'AbortError'); }
  });

  assert.equal(result.trace.status, 'cancelled');
  assert.equal(result.trace.assistantMessageId || '', '');
  assert.equal(result.interruptedSaves, 1);
  assert.notEqual(result.trace.status, 'pending');
});

test('stream lifecycle records stale generation without creating an assistant', async () => {
  const staleError = Object.assign(new Error('timeline changed'), { code: 'CONVERSATION_TIMELINE_CHANGED' });
  const result = await runLifecycle({
    fetchImpl: async () => { throw staleError; }
  });

  assert.equal(result.trace.status, 'stale');
  assert.equal(result.trace.errorCode, 'CONVERSATION_TIMELINE_CHANGED');
  assert.equal(result.trace.assistantMessageId || '', '');
  assert.notEqual(result.trace.status, 'pending');
});

test('stream lifecycle records an empty provider result as terminal without an assistant', async () => {
  const result = await runLifecycle({
    fetchImpl: async () => new Response('data: [DONE]\n\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' }
    })
  });

  assert.equal(result.trace.status, 'empty');
  assert.equal(result.trace.errorCode, 'PROVIDER_EMPTY');
  assert.equal(result.trace.assistantMessageId || '', '');
  assert.equal(result.assistantSaves, 0);
  assert.notEqual(result.trace.status, 'pending');
});

test('mock stream completes and links its assistant without a wire request', async () => {
  let wireCalls = 0;
  const result = await runLifecycle({
    settings: { providerType: 'mock', gatewayName: 'Local Mock', model: 'local-mock', baseUrl: '', apiKey: '' },
    fetchImpl: async () => {
      wireCalls += 1;
      throw new Error('mock provider must not use fetch');
    }
  });

  assert.equal(wireCalls, 0);
  assert.equal(result.trace.status, 'completed');
  assert.equal(result.trace.assistantMessageId, 'completed-assistant');
  assert.equal(result.assistantSaves, 1);
  assert.notEqual(result.trace.status, 'pending');
});

async function runLifecycle(options = {}) {
  const originalFetch = globalThis.fetch;
  const request = new EventEmitter();
  request.auth = { user: { id: 'trace-user', username: 'Trace User' } };
  request.socket = { setTimeout() {} };
  const response = new ResponseStub();
  const trace = createLifecycleTrace();
  let assistantSaves = 0;
  let interruptedSaves = 0;
  globalThis.fetch = options.fetchImpl;
  try {
    await streamAssistantResponse({
      request,
      response,
      userId: 'trace-user',
      database: null,
      config: { isProduction: false },
      conversation: { id: 'trace-conversation' },
      character: { id: 'trace-character', name: 'Trace Character' },
      rules: [],
      modelMessages: [{ role: 'user', content: 'deterministic lifecycle request' }],
      settings: options.settings || {
        providerType: 'custom', gatewayName: 'Test Gateway', model: 'test-model',
        baseUrl: 'https://provider.test/v1', apiKey: 'test-key'
      },
      userMessage: null,
      completionOptions: { requestTrace: trace },
      writeSse: async (_target, event, data) => { response.events.push({ event, data }); },
      getStatusBar: () => null,
      saveAssistantResult({ result }) {
        assistantSaves += 1;
        const assistant = { id: 'completed-assistant', content: result.content, usage: result.usage || null };
        trace.complete({ status: 'completed', assistantMessageId: assistant.id, usage: assistant.usage });
        return assistant;
      },
      saveInterruptedAssistantResult({ partialAssistant }) {
        interruptedSaves += 1;
        if (!partialAssistant.content && !partialAssistant.reasoning) return null;
        return options.interruptedAssistant?.(partialAssistant) || {
          id: 'partial-assistant', content: partialAssistant.content, reasoning: partialAssistant.reasoning, usage: null
        };
      }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  return { trace: trace.result, assistantSaves, interruptedSaves, events: response.events };
}

function createLifecycleTrace() {
  const result = { status: 'pending', assistantMessageId: '', errorCode: '' };
  return {
    result,
    requestStarted() { return 'wire-request'; },
    requestFinished() {},
    complete(update = {}) {
      if (result.status !== 'pending') return;
      Object.assign(result, update);
    }
  };
}

function sseResponse(payloads) {
  return new Response(payloads.map((payload) => `data: ${JSON.stringify(payload)}\n\n`).join(''), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' }
  });
}

class ResponseStub extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.writableEnded = false;
    this.events = [];
    this.socket = { setTimeout() {} };
  }

  setTimeout() {}
  writeHead() { return this; }
  flushHeaders() {}
  end() { this.writableEnded = true; }
}
