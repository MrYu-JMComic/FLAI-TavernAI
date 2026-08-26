import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import express from 'express';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const { createAppDatabase } = await import('../db.js');
const { createCharacter } = await import('../modules/characters.js');
const { createConversationMemory } = await import('../modules/conversationMemories.js');
const { createEntry, createWorldBook } = await import('../modules/worldBooks.js');
const { createConversationsRouter } = await import('../routes/conversations.js');
const { writeSse } = await import('../routes/helpers.js');
const { normalizeChatAttachments, validateChatAttachmentsForUpload } = await import('../services/chatAttachments.js');
const { createStreamEmitQueue } = await import('../services/providerStreamEmit.js');
const { hasUsableProvider } = await import('../services/providers.js');
const { insertUser, withServer } = await import('./routeTestUtils.js');
const conversationGenerationRouteSource = readFileSync(new URL('../routes/conversationGeneration.js', import.meta.url), 'utf8');
const routeHelpersSource = readFileSync(new URL('../routes/helpers.js', import.meta.url), 'utf8');
const chatAttachmentsSource = readFileSync(new URL('../services/chatAttachments.js', import.meta.url), 'utf8');
const generationDiagnosticsSource = readFileSync(new URL('../services/conversationGenerationDiagnostics.js', import.meta.url), 'utf8');
const conversationStreamResponseSource = readFileSync(new URL('../services/conversationStreamResponse.js', import.meta.url), 'utf8');
const assistantResultsSource = readFileSync(new URL('../services/conversationAssistantResults.js', import.meta.url), 'utf8');
const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
const tinyPngDataUrl = `data:image/png;base64,${tinyPngBase64}`;

test('chat streaming route keeps SSE connections alive during quiet provider periods', () => {
  assert.match(conversationGenerationRouteSource, /import \{ streamAssistantResponse \} from '\.\.\/services\/conversationStreamResponse\.js';/);
  assert.doesNotMatch(conversationGenerationRouteSource, /response\.socket\?\.setTimeout\?\.\(0\);/);
  assert.match(conversationStreamResponseSource, /export const CHAT_STREAM_HEARTBEAT_MS = 15_000;/);
  assert.match(conversationStreamResponseSource, /response\.socket\?\.setTimeout\?\.\(0\);/);
  assert.match(conversationStreamResponseSource, /'Content-Encoding': 'identity'/);
  assert.match(conversationStreamResponseSource, /const streamWrites = createStreamEmitQueue/);
  assert.match(conversationStreamResponseSource, /void emit\('ping', \{ at: Date\.now\(\) \}\);/);
  assert.match(conversationStreamResponseSource, /await streamWrites\.wait\(\);[\s\S]*response\.end\(\);/);
  assert.match(conversationStreamResponseSource, /clearInterval\(heartbeat\);/);
  assert.match(routeHelpersSource, /const frame = `event: \$\{event\}\\ndata: \$\{JSON\.stringify\(data\)\}\\n\\n`;/);
  assert.match(routeHelpersSource, /return waitForResponseDrain\(response\);/);
});

test('writeSse waits for response drain under backpressure', async () => {
  const response = new BackpressureResponse();
  const pendingWrite = writeSse(response, 'content', { text: 'slow' });
  let settled = false;
  pendingWrite.then(() => {
    settled = true;
  });

  await Promise.resolve();
  assert.equal(settled, false);
  assert.deepEqual(response.frames, ['event: content\ndata: {"text":"slow"}\n\n']);
  assert.equal(response.flushed, true);

  response.emit('drain');
  assert.equal(await pendingWrite, true);
  assert.equal(settled, true);
  assert.equal(await writeSse({ destroyed: true }, 'content', { text: 'ignored' }), false);
});

test('stream emit queue serializes async event writes', async () => {
  const releases = [];
  const steps = [];
  const queue = createStreamEmitQueue(async (_event, data) => {
    steps.push(`start:${data.index}`);
    await new Promise((resolve) => releases.push(resolve));
    steps.push(`finish:${data.index}`);
  });

  const first = queue.emit('content', { index: 1 });
  const second = queue.emit('content', { index: 2 });
  await Promise.resolve();
  assert.deepEqual(steps, ['start:1']);

  releases.shift()();
  await first;
  await Promise.resolve();
  assert.deepEqual(steps, ['start:1', 'finish:1', 'start:2']);

  releases.shift()();
  await second;
  await queue.wait();
  assert.deepEqual(steps, ['start:1', 'finish:1', 'start:2', 'finish:2']);
});

