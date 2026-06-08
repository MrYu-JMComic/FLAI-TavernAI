import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { findSseBlockSeparator, forEachSseLine } from '../../../shared/sse.js';

const { apiRequest, streamCharacterDraft, updateCharacter } = await import('../../../frontend/src/api.js');
const frontendApiSource = readFileSync(new URL('../../../frontend/src/api.js', import.meta.url), 'utf8');

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
  assert.match(frontendApiSource, /from '..\/..\/shared\/sse\.js'/);
  assert.match(frontendApiSource, /forEachSseLine\(block, \(line\) => \{/);
  assert.doesNotMatch(frontendApiSource, /function forEachSseLine\(text, visit\)/);
  assert.doesNotMatch(frontendApiSource, /block\.split\(\s*\/\\r\?\\n\//);
  assert.doesNotMatch(frontendApiSource, /const dataLines = \[\]/);
  assert.doesNotMatch(frontendApiSource, /dataLines\.push/);
  assert.doesNotMatch(frontendApiSource, /dataLines\.join/);
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
  assert.match(frontendApiSource, /from '..\/..\/shared\/sse\.js'/);
  assert.match(frontendApiSource, /let separator = findSseBlockSeparator\(buffer\);/);
  assert.doesNotMatch(frontendApiSource, /function findSseBlockSeparator\(text\)/);
  assert.doesNotMatch(frontendApiSource, /buffer\.match\(\s*\/\\r\?\\n\\r\?\\n\//);
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

  assert.match(frontendApiSource, /function readCookieValue\(cookieText, cookieName\) \{/);
  assert.match(frontendApiSource, /text\.startsWith\(target, pairStart\)/);
  assert.doesNotMatch(frontendApiSource, /document\.cookie\.match\(/);
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
