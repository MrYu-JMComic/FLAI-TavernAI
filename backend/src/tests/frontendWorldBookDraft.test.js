import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeAiWorldBookDraft,
  normalizeWorldBookEntryForCreate
} from '../../../frontend/src/utils/worldBookDraft.js';
import { rebaseWorldBookWorkspace, worldBookApplyRequest } from '../../../frontend/src/utils/worldBookWorkspace.js';
import { applyWorldBookChanges } from '../../../frontend/src/api/worldBooks.js';
import { __resetApiCsrfTokenForTests } from '../../../frontend/src/api/core.js';

test('AI world book create payload uses the save API field types', () => {
  const entry = normalizeWorldBookEntryForCreate({
    id: 'draft-only-id',
    name: '雾港',
    triggerKeys: '雾港,港口城邦',
    content: '雾港由领航公会治理。',
    position: 'at_depth',
    role: 2,
    depth: 3.8,
    group: '港口',
    inclusionGroup: 'legacy-group',
    sticky: 10000,
    cooldown: '',
    orderIndex: 4.9
  });

  assert.equal(entry.role, 2);
  assert.equal(entry.depth, 3);
  assert.equal(entry.group, '港口');
  assert.equal(entry.sticky, 9999);
  assert.equal(entry.cooldown, null);
  assert.equal(entry.orderIndex, 4);
  assert.equal(Object.hasOwn(entry, 'id'), false);
  assert.equal(Object.hasOwn(entry, 'inclusionGroup'), false);
});

test('AI world book preview keeps only drafts that can be created', () => {
  const draft = normalizeAiWorldBookDraft({
    name: '雾港航路',
    scanDepth: 6,
    lorebookContextPercent: 30,
    entries: [
      { name: '雾港', triggerKeys: '雾港', content: '港口设定。' },
      { name: '缺少触发词', content: '不会进入草稿。' },
      { name: '常驻规则', content: '始终生效。', alwaysActive: true }
    ]
  });

  assert.equal(draft.entries.length, 2);
  assert.deepEqual(draft.entries.map((entry) => entry.name), ['雾港', '常驻规则']);
});

test('world book transaction payload keeps sparse edits and separates independent creations', () => {
  const changes = worldBookApplyRequest([
    {
      ref: 'existing:book-a', bookId: 'book-a', baseRevision: 'original-version', name: 'UI preview title',
      before: { entries: Array.from({ length: 80 }, (_, index) => ({ id: `entry-${index}`, content: 'Untouched' })) },
      profile: { description: 'Edited description' },
      upserts: [{ entryId: 'entry-65', before: { content: 'Old content', enabled: false }, patch: { content: 'New content' } }],
      removals: [{ entryId: 'entry-12', before: { content: 'Removed content' } }]
    },
    { ref: 'new:separate', profile: { name: '航海手册' }, entries: [{ name: '潮汐', triggerKeys: '潮汐', content: '潮汐设定' }] }
  ]);
  assert.deepEqual(changes[0], {
    ref: 'existing:book-a', bookId: 'book-a', baseRevision: 'original-version',
    profile: { description: 'Edited description' },
    upserts: [{ entryId: 'entry-65', patch: { content: 'New content' } }], removals: ['entry-12']
  });
  assert.equal(Object.hasOwn(changes[0], 'entries'), false);
  assert.equal(Object.hasOwn(changes[0].upserts[0].patch, 'enabled'), false);
  assert.deepEqual(changes[1], {
    ref: 'new:separate', bookId: null, profile: { name: '航海手册' },
    entries: [{ name: '潮汐', triggerKeys: '潮汐', content: '潮汐设定' }]
  });
});

test('applying selected world books retains unchecked drafts and rebases newly created books', () => {
  const unchecked = { ref: 'existing:book-b', bookId: 'book-b', baseRevision: 'b-version', upserts: [{ entryId: 'b-entry', patch: { content: 'Pending' } }] };
  const workspace = {
    activeRef: 'new:guide', targets: [
      { ref: 'new:guide', bookId: null, profile: { name: 'Guide' }, entries: [{ name: 'Pending entry' }] }, unchecked
    ]
  };
  const next = rebaseWorldBookWorkspace(workspace, [{
    ref: 'new:guide', book: {
      id: 'created-guide', name: 'Guide', description: '', scanDepth: 4, lorebookContextPercent: 25,
      revision: 'saved-version', entries: [{ id: 'saved-entry' }], linkedCharacters: []
    }
  }]);
  assert.equal(next.activeRef, 'existing:created-guide');
  assert.equal(next.targets[0].bookId, 'created-guide');
  assert.equal(next.targets[0].baseRevision, 'saved-version');
  assert.deepEqual(next.targets[0].upserts, []);
  assert.deepEqual(next.targets[0].removals, []);
  assert.equal(next.targets[1], unchecked);
  assert.equal(workspace.targets[0].ref, 'new:guide');
});

test('world book API submits mixed edits as one transaction and retains the retry id', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const payload = { requestId: 'one-stable-attempt', changes: worldBookApplyRequest([
    { ref: 'existing:old-book', bookId: 'old-book', baseRevision: 'version', profile: { name: 'Updated book' } },
    { ref: 'new:guide', profile: { name: 'Guide' }, entries: [] }
  ]) };
  __resetApiCsrfTokenForTests();
  globalThis.fetch = async (url, request = {}) => {
    requests.push({ url: String(url), request });
    return new Response(JSON.stringify(String(url) === '/api/csrf-token' ? { csrfToken: 'world-book-csrf' } : { books: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  };
  try {
    await applyWorldBookChanges(payload);
    await applyWorldBookChanges(payload);
    const transactions = requests.filter((item) => item.url !== '/api/csrf-token');
    assert.equal(transactions.length, 2);
    for (const { url, request } of transactions) {
      assert.equal(url, '/api/world-books/apply-changes');
      assert.equal(request.method, 'POST');
      assert.equal(request.headers['X-CSRF-Token'], 'world-book-csrf');
      assert.deepEqual(JSON.parse(request.body), payload);
    }
  } finally {
    globalThis.fetch = originalFetch;
    __resetApiCsrfTokenForTests();
  }
});
