import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  __resetApiCsrfTokenForTests,
} from '../../../frontend/src/api/core.js';
import {
  deleteCastMemory,
  fetchCastAudit,
  fetchCastMemories,
  streamCastOrganization,
  streamCastSync,
} from '../../../frontend/src/api/cast.js';
import {
  formatCastSyncError,
  useCastManager,
} from '../../../frontend/src/composables/cast/useCastManager.js';

const requireFromFrontend = createRequire(new URL('../../../frontend/package.json', import.meta.url));
const { effectScope, nextTick, ref } = requireFromFrontend('vue');
const drawerSource = readFileSync(
  new URL('../../../frontend/src/components/cast/CastManagerDrawer.vue', import.meta.url),
  'utf8'
);
const rosterSource = readFileSync(
  new URL('../../../frontend/src/components/cast/CastRoster.vue', import.meta.url),
  'utf8'
);
const castStyles = readFileSync(
  new URL('../../../frontend/src/styles/cast-manager.css', import.meta.url),
  'utf8'
);

test('cast API encodes ids and bounds list queries', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, request = {}) => {
    requests.push({ url: String(url), request });
    return jsonResponse({ items: [], total: 0 });
  };

  try {
    await fetchCastMemories('conversation/one', 'member one', {
      limit: 999,
      offset: -8,
      includeForgotten: true,
    });
    await fetchCastAudit('conversation/one', 'member one', {
      limit: 30,
      beforeCreatedAt: '2026-08-15T00:00:00.000Z',
      beforeId: 'event/one',
    });

    assert.equal(
      requests[0].url,
      '/api/conversations/conversation%2Fone/cast/member%20one/memories?limit=200&offset=0&includeForgotten=true'
    );
    assert.equal(
      requests[1].url,
      '/api/conversations/conversation%2Fone/cast/member%20one/audit?limit=30&beforeCreatedAt=2026-08-15T00%3A00%3A00.000Z&beforeId=event%2Fone'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('cast SSE uses strict POST bodies and bodyless GET subscriptions', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const progress = [];
  const statuses = [];
  __resetApiCsrfTokenForTests();
  globalThis.fetch = async (url, request = {}) => {
    requests.push({ url: String(url), request });
    if (String(url) === '/api/csrf-token') return jsonResponse({ csrfToken: 'cast-csrf' });
    if (String(url).endsWith('/organize')) {
      return sseResponse('event: progress\ndata: {"phase":"validating","applied":0}\n\n');
    }
    return sseResponse('event: cast-sync\ndata: {"status":"applied","summary":"ok"}\n\n');
  };

  try {
    await streamCastOrganization(
      'conversation/one',
      { scope: 'member', memberId: 'member/one', requirement: '合并重复项' },
      { progress: (data) => progress.push(data) }
    );
    await streamCastSync(
      'conversation/one',
      { 'cast-sync': (data) => statuses.push(data) }
    );

    assert.deepEqual(progress, [{ phase: 'validating', applied: 0 }]);
    assert.deepEqual(statuses, [{ status: 'applied', summary: 'ok' }]);
    assert.equal(requests[1].url, '/api/conversations/conversation%2Fone/cast/organize');
    assert.equal(requests[1].request.method, 'POST');
    assert.equal(requests[1].request.headers['X-CSRF-Token'], 'cast-csrf');
    assert.deepEqual(JSON.parse(requests[1].request.body), {
      scope: 'member',
      memberId: 'member/one',
      requirement: '合并重复项',
    });
    assert.equal(requests[2].url, '/api/conversations/conversation%2Fone/cast/sync-events');
    assert.equal(requests[2].request.method, 'GET');
    assert.equal(requests[2].request.body, undefined);
    assert.equal(requests[2].request.headers['X-CSRF-Token'], undefined);
    assert.equal(requests[2].request.headers['Content-Type'], undefined);
  } finally {
    globalThis.fetch = originalFetch;
    __resetApiCsrfTokenForTests();
  }
});

test('cast sync errors expose the validation code, field path, and repair attempt', () => {
  const message = formatCastSyncError({
    status: 'error',
    error: 'Cast change plan does not match CastChangePlanV1',
    code: 'CAST_PLAN_SCHEMA',
    details: [{ path: 'operations.0.target', message: 'Invalid input' }],
    repairAttempted: true,
  });

  assert.match(message, /CAST_PLAN_SCHEMA/);
  assert.match(message, /operations\.0\.target/);
  assert.match(message, /已自动修复重试一次/);
});

test('cast delete mutations send only the revision contract', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  __resetApiCsrfTokenForTests();
  globalThis.fetch = async (url, request = {}) => {
    requests.push({ url: String(url), request });
    if (String(url) === '/api/csrf-token') return jsonResponse({ csrfToken: 'cast-delete-csrf' });
    return jsonResponse({ deletedId: 'memory/one' });
  };

  try {
    await deleteCastMemory('conversation/one', 'member/one', 'memory/one', 7);
    assert.equal(
      requests[1].url,
      '/api/conversations/conversation%2Fone/cast/member%2Fone/memories/memory%2Fone'
    );
    assert.equal(requests[1].request.method, 'DELETE');
    assert.deepEqual(JSON.parse(requests[1].request.body), { revision: 7 });
  } finally {
    globalThis.fetch = originalFetch;
    __resetApiCsrfTokenForTests();
  }
});

