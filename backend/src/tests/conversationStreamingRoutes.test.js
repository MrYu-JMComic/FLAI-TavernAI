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
