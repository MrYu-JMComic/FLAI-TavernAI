import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { __resetApiCsrfTokenForTests } from '../../../frontend/src/api/core.js';
import {
  fetchMultiRoleState,
  generateMultiRole,
  updateMultiRoleQueue,
} from '../../../frontend/src/api/multiRole.js';

const frontendApi = await import('../../../frontend/src/api.js');
const viewSource = readFileSync(
  new URL('../../../frontend/src/views/MultiRoleChatView.vue', import.meta.url),
  'utf8'
);
const styleSource = readFileSync(
  new URL('../../../frontend/src/styles/multi-role.css', import.meta.url),
  'utf8'
);
const routerSource = readFileSync(
  new URL('../../../frontend/src/router.js', import.meta.url),
  'utf8'
);
const chatViewSource = readFileSync(
  new URL('../../../frontend/src/views/ChatView.vue', import.meta.url),
  'utf8'
);
const chatHeaderSource = readFileSync(
  new URL('../../../frontend/src/components/chat/ChatHeader.vue', import.meta.url),
  'utf8'
);

test('multi-role API encodes stable ids and preserves write request contracts', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const controller = new AbortController();
  __resetApiCsrfTokenForTests();
  globalThis.fetch = async (url, request = {}) => {
    requests.push({ url: String(url), request });
    if (String(url) === '/api/csrf-token') return jsonResponse({ csrfToken: 'multi-role-csrf' });
    return jsonResponse({ participants: [], queue: [], turns: [] });
  };

  try {
    await fetchMultiRoleState('conversation/one');
    await updateMultiRoleQueue('conversation/one', ['member/one', 'member two']);
    await generateMultiRole('conversation/one', {
      input: 'Take one turn each.',
      memberIds: ['member/one'],
    }, { signal: controller.signal });

    assert.deepEqual(requests.map(({ url }) => url), [
      '/api/conversations/conversation%2Fone/multi-role',
      '/api/csrf-token',
      '/api/conversations/conversation%2Fone/multi-role/queue',
      '/api/conversations/conversation%2Fone/multi-role/generate',
    ]);
    assert.equal(requests[2].request.method, 'PUT');
    assert.equal(requests[2].request.headers['X-CSRF-Token'], 'multi-role-csrf');
    assert.deepEqual(JSON.parse(requests[2].request.body), {
      memberIds: ['member/one', 'member two'],
    });
    assert.equal(requests[3].request.method, 'POST');
    assert.equal(requests[3].request.signal, controller.signal);
    assert.deepEqual(JSON.parse(requests[3].request.body), {
      input: 'Take one turn each.',
      memberIds: ['member/one'],
    });
  } finally {
    globalThis.fetch = originalFetch;
    __resetApiCsrfTokenForTests();
  }
});

test('multi-role route and chat entry keep the existing navigation contract', () => {
  assert.equal(frontendApi.fetchMultiRoleState, fetchMultiRoleState);
  assert.equal(frontendApi.generateMultiRole, generateMultiRole);
  assert.match(routerSource, /path:\s*'\/chat\/:id\/multi-role'/);
  assert.match(routerSource, /name:\s*'multiAgentChat'/);
  assert.match(chatViewSource, /emit\('navigate',\s*'multiAgentChat',\s*\{ id: conversation\.value\.id \}\)/);
  assert.match(chatHeaderSource, /aria-label="NPC 管理"/);
  assert.match(chatHeaderSource, /emit\('open-npc',\s*\$event\)/);
});

test('multi-role workspace exposes accessible controls and responsive stable sizing', () => {
  assert.match(viewSource, /<section class="multi-role-page" aria-labelledby="multi-role-title">/);
  assert.match(viewSource, /<h1 id="multi-role-title">多角色对话<\/h1>/);
  assert.match(viewSource, /aria-label="参与人物"/);
  assert.match(viewSource, /:aria-pressed="selectedIds\.includes\(member\.id\)"/);
  assert.match(viewSource, /aria-live="polite"/);
  assert.match(viewSource, /role="status"/);
  assert.match(viewSource, /role="alert"/);
  assert.match(viewSource, /aria-label="停止生成"/);
  assert.match(viewSource, /generationController\?\.abort\(\)/);
  assert.match(viewSource, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(styleSource, /min-height:\s*44px/);
  assert.match(styleSource, /@media \(max-width:\s*720px\)/);
  assert.match(styleSource, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.doesNotMatch(styleSource, /letter-spacing:\s*-/);
});

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
