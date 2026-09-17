import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';

const { createAppDatabase } = await import('../db.js');
const { createCharacter } = await import('../modules/characters.js');
const { createConversationMemory, pinConversationMemory } = await import('../modules/conversationMemories.js');
const { createEntry, createWorldBook } = await import('../modules/worldBooks.js');
const { createConversationsRouter } = await import('../routes/conversations.js');
const { createUpgradeRouter } = await import('../routes/upgrade.js');
const { hasUsableProvider } = await import('../services/providers.js');
const { claimNextJob, completeJob } = await import('../services/jobs/jobQueue.js');
const { createDefaultJobHandlers } = await import('../services/jobs/jobHandlers.js');
const { insertUser, withServer } = await import('./routeTestUtils.js');

const tinyPngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

test('context budget routes validate positive integers, bind provider scope, clear values, and enforce owner', async (t) => {
  const fixture = createFixture(t, { providerType: 'openai', model: 'scope-model', supportsReasoning: true });
  await withServer(fixture.app, async (baseUrl) => {
    let response = await requestJson(baseUrl, fixture.conversationId, '/context/budget');
    assert.equal(response.status, 200);
    assert.equal(response.body.resolved.inputTokenLimit, 8192);
    assert.equal(response.body.provider.providerType, 'openai');
    assert.equal(response.body.provider.model, 'scope-model');

    response = await requestJson(baseUrl, fixture.conversationId, '/context/budget', {
      method: 'PUT',
      body: {
        inputTokenLimit: 6000,
        reservedOutputTokens: 700,
        imageTokensPerImage: 900,
        contextWindowTokens: 8000,
      },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.config.forModel, 'scope-model');
    assert.equal(response.body.config.forProviderType, 'openai');
    assert.equal(response.body.resolved.effectiveInputLimit, 6000);

    for (const invalid of [0, -1, true, '', 10_000_001]) {
      const invalidResponse = await requestJson(baseUrl, fixture.conversationId, '/context/budget', {
        method: 'PUT', body: { reservedOutputTokens: invalid },
      });
      assert.equal(invalidResponse.status, 400);
    }

    response = await requestJson(baseUrl, fixture.conversationId, '/context/budget', {
      method: 'PUT', body: { contextWindowTokens: null },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.config.contextWindowTokens ?? null, null);

    await requestJson(baseUrl, fixture.conversationId, '/context/budget', {
      method: 'PUT', body: { contextWindowTokens: 8000 },
    });
    fixture.settings.model = 'changed-model';
    response = await requestJson(baseUrl, fixture.conversationId, '/context/budget');
    assert.equal(response.status, 200);
    assert.equal(response.body.resolved.contextWindowTokens, null);
    assert.match(response.body.resolved.warning, /does not match/);

    fixture.database.prepare(
      'UPDATE conversations SET active_generation_id = ?, generation_expires_at = ? WHERE id = ?'
    ).run('generation-in-progress', Date.now() + 60_000, fixture.conversationId);
    response = await requestJson(baseUrl, fixture.conversationId, '/context/budget', {
      method: 'PUT', body: { inputTokenLimit: 5000 },
    });
    assert.equal(response.status, 409);
    fixture.database.prepare(
      "UPDATE conversations SET active_generation_id = '', generation_expires_at = NULL WHERE id = ?"
    ).run(fixture.conversationId);

    fixture.auth.user.id = 'other-user';
    response = await requestJson(baseUrl, fixture.conversationId, '/context/budget');
    assert.equal(response.status, 404);
  });
});

test('explicit token overflow rejects before provider call or message persistence without slicing input', async (t) => {
  const fixture = createFixture(t, { providerType: 'custom', model: 'small-context' });
  let providerCalls = 0;
  await withProviderFetch(async () => {
    providerCalls += 1;
    return jsonResponse(chatCompletion('must not run'));
  }, async () => {
    await withServer(fixture.app, async (baseUrl) => {
      const configured = await requestJson(baseUrl, fixture.conversationId, '/context/budget', {
        method: 'PUT',
        body: { inputTokenLimit: 32, reservedOutputTokens: 128 },
      });
      assert.equal(configured.status, 200);

      const content = '完整用户输入'.repeat(200);
      const response = await requestJson(baseUrl, fixture.conversationId, '/messages', {
        method: 'POST', body: {
          content,
          stream: false,
          attachments: [{ type: 'image', dataUrl: tinyPngDataUrl, mimeType: 'image/png', name: 'tiny.png' }],
        },
      });
      assert.equal(response.status, 400);
      assert.equal(response.body.code, 'CONTEXT_BUDGET_EXCEEDED');
      assert.equal(response.body.accepted, false);
      assert.equal(providerCalls, 0);
      assert.equal(messageCount(fixture.database, fixture.conversationId), 0);
      assert.equal(assetCount(fixture.database, fixture.userId), 0);
    });
  });
});

test('accepted send rolls back attachment, message, and lore state when deferred lore commit fails', async (t) => {
  const fixture = createFixture(t, { providerType: 'custom', model: 'atomic-model' }, 'atomic-send');
  const book = createWorldBook(fixture.database, fixture.userId, {
    name: 'Atomic lore', characterId: fixture.character.id,
  });
  createEntry(fixture.database, fixture.userId, book.id, {
    name: 'Atomic entry', triggerKeys: 'atomic lore', content: 'Atomic lore content', sticky: 2,
  });
  fixture.database.exec(`CREATE TRIGGER fail_world_book_clock
    BEFORE INSERT ON conversation_world_book_clock
    BEGIN SELECT RAISE(ABORT, 'forced world book clock failure'); END`);
  let providerCalls = 0;
  await withProviderFetch(async () => {
    providerCalls += 1;
    return jsonResponse(chatCompletion('must not run'));
  }, async () => {
    await withServer(fixture.app, async (baseUrl) => {
      const response = await requestJson(baseUrl, fixture.conversationId, '/messages', {
        method: 'POST', body: {
          content: 'activate atomic lore', stream: false,
          attachments: [{ type: 'image', dataUrl: tinyPngDataUrl, mimeType: 'image/png', name: 'atomic.png' }],
        },
      });
      assert.ok(response.status >= 400);
      assert.equal(response.body.accepted, false);
      assert.equal(providerCalls, 0);
      assert.equal(messageCount(fixture.database, fixture.conversationId), 0);
      assert.equal(assetCount(fixture.database, fixture.userId), 0);
      assert.equal(fixture.database.prepare(
        'SELECT COUNT(*) AS count FROM conversation_world_book_state WHERE conversation_id = ?'
      ).get(fixture.conversationId).count, 0);
    });
  });
});

test('pinned memory trace sources preserve id and revision and correspond to included logical prompt', async (t) => {
  const fixture = createFixture(t, { providerType: 'custom', model: 'memory-trace-model' }, 'memory-source');
  const created = createConversationMemory(fixture.database, fixture.userId, fixture.conversationId, {
    memoryType: 'fact', content: 'PINNED_MEMORY_SENTINEL', confidence: 0.9,
  });
  const pinned = pinConversationMemory(
    fixture.database,
    fixture.userId,
    fixture.conversationId,
    created.id,
    { pinned: true, revision: created.revision }
  );
  await withProviderFetch(async () => jsonResponse(chatCompletion('memory reply')), async () => {
    await withServer(fixture.app, async (baseUrl) => {
      const generated = await requestJson(baseUrl, fixture.conversationId, '/messages', {
        method: 'POST', body: { content: 'recall it', stream: false },
      });
      assert.equal(generated.status, 200);
      const listed = await requestJson(baseUrl, fixture.conversationId, '/context/traces');
      const detail = await requestJson(baseUrl, fixture.conversationId, `/context/traces/${listed.body.traces[0].id}`);
      const source = detail.body.selection.sources.memory.entries.find((entry) => entry.id === pinned.id);
      assert.equal(source.revision, pinned.revision);
      assert.equal(source.pinned, true);
      assert.ok(detail.body.logicalMessages.some((message) => String(message.content).includes('PINNED_MEMORY_SENTINEL')));
      assert.ok(detail.body.selection.manifest.some((entry) => entry.section === 'memory' && entry.included));
    });
  });
});

test('chat-completions, responses, and Anthropic request bodies are recorded exactly and traces are owner-scoped', async (t) => {
  const protocols = [
    {
      name: 'chat', settings: { providerType: 'custom', model: 'chat-model' },
      reply: chatCompletion('chat reply'), endpoint: '/chat/completions',
    },
    {
      name: 'responses', settings: { providerType: 'openai', model: 'response-model', supportsReasoning: true },
      reply: { output_text: 'responses reply', usage: { input_tokens: 10, output_tokens: 2 } }, endpoint: '/responses',
    },
    {
      name: 'anthropic', settings: { providerType: 'anthropic', model: 'claude-test' },
      reply: { content: [{ type: 'text', text: 'anthropic reply' }], usage: { input_tokens: 9, output_tokens: 3 } }, endpoint: '/messages',
    },
  ];

  for (const protocol of protocols) {
    await t.test(protocol.name, async (st) => {
      const fixture = createFixture(st, protocol.settings, `trace-${protocol.name}`);
      let sentBody;
      await withProviderFetch(async (_url, options) => {
        sentBody = JSON.parse(options.body);
        return jsonResponse(protocol.reply);
      }, async () => {
        await withServer(fixture.app, async (baseUrl) => {
          const configured = await requestJson(baseUrl, fixture.conversationId, '/context/budget', {
            method: 'PUT', body: { reservedOutputTokens: 333 },
          });
          assert.equal(configured.status, 200);
          const generated = await requestJson(baseUrl, fixture.conversationId, '/messages', {
            method: 'POST', body: { content: `hello ${protocol.name}`, stream: false },
          });
          assert.equal(generated.status, 200);
          const outputLimitKey = protocol.name === 'responses' ? 'max_output_tokens' : 'max_tokens';
          assert.equal(sentBody[outputLimitKey], 333);

          const listed = await requestJson(baseUrl, fixture.conversationId, '/context/traces');
          assert.equal(listed.status, 200);
          assert.equal(listed.body.traces.length, 1);
          assert.equal(listed.body.traces[0].status, 'completed');
          const detail = await requestJson(
            baseUrl,
            fixture.conversationId,
            `/context/traces/${listed.body.traces[0].id}`
          );
          assert.equal(detail.status, 200);
          assert.equal(detail.body.requests[0].endpoint, protocol.endpoint);
          assert.deepEqual(detail.body.requests[0].body, sentBody);
          assert.equal(detail.body.assistantMessageId, generated.body.assistantMessage.id);
          assert.ok(detail.body.usage);
          assert.equal(detail.body.selection.history.length, 0);

          fixture.auth.user.id = 'other-user';
          const denied = await requestJson(
            baseUrl,
            fixture.conversationId,
            `/context/traces/${listed.body.traces[0].id}`
          );
          assert.equal(denied.status, 404);
        });
      });
    });
  }
});

test('stream and continue generations create completed traces with source history ids', async (t) => {
  const fixture = createFixture(t, { providerType: 'custom', model: 'stream-model' }, 'trace-stream');
  let call = 0;
  const sentBodies = [];
  await withProviderFetch(async (_url, options) => {
    call += 1;
    const body = JSON.parse(options.body);
    sentBodies.push(body);
    if (body.stream) {
      return new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'streamed reply' } }] })}\n\ndata: [DONE]\n\n`,
        { headers: { 'Content-Type': 'text/event-stream' } }
      );
    }
    return jsonResponse(chatCompletion('continued reply'));
  }, async () => {
    await withServer(fixture.app, async (baseUrl) => {
      const streamed = await fetch(`${baseUrl}/api/conversations/${fixture.conversationId}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'start stream', stream: true }),
      });
      assert.equal(streamed.status, 200);
      assert.match(await streamed.text(), /streamed reply/);
      const afterStream = await requestJson(baseUrl, fixture.conversationId, '/context/traces');
      const streamedDetail = await requestJson(
        baseUrl,
        fixture.conversationId,
        `/context/traces/${afterStream.body.traces[0].id}`
      );
      assert.deepEqual(streamedDetail.body.requests[0].body, sentBodies[0]);
      const processingJob = claimNextJob(fixture.database, 'context-quality-worker');
      assert.ok(processingJob);
      const handlers = createDefaultJobHandlers(fixture.database, {
        providerSettings: () => ({ providerType: 'mock' }),
      });
      const processingResult = await handlers[processingJob.type]({
        job: processingJob,
        payload: processingJob.payload,
        signal: new AbortController().signal,
        progress: () => {},
      });
      completeJob(fixture.database, processingJob.id, processingJob.leaseOwner, processingResult);

      const continued = await requestJson(baseUrl, fixture.conversationId, '/messages/continue', {
        method: 'POST', body: { stream: false },
      });
      assert.equal(continued.status, 200);
      assert.equal(call, 2);

      const listed = await requestJson(baseUrl, fixture.conversationId, '/context/traces');
      assert.equal(listed.body.traces.length, 2);
      assert.ok(listed.body.traces.every((trace) => trace.status === 'completed'));
      const continueSummary = listed.body.traces.find((trace) => trace.operation.includes('continue'));
      const detail = await requestJson(baseUrl, fixture.conversationId, `/context/traces/${continueSummary.id}`);
      assert.ok(detail.body.selection.history.length >= 2);
      assert.ok(detail.body.selection.history.every((entry) => entry.id && entry.revision >= 1));
      assert.ok(detail.body.sourceMessageId);
      assert.ok(detail.body.sourceMessageRevision >= 1);
    });
  });
});

