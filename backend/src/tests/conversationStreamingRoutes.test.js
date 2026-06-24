import assert from 'node:assert/strict';
import express from 'express';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const { createAppDatabase } = await import('../db.js');
const { createCharacter } = await import('../modules/characters.js');
const { createEntry, createWorldBook } = await import('../modules/worldBooks.js');
const { createConversationsRouter } = await import('../routes/conversations.js');
const { hasUsableProvider } = await import('../services/providers.js');
const { insertUser, withServer } = await import('./routeTestUtils.js');
const conversationsRouteSource = readFileSync(new URL('../routes/conversations.js', import.meta.url), 'utf8');

test('chat streaming route keeps SSE connections alive during quiet provider periods', () => {
  assert.match(conversationsRouteSource, /const CHAT_STREAM_HEARTBEAT_MS = 15_000;/);
  assert.match(conversationsRouteSource, /response\.socket\?\.setTimeout\?\.\(0\);/);
  assert.match(conversationsRouteSource, /'Content-Encoding': 'identity'/);
  assert.match(conversationsRouteSource, /setInterval\(\(\) => writeSse\(response, 'ping'/);
  assert.match(conversationsRouteSource, /clearInterval\(heartbeat\);/);
});

test('streaming chat emits provider errors without saving an assistant message', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'stream-route-error-user';
  const conversationId = 'stream-route-error-conversation';
  insertUser(database, userId);
  const character = createCharacter(database, userId, { name: 'StreamError', visibility: 'private' });
  const worldBook = createWorldBook(database, userId, {
    name: 'Route Lore',
    characterId: character.id
  });
  createEntry(database, userId, worldBook.id, {
    name: 'Route Secret',
    triggerKeys: 'secret',
    content: 'Secret route lore'
  });
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
        body: JSON.stringify({ content: 'please continue secret' })
      });
      const body = await response.text();

      assert.equal(response.status, 200);
      assert.match(body, /event: user_message/);
      assert.match(body, /event: meta/);
      assert.match(body, /Route Lore/);
      assert.match(body, /Route Secret/);
      assert.match(body, /event: error/);
      assert.match(body, /Provider exploded/);

      const messages = database
        .prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY rowid ASC')
        .all(conversationId)
        .map((row) => ({ role: row.role, content: row.content }));
      assert.deepEqual(messages, [{ role: 'user', content: 'please continue secret' }]);
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

test('chat message image attachments are saved and sent as multimodal content', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'chat-image-user';
  const conversationId = 'chat-image-conversation';
  insertUser(database, userId);
  const character = createCharacter(database, userId, { name: 'VisionChar', visibility: 'private' });
  insertConversation(database, { userId, conversationId, characterId: character.id });

  const app = createConversationStreamingApp(database, userId, {
    providerType: 'custom',
    gatewayName: 'Vision Gateway',
    baseUrl: 'https://vision-provider.test/v1',
    model: 'vision-model'
  });
  const originalFetch = globalThis.fetch;
  let providerBody = null;
  globalThis.fetch = async (url, options) => {
    const href = String(url);
    if (href.startsWith('http://127.0.0.1:')) {
      return originalFetch(url, options);
    }
    providerBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'I can see it.' } }]
    }), { headers: { 'Content-Type': 'application/json' } });
  };

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'look',
          stream: false,
          attachments: [{
            type: 'image',
            dataUrl: 'data:image/png;base64,AQID',
            mimeType: 'image/png',
            name: 'look.png',
            size: 3
          }]
        })
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.userMessage.attachments.length, 1);
      assert.equal(body.userMessage.attachments[0].dataUrl, 'data:image/png;base64,AQID');
      const lastMessage = providerBody.messages.at(-1);
      assert.equal(lastMessage.role, 'user');
      assert.deepEqual(lastMessage.content, [
        { type: 'text', text: 'look' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } }
      ]);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chat image generation saves returned image as an assistant attachment', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'chat-image-generation-user';
  const conversationId = 'chat-image-generation-conversation';
  insertUser(database, userId);
  const character = createCharacter(database, userId, { name: 'ImageGenChar', visibility: 'private' });
  insertConversation(database, { userId, conversationId, characterId: character.id });

  const app = createConversationStreamingApp(database, userId, {
    providerType: 'custom',
    gatewayName: 'Image Gateway',
    baseUrl: 'https://image-provider.test/v1',
    model: 'image-model'
  });
  const originalFetch = globalThis.fetch;
  let providerBody = null;
  globalThis.fetch = async (url, options) => {
    const href = String(url);
    if (href.startsWith('http://127.0.0.1:')) {
      return originalFetch(url, options);
    }
    assert.match(href, /\/images\/generations$/);
    providerBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      data: [{ b64_json: 'AQID', revised_prompt: 'a small lantern' }]
    }), { headers: { 'Content-Type': 'application/json' } });
  };

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'draw a lantern',
          stream: false,
          imageGeneration: true
        })
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(providerBody.model, 'image-model');
      assert.equal(providerBody.prompt, 'draw a lantern');
      assert.equal(body.assistantMessage.attachments.length, 1);
      assert.equal(body.assistantMessage.attachments[0].dataUrl, 'data:image/png;base64,AQID');
      assert.match(body.assistantMessage.content, /a small lantern/);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chat image generation auto-detects Gemini image models and uses native generateContent', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'chat-gemini-image-generation-user';
  const conversationId = 'chat-gemini-image-generation-conversation';
  insertUser(database, userId);
  const character = createCharacter(database, userId, { name: 'GeminiImageChar', visibility: 'private' });
  insertConversation(database, { userId, conversationId, characterId: character.id });

  const app = createConversationStreamingApp(database, userId, {
    providerType: 'gemini',
    gatewayName: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1/openai',
    model: 'gemini-3.1-flash-image'
  });
  const originalFetch = globalThis.fetch;
  let providerBody = null;
  let providerHeaders = null;
  globalThis.fetch = async (url, options) => {
    const href = String(url);
    if (href.startsWith('http://127.0.0.1:')) {
      return originalFetch(url, options);
    }
    assert.match(href, /\/v1\/models\/gemini-3\.1-flash-image:generateContent$/);
    providerHeaders = options.headers;
    providerBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [
            { text: 'a tiny moon gate' },
            { inlineData: { mimeType: 'image/png', data: 'AQID' } }
          ]
        }
      }],
      usageMetadata: { totalTokenCount: 42 }
    }), { headers: { 'Content-Type': 'application/json' } });
  };

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'draw a moon gate',
          stream: false
        })
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(providerHeaders['x-goog-api-key'], 'sk-test');
      assert.deepEqual(providerBody.contents, [{
        role: 'user',
        parts: [{ text: 'draw a moon gate' }]
      }]);
      assert.deepEqual(providerBody.generationConfig.responseModalities, ['TEXT', 'IMAGE']);
      assert.equal(body.assistantMessage.attachments.length, 1);
      assert.equal(body.assistantMessage.attachments[0].dataUrl, 'data:image/png;base64,AQID');
      assert.match(body.assistantMessage.content, /a tiny moon gate/);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chat image generation rejects unsupported xAI lite image model before provider fetch', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'chat-image-generation-lite-user';
  const conversationId = 'chat-image-generation-lite-conversation';
  insertUser(database, userId);
  const character = createCharacter(database, userId, { name: 'ImageLiteChar', visibility: 'private' });
  insertConversation(database, { userId, conversationId, characterId: character.id });

  const app = createConversationStreamingApp(database, userId, {
    providerType: 'xai',
    gatewayName: 'xAI',
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-imagine-image-lite'
  });
  const originalFetch = globalThis.fetch;
  let providerFetchCount = 0;
  globalThis.fetch = async (url, options) => {
    const href = String(url);
    if (href.startsWith('http://127.0.0.1:')) {
      return originalFetch(url, options);
    }
    providerFetchCount += 1;
    return originalFetch(url, options);
  };

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'draw a lantern',
          stream: false,
          imageGeneration: true
        })
      });
      const body = await response.json();

      assert.equal(response.status, 400);
      assert.equal(providerFetchCount, 0);
      assert.match(body.error, /grok-imagine-image-lite/);
      assert.match(body.error, /grok-imagine-image-quality/);
      assert.equal(body.userMessage.content, 'draw a lantern');
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function createConversationStreamingApp(database, userId, providerOverrides = {}) {
  const providerSettings = {
    providerType: 'deepseek',
    gatewayName: 'Failing Provider',
    baseUrl: 'https://stream-route-error-provider.test',
    model: 'test-model',
    apiKey: 'sk-test',
    supportsReasoning: false,
    extraBody: {},
    ...providerOverrides
  };
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
    getProviderRow: () => providerSettings,
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
