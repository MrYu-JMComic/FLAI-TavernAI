import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import { initializeDatabase, resetColumnCache } from '../db/schema.js';
import { createAsset, getAssetForViewer } from '../modules/assets.js';
import {
  beginCharacterAssistantTurn, createCharacterAssistantSession, finishCharacterAssistantTurn,
  getCharacterAssistantSession
} from '../modules/characterAssistantSessions.js';
import { createCharactersRouter } from '../routes/characters.js';
import { completeCharacterDraft, streamCharacterDraft } from '../services/characterAssistant.js';
import { buildCharacterContext } from '../services/characterAssistantContext.js';
import { insertUser, withServer } from './routeTestUtils.js';

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
const dataUrl = `data:image/png;base64,${pngBase64}`;
const image = { type: 'image', dataUrl, name: 'reference.png', mimeType: 'image/png' };
const settings = { providerType: 'openai', baseUrl: 'https://assistant-images.test/v1', apiKey: 'test-key', model: 'test-model', extraBody: {} };

function fixture() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  resetColumnCache();
  initializeDatabase(database);
  insertUser(database, 'owner');
  insertUser(database, 'other');
  const app = express();
  app.use(express.json({ limit: '8mb' }));
  app.use('/api/characters', createCharactersRouter({
    db: database, config: { isProduction: false },
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: request.headers['x-test-user'] || 'owner', username: 'Owner' } };
      next();
    },
    asyncRoute: handler => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    getChatProviderSettings: () => ({ ok: true, value: settings })
  }));
  app.use((error, _request, response, _next) => response.status(error.status || 500).json({ error: error.message }));
  return { database, app };
}

