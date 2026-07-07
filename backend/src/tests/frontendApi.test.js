import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { findSseBlockSeparator, forEachSseLine } from '../../../shared/sse.js';

const frontendApi = await import('../../../frontend/src/api.js');
const {
  __resetApiCsrfTokenForTests,
  apiRequest,
  streamCharacterDraft,
  streamNpcOrganizer,
  updateCharacter
} = frontendApi;
const authApi = await import('../../../frontend/src/api/auth.js');
const providersApi = await import('../../../frontend/src/api/providers.js');
const assetsApi = await import('../../../frontend/src/api/assets.js');
const envelopesApi = await import('../../../frontend/src/api/envelopes.js');
const diagnosticsApi = await import('../../../frontend/src/api/diagnostics.js');
const appApi = await import('../../../frontend/src/api/app.js');
const charactersApi = await import('../../../frontend/src/api/characters.js');
const chatApi = await import('../../../frontend/src/api/chat.js');
const modsApi = await import('../../../frontend/src/api/mods.js');
const presetsApi = await import('../../../frontend/src/api/presets.js');
const settingsApi = await import('../../../frontend/src/api/settings.js');
const tagsApi = await import('../../../frontend/src/api/tags.js');
const talentsApi = await import('../../../frontend/src/api/talents.js');
const worldBooksApi = await import('../../../frontend/src/api/worldBooks.js');
const frontendApiCoreSource = readFileSync(new URL('../../../frontend/src/api/core.js', import.meta.url), 'utf8');

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function sseResponse(text, status = 200) {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      }
    }),
    {
      status,
      headers: { 'Content-Type': 'text/event-stream' }
    }
  );
}

function sseByteChunksResponse(chunks, status = 200) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      }
    }),
    {
      status,
      headers: { 'Content-Type': 'text/event-stream' }
    }
  );
}

function textResponse(text, status = 500) {
  return new Response(text, {
    status,
    headers: { 'Content-Type': 'text/plain' }
  });
}

test('frontend API domain modules back the compatibility exports', () => {
  assert.equal(frontendApi.getMe, authApi.getMe);
  assert.equal(frontendApi.login, authApi.login);
  assert.equal(frontendApi.saveUserProfile, authApi.saveUserProfile);
  assert.equal(frontendApi.getProviderSettings, providersApi.getProviderSettings);
  assert.equal(frontendApi.fetchProviderCapabilities, providersApi.fetchProviderCapabilities);
  assert.equal(frontendApi.checkProviderHealth, providersApi.checkProviderHealth);
  assert.equal(frontendApi.fetchAssets, assetsApi.fetchAssets);
  assert.equal(frontendApi.createAsset, assetsApi.createAsset);
  assert.equal(frontendApi.exportEnvelope, envelopesApi.exportEnvelope);
  assert.equal(frontendApi.importEnvelope, envelopesApi.importEnvelope);
  assert.equal(frontendApi.exportDiagnostics, diagnosticsApi.exportDiagnostics);
  assert.equal(frontendApi.fetchAppBootstrap, appApi.fetchAppBootstrap);
  assert.equal(frontendApi.exportProjectSnapshot, appApi.exportProjectSnapshot);
  assert.equal(frontendApi.fetchCharacters, charactersApi.fetchCharacters);
  assert.equal(frontendApi.updateCharacter, charactersApi.updateCharacter);
  assert.equal(frontendApi.streamCharacterDraft, charactersApi.streamCharacterDraft);
  assert.equal(frontendApi.fetchCharacterImages, charactersApi.fetchCharacterImages);
  assert.equal(frontendApi.rollCharacterTalent, charactersApi.rollCharacterTalent);
  assert.equal(frontendApi.fetchWorldBooks, worldBooksApi.fetchWorldBooks);
  assert.equal(frontendApi.previewWorldBookMatches, worldBooksApi.previewWorldBookMatches);
  assert.equal(frontendApi.streamWorldBookDraft, worldBooksApi.streamWorldBookDraft);
  assert.equal(frontendApi.fetchConversations, chatApi.fetchConversations);
  assert.equal(frontendApi.fetchConversationBranchTree, chatApi.fetchConversationBranchTree);
  assert.equal(frontendApi.previewConversationContext, chatApi.previewConversationContext);
  assert.equal(frontendApi.fetchConversationMemories, chatApi.fetchConversationMemories);
  assert.equal(frontendApi.confirmConversationMemory, chatApi.confirmConversationMemory);
  assert.equal(frontendApi.disableConversationMemory, chatApi.disableConversationMemory);
  assert.equal(frontendApi.rollbackConversationMemory, chatApi.rollbackConversationMemory);
  assert.equal(frontendApi.streamNpcOrganizer, chatApi.streamNpcOrganizer);
  assert.equal(frontendApi.streamMessage, chatApi.streamMessage);
  assert.equal(frontendApi.continueMessage, chatApi.continueMessage);
  assert.equal(frontendApi.streamContinueMessage, chatApi.streamContinueMessage);
  assert.equal(frontendApi.fetchMods, modsApi.fetchMods);
  assert.equal(frontendApi.reorderMods, modsApi.reorderMods);
  assert.equal(frontendApi.fetchPresets, presetsApi.fetchPresets);
  assert.equal(frontendApi.setDefaultPreset, presetsApi.setDefaultPreset);
  assert.equal(frontendApi.fetchRegexRules, settingsApi.fetchRegexRules);
  assert.equal(frontendApi.importRegexRuleSet, settingsApi.importRegexRuleSet);
  assert.equal(frontendApi.fetchTags, tagsApi.fetchTags);
  assert.equal(frontendApi.createTag, tagsApi.createTag);
  assert.equal(frontendApi.fetchTalentPools, talentsApi.fetchTalentPools);
  assert.equal(frontendApi.updateTalentPool, talentsApi.updateTalentPool);
});