test('cast manager discards roster responses from a previous conversation', async () => {
  const originalFetch = globalThis.fetch;
  const deferredRoster = deferred();
  const conversationId = ref('conversation-a');
  const open = ref(true);
  const scope = effectScope();
  let manager;
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.endsWith('/sync-events')) return sseResponse('');
    if (path === '/api/conversations/conversation-a/cast') return deferredRoster.promise;
    if (path === '/api/conversations/conversation-b/cast') return jsonResponse(roster('member-b', 'Beta'));
    if (path === '/api/conversations/conversation-b/cast/member-b') {
      return jsonResponse(detail('member-b', 'Beta'));
    }
    return jsonResponse({ error: `Unexpected request: ${path}` }, 500);
  };

  try {
    manager = scope.run(() => useCastManager({ conversationId, open, notify: {} }));
    await flushTasks();
    conversationId.value = 'conversation-b';
    await nextTick();
    await flushTasks();
    deferredRoster.resolve(jsonResponse(roster('member-a', 'Alpha')));
    await flushTasks();

    assert.equal(manager.roster.value.protagonist.id, 'member-b');
    assert.equal(manager.selectedMemberId.value, 'member-b');
    assert.equal(manager.detail.value.member.canonicalName, 'Beta');
  } finally {
    globalThis.fetch = originalFetch;
    scope.stop();
  }
});

test('cast manager keeps unrelated drafts dirty after saving one profile section', async () => {
  const originalFetch = globalThis.fetch;
  const conversationId = ref('conversation-one');
  const open = ref(true);
  const scope = effectScope();
  let manager;
  __resetApiCsrfTokenForTests();
  globalThis.fetch = async (url, request = {}) => {
    const path = String(url);
    if (path === '/api/csrf-token') return jsonResponse({ csrfToken: 'cast-profile-csrf' });
    if (path.endsWith('/sync-events')) return sseResponse('');
    if (path === '/api/conversations/conversation-one/cast' && !request.method) {
      return jsonResponse(roster('member-one', 'Original'));
    }
    if (path === '/api/conversations/conversation-one/cast/member-one' && request.method === 'PATCH') {
      return jsonResponse({ ...member('member-one', 'Updated'), revision: 2 });
    }
    if (path === '/api/conversations/conversation-one/cast/member-one') {
      return jsonResponse(detail('member-one', 'Original'));
    }
    return jsonResponse({ error: `Unexpected request: ${path}` }, 500);
  };

  try {
    manager = scope.run(() => useCastManager({ conversationId, open, notify: {} }));
    await flushTasks();
    manager.setDirty('profile', true);
    manager.setDirty('appearance', true);
    const saved = await manager.saveProfile({ canonicalName: 'Updated', revision: 1 });

    assert.equal(saved.canonicalName, 'Updated');
    assert.equal(manager.detail.value.member.canonicalName, 'Updated');
    assert.equal(manager.hasUnsavedChanges.value, true);
    manager.clearDirty('appearance');
    assert.equal(manager.hasUnsavedChanges.value, false);
  } finally {
    globalThis.fetch = originalFetch;
    scope.stop();
    __resetApiCsrfTokenForTests();
  }
});