test('chat generation route delegates image attachment storage to a service', () => {
  assert.match(
    conversationGenerationRouteSource,
    /import \{[\s\S]*normalizeChatAttachments,[\s\S]*prepareUserChatAttachmentsForStorage,[\s\S]*validateChatAttachmentsForUpload,[\s\S]*resolveChatAttachmentsForModel[\s\S]*\} from '\.\.\/services\/chatAttachments\.js';/
  );
  assert.doesNotMatch(conversationGenerationRouteSource, /assetIdFromUrl/);
  assert.doesNotMatch(conversationGenerationRouteSource, /function parseImageDataUrl/);
  assert.doesNotMatch(conversationGenerationRouteSource, /CHAT_IMAGE_MAX_BYTES/);
  assert.doesNotMatch(conversationGenerationRouteSource, /function prepareChatAttachmentForStorage/);
  assert.match(chatAttachmentsSource, /import \{ appConfig \} from '\.\.\/config\.js';/);
  assert.match(chatAttachmentsSource, /const CHAT_IMAGE_LIMIT = 4;/);
  assert.match(chatAttachmentsSource, /const CHAT_IMAGE_MAX_BYTES = appConfig\.upload\.chatImageMaxBytes;/);
  assert.match(chatAttachmentsSource, /const CHAT_IMAGE_MAX_PIXELS = appConfig\.upload\.imageMaxPixels;/);
  assert.match(chatAttachmentsSource, /maxPixels: CHAT_IMAGE_MAX_PIXELS,/);
  assert.match(chatAttachmentsSource, /export function prepareChatAttachmentsForStorage\(database, userId, conversationId, attachments = \[\]\)/);
  assert.match(chatAttachmentsSource, /export function prepareUserChatAttachmentsForStorage\(database, userId, conversationId, attachments = \[\]\)/);
  assert.match(chatAttachmentsSource, /export function validateChatAttachmentsForUpload\(attachments = \[\]\)/);
  assert.match(chatAttachmentsSource, /createAsset\(database, userId,/);
  assert.match(chatAttachmentsSource, /export function resolveChatAttachmentsForModel\(database, userId, attachments = \[\]\)/);
});

test('chat image attachments reject MIME spoofing and oversized dimensions', () => {
  assert.equal(normalizeChatAttachments([{ dataUrl: tinyPngDataUrl }]).length, 1);
  assert.equal(normalizeChatAttachments([{ dataUrl: tinyPngDataUrl.replace('image/png', 'image/jpeg') }]).length, 0);
  assert.equal(normalizeChatAttachments([{ dataUrl: pngHeaderDataUrl(6000, 5000) }]).length, 0);
  assert.doesNotThrow(() => validateChatAttachmentsForUpload([{ dataUrl: tinyPngDataUrl }]));
  assert.throws(
    () => validateChatAttachmentsForUpload([{ dataUrl: tinyPngDataUrl.replace('image/png', 'image/jpeg') }]),
    /聊天图片数据无效/
  );
  assert.throws(
    () => validateChatAttachmentsForUpload([{ dataUrl: pngHeaderDataUrl(6000, 5000) }]),
    /聊天图片像素过大/
  );
});

test('chat route rejects invalid uploaded image attachments before saving or calling provider', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'chat-invalid-image-user';
  const conversationId = 'chat-invalid-image-conversation';
  insertUser(database, userId);
  const character = createCharacter(database, userId, { name: 'InvalidImageChar', visibility: 'private' });
  insertConversation(database, { userId, conversationId, characterId: character.id });

  const app = createConversationStreamingApp(database, userId, {
    providerType: 'custom',
    gatewayName: 'Invalid Image Gateway',
    baseUrl: 'https://invalid-image-provider.test/v1',
    model: 'vision-model'
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
          content: 'look at this',
          stream: false,
          attachments: [{ type: 'image', dataUrl: tinyPngDataUrl.replace('image/png', 'image/jpeg') }]
        })
      });
      const body = await response.json();

      assert.equal(response.status, 400);
      assert.match(body.error, /聊天图片数据无效/);
      assert.equal(providerFetchCount, 0);
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?').get(conversationId).count, 0);
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM assets WHERE user_id = ?').get(userId).count, 0);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chat generation route delegates diagnostics helpers to a service', () => {
  assert.match(
    conversationGenerationRouteSource,
    /import \{[\s\S]*createChatDiagnosticId,[\s\S]*hasAssistantPayload,[\s\S]*logAssistantPayloadFailure[\s\S]*\} from '\.\.\/services\/conversationGenerationDiagnostics\.js';/
  );
  assert.doesNotMatch(conversationGenerationRouteSource, /function safeUrlHost/);
  assert.doesNotMatch(conversationGenerationRouteSource, /function countIterable/);
  assert.doesNotMatch(conversationGenerationRouteSource, /function listOwnKeys/);
  assert.match(generationDiagnosticsSource, /import \{ sanitizeDiagnosticLogPayload, sanitizeDiagnosticText \} from '\.\/diagnosticRedaction\.js';/);
  assert.match(generationDiagnosticsSource, /export function logAssistantPayloadFailure\(/);
  assert.match(generationDiagnosticsSource, /providerDiagnostics: sanitizeDiagnosticLogPayload\(result\?\.diagnostics \|\| null\)/);
});