test('frontend envelope API uses the unified envelope routes', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  __resetApiCsrfTokenForTests();

  globalThis.fetch = async (url, request = {}) => {
    requests.push({ url: String(url), request });
    if (String(url).endsWith('/api/csrf-token')) {
      return jsonResponse({ csrfToken: 'csrf-for-envelope-api-test' });
    }
    return jsonResponse({ ok: true, kind: 'characters' });
  };

  try {
    const exported = await envelopesApi.exportEnvelope('characters', { ids: ['char-1', 'char-1', 'char-2'] });
    const imported = await envelopesApi.importEnvelope('world-books', {
      version: 1,
      kind: 'world_books',
      items: []
    });

    assert.deepEqual(exported, { ok: true, kind: 'characters' });
    assert.deepEqual(imported, { ok: true, kind: 'characters' });
    assert.deepEqual(
      requests.map(({ url }) => url),
      [
        '/api/envelopes/characters?ids=char-1%2Cchar-2',
        '/api/csrf-token',
        '/api/envelopes/world-books/import'
      ]
    );
    assert.equal(requests[2].request.method, 'POST');
    assert.equal(requests[2].request.headers['X-CSRF-Token'], 'csrf-for-envelope-api-test');
    assert.deepEqual(JSON.parse(requests[2].request.body), {
      version: 1,
      kind: 'world_books',
      items: []
    });
  } finally {
    globalThis.fetch = originalFetch;
    __resetApiCsrfTokenForTests();
  }
});

