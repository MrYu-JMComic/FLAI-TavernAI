import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppDatabase } from '../db/runtime.js';
import { insertUser } from './routeTestUtils.js';
import { applyWorldBookChanges, createEntry, createWorldBook, deleteEntry, getWorldBook, updateEntry } from '../services/worldBooks/worldBookService.js';
import { completeWorldBookDraft, streamWorldBookDraft } from '../services/worldBookAssistant.js';
import {
  buildWorldBookChanges,
  createWorldBookWorkspace,
  executeWorldBookWorkspaceTool,
  serializeWorldBookWorkspace,
  worldBookWorkspaceContext,
  worldBookWorkspaceTools
} from '../services/worldBooks/worldBookAssistantWorkspace.js';

const settings = { providerType: 'custom', gatewayName: 'Workspace test', baseUrl: 'https://workspace.test/v1', model: 'test', apiKey: 'test', extraBody: {} };
const lore = (name) => ({ name, triggerKeys: name, content: `${name} lore.` });

function fixture(t) {
  const database = createAppDatabase(':memory:');
  t.after(() => database.close());
  const userId = 'workspace-owner';
  insertUser(database, userId);
  insertUser(database, 'workspace-other');
  const book = createWorldBook(database, userId, { name: '大陆', description: '角色航海设定' });
  return { database, userId, book };
}

function call(workspace, name, args) {
  const result = executeWorldBookWorkspaceTool(workspace, name, args);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}

test('an 80-entry existing book is read on demand and produces one exact patch', (t) => {
  const { database, userId, book } = fixture(t);
  for (let index = 0; index < 80; index += 1) createEntry(database, userId, book.id, { ...lore(`第${index}条`), enabled: index !== 3, position: 'at_depth', depth: 7, role: 2, sticky: 4, group: '舰队' });
  const original = getWorldBook(database, userId, book.id);
  const workspace = createWorldBookWorkspace({ database, userId, selectedBookIds: [book.id] });
  const context = worldBookWorkspaceContext(workspace);
  assert.equal(context.targets[0].entryCount, 80);
  assert.equal(context.targets[0].directoryHasMore, true);
  assert.equal(Object.hasOwn(context.targets[0].entries[0], 'content'), false);
  assert.equal(Object.hasOwn(serializeWorldBookWorkspace(workspace).targets[0], 'entries'), false);
  const entryId = original.entries[65].id;
  const read = call(workspace, 'read_world_book', { entryIds: [entryId] });
  assert.equal(read.entries[0].content, original.entries[65].content);
  call(workspace, 'upsert_world_book_entry', { entryId, changes: { content: '第六十五条已更新。' } });
  const [change] = buildWorldBookChanges(workspace);
  assert.deepEqual(change.upserts[0].patch, { content: '第六十五条已更新。' });
  assert.equal(change.upserts[0].before.sticky, 4);
  assert.equal(change.baseRevision, original.revision);
  assert.equal(worldBookWorkspaceContext(workspace).targets[0].entryCount, 80);
  assert.deepEqual(getWorldBook(database, userId, book.id), original);
});

test('existing books reject whole replacement without losing unlisted entries', (t) => {
  const { database, userId, book } = fixture(t);
  createEntry(database, userId, book.id, lore('港口'));
  const workspace = createWorldBookWorkspace({ database, userId, selectedBookIds: [book.id] });
  const result = executeWorldBookWorkspaceTool(workspace, 'replace_world_book_entries', { entries: [lore('替代')] });
  assert.equal(result.error, 'USE_INCREMENTAL_EDITS');
  assert.deepEqual(buildWorldBookChanges(workspace), []);
});