test('chat generation route delegates assistant result persistence to a service', () => {
  assert.match(
    conversationGenerationRouteSource,
    /createConversationAssistantResultService\(\{[\s\S]*createConversationMessage,[\s\S]*updateConversationTimestamp[\s\S]*\}\)/
  );
  assert.doesNotMatch(conversationGenerationRouteSource, /function saveAssistantResult/);
  assert.doesNotMatch(conversationGenerationRouteSource, /function saveAssistantImageResult/);
  assert.doesNotMatch(conversationGenerationRouteSource, /function saveInterruptedAssistantResult/);
  assert.match(assistantResultsSource, /export function createConversationAssistantResultService\(/);
  assert.match(assistantResultsSource, /applyRegexRules\(result\.content \|\| '', rules, 'output', macroContext\)/);
  assert.match(assistantResultsSource, /prepareChatAttachmentsForStorage\(db, userId, conversation\.id, result\.attachments\)/);
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
      await reader.read().catch((error) => {
        assert.equal(error?.name, 'AbortError');
        return null;
      });

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
            dataUrl: tinyPngDataUrl,
            mimeType: 'image/png',
            name: 'look.png',
            size: Buffer.from(tinyPngBase64, 'base64').length
          }]
        })
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.userMessage.attachments.length, 1);
      assert.match(body.userMessage.attachments[0].url, /^\/api\/assets\//);
      assert.equal(body.userMessage.attachments[0].dataUrl, undefined);
      const userAttachmentJson = database
        .prepare('SELECT attachments_json FROM messages WHERE id = ?')
        .get(body.userMessage.id)
        .attachments_json;
      assert.doesNotMatch(userAttachmentJson, /data:image\/png/);
      assert.match(userAttachmentJson, /\/api\/assets\//);
      const userAsset = database
        .prepare('SELECT * FROM assets WHERE user_id = ? AND kind = ? AND owner_type = ? AND owner_id = ?')
        .get(userId, 'chat-image', 'conversation', conversationId);
      assert.equal(userAsset.mime_type, 'image/png');
      assert.equal(userAsset.byte_size, Buffer.from(tinyPngBase64, 'base64').length);
      const lastMessage = providerBody.messages.at(-1);
      assert.equal(lastMessage.role, 'user');
      assert.deepEqual(lastMessage.content, [
        { type: 'text', text: 'look' },
        { type: 'image_url', image_url: { url: tinyPngDataUrl } }
      ]);

      const followupResponse = await fetch(`${baseUrl}/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'remember the image',
          stream: false
        })
      });
      assert.equal(followupResponse.status, 200);
      const historicalImageMessage = providerBody.messages.find((message) => Array.isArray(message.content));
      assert.deepEqual(historicalImageMessage.content, [
        { type: 'text', text: 'look' },
        { type: 'image_url', image_url: { url: tinyPngDataUrl } }
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
      data: [{ b64_json: tinyPngBase64, revised_prompt: 'a small lantern' }]
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
      assert.match(body.assistantMessage.attachments[0].url, /^\/api\/assets\//);
      assert.equal(body.assistantMessage.attachments[0].dataUrl, undefined);
      assert.equal(
        database.prepare('SELECT COUNT(*) AS count FROM assets WHERE user_id = ? AND kind = ?').get(userId, 'chat-image').count,
        1
      );
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
    model: 'gemini-3.1-flash-image',
    lookup: async () => [{ address: '8.8.8.8', family: 4 }]
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
            { inlineData: { mimeType: 'image/png', data: tinyPngBase64 } }
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
      assert.match(body.assistantMessage.attachments[0].url, /^\/api\/assets\//);
      assert.equal(body.assistantMessage.attachments[0].dataUrl, undefined);
      assert.equal(
        database.prepare('SELECT COUNT(*) AS count FROM assets WHERE user_id = ? AND kind = ?').get(userId, 'chat-image').count,
        1
      );
      assert.match(body.assistantMessage.content, /a tiny moon gate/);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chat image generation explicit false overrides image model auto-detection', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'chat-image-generation-disabled-user';
  const conversationId = 'chat-image-generation-disabled-conversation';
  insertUser(database, userId);
  const character = createCharacter(database, userId, { name: 'ImageToggleChar', visibility: 'private' });
  insertConversation(database, { userId, conversationId, characterId: character.id });

  const app = createConversationStreamingApp(database, userId, {
    providerType: 'custom',
    gatewayName: 'Image Toggle Gateway',
    baseUrl: 'https://image-toggle-provider.test/v1',
    model: 'gpt-image-2'
  });
  const originalFetch = globalThis.fetch;
  let providerBody = null;
  globalThis.fetch = async (url, options) => {
    const href = String(url);
    if (href.startsWith('http://127.0.0.1:')) {
      return originalFetch(url, options);
    }
    assert.doesNotMatch(href, /\/images\/generations$/);
    assert.match(href, /\/chat\/completions$/);
    providerBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'A text-only lantern description.' } }],
      usage: { total_tokens: 12 }
    }), { headers: { 'Content-Type': 'application/json' } });
  };

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'describe a lantern',
          stream: false,
          imageGeneration: false
        })
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(providerBody.model, 'gpt-image-2');
      assert.equal(body.assistantMessage.content, 'A text-only lantern description.');
      assert.equal(body.assistantMessage.attachments.length, 0);
      assert.equal(
        database.prepare('SELECT COUNT(*) AS count FROM assets WHERE user_id = ? AND kind = ?').get(userId, 'chat-image').count,
        0
      );
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

test('chat completion inserts context director between base and preset system prompts', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'chat-context-director-user';
  const conversationId = 'chat-context-director-conversation';
  insertUser(database, userId);
  const character = createCharacter(database, userId, {
    name: 'DirectorChar',
    persona: 'Speaks carefully.',
    visibility: 'private'
  });
  const worldBook = createWorldBook(database, userId, {
    name: 'Director Lore',
    characterId: character.id
  });
  createEntry(database, userId, worldBook.id, {
    name: 'Moon Gate',
    triggerKeys: 'moon gate',
    content: 'The moon gate opens only for sworn guests.'
  });
  insertConversation(database, { userId, conversationId, characterId: character.id });

  database.prepare(
    `INSERT INTO presets (id, user_id, name, system_prompt, temperature, max_tokens, top_p, frequency_penalty, presence_penalty, is_default, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'director-preset',
    userId,
    'Director Preset',
    'Preset session guidance sentinel.',
    0.7,
    2048,
    1,
    0,
    0,
    1,
    new Date().toISOString(),
    new Date().toISOString()
  );

  const app = createConversationStreamingApp(database, userId, {
    providerType: 'custom',
    gatewayName: 'Director Gateway',
    baseUrl: 'https://director-provider.test/v1',
    model: 'director-model'
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
      choices: [{ message: { content: 'Director reply.' } }]
    }), { headers: { 'Content-Type': 'application/json' } });
  };

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'approach the moon gate',
          stream: false
        })
      });

      assert.equal(response.status, 200);
      assert.equal(providerBody.messages[0].role, 'system');
      assert.match(providerBody.messages[0].content, /DirectorChar/);
      assert.match(providerBody.messages[0].content, /The moon gate opens only for sworn guests/);
      assert.equal(providerBody.messages[1].role, 'system');
      assert.match(providerBody.messages[1].content, /Context priority and conflict handling/);
      assert.match(providerBody.messages[1].content, /1\. Explicit user instruction/);
      assert.match(providerBody.messages[1].content, /matched world book entries/i);
      assert.equal(providerBody.messages[2].role, 'system');
      assert.match(providerBody.messages[2].content, /\[用户配置的会话级指令\]/);
      assert.match(providerBody.messages[2].content, /Preset session guidance sentinel\./);
      assert.equal(providerBody.messages.at(-1).role, 'user');
      assert.equal(providerBody.messages.at(-1).content, 'approach the moon gate');
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chat completion injects long-term conversation memories through the prompt pipeline', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'chat-memory-pipeline-user';
  const conversationId = 'chat-memory-pipeline-conversation';
  insertUser(database, userId);
  const character = createCharacter(database, userId, {
    name: 'MemoryChar',
    persona: 'Tracks continuity carefully.',
    visibility: 'private'
  });
  insertConversation(database, { userId, conversationId, characterId: character.id });
  createConversationMemory(database, userId, conversationId, {
    memoryType: 'event',
    subject: 'silver key',
    content: 'The player found a silver key under the old bridge.'
  });

  const app = createConversationStreamingApp(database, userId, {
    providerType: 'custom',
    gatewayName: 'Memory Gateway',
    baseUrl: 'https://memory-provider.test/v1',
    model: 'memory-model'
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
      choices: [{ message: { content: 'I remember the key.' } }]
    }), { headers: { 'Content-Type': 'application/json' } });
  };

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'What did we find?',
          stream: false
        })
      });

      assert.equal(response.status, 200);
      assert.match(providerBody.messages[0].content, /\[Long-term conversation memory\]/);
      assert.match(providerBody.messages[0].content, /silver key under the old bridge/);
      assert.match(providerBody.messages[1].content, /long-term conversation memory/i);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chat completion records pending automatic long-term memory candidates', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'chat-auto-memory-user';
  const conversationId = 'chat-auto-memory-conversation';
  insertUser(database, userId);
  const character = createCharacter(database, userId, {
    name: 'AutoMemoryChar',
    visibility: 'private'
  });
  insertConversation(database, { userId, conversationId, characterId: character.id });

  const app = createConversationStreamingApp(database, userId, {
    providerType: 'custom',
    gatewayName: 'Auto Memory Gateway',
    baseUrl: 'https://auto-memory-provider.test/v1',
    model: 'auto-memory-model'
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const href = String(url);
    if (href.startsWith('http://127.0.0.1:')) {
      return originalFetch(url, options);
    }
    JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: 'Mira trusts the player. The player found a silver key under the old bridge.'
        }
      }]
    }), { headers: { 'Content-Type': 'application/json' } });
  };

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'I prefer moon tea.',
          stream: false
        })
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      const memories = await waitForConversationMemories(database, conversationId, 2);
      assert.ok(memories.length >= 2);
      assert.equal(memories.every((memory) => memory.source_kind === 'auto'), true);
      assert.equal(memories.every((memory) => memory.enabled === 0), true);
      assert.equal(memories.every((memory) => memory.archived === 0), true);
      assert.equal(memories.some((memory) => memory.memory_type === 'preference'), true);
      assert.equal(memories.some((memory) => memory.memory_type === 'relationship'), true);
      assert.equal(
        memories.some((memory) => memory.memory_type === 'preference' && memory.source_message_id === body.userMessage.id),
        true
      );
      assert.equal(
        memories.some((memory) => memory.memory_type === 'relationship' && memory.source_message_id === body.assistantMessage.id),
        true
      );
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chat continue appends an assistant message without storing a user prompt', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'chat-continue-user';
  const conversationId = 'chat-continue-conversation';
  insertUser(database, userId);
  const character = createCharacter(database, userId, {
    name: 'ContinueChar',
    visibility: 'private'
  });
  insertConversation(database, { userId, conversationId, characterId: character.id });
  insertMessage(database, { userId, conversationId, id: 'continue-user-1', role: 'user', content: 'Open the old door.' });
  insertMessage(database, { userId, conversationId, id: 'continue-assistant-1', role: 'assistant', content: 'The hinges groan as the door opens.' });

  const app = createConversationStreamingApp(database, userId, {
    providerType: 'custom',
    gatewayName: 'Continue Gateway',
    baseUrl: 'https://continue-provider.test/v1',
    model: 'continue-model'
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
      choices: [{ message: { content: 'A cold blue light spills across the floor.' } }]
    }), { headers: { 'Content-Type': 'application/json' } });
  };

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/conversations/${conversationId}/messages/continue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stream: false })
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.userMessage, null);
      assert.equal(body.assistantMessage.role, 'assistant');
      assert.equal(body.assistantMessage.content, 'A cold blue light spills across the floor.');
      assert.equal(providerBody.messages.at(-2).role, 'assistant');
      assert.equal(providerBody.messages.at(-2).content, 'The hinges groan as the door opens.');
      assert.equal(providerBody.messages.at(-1).role, 'user');
      assert.match(providerBody.messages.at(-1).content, /从上一条 assistant 回复的末尾直接续写/);
      assert.match(providerBody.messages.at(-1).content, /不要复述、改写或总结/);

      const messages = database
        .prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY rowid ASC')
        .all(conversationId)
        .map((row) => ({ role: row.role, content: row.content }));
      assert.deepEqual(messages, [
        { role: 'user', content: 'Open the old door.' },
        { role: 'assistant', content: 'The hinges groan as the door opens.' },
        { role: 'assistant', content: 'A cold blue light spills across the floor.' }
      ]);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streaming chat continue emits only assistant events and persists no user prompt', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'chat-stream-continue-user';
  const conversationId = 'chat-stream-continue-conversation';
  insertUser(database, userId);
  const character = createCharacter(database, userId, {
    name: 'StreamContinueChar',
    visibility: 'private'
  });
  insertConversation(database, { userId, conversationId, characterId: character.id });
  insertMessage(database, { userId, conversationId, id: 'stream-continue-user-1', role: 'user', content: 'Begin the spell.' });
  insertMessage(database, { userId, conversationId, id: 'stream-continue-assistant-1', role: 'assistant', content: 'Silver sparks gather around her hands.' });

  const app = createConversationStreamingApp(database, userId, {
    providerType: 'custom',
    gatewayName: 'Stream Continue Gateway',
    baseUrl: 'https://stream-continue-provider.test/v1',
    model: 'stream-continue-model'
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const href = String(url);
    if (href.startsWith('http://127.0.0.1:')) {
      return originalFetch(url, options);
    }
    assert.equal(JSON.parse(options.body).stream, true);
    return new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'Then the spell blooms.' } }] })}\n\n` +
      'data: [DONE]\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } }
    );
  };

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/conversations/${conversationId}/messages/continue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const body = await response.text();

      assert.equal(response.status, 200);
      assert.doesNotMatch(body, /event: user_message/);
      assert.match(body, /event: meta/);
      assert.match(body, /event: content/);
      assert.match(body, /Then the spell blooms\./);
      assert.match(body, /event: done/);
      assert.match(body, /"userMessage":null/);

      const messages = database
        .prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY rowid ASC')
        .all(conversationId)
        .map((row) => ({ role: row.role, content: row.content }));
      assert.deepEqual(messages, [
        { role: 'user', content: 'Begin the spell.' },
        { role: 'assistant', content: 'Silver sparks gather around her hands.' },
        { role: 'assistant', content: 'Then the spell blooms.' }
      ]);
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

class BackpressureResponse extends EventEmitter {
  constructor() {
    super();
    this.frames = [];
    this.flushed = false;
    this.destroyed = false;
    this.writableEnded = false;
  }

  write(frame) {
    this.frames.push(frame);
    return false;
  }

  flush() {
    this.flushed = true;
  }
}

function insertConversation(database, { userId, conversationId, characterId }) {
  const timestamp = new Date().toISOString();
  database.prepare(
    'INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(conversationId, userId, characterId, 'Streaming Route Error', timestamp, timestamp);
}

function pngHeaderDataUrl(width, height) {
  const buffer = Buffer.alloc(24);
  buffer[0] = 0x89;
  buffer.write('PNG', 1, 3, 'ascii');
  buffer[4] = 0x0d;
  buffer[5] = 0x0a;
  buffer[6] = 0x1a;
  buffer[7] = 0x0a;
  buffer.write('IHDR', 12, 4, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

function insertMessage(database, { userId, conversationId, id, role, content }) {
  database.prepare(
    `INSERT INTO messages (id, user_id, conversation_id, role, content, attachments_json, reasoning, usage_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, userId, conversationId, role, content, '[]', '', null, new Date().toISOString());
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

async function waitForConversationMemories(database, conversationId, expectedCount) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const rows = database
      .prepare('SELECT * FROM conversation_memories WHERE conversation_id = ? ORDER BY rowid ASC')
      .all(conversationId);
    if (rows.length >= expectedCount) {
      return rows;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return database
    .prepare('SELECT * FROM conversation_memories WHERE conversation_id = ? ORDER BY rowid ASC')
    .all(conversationId);
}