test('Responses and Anthropic SSE requests preserve exact wire bodies in completed traces', async (t) => {
  const protocols = [
    {
      name: 'responses-stream',
      settings: { providerType: 'openai', model: 'response-stream-model', supportsReasoning: true },
      endpoint: '/responses',
      outputKey: 'max_output_tokens',
      replyText: 'responses streamed reply',
      stream: (text) => [
        `event: response.output_text.delta\ndata: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}`,
        `event: response.completed\ndata: ${JSON.stringify({
          type: 'response.completed',
          response: { usage: { input_tokens: 12, output_tokens: 4, total_tokens: 16 } },
        })}`,
        'data: [DONE]',
      ].join('\n\n') + '\n\n',
    },
    {
      name: 'anthropic-stream',
      settings: { providerType: 'anthropic', model: 'claude-stream-model', supportsReasoning: false },
      endpoint: '/messages',
      outputKey: 'max_tokens',
      replyText: 'anthropic streamed reply',
      stream: (text) => [
        `event: message_start\ndata: ${JSON.stringify({
          type: 'message_start', message: { usage: { input_tokens: 11, output_tokens: 0 } },
        })}`,
        `event: content_block_delta\ndata: ${JSON.stringify({
          type: 'content_block_delta', delta: { type: 'text_delta', text },
        })}`,
        `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}`,
      ].join('\n\n') + '\n\n',
    },
  ];

  for (const protocol of protocols) {
    await t.test(protocol.name, async (st) => {
      const fixture = createFixture(st, protocol.settings, protocol.name);
      let sentBody;
      await withProviderFetch(async (_url, options) => {
        sentBody = JSON.parse(options.body);
        return new Response(protocol.stream(protocol.replyText), {
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }, async () => {
        await withServer(fixture.app, async (baseUrl) => {
          const configured = await requestJson(baseUrl, fixture.conversationId, '/context/budget', {
            method: 'PUT', body: { reservedOutputTokens: 444 },
          });
          assert.equal(configured.status, 200);
          const response = await fetch(`${baseUrl}/api/conversations/${fixture.conversationId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: `stream ${protocol.name}`, stream: true }),
          });
          assert.equal(response.status, 200);
          assert.match(await response.text(), new RegExp(protocol.replyText));
          assert.equal(sentBody.stream, true);
          assert.equal(sentBody[protocol.outputKey], 444);

          const listed = await requestJson(baseUrl, fixture.conversationId, '/context/traces');
          assert.equal(listed.body.traces.length, 1);
          assert.equal(listed.body.traces[0].status, 'completed');
          const detail = await requestJson(
            baseUrl,
            fixture.conversationId,
            `/context/traces/${listed.body.traces[0].id}`
          );
          assert.equal(detail.body.requests[0].endpoint, protocol.endpoint);
          assert.deepEqual(detail.body.requests[0].body, sentBody);
          assert.equal(detail.body.requests[0].status, 'response_received');
          assert.ok(detail.body.assistantMessageId);
        });
      });
    });
  }
});

test('provider terminal failures leave a failed trace while preserving the accepted user message', async (t) => {
  const fixture = createFixture(t, { providerType: 'custom', model: 'failure-model' }, 'trace-failure');
  await withProviderFetch(async () => new Response('gateway failed', { status: 502 }), async () => {
    await withServer(fixture.app, async (baseUrl) => {
      const response = await requestJson(baseUrl, fixture.conversationId, '/messages', {
        method: 'POST', body: { content: 'accepted before failure', stream: false },
      });
      assert.ok(response.status >= 400);
      const listed = await requestJson(baseUrl, fixture.conversationId, '/context/traces');
      assert.equal(listed.body.traces.length, 1);
      assert.equal(listed.body.traces[0].status, 'failed');
      assert.equal(messageCount(fixture.database, fixture.conversationId), 1);
    });
  });
});

function createFixture(t, overrides = {}, suffix = 'context-quality') {
  const database = createAppDatabase(':memory:');
  t.after(() => database.close());
  const userId = `owner-${suffix}`;
  const conversationId = `conversation-${suffix}`;
  insertUser(database, userId);
  insertUser(database, 'other-user');
  const character = createCharacter(database, userId, { name: 'Trace Character', visibility: 'private' });
  const timestamp = new Date().toISOString();
  database.prepare(
    'INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(conversationId, userId, character.id, 'Context quality', timestamp, timestamp);
  const auth = { user: { id: userId, username: userId } };
  const settings = {
    providerType: 'custom', gatewayName: 'Trace Gateway', baseUrl: 'https://trace-provider.test/v1',
    model: 'trace-model', apiKey: 'test-key', supportsReasoning: false, extraBody: {}, ...overrides,
  };
  const app = express();
  app.use(express.json());
  const routeContext = {
    db: database,
    requireAuth: (request, _response, next) => { request.auth = auth; next(); },
    asyncRoute: (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    newId: (() => { let counter = 0; return () => `${suffix}-${++counter}`; })(),
    nowIso: () => new Date().toISOString(),
    withEtag: (_request, response, data) => response.json(data),
    withListCache: (_request, response, data) => response.json(data),
    providerWithSecret: (row) => row,
    getProviderRow: () => settings,
    hasUsableProvider,
    getUserProfile: () => null,
    publicUser: (row) => row,
  };
  app.use('/api', createUpgradeRouter(routeContext));
  app.use('/api/conversations', createConversationsRouter(routeContext));
  app.use((error, _request, response, _next) => {
    response.status(error.statusCode || error.status || 500).json({ error: error.message, code: error.code });
  });
  return { app, auth, database, userId, conversationId, character, settings };
}

async function requestJson(baseUrl, conversationId, path, options = {}) {
  const response = await fetch(`${baseUrl}/api/conversations/${conversationId}${path}`, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

async function withProviderFetch(handler, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => String(url).startsWith('http://127.0.0.1:')
    ? originalFetch(url, options)
    : handler(url, options);
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function chatCompletion(content) {
  return { choices: [{ message: { content } }], usage: { prompt_tokens: 8, completion_tokens: 2 } };
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}

function messageCount(database, conversationId) {
  return database.prepare('SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?').get(conversationId).count;
}

function assetCount(database, userId) {
  return database.prepare('SELECT COUNT(*) AS count FROM assets WHERE user_id = ?').get(userId).count;
}