test('updating A and creating B retain independent stable drafts across turns', (t) => {
  const { database, userId, book } = fixture(t);
  const entry = createEntry(database, userId, book.id, lore('港口'));
  let workspace = createWorldBookWorkspace({ database, userId, selectedBookIds: [book.id] });
  call(workspace, 'upsert_world_book_entry', { entryId: entry.id, changes: { content: '港口扩建。' } });
  const added1 = call(workspace, 'upsert_world_book_entry', { changes: lore('码头') }).entry.id;
  const added2 = call(workspace, 'upsert_world_book_entry', { changes: lore('船厂') }).entry.id;
  const created = call(workspace, 'create_world_book', { localId: 'manual-b', name: '航海手册', entries: [lore('潮汐')] });
  assert.equal(created.targetRef, 'new:manual-b');
  workspace = createWorldBookWorkspace({ database, userId, selectedBookIds: [book.id], workspace: serializeWorldBookWorkspace(workspace) });
  assert.equal(workspace.activeRef, created.targetRef);
  const changes = buildWorldBookChanges(workspace);
  assert.equal(changes.length, 2);
  assert.deepEqual(changes[0].upserts.filter((item) => item.localId).map((item) => item.localId), [added1, added2]);
  call(workspace, 'upsert_world_book_entry', { targetRef: `existing:${book.id}`, entryId: entry.id, changes: { name: '新港口' } });
  assert.deepEqual(buildWorldBookChanges(workspace)[0].upserts.find((item) => item.entryId).patch, { name: '新港口', content: '港口扩建。' });
  call(workspace, 'create_world_book', { localId: 'manual-b', name: 'ignored', entries: [lore('ignored')] });
  assert.equal(workspace.targets.length, 2);
  assert.equal(workspace.targets[1].profile.name, '航海手册');
});

test('search and on-demand reads remain owner scoped and resolve explicit book IDs', (t) => {
  const { database, userId, book } = fixture(t);
  createEntry(database, userId, book.id, { ...lore('隐秘航线'), content: '只有灯塔守卫知道航线。' });
  const second = createWorldBook(database, userId, { name: '空白书' });
  const foreign = createWorldBook(database, 'workspace-other', { name: '灯塔密卷' });
  const workspace = createWorldBookWorkspace({ database, userId, selectedBookIds: [second.id] });
  const found = call(workspace, 'search_world_books', { query: '灯塔' });
  assert.deepEqual(found.books.map((item) => item.bookId), [book.id]);
  assert.equal(Object.hasOwn(found.books[0], 'entries'), false);
  const read = call(workspace, 'read_world_book', { bookId: book.id, query: '灯塔', includeContent: true });
  assert.equal(read.entries[0].name, '隐秘航线');
  assert.equal(executeWorldBookWorkspaceTool(workspace, 'select_world_book', { bookId: foreign.id }).error, 'WORLD_BOOK_NOT_FOUND');
  assert.throws(() => createWorldBookWorkspace({ database, userId, selectedBookIds: [foreign.id] }), /不可访问/);
});

test('same-name books and entries keep separate ID-scoped patches through continuation and apply', (t) => {
  const { database, userId, book } = fixture(t);
  const second = createWorldBook(database, userId, { name: book.name });
  const firstEntry = createEntry(database, userId, book.id, lore('港口'));
  const secondEntry = createEntry(database, userId, second.id, lore('港口'));
  let workspace = createWorldBookWorkspace({ database, userId, selectedBookIds: [book.id] });
  const found = call(workspace, 'search_world_books', { query: book.name });
  assert.deepEqual(new Set(found.books.map(item => item.bookId)), new Set([book.id, second.id]));
  for (const [target, entry, content] of [[book, firstEntry, '北港扩建。'], [second, secondEntry, '南港封航。']]) {
    call(workspace, 'select_world_book', { bookId: target.id });
    call(workspace, 'set_world_book_profile', { description: content });
    call(workspace, 'upsert_world_book_entry', { entryId: entry.id, changes: { content } });
  }
  workspace = createWorldBookWorkspace({ database, userId, selectedBookIds: [second.id, book.id], workspace: serializeWorldBookWorkspace(workspace) });
  const changes = buildWorldBookChanges(workspace);
  assert.equal(changes.length, 2);
  assert.equal(changes.find(change => change.bookId === book.id).upserts[0].entryId, firstEntry.id);
  assert.equal(changes.find(change => change.bookId === second.id).upserts[0].entryId, secondEntry.id);
  applyWorldBookChanges(database, userId, { requestId: 'same-name-independent-books', changes });
  for (const [target, entry, content] of [[book, firstEntry, '北港扩建。'], [second, secondEntry, '南港封航。']]) {
    const saved = getWorldBook(database, userId, target.id);
    assert.equal(saved.name, book.name);
    assert.equal(saved.description, content);
    assert.equal(saved.entries.length, 1);
    assert.equal(saved.entries[0].id, entry.id);
    assert.equal(saved.entries[0].content, content);
  }
});

