import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyDeepSeekOnlineSearch,
  createDeepSeekOnlineSearchExecutor
} from '../services/deepSeekSearch.js';
import { continueMessageSchema, sendMessageSchema } from '../validations/schemas.js';

function makeSettings(baseUrl = 'https://deepseek-search.test') {
  return {
    providerType: 'deepseek',
    gatewayName: 'DeepSeek',
    baseUrl,
    model: 'deepseek-flash',
    apiKey: 'sk-test-search-key',
    timeoutMs: 1000,
    retryBudget: 0
  };
}

test('DeepSeek online tools call Search with bounded results and fetch only returned URLs', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const pageContent = 'A'.repeat(13000);
  globalThis.fetch = async (url, request) => {
    calls.push({ url: String(url), request });
    const body = calls.length === 1
      ? { results: [
          {
            title: 'Article', url: 'https://example.com/article#section',
            snippet: 'Short result', summary: 'Long search summary', content: 'Search body'
          },
          { title: 'Invalid', url: 'file:///private', content: 'Ignore this result' }
        ] }
      : { title: 'Article', content: pageContent };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const executeTool = createDeepSeekOnlineSearchExecutor(makeSettings());
    const search = await executeTool('deepseek_web_search', { query: 'current release', count: 4 });

    assert.equal(calls[0].url, 'https://deepseek-search.test/v1/tools/search');
    assert.deepEqual(JSON.parse(calls[0].request.body), {
      query: 'current release', count: 4, need_content: true
    });
    const searchHeaders = new Headers(calls[0].request.headers);
    assert.equal(searchHeaders.get('authorization'), 'Bearer sk-test-search-key');
    assert.equal(searchHeaders.get('content-type'), 'application/json');
    assert.equal(search.results.length, 1);
    assert.equal(search.results[0].url, 'https://example.com/article');
    assert.equal(search.results[0].summary, 'Long search summary');

    const blocked = await executeTool('deepseek_web_fetch', { url: 'https://example.org/not-searched' });
    assert.equal(blocked.error, 'URL_NOT_FROM_SEARCH_RESULTS');
    assert.equal(calls.length, 1);

    const fetched = await executeTool('deepseek_web_fetch', { url: search.results[0].url });
    assert.equal(calls[1].url, 'https://deepseek-search.test/v1/tools/fetch');
    assert.deepEqual(JSON.parse(calls[1].request.body), { url: search.results[0].url });
    assert.equal(fetched.content.length, 12000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('DeepSeek Search uses /tools when the configured API base already includes /v1', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await createDeepSeekOnlineSearchExecutor(makeSettings('https://deepseek-search.test/v1'))(
      'deepseek_web_search', { query: 'test' }
    );
    assert.equal(requestedUrl, 'https://deepseek-search.test/v1/tools/search');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('DeepSeek Search rejects empty or overlong queries before making an API call', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  try {
    const executeTool = createDeepSeekOnlineSearchExecutor(makeSettings());
    const empty = await executeTool('deepseek_web_search', { query: '   ' });
    const long = await executeTool('deepseek_web_search', { query: 'x'.repeat(129) });
    assert.equal(empty.error, 'INVALID_SEARCH_QUERY');
    assert.equal(long.error, 'INVALID_SEARCH_QUERY');
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('online search tools are attached only to an explicitly enabled DeepSeek request', () => {
  const messages = [{ role: 'user', content: 'hello' }];
  const options = { signal: new AbortController().signal };

  assert.equal(applyDeepSeekOnlineSearch(options, messages, makeSettings(), false), options);
  assert.equal(applyDeepSeekOnlineSearch(options, messages, { ...makeSettings(), providerType: 'openai' }, true), options);
  assert.equal(messages.length, 1);

  const enabledOptions = applyDeepSeekOnlineSearch(options, messages, makeSettings(), true);
  assert.equal(enabledOptions.tools.length, 2);
  assert.equal(typeof enabledOptions.executeTool, 'function');
  assert.equal(messages[0].role, 'system');
});

test('send, continue, and regenerate request schemas accept the online-search flag', () => {
  assert.equal(sendMessageSchema.safeParse({ content: 'hello', webSearch: true }).data.webSearch, true);
  assert.equal(continueMessageSchema.safeParse({ webSearch: 'true' }).data.webSearch, true);
});