test('frontend assistant SSE errors preserve structured message fields', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const handledErrors = [];

  globalThis.fetch = async (url, request = {}) => {
    requests.push({ url: String(url), request });
    if (String(url).endsWith('/api/csrf-token')) {
      return jsonResponse({ csrfToken: 'csrf-for-frontend-api-test' });
    }
    return sseResponse('event: error\ndata: {"message":"Provider model is unavailable"}\n\n');
  };

  try {
    await assert.rejects(
      () => streamCharacterDraft(
        { name: 'Draft Target' },
        {
          error(data) {
            handledErrors.push(data);
          }
        }
      ),
      /Provider model is unavailable/
    );

    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, '/api/csrf-token');
    assert.equal(requests[1].url, '/api/characters/complete-draft');
    assert.equal(requests[1].request.method, 'POST');
    assert.equal(JSON.parse(requests[1].request.body).stream, true);
    assert.deepEqual(handledErrors, [{ message: 'Provider model is unavailable' }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('frontend assistant SSE errors preserve plain text payloads', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/api/csrf-token')) {
      return jsonResponse({ csrfToken: 'csrf-for-frontend-api-plain-text-test' });
    }
    return sseResponse('event: error\ndata: Upstream timeout while streaming\n\n');
  };

  try {
    await assert.rejects(
      () => streamCharacterDraft({ name: 'Plain Text Error Target' }),
      /Upstream timeout while streaming/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('frontend NPC organizer streams through the conversation NPC organize route', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (url, request = {}) => {
    requests.push({ url: String(url), request });
    if (String(url).endsWith('/api/csrf-token')) {
      return jsonResponse({ csrfToken: 'csrf-for-npc-organizer-test' });
    }
    return sseResponse('event: done\ndata: {"summary":"ok","toolCalls":[]}\n\n');
  };

  try {
    const result = await streamNpcOrganizer(
      'conversation-1',
      { requirement: '整理 NPC', selectedNpc: 'Mira' }
    );

    assert.equal(result.summary, 'ok');
    assert.ok(requests.length >= 1);
    const streamRequest = requests[requests.length - 1];
    assert.equal(streamRequest.url, '/api/conversations/conversation-1/npcs/organize');
    assert.equal(streamRequest.request.method, 'POST');
    assert.ok(streamRequest.request.headers['X-CSRF-Token']);
    assert.deepEqual(JSON.parse(streamRequest.request.body), {
      requirement: '整理 NPC',
      selectedNpc: 'Mira',
      stream: true
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('frontend assistant SSE parser scans CRLF data lines without block split allocation', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/api/csrf-token')) {
      return jsonResponse({ csrfToken: 'csrf-for-frontend-api-crlf-sse-test' });
    }
    return sseResponse('event: error\r\ndata: First line\r\ndata: Second line\r\n\r\n');
  };

  try {
    await assert.rejects(
      () => streamCharacterDraft({ name: 'CRLF Error Target' }),
      /First line Second line/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  const sharedLines = [];
  forEachSseLine('event: error\r\ndata: First line', (line) => sharedLines.push(line));
  assert.deepEqual(sharedLines, ['event: error', 'data: First line']);
  assert.match(frontendApiCoreSource, /from '..\/..\/..\/shared\/sse\.js'/);
  assert.match(frontendApiCoreSource, /forEachSseLine\(block, \(line\) => \{/);
  assert.doesNotMatch(frontendApiCoreSource, /function forEachSseLine\(text, visit\)/);
  assert.doesNotMatch(frontendApiCoreSource, /block\.split\(\s*\/\\r\?\\n\//);
  assert.doesNotMatch(frontendApiCoreSource, /const dataLines = \[\]/);
  assert.doesNotMatch(frontendApiCoreSource, /dataLines\.push/);
  assert.doesNotMatch(frontendApiCoreSource, /dataLines\.join/);
});

test('frontend assistant SSE parser scans split CRLF block separators without regex match allocation', async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();

  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/api/csrf-token')) {
      return jsonResponse({ csrfToken: 'csrf-for-frontend-api-split-separator-test' });
    }
    return sseByteChunksResponse([
      encoder.encode('event: done\r'),
      encoder.encode('\ndata: {"name":"Split Separator Character"}\r'),
      encoder.encode('\n\r'),
      encoder.encode('\n')
    ]);
  };

  try {
    const result = await streamCharacterDraft({ name: 'Split Separator Character' });
    assert.deepEqual(result, { name: 'Split Separator Character' });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(findSseBlockSeparator('a\r\n\r\nb'), { index: 1, length: 4 });
  assert.match(frontendApiCoreSource, /from '..\/..\/..\/shared\/sse\.js'/);
  assert.match(frontendApiCoreSource, /let separator = findSseBlockSeparator\(buffer\);/);
  assert.doesNotMatch(frontendApiCoreSource, /function findSseBlockSeparator\(text\)/);
  assert.doesNotMatch(frontendApiCoreSource, /buffer\.match\(\s*\/\\r\?\\n\\r\?\\n\//);
});

test('frontend assistant SSE errors flush truncated trailing UTF-8 bytes', async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();

  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/api/csrf-token')) {
      return jsonResponse({ csrfToken: 'csrf-for-frontend-api-truncated-utf8-test' });
    }
    return sseByteChunksResponse([
      encoder.encode('event: error\ndata: Upstream stream ended mid-character '),
      Uint8Array.of(0xe4)
    ]);
  };

  try {
    await assert.rejects(
      () => streamCharacterDraft({ name: 'Truncated UTF-8 Error Target' }),
      (error) => {
        assert.equal(error.message, `Upstream stream ended mid-character ${String.fromCharCode(0xfffd)}`);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('frontend assistant SSE errors preserve nested error messages', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/api/csrf-token')) {
      return jsonResponse({ csrfToken: 'csrf-for-frontend-api-nested-error-test' });
    }
    return sseResponse('event: error\ndata: {"error":{"message":"Nested provider rejection"}}\n\n');
  };

  try {
    await assert.rejects(
      () => streamCharacterDraft({ name: 'Nested Error Target' }),
      /Nested provider rejection/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('frontend assistant SSE errors ignore empty JSON payloads', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/api/csrf-token')) {
      return jsonResponse({ csrfToken: 'csrf-for-frontend-api-empty-json-error-test' });
    }
    return sseResponse('event: error\ndata: {}\n\n');
  };

  try {
    await assert.rejects(
      () => streamCharacterDraft({ name: 'Empty JSON Error Target' }),
      (error) => {
        assert.equal(error.message, 'AI 助手生成失败');
        assert.deepEqual(error.data, {});
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('frontend API HTTP errors preserve plain text response bodies', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (url, request = {}) => {
    requests.push({ url: String(url), request });
    return textResponse('Provider quota exceeded\nTry again later', 500);
  };

  try {
    await assert.rejects(
      () => apiRequest('/api/plain-text-error'),
      (error) => {
        assert.equal(error.message, 'Provider quota exceeded Try again later');
        assert.equal(error.status, 500);
        assert.deepEqual(error.data, { rawText: 'Provider quota exceeded\nTry again later' });
        return true;
      }
    );

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/plain-text-error');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('frontend API HTTP errors ignore HTML response bodies', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => textResponse('<!doctype html><title>Proxy Error</title>', 503);

  try {
    await assert.rejects(
      () => apiRequest('/api/html-error'),
      (error) => {
        assert.equal(error.message, '请求失败：503');
        assert.equal(error.status, 503);
        assert.deepEqual(error.data, { rawText: '<!doctype html><title>Proxy Error</title>' });
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('frontend API retries transient idempotent proxy failures', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (url, request = {}) => {
    requests.push({ url: String(url), request });
    if (requests.length === 1) {
      return textResponse('<!doctype html><title>Proxy starting</title>', 503);
    }
    return jsonResponse({ ok: true });
  };

  try {
    const result = await apiRequest('/api/transient-load');

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(
      requests.map(({ url }) => url),
      ['/api/transient-load', '/api/transient-load']
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('frontend API does not retry transient mutation failures', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (url, request = {}) => {
    requests.push({ url: String(url), request });
    if (String(url).endsWith('/api/csrf-token')) {
      return jsonResponse({ csrfToken: 'csrf-for-no-mutation-retry-test' });
    }
    return textResponse('Backend is restarting', 503);
  };

  try {
    await assert.rejects(
      () => apiRequest('/api/transient-mutation', {
        method: 'POST',
        body: JSON.stringify({ value: true })
      }),
      (error) => {
        assert.equal(error.status, 503);
        assert.equal(error.message, 'Backend is restarting');
        return true;
      }
    );

    assert.equal(
      requests.filter(({ url }) => url === '/api/transient-mutation').length,
      1
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('frontend API dev backend retry preserves structured 404 errors', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const requests = [];

  globalThis.window = {
    location: {
      hostname: 'localhost',
      port: '5173',
      protocol: 'http:'
    }
  };

  globalThis.fetch = async (url, request = {}) => {
    requests.push({ url: String(url), request });
    return jsonResponse({ message: 'Character not found' }, 404);
  };

  try {
    await assert.rejects(
      () => apiRequest('/api/characters/missing'),
      (error) => {
        assert.equal(error.message, 'Character not found');
        assert.equal(error.status, 404);
        return true;
      }
    );

    assert.deepEqual(
      requests.map(({ url }) => url),
      ['/api/characters/missing']
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('frontend API dev backend retry preserves structured generic 404 errors', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const requests = [];

  globalThis.window = {
    location: {
      hostname: 'localhost',
      port: '5173',
      protocol: 'http:'
    }
  };

  globalThis.fetch = async (url, request = {}) => {
    requests.push({ url: String(url), request });
    return jsonResponse({ message: 'Not Found' }, 404);
  };

  try {
    await assert.rejects(
      () => apiRequest('/api/structured-generic-missing'),
      (error) => {
        assert.equal(error.message, 'Not Found');
        assert.equal(error.status, 404);
        return true;
      }
    );

    assert.deepEqual(
      requests.map(({ url }) => url),
      ['/api/structured-generic-missing']
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('frontend API dev backend retry preserves plain text 404 errors', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const requests = [];

  globalThis.window = {
    location: {
      hostname: 'localhost',
      port: '5173',
      protocol: 'http:'
    }
  };

  globalThis.fetch = async (url, request = {}) => {
    requests.push({ url: String(url), request });
    return textResponse('Plain route not found', 404);
  };

  try {
    await assert.rejects(
      () => apiRequest('/api/plain-missing'),
      (error) => {
        assert.equal(error.message, 'Plain route not found');
        assert.equal(error.status, 404);
        return true;
      }
    );

    assert.deepEqual(
      requests.map(({ url }) => url),
      ['/api/plain-missing']
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('frontend API dev backend retry blocks fallback when 404 body cannot be read', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const requests = [];
  let bodyReads = 0;

  globalThis.window = {
    location: {
      hostname: 'localhost',
      port: '5173',
      protocol: 'http:'
    }
  };

  globalThis.fetch = async (url, request = {}) => {
    requests.push({ url: String(url), request });
    if (String(url) === '/api/unreadable-missing') {
      return {
        ok: false,
        status: 404,
        async text() {
          bodyReads += 1;
          throw new Error('body read failed');
        }
      };
    }
    return jsonResponse({ error: 'Unexpected API unreadable 404 backend fallback request' }, 500);
  };

  try {
    await assert.rejects(
      () => apiRequest('/api/unreadable-missing'),
      (error) => {
        assert.equal(error.status, 404);
        return true;
      }
    );

    assert.equal(bodyReads, 1);
    assert.deepEqual(
      requests.map(({ url }) => url),
      ['/api/unreadable-missing']
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('frontend API dev backend retry still falls back for generic dev 404 text', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const requests = [];
  let apiRequestCount = 0;

  globalThis.window = {
    location: {
      hostname: 'localhost',
      port: '5173',
      protocol: 'http:'
    }
  };

  globalThis.fetch = async (url, request = {}) => {
    requests.push({ url: String(url), request });
    if (String(url).includes('/api/fallback-target')) {
      apiRequestCount += 1;
      if (apiRequestCount === 1) {
        return textResponse('Cannot GET /api/fallback-target', 404);
      }
      return jsonResponse({ ok: true });
    }
    return jsonResponse({ error: 'Unexpected generic dev fallback request' }, 500);
  };

  try {
    const result = await apiRequest('/api/fallback-target');

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(
      requests.map(({ url }) => url),
      ['/api/fallback-target', 'http://localhost:3001/api/fallback-target']
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('frontend API dev backend retry falls back for generic root api 404 text', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const requests = [];
  let apiRequestCount = 0;

  globalThis.window = {
    location: {
      hostname: 'localhost',
      port: '5173',
      protocol: 'http:'
    }
  };

  globalThis.fetch = async (url, request = {}) => {
    requests.push({ url: String(url), request });
    if (String(url).endsWith('/api')) {
      apiRequestCount += 1;
      if (apiRequestCount === 1) {
        return textResponse('Cannot GET /api', 404);
      }
      return jsonResponse({ ok: true });
    }
    return jsonResponse({ error: 'Unexpected root API fallback request' }, 500);
  };

  try {
    const result = await apiRequest('/api');

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(
      requests.map(({ url }) => url),
      ['/api', 'http://localhost:3001/api']
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('frontend assistant SSE dev backend retry preserves structured 404 errors', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const requests = [];

  globalThis.window = {
    location: {
      hostname: 'localhost',
      port: '5173',
      protocol: 'http:'
    }
  };

  globalThis.fetch = async (url, request = {}) => {
    requests.push({ url: String(url), request });
    if (String(url).endsWith('/api/csrf-token')) {
      return jsonResponse({ csrfToken: 'csrf-for-frontend-api-stream-404-test' });
    }
    return jsonResponse({ message: 'Draft route not found' }, 404);
  };

  try {
    await assert.rejects(
      () => streamCharacterDraft({ name: 'Missing Stream Route' }),
      (error) => {
        assert.equal(error.message, 'Draft route not found');
        assert.equal(error.status, 404);
        return true;
      }
    );

    assert.deepEqual(
      requests
        .map(({ url }) => url)
        .filter((url) => url.includes('/api/characters/complete-draft')),
      ['/api/characters/complete-draft']
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('frontend assistant SSE dev backend retry preserves structured generic 404 errors', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const requests = [];

  globalThis.window = {
    location: {
      hostname: 'localhost',
      port: '5173',
      protocol: 'http:'
    }
  };

  globalThis.fetch = async (url, request = {}) => {
    requests.push({ url: String(url), request });
    if (String(url).endsWith('/api/csrf-token')) {
      return jsonResponse({ csrfToken: 'csrf-for-frontend-api-stream-generic-structured-404-test' });
    }
    return jsonResponse({ message: 'Not Found' }, 404);
  };

  try {
    await assert.rejects(
      () => streamCharacterDraft({ name: 'Structured Generic Missing Stream Route' }),
      (error) => {
        assert.equal(error.message, 'Not Found');
        assert.equal(error.status, 404);
        return true;
      }
    );

    assert.deepEqual(
      requests
        .map(({ url }) => url)
        .filter((url) => url.includes('/api/characters/complete-draft')),
      ['/api/characters/complete-draft']
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('frontend assistant SSE dev backend retry preserves structured 404 errors without response clones', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const requests = [];
  let cloneCalls = 0;

  globalThis.window = {
    location: {
      hostname: 'localhost',
      port: '5173',
      protocol: 'http:'
    }
  };

  globalThis.fetch = async (url, request = {}) => {
    requests.push({ url: String(url), request });
    if (String(url).endsWith('/api/csrf-token')) {
      return jsonResponse({ csrfToken: 'csrf-for-frontend-api-stream-404-no-clone-test' });
    }
    if (String(url) === '/api/characters/complete-draft') {
      return {
        ok: false,
        status: 404,
        clone() {
          cloneCalls += 1;
          throw new Error('clone is unavailable for this response');
        },
        async text() {
          return JSON.stringify({ message: 'Draft route not found without clone' });
        }
      };
    }
    return jsonResponse({ error: 'Unexpected backend fallback request' }, 500);
  };

  try {
    await assert.rejects(
      () => streamCharacterDraft({ name: 'Missing Stream Route Without Clone' }),
      (error) => {
        assert.equal(error.message, 'Draft route not found without clone');
        assert.equal(error.status, 404);
        return true;
      }
    );

    assert.equal(cloneCalls, 0);
    assert.deepEqual(
      requests
        .map(({ url }) => url)
        .filter((url) => url.includes('/api/characters/complete-draft')),
      ['/api/characters/complete-draft']
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('frontend assistant SSE dev backend retry blocks fallback when 404 body cannot be read', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const requests = [];
  let bodyReads = 0;

  globalThis.window = {
    location: {
      hostname: 'localhost',
      port: '5173',
      protocol: 'http:'
    }
  };

  globalThis.fetch = async (url, request = {}) => {
    requests.push({ url: String(url), request });
    if (String(url).endsWith('/api/csrf-token')) {
      return jsonResponse({ csrfToken: 'csrf-for-frontend-api-stream-unreadable-404-test' });
    }
    if (String(url) === '/api/characters/complete-draft') {
      return {
        ok: false,
        status: 404,
        async text() {
          bodyReads += 1;
          throw new Error('body read failed');
        }
      };
    }
    return jsonResponse({ error: 'Unexpected unreadable 404 backend fallback request' }, 500);
  };

  try {
    await assert.rejects(
      () => streamCharacterDraft({ name: 'Unreadable Missing Stream Route' }),
      (error) => {
        assert.equal(error.status, 404);
        return true;
      }
    );

    assert.equal(bodyReads, 1);
    assert.deepEqual(
      requests
        .map(({ url }) => url)
        .filter((url) => url.includes('/api/characters/complete-draft')),
      ['/api/characters/complete-draft']
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('frontend assistant SSE dev backend retry still falls back for generic dev 404 text', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const requests = [];
  let streamRequestCount = 0;

  globalThis.window = {
    location: {
      hostname: 'localhost',
      port: '5173',
      protocol: 'http:'
    }
  };

  globalThis.fetch = async (url, request = {}) => {
    requests.push({ url: String(url), request });
    if (String(url).endsWith('/api/csrf-token')) {
      return jsonResponse({ csrfToken: 'csrf-for-frontend-api-stream-generic-404-test' });
    }
    if (String(url).includes('/api/characters/complete-draft')) {
      streamRequestCount += 1;
      if (streamRequestCount === 1) {
        return textResponse('Cannot POST /api/characters/complete-draft', 404);
      }
      return sseResponse('event: done\ndata: {"name":"Fallback Stream Character"}\n\n');
    }
    return jsonResponse({ error: 'Unexpected generic SSE fallback request' }, 500);
  };

  try {
    const result = await streamCharacterDraft({ name: 'Fallback Stream Character' });

    assert.deepEqual(result, { name: 'Fallback Stream Character' });
    assert.deepEqual(
      requests
        .map(({ url }) => url)
        .filter((url) => url.includes('/api/characters/complete-draft')),
      [
        '/api/characters/complete-draft',
        'http://localhost:3001/api/characters/complete-draft'
      ]
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('frontend assistant SSE dev backend retry preserves plain text 404 errors', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const requests = [];

  globalThis.window = {
    location: {
      hostname: 'localhost',
      port: '5173',
      protocol: 'http:'
    }
  };

  globalThis.fetch = async (url, request = {}) => {
    requests.push({ url: String(url), request });
    if (String(url).endsWith('/api/csrf-token')) {
      return jsonResponse({ csrfToken: 'csrf-for-frontend-api-stream-text-404-test' });
    }
    return textResponse('Plain draft route not found', 404);
  };

  try {
    await assert.rejects(
      () => streamCharacterDraft({ name: 'Plain Missing Stream Route' }),
      (error) => {
        assert.equal(error.message, 'Plain draft route not found');
        assert.equal(error.status, 404);
        return true;
      }
    );

    assert.deepEqual(
      requests
        .map(({ url }) => url)
        .filter((url) => url.includes('/api/characters/complete-draft')),
      ['/api/characters/complete-draft']
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('frontend assistant SSE 404 errors outside dev fallback do not require response clones', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  let cloneCalls = 0;

  delete globalThis.window;

  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/api/csrf-token')) {
      return jsonResponse({ csrfToken: 'csrf-for-frontend-api-non-dev-404-test' });
    }
    return {
      ok: false,
      status: 404,
      clone() {
        cloneCalls += 1;
        throw new Error('clone should not be needed outside dev fallback');
      },
      async text() {
        return JSON.stringify({ message: 'Non-dev stream route not found' });
      }
    };
  };

  try {
    await assert.rejects(
      () => streamCharacterDraft({ name: 'Missing Non-dev Stream Route' }),
      (error) => {
        assert.equal(error.message, 'Non-dev stream route not found');
        assert.equal(error.status, 404);
        return true;
      }
    );

    assert.equal(cloneCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('frontend API reads CSRF token from the exact cookie name only', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const requests = [];

  delete globalThis.window;
  __resetApiCsrfTokenForTests();
  globalThis.document = {
    cookie: 'not_flai_csrf=wrong-token; flai_csrf=csrf%20exact; flai_csrf_backup=wrong-backup'
  };
  const { updateCharacter: updateCharacterWithCookie } = await import(
    new URL('../../../frontend/src/api.js?csrf-cookie-exact-name-test', import.meta.url)
  );

  globalThis.fetch = async (url, request = {}) => {
    requests.push({ url: String(url), request });
    if (String(url).endsWith('/api/csrf-token')) {
      return jsonResponse({ error: 'CSRF token endpoint should not be needed when exact cookie exists' }, 500);
    }
    return jsonResponse({ id: 'cookie-target', name: 'Cookie Target' });
  };

  try {
    const result = await updateCharacterWithCookie('cookie-target', { name: 'Cookie Target' });

    assert.deepEqual(result, { id: 'cookie-target', name: 'Cookie Target' });
    assert.deepEqual(requests.map(({ url }) => url), ['/api/characters/cookie-target']);
    assert.equal(requests[0].request.headers['X-CSRF-Token'], 'csrf exact');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
    if (originalDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = originalDocument;
    }
  }

  assert.match(frontendApiCoreSource, /function readCookieValue\(cookieText, cookieName\) \{/);
  assert.match(frontendApiCoreSource, /text\.startsWith\(target, pairStart\)/);
  assert.doesNotMatch(frontendApiCoreSource, /document\.cookie\.match\(/);
});

test('frontend JSON mutations retry nested CSRF errors', async () => {
  const originalFetch = globalThis.fetch;
  const csrfTokens = [];
  const patchRequests = [];
  let patchCount = 0;

  globalThis.fetch = async (url, request = {}) => {
    const requestUrl = String(url);

    if (requestUrl.endsWith('/api/csrf-token')) {
      const csrfToken = `csrf-retry-token-${csrfTokens.length + 1}`;
      csrfTokens.push(csrfToken);
      return jsonResponse({ csrfToken });
    }

    if (requestUrl.endsWith('/api/characters/csrf-target')) {
      patchCount += 1;
      patchRequests.push(request);
      if (patchCount === 1) {
        return jsonResponse({ error: { message: 'CSRF token invalid' } }, 403);
      }
      return jsonResponse({ id: 'csrf-target', name: 'Retried Character' });
    }

    return jsonResponse({ error: 'Unexpected frontend API test request' }, 500);
  };

  try {
    const result = await updateCharacter('csrf-target', { name: 'Retried Character' });

    assert.deepEqual(result, { id: 'csrf-target', name: 'Retried Character' });
    assert.equal(patchRequests.length, 2);
    assert.ok(csrfTokens.length >= 1);
    assert.equal(patchRequests[1].headers['X-CSRF-Token'], csrfTokens.at(-1));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('frontend assistant SSE requests retry nested CSRF errors', async () => {
  const originalFetch = globalThis.fetch;
  const csrfTokens = [];
  const streamRequests = [];
  let streamCount = 0;

  globalThis.fetch = async (url, request = {}) => {
    const requestUrl = String(url);

    if (requestUrl.endsWith('/api/csrf-token')) {
      const csrfToken = `csrf-stream-retry-token-${csrfTokens.length + 1}`;
      csrfTokens.push(csrfToken);
      return jsonResponse({ csrfToken });
    }

    if (requestUrl.endsWith('/api/characters/complete-draft')) {
      streamCount += 1;
      streamRequests.push(request);
      if (streamCount === 1) {
        return jsonResponse({ error: { message: 'CSRF token expired' } }, 419);
      }
      return sseResponse('event: done\ndata: {"name":"Retried Stream Character"}\n\n');
    }

    return jsonResponse({ error: 'Unexpected frontend SSE CSRF test request' }, 500);
  };

  try {
    const result = await streamCharacterDraft({ name: 'Retried Stream Character' });

    assert.deepEqual(result, { name: 'Retried Stream Character' });
    assert.equal(streamRequests.length, 2);
    assert.ok(csrfTokens.length >= 1);
    assert.equal(streamRequests[1].headers['X-CSRF-Token'], csrfTokens.at(-1));
    assert.equal(JSON.parse(streamRequests[1].body).stream, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('frontend assistant SSE CSRF retry does not require response clones', async () => {
  const originalFetch = globalThis.fetch;
  const csrfTokens = [];
  const streamRequests = [];
  let streamCount = 0;
  let cloneCalls = 0;

  globalThis.fetch = async (url, request = {}) => {
    const requestUrl = String(url);

    if (requestUrl.endsWith('/api/csrf-token')) {
      const csrfToken = `csrf-stream-clone-free-token-${csrfTokens.length + 1}`;
      csrfTokens.push(csrfToken);
      return jsonResponse({ csrfToken });
    }

    if (requestUrl.endsWith('/api/characters/complete-draft')) {
      streamCount += 1;
      streamRequests.push(request);
      if (streamCount === 1) {
        return {
          ok: false,
          status: 419,
          clone() {
            cloneCalls += 1;
            throw new Error('clone is unavailable for this response');
          },
          async text() {
            return JSON.stringify({ error: { message: 'CSRF token expired' } });
          }
        };
      }
      return sseResponse('event: done\ndata: {"name":"Clone Free CSRF Retry"}\n\n');
    }

    return jsonResponse({ error: 'Unexpected frontend SSE clone-free CSRF test request' }, 500);
  };

  try {
    const result = await streamCharacterDraft({ name: 'Clone Free CSRF Retry' });

    assert.deepEqual(result, { name: 'Clone Free CSRF Retry' });
    assert.equal(streamRequests.length, 2);
    assert.equal(cloneCalls, 0);
    assert.ok(csrfTokens.length >= 1);
    assert.equal(streamRequests[1].headers['X-CSRF-Token'], csrfTokens.at(-1));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