test('profile-only edits preserve incomplete disabled entries and deleting the last entry is valid', (t) => {
  const { database, userId, book } = fixture(t);
  const entry = createEntry(database, userId, book.id, { name: '旧条目', triggerKeys: '', content: '', enabled: false });
  const workspace = createWorldBookWorkspace({ database, userId, selectedBookIds: [book.id] });
  call(workspace, 'set_world_book_profile', { name: '新版大陆' });
  assert.deepEqual(buildWorldBookChanges(workspace)[0].profile, { name: '新版大陆' });
  assert.equal(worldBookWorkspaceContext(workspace).targets[0].entryCount, 1);
  call(workspace, 'remove_world_book_entry', { entryId: entry.id });
  assert.equal(worldBookWorkspaceContext(workspace).targets[0].entryCount, 0);
  assert.deepEqual(buildWorldBookChanges(workspace)[0].removals, [entry.id]);
});

test('restoring stale conversations retains intended patches and removals for the apply conflict check', (t) => {
  const { database, userId, book } = fixture(t);
  const edited = createEntry(database, userId, book.id, lore('编辑条目'));
  const removed = createEntry(database, userId, book.id, lore('删除条目'));
  const workspace = createWorldBookWorkspace({ database, userId, selectedBookIds: [book.id] });
  call(workspace, 'upsert_world_book_entry', { entryId: edited.id, changes: { content: '本次对话草稿。' } });
  call(workspace, 'remove_world_book_entry', { entryId: removed.id });
  const snapshot = serializeWorldBookWorkspace(workspace);
  updateEntry(database, userId, book.id, edited.id, { content: '本次对话草稿。' });
  deleteEntry(database, userId, book.id, removed.id);
  const restored = createWorldBookWorkspace({ database, userId, selectedBookIds: [book.id], workspace: snapshot });
  const [change] = buildWorldBookChanges(restored);
  assert.equal(change.baseRevision, snapshot.targets[0].baseRevision);
  assert.deepEqual(change.upserts[0].patch, { content: '本次对话草稿。' });
  assert.deepEqual(change.removals, [removed.id]);
  deleteEntry(database, userId, book.id, edited.id);
  const restoredAgain = createWorldBookWorkspace({ database, userId, workspace: serializeWorldBookWorkspace(restored) });
  assert.equal(buildWorldBookChanges(restoredAgain)[0].upserts[0].entryId, edited.id);
});

test('30-entry batch limit never caps the total size of an existing book', (t) => {
  const { database, userId, book } = fixture(t);
  const workspace = createWorldBookWorkspace({ database, userId, selectedBookIds: [book.id] });
  for (let index = 0; index < 35; index += 1) call(workspace, 'upsert_world_book_entry', { changes: lore(`补充${index}`) });
  assert.equal(buildWorldBookChanges(workspace)[0].upserts.length, 35);
  const created = call(workspace, 'create_world_book', { name: '新书' });
  const result = executeWorldBookWorkspaceTool(workspace, 'replace_world_book_entries', { targetRef: created.targetRef, entries: Array.from({ length: 31 }, (_, index) => lore(`条目${index}`)) });
  assert.equal(result.error, 'ENTRY_LIMIT');
  assert.ok(worldBookWorkspaceTools().some((item) => item.function.name === 'create_world_book'));
  assert.equal(worldBookWorkspaceTools({ planPhase: true }).some((item) => item.function.name === 'create_world_book'), false);
});

test('named empty drafts can be created alongside selected books and later filled', (t) => {
  const { database, userId, book } = fixture(t);
  const workspace = createWorldBookWorkspace({ database, userId, selectedBookIds: [book.id] });
  call(workspace, 'create_world_book', { name: '空白新书', description: '稍后补充' });
  const [created] = buildWorldBookChanges(workspace);
  assert.equal(created.bookId, null);
  assert.equal(created.profile.name, '空白新书');
  assert.deepEqual(created.entries, []);
  const restored = createWorldBookWorkspace({ database, userId, workspace: serializeWorldBookWorkspace(workspace) });
  call(restored, 'upsert_world_book_entry', { changes: lore('第一条') });
  assert.equal(buildWorldBookChanges(restored)[0].entries.length, 1);
});

test('query reads include matching body by default and explicit directory reads stay compact', (t) => {
  const { database, userId, book } = fixture(t);
  const entry = createEntry(database, userId, book.id, { ...lore('港湾'), content: '隐藏正文包含灯塔。' });
  const workspace = createWorldBookWorkspace({ database, userId, selectedBookIds: [book.id] });
  assert.equal(call(workspace, 'read_world_book', { query: '灯塔' }).entries[0].content, entry.content);
  assert.equal(Object.hasOwn(call(workspace, 'read_world_book', { query: '灯塔', includeContent: false }).entries[0], 'content'), false);
});

