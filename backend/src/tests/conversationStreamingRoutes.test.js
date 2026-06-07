import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';

const { createAppDatabase } = await import('../db.js');
const { createCharacter } = await import('../modules/characters.js');
const { createConversationsRouter } = await import('../routes/conversations.js');
const { hasUsableProvider } = await import('../services/providers.js');
const { insertUser, withServer } = await import('./routeTestUtils.js');

test('streaming chat emits provider errors without saving an assistant message', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'stream-route-error-user';
  const conversationId = 'stream-route-error-conversation';
  insertUser(database, userId);
  const character = createCharacter(database, userId, { name: 'StreamError', visibility: 'private' });
  insertConversation(database, { userId, conversationId, characterId: character.id });

  const app = createConversationStreamingApp(database, userId);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const href = String(url);
    if (href.startsWith('http://127.0.0.1:')) {
      return originalFetch(url, options);
    }
    assert.equal(JSON.parse(options.body).stream, true);
    return new Response('Provider exploded', { status: 502, statusText: 'Bad Gateway' });
  };

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'please continue' })
      });
      const body = await response.text();

      assert.equal(response.status, 200);
      assert.match(body, /event: user_message/);
      assert.match(body, /event: error/);
      assert.match(body, /Provider exploded/);

      const messages = database
        .prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY rowid ASC')
        .all(conversationId)
        .map((row) => ({ role: row.role, content: row.content }));
      assert.deepEqual(messages, [{ role: 'user', content: 'please continue' }]);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streaming chat persists partial assistant output when the client aborts', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'stream-route-abort-user';
  const conversationId = 'stream-route-abort-conversation';
  insertUser(database, userId);
  const character = createCharacter(database, userId, { name: 'StreamAbort', visibility: 'private' });
  insertConversation(database, { userId, conversationId, characterId: character.id });

  const app = createConversationStreamingApp(database, userId);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.startsWith('http://127.0.0.1:')) {
      return originalFetch(url, options);
    }

    return new Response(abortableProviderStream(options.signal), {
      headers: { 'Content-Type': 'text/event-stream' }
    });
  };

  try {
    await withServer(app, async (baseUrl) => {
      const abortController = new AbortController();
      const response = await fetch(`${baseUrl}/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'please stop later' }),
        signal: abortController.signal
      });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let text = '';
      while (!text.includes('Partial streamed reply')) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        text += decoder.decode(chunk.value, { stream: true });
      }

      assert.match(text, /event: content/);
      abortController.abort();
      await reader.read().catch(() => null);

      const messages = await waitForMessages(database, conversationId, 2);
      assert.deepEqual(
        messages.map((row) => ({ role: row.role, content: row.content })),
        [
          { role: 'user', content: 'please stop later' },
          { role: 'assistant', content: 'Partial streamed reply' }
        ]
      );
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function createConversationStreamingApp(database, userId) {
  const app = express();
  app.use(express.json());
  app.use('/api/conversations', createConversationsRouter({
    db: database,
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: userId, username: userId } };
      next();
    },
    asyncRoute: (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    newId: (() => {
      let counter = 0;
      return () => `stream-route-error-${++counter}`;
    })(),
    nowIso: () => new Date().toISOString(),
    withEtag: (_request, response, data) => response.json(data),
    withListCache: (_request, response, data) => response.json(data),
    providerWithSecret: (row) => row,
    getProviderRow: () => ({
      providerType: 'deepseek',
      gatewayName: 'Failing Provider',
      baseUrl: 'https://stream-route-error-provider.test',
      model: 'test-model',
      apiKey: 'sk-test',
      supportsReasoning: false,
      extraBody: {}
    }),
    hasUsableProvider
  }));
  app.use((error, _request, response, _next) => {
    response.status(500).json({ error: error.message });
  });
  return app;
}

function insertConversation(database, { userId, conversationId, characterId }) {
  const timestamp = new Date().toISOString();
  database.prepare(
    'INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(conversationId, userId, characterId, 'Streaming Route Error', timestamp, timestamp);
}

function abortableProviderStream(signal) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'Partial streamed reply' } }] })}\n\n`
      ));
      signal?.addEventListener('abort', () => {
        controller.error(Object.assign(new Error('Provider request aborted'), { name: 'AbortError' }));
      }, { once: true });
    }
  });
}

async function waitForMessages(database, conversationId, expectedCount) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const rows = database
      .prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY rowid ASC')
      .all(conversationId);
    if (rows.length >= expectedCount) {
      return rows;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return database
    .prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY rowid ASC')
    .all(conversationId);
}