test('cast manager cancellation aborts the active organizer request', async () => {
  const originalFetch = globalThis.fetch;
  const conversationId = ref('conversation-one');
  const open = ref(true);
  const organizerStarted = deferred();
  const scope = effectScope();
  let manager;
  __resetApiCsrfTokenForTests();
  globalThis.fetch = async (url, request = {}) => {
    const path = String(url);
    if (path === '/api/csrf-token') return jsonResponse({ csrfToken: 'cast-organizer-csrf' });
    if (path.endsWith('/sync-events')) return sseResponse('');
    if (path === '/api/conversations/conversation-one/cast') {
      return jsonResponse(roster('member-one', 'Original'));
    }
    if (path === '/api/conversations/conversation-one/cast/member-one') {
      return jsonResponse(detail('member-one', 'Original'));
    }
    if (path.endsWith('/organize')) {
      organizerStarted.resolve();
      return new Promise((resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(abortError()), { once: true });
      });
    }
    return jsonResponse({ error: `Unexpected request: ${path}` }, 500);
  };

  try {
    manager = scope.run(() => useCastManager({ conversationId, open, notify: {} }));
    await flushTasks();
    const resultPromise = manager.runOrganization({ scope: 'member', requirement: '去重' });
    await organizerStarted.promise;
    assert.equal(manager.organizer.running, true);
    assert.equal(manager.cancelOrganization(), true);
    assert.equal(await resultPromise, null);
    assert.equal(manager.organizer.running, false);
    assert.equal(manager.organizer.phase, 'cancelled');
  } finally {
    globalThis.fetch = originalFetch;
    scope.stop();
    __resetApiCsrfTokenForTests();
  }
});

test('cast manager UI keeps the existing entry semantics and accessible mobile controls', () => {
  assert.match(drawerSource, /role="dialog"[\s\S]*aria-modal="true"/);
  assert.match(drawerSource, /class="cast-mobile-actions"/);
  assert.match(drawerSource, /@keydown="handleTabKeydown\(\$event, tab\.id\)"/);
  assert.match(rosterSource, /role="listbox"[\s\S]*role="option"/);
  assert.match(castStyles, /min-height:\s*44px/);
  assert.match(castStyles, /@media \(max-width:\s*720px\)/);
  assert.match(castStyles, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.doesNotMatch(drawerSource, /NpcPanel/);
});

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sseResponse(text, status = 200) {
  return new Response(
    new ReadableStream({
      start(controller) {
        if (text) controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    }),
    { status, headers: { 'Content-Type': 'text/event-stream' } }
  );
}

function member(id, name) {
  return {
    id,
    memberType: 'protagonist',
    canonicalName: name,
    aliases: [],
    visibility: 'visible',
    status: 'active',
    relationship: '',
    currentLocationLabel: '',
    memorySealed: false,
    revision: 1,
    counts: { memories: 0, behaviors: 0, items: 0 },
  };
}

function roster(id, name) {
  return {
    protagonist: member(id, name),
    npcs: [],
    stats: { total: 1, visibleNpcs: 0, hiddenNpcs: 0, sealed: 0 },
    sync: { status: 'idle', appliedAt: '', summary: '' },
  };
}

function detail(id, name) {
  return {
    member: member(id, name),
    appearance: null,
    counts: { memories: 0, behaviors: 0, items: 0 },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function abortError() {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

async function flushTasks() {
  await nextTick();
  await new Promise((resolve) => setImmediate(resolve));
  await nextTick();
}