function request(body, user = 'owner') {
  return { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-user': user }, body: JSON.stringify({ conversationMode: true, ...body }) };
}

function providerResponse(body, { fail = false, plan = false } = {}) {
  if (fail) return Response.json({ error: { message: 'Provider temporarily unavailable' } }, { status: 503 });
  const message = { role: 'assistant', content: 'I can use the reference image.' };
  if (plan) message.tool_calls = [{ id: 'plan-images', type: 'function', function: {
    name: 'submit_character_plan', arguments: JSON.stringify({ steps: [{ section: 'persona', intent: 'Use the visual reference', detail: 'Preserve existing traits' }], risks: [] })
  } }];
  if (!body.stream || plan) return Response.json({ choices: [{ message }] });
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: message, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
}

function modelImages(messages) {
  return messages.flatMap(message => Array.isArray(message.content) ? message.content.filter(part => part.type === 'image_url') : []);
}

for (const streaming of [false, true]) {
  test(`assistant image-only turns persist private assets and reuse images from server history, streaming ${streaming}`, async () => {
    const { database, app } = fixture();
    const originalFetch = globalThis.fetch;
    const bodies = [];
    try {
      const session = createCharacterAssistantSession(database, 'owner');
      globalThis.fetch = async (url, options = {}) => {
        if (!String(url).startsWith(settings.baseUrl)) return originalFetch(url, options);
        const body = JSON.parse(options.body);
        bodies.push(body);
        return providerResponse(body);
      };
      await withServer(app, async base => {
        const endpoint = `${base}/api/characters/complete-draft`;
        const first = await fetch(endpoint, request({ assistantSessionId: session.id, attachments: [image], stream: streaming, providerStreaming: streaming }));
        assert.equal(first.status, 200, await first.clone().text());
        const output = await first.text();
        assert.doesNotMatch(output, /data:image|base64/);
        const stored = getCharacterAssistantSession(database, 'owner', session.id);
        const attachment = stored.messages[0].attachments[0];
        assert.match(attachment.url, /^\/api\/assets\//);
        assert.equal(attachment.name, 'reference.png');
        assert.equal(Object.hasOwn(attachment, 'dataUrl'), false);
        assert.match(stored.messages[0].content, /图片/);
        assert.equal(database.prepare('SELECT owner_type, owner_id FROM assets').get().owner_type, 'character-assistant-session');
        assert.equal(database.prepare('SELECT owner_id FROM assets').get().owner_id, session.id);
        assert.ok(getAssetForViewer(database, 'owner', attachment.url.split('/').at(-1)));
        assert.equal(getAssetForViewer(database, 'other', attachment.url.split('/').at(-1)), null);
        assert.equal(modelImages(bodies[0].messages)[0].image_url.url, dataUrl);
        assert.equal(JSON.parse(bodies[0].messages.at(-1).content[0].text).currentCharacter.name, '');
        assert.equal(stored.state.context.imageCount, 1);
        assert.equal(stored.state.context.components.find(component => component.key === 'images').estimatedTokens, 1024);
        const next = await fetch(endpoint, request({ assistantSessionId: session.id, requirement: 'Continue using the reference.', history: [{ role: 'user', content: 'FORGED' }] }));
        assert.equal(next.status, 200, await next.clone().text());
        await next.text();
        assert.equal(modelImages(bodies[1].messages)[0].image_url.url, dataUrl);
        assert.equal(JSON.stringify(bodies[1]).includes('FORGED'), false);
        assert.equal(typeof bodies[1].messages.at(-1).content, 'string');
        assert.equal(database.prepare('SELECT COUNT(*) AS count FROM assets').get().count, 1);
      });
    } finally {
      globalThis.fetch = originalFetch;
      database.close();
    }
  });
}

test('assistant rejects invalid, excessive, oversized, and foreign images before mutating a session', async () => {
  const { database, app } = fixture();
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  try {
    const session = createCharacterAssistantSession(database, 'owner');
    const foreign = createAsset(database, 'other', { dataUrl, ownerType: 'character-assistant-session', ownerId: 'other-session' });
    const oversized = `data:image/png;base64,${Buffer.concat([Buffer.from(pngBase64, 'base64'), Buffer.alloc(4 * 1024 * 1024)]).toString('base64')}`;
    globalThis.fetch = async (url, options = {}) => {
      if (!String(url).startsWith(settings.baseUrl)) return originalFetch(url, options);
      providerCalls += 1;
      return providerResponse(JSON.parse(options.body));
    };
    await withServer(app, async base => {
      for (const attachments of [
        [{ dataUrl: 'data:image/png;base64,aGVsbG8=' }],
        Array(5).fill(image), [{ ...image, dataUrl: oversized }], [{ type: 'image', url: foreign.url }],
        [{ type: 'image', url: 'https://external.test/unsolicited.png' }]
      ]) {
        const response = await fetch(`${base}/api/characters/complete-draft`, request({ assistantSessionId: session.id, attachments, stream: true }));
        assert.equal(response.status, 400);
        assert.match((await response.json()).error, /图片|最多/);
        assert.deepEqual(getCharacterAssistantSession(database, 'owner', session.id).messages, []);
      }
      const ownAsset = createAsset(database, 'owner', { dataUrl, ownerType: 'character-assistant-session', ownerId: session.id });
      const accepted = await fetch(`${base}/api/characters/complete-draft`, request({ assistantSessionId: session.id, attachments: [{ type: 'image', url: ownAsset.url }] }));
      assert.equal(accepted.status, 200, await accepted.clone().text());
      await accepted.text();
      assert.equal(getCharacterAssistantSession(database, 'owner', session.id).messages[0].attachments[0].url, ownAsset.url);
    });
    assert.equal(providerCalls, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM assets').get().count, 2);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test('assistant asset storage rolls back with a rejected turn and releases its run reservation', () => {
  const { database } = fixture();
  try {
    const session = createCharacterAssistantSession(database, 'owner');
    database.exec("CREATE TRIGGER reject_assistant_message BEFORE UPDATE ON character_assistant_sessions BEGIN SELECT RAISE(ABORT, 'reject turn'); END");
    assert.throws(() => beginCharacterAssistantTurn(database, 'owner', session.id, { attachments: [image] }), /reject turn/);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM assets').get().count, 0);
    assert.deepEqual(getCharacterAssistantSession(database, 'owner', session.id).messages, []);
    database.exec('DROP TRIGGER reject_assistant_message');
    const turn = beginCharacterAssistantTurn(database, 'owner', session.id, { attachments: [image] });
    finishCharacterAssistantTurn(database, 'owner', turn, { assistantMessage: 'Accepted retry' });
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM assets').get().count, 1);
  } finally { database.close(); }
});

test('failed assistant runs keep private image references so retries reuse the saved asset', async () => {
  const { database, app } = fixture();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    const session = createCharacterAssistantSession(database, 'owner');
    globalThis.fetch = async (url, options = {}) => {
      if (!String(url).startsWith(settings.baseUrl)) return originalFetch(url, options);
      calls += 1;
      return providerResponse(JSON.parse(options.body), { fail: calls === 1 });
    };
    await withServer(app, async base => {
      const endpoint = `${base}/api/characters/complete-draft`;
      const failed = await fetch(endpoint, request({ assistantSessionId: session.id, attachments: [image] }));
      assert.equal(failed.status, 400);
      await failed.text();
      const saved = getCharacterAssistantSession(database, 'owner', session.id);
      assert.equal(saved.messages.at(-1).status, 'failed');
      const retry = await fetch(endpoint, request({ assistantSessionId: session.id, attachments: saved.messages[0].attachments }));
      assert.equal(retry.status, 200, await retry.clone().text());
      await retry.text();
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM assets').get().count, 1);
    });
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

for (const provider of ['chat', 'responses', 'anthropic']) {
  for (const streaming of [false, true]) {
    test(`assistant sends real ${provider} image blocks without a database, streaming ${streaming}`, async () => {
      const originalFetch = globalThis.fetch;
      const bodies = [];
      try {
        globalThis.fetch = async (_url, options) => {
          const body = JSON.parse(options.body);
          bodies.push(body);
          if (provider === 'anthropic') return Response.json({ content: [{ type: 'text', text: 'Reference received.' }] });
          if (provider === 'responses') return Response.json({ id: 'response-images', output_text: 'Reference received.', output: [] });
          return providerResponse(body);
        };
        const config = { ...settings, providerType: provider === 'anthropic' ? 'anthropic' : 'openai', supportsReasoning: provider === 'responses' };
        const input = { conversationMode: true, requirement: 'Use the reference.', attachments: [image] };
        const result = streaming
          ? await streamCharacterDraft(config, { ...input, providerStreaming: true })
          : await completeCharacterDraft(config, input);
        assert.equal(bodies.length, 1);
        assert.equal(result.context.imageCount, 1);
        const last = (provider === 'responses' ? bodies[0].input : bodies[0].messages).at(-1);
        if (provider === 'anthropic') assert.deepEqual(last.content.at(-1), { type: 'image', source: { type: 'base64', media_type: 'image/png', data: pngBase64 } });
        else if (provider === 'responses') assert.deepEqual(last.content.at(-1), { type: 'input_image', image_url: dataUrl });
        else assert.deepEqual(last.content.at(-1), { type: 'image_url', image_url: { url: dataUrl } });
        assert.doesNotMatch(JSON.stringify(result.context), /base64|data:image/);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }
}

test('assistant plan mode sees image references without applying character changes', async () => {
  const originalFetch = globalThis.fetch;
  let body;
  try {
    globalThis.fetch = async (_url, options) => {
      body = JSON.parse(options.body);
      return providerResponse(body, { plan: true });
    };
    const result = await completeCharacterDraft(settings, { conversationMode: true, planMode: true, attachments: [image] });
    assert.equal(result.phase, 'plan');
    assert.equal(Object.hasOwn(result, 'character'), false);
    assert.equal(modelImages(body.messages)[0].image_url.url, dataUrl);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('assistant image context bounds history before resolving bytes and keeps text and pure-image turns', () => {
  const { database } = fixture();
  try {
    const assets = Array.from({ length: 8 }, (_, index) => createAsset(database, 'owner', {
      dataUrl: `data:image/png;base64,${Buffer.concat([Buffer.from(pngBase64, 'base64'), Buffer.from([index])]).toString('base64')}`,
      name: `image-${index}.png`, ownerType: 'character-assistant-session', ownerId: 'session'
    }));
    const attachment = asset => ({ type: 'image', url: asset.url });
    const history = [
      { role: 'user', content: '', attachments: assets.slice(0, 4).map(attachment) },
      { role: 'user', content: 'Keep this text.', attachments: assets.slice(4).map(attachment) },
      { role: 'user', content: '', attachments: [attachment(assets[6])] }
    ];
    const queries = [];
    const observedDatabase = { prepare(sql) {
      const statement = database.prepare(sql);
      return { get(...values) { if (sql.startsWith('SELECT * FROM assets')) queries.push(values[0]); return statement.get(...values); } };
    } };
    const first = buildCharacterContext({ system: 'Fixed', stablePrefix: true, history, attachments: [{ ...attachment(assets[7]), dataUrl: assets[7].dataUrl }], database: observedDatabase, userId: 'owner' });
    assert.equal(first.context.imageCount, 4);
    assert.equal(first.context.limits.images, 4);
    assert.equal(first.context.droppedHistoryImages, 6);
    assert.equal(queries.length, 3);
    assert.deepEqual(new Set(queries), new Set([assets[6].id, assets[4].id, assets[5].id]));
    assert.equal(first.messages.some(message => message.content === ''), false);
    assert.ok(JSON.stringify(first.messages).includes('Keep this text.'));
    assert.ok(first.messages.some(message => Array.isArray(message.content) && message.content.length === 1 && message.content[0].type === 'image_url'));
    const next = buildCharacterContext({ system: 'Fixed', stablePrefix: true, history, attachments: assets.slice(0, 4).map(attachment), database, userId: 'owner' });
    assert.equal(next.context.imageCount, 4);
    assert.equal(next.context.droppedHistoryImages, 9);
    assert.equal(next.messages[1].content, 'Keep this text.');
    const recovered = buildCharacterContext({ system: 'Fixed', stablePrefix: true, database, userId: 'owner', history: [{ role: 'user', content: 'Continue this conversation.', attachments: [{ type: 'image', url: '/api/assets/deleted-image' }] }] });
    assert.equal(recovered.context.imageCount, 0);
    assert.equal(recovered.context.droppedHistoryImages, 1);
    assert.equal(recovered.messages[1].content, 'Continue this conversation.');
    assert.throws(() => buildCharacterContext({ system: 'Fixed', database, userId: 'owner', attachments: [{ type: 'image', url: '/api/assets/deleted-image' }] }), /不可访问/);
  } finally { database.close(); }
});