test('group, explicit sorting and sparse append order survive partial updates and continuation', (t) => {
  const { database, userId, book } = fixture(t);
  const entry = createEntry(database, userId, book.id, { ...lore('舰队'), group: '旧组' });
  updateEntry(database, userId, book.id, entry.id, { orderIndex: 100 });
  let workspace = createWorldBookWorkspace({ database, userId, selectedBookIds: [book.id] });
  call(workspace, 'upsert_world_book_entry', { entryId: entry.id, changes: { group: '', orderIndex: 125 } });
  const added = call(workspace, 'upsert_world_book_entry', { changes: lore('追加') });
  assert.equal(added.entry.orderIndex, 126);
  workspace = createWorldBookWorkspace({ database, userId, workspace: serializeWorldBookWorkspace(workspace) });
  assert.deepEqual(buildWorldBookChanges(workspace)[0].upserts.find((item) => item.entryId).patch, { orderIndex: 125, group: '' });
});

function toolResponse(calls = [], content = '') {
  return Response.json({ choices: [{ message: { role: 'assistant', content, tool_calls: calls.map(([name, args], index) => ({ id: `call-${index}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })) } }] });
}

test('standalone assistant supports autonomous selection, updates, creation and conversation history', async (t) => {
  const { database, userId, book } = fixture(t);
  const entry = createEntry(database, userId, book.id, lore('灯塔'));
  const originalFetch = globalThis.fetch;
  try {
  const requests = [];
  globalThis.fetch = async (_url, request) => {
    requests.push(JSON.parse(request.body));
    if (requests.length === 1) return toolResponse([['search_world_books', { query: '灯塔' }]]);
    if (requests.length === 2) return toolResponse([['select_world_book', { bookId: book.id }], ['read_world_book', { bookId: book.id, entryIds: [entry.id] }]]);
    if (requests.length === 3) return toolResponse([['upsert_world_book_entry', { targetRef: `existing:${book.id}`, entryId: entry.id, changes: { content: '灯塔恢复运作。' } }], ['create_world_book', { name: '航海手册', entries: [lore('潮汐')] }]]);
    return toolResponse([['finish_world_book_task', { reply: '已修订灯塔，并新建航海手册。' }]]);
  };
  const result = await completeWorldBookDraft(settings, { database, userId, selectedBookIds: [], requirement: '修订灯塔，再另建航海手册。', history: [{ role: 'user', content: '此前讨论沿海设定。' }] });
  assert.equal(result.changes.length, 2);
  assert.equal(result.changes[0].bookId, book.id);
  assert.equal(result.changes[1].bookId, null);
  assert.match(result.reply, /已修订灯塔/);
  assert.ok(requests[0].messages.some((item) => item.content === '此前讨论沿海设定。'));
  assert.equal(getWorldBook(database, userId, book.id).entries[0].content, entry.content);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('pure discussion stops without write tools and stream mode exposes incremental workspace', async (t) => {
  const { database, userId, book } = fixture(t);
  const originalFetch = globalThis.fetch;
  try {
  let count = 0;
  globalThis.fetch = async () => { count += 1; return toolResponse([], '可以先讨论设定。'); };
  const readOnly = await completeWorldBookDraft(settings, { database, userId, selectedBookIds: [book.id], requirement: '先讨论。' });
  assert.equal(count, 1);
  assert.deepEqual(readOnly.changes, []);
  assert.equal(readOnly.reply, '可以先讨论设定。');
  count = 0;
  const events = [];
  globalThis.fetch = async () => ++count === 1 ? toolResponse([['set_world_book_profile', { description: '新用途' }]]) : toolResponse([], '已更新用途。');
  const result = await streamWorldBookDraft(settings, { database, userId, selectedBookIds: [book.id], providerStreaming: false, emit: (name, data) => events.push({ name, data }) });
  assert.equal(result.changes[0].profile.description, '新用途');
  assert.ok(events.some((event) => event.name === 'workspace' && event.data.changes[0]?.profile.description === '新用途'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Plan preserves its selected targets and rejects a changed target before executing', async (t) => {
  const { database, userId, book } = fixture(t);
  const originalFetch = globalThis.fetch;
  try {
  globalThis.fetch = async () => toolResponse([['submit_world_book_plan', { steps: [{ section: 'profile', intent: '完善用途说明' }] }]]);
  const planned = await completeWorldBookDraft(settings, { database, userId, selectedBookIds: [book.id], planMode: true });
  const modified = structuredClone(planned.workspace);
  modified.targets[0].profilePatch = { name: '另一底稿' };
  await assert.rejects(completeWorldBookDraft(settings, { database, userId, selectedBookIds: [book.id], workspace: modified, planMode: true, plan: { ...planned.plan, approved: true } }), /重新生成计划/);
  let count = 0;
  globalThis.fetch = async () => ++count === 1 ? toolResponse([['set_world_book_profile', { description: '执行计划后的说明' }]]) : toolResponse([], '完成。');
  const result = await completeWorldBookDraft(settings, { database, userId, selectedBookIds: [book.id], workspace: planned.workspace, planMode: true, plan: { ...planned.plan, approved: true } });
  assert.equal(result.planProgress.completed, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('per-run creation limit counts additions across targets without limiting old-entry edits', async (t) => {
  const { database, userId, book } = fixture(t);
  const entry = createEntry(database, userId, book.id, lore('旧条目'));
  const originalFetch = globalThis.fetch;
  try {
  let round = 0;
  globalThis.fetch = async () => ++round === 1 ? toolResponse([
    ['upsert_world_book_entry', { entryId: entry.id, changes: { content: '仍可修改。' } }],
    ['upsert_world_book_entry', { changes: lore('新增甲') }],
    ['create_world_book', { name: '新书', entries: [lore('新增乙')] }],
    ['upsert_world_book_entry', { changes: lore('超限') }]
  ]) : toolResponse([], '完成。');
  const result = await completeWorldBookDraft(settings, { database, userId, selectedBookIds: [book.id], context: { entryLimit: 2 } });
  assert.equal(result.changes.length, 2);
  assert.equal(result.toolCalls[3].result.error, 'ENTRY_LIMIT');
  assert.equal(result.changes[0].upserts[0].entryId, entry.id);
  assert.equal(result.changes[1].entries.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('stream recovery reuses a new draft and added entry even if provider repeats calls with new IDs', async (t) => {
  const { database, userId, book } = fixture(t);
  const originalFetch = globalThis.fetch;
  try {
  let requestCount = 0;
  const create = { name: '恢复草稿', entries: [lore('核心')] };
  const add = { changes: lore('补充') };
  globalThis.fetch = async (_url, request) => {
    requestCount += 1;
    const body = JSON.parse(request.body);
    if (requestCount === 1) return toolResponse([['create_world_book', create], ['upsert_world_book_entry', add]]);
    if (requestCount === 2) throw new Error('AI 流式响应中断');
    assert.equal(body.stream, false);
    if (requestCount === 3) {
      const response = { choices: [{ message: { role: 'assistant', content: '', tool_calls: [
        { id: 'recovery-create', type: 'function', function: { name: 'create_world_book', arguments: JSON.stringify(create) } },
        { id: 'recovery-add', type: 'function', function: { name: 'upsert_world_book_entry', arguments: JSON.stringify(add) } }
      ] } }] };
      return Response.json(response);
    }
    return toolResponse([], '已完成恢复。');
  };
  const result = await streamWorldBookDraft(settings, { database, userId, selectedBookIds: [book.id], emit: () => {} });
  assert.equal(result.streamRecovered, true);
  assert.equal(result.workspace.targets.length, 2);
  assert.equal(result.changes.length, 1);
  assert.deepEqual(result.changes[0].entries.map((item) => item.name), ['核心', '补充']);
  assert.ok(result.toolCalls.every((item) => item.result.replayed));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('manual selection is explained to the model and identical provider call IDs stay target scoped', async (t) => {
  const { database, userId, book } = fixture(t);
  const second = createWorldBook(database, userId, { name: '第二本' });
  const originalFetch = globalThis.fetch;
  try {
    let round = 0;
    globalThis.fetch = async (_url, request) => {
      const body = JSON.parse(request.body);
      assert.match(body.messages[0].content, /The user selected the default book/);
      assert.doesNotMatch(body.messages[0].content, /\p{Script=Han}/u);
      round += 1;
      if (round === 1) return toolResponse([['upsert_world_book_entry', { changes: lore('通用条目') }]]);
      if (round === 2) return toolResponse([['select_world_book', { bookId: second.id }]]);
      if (round === 3) return toolResponse([['upsert_world_book_entry', { changes: lore('通用条目') }]]);
      return toolResponse([], '分别补充两本。');
    };
    const result = await completeWorldBookDraft(settings, { database, userId, selectedBookIds: [book.id], automatic: false });
    assert.equal(result.changes.length, 2);
    assert.ok(result.changes.every((item) => item.upserts.length === 1));
    assert.ok(result.workspace.targets.every((target) => target.bookId));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
