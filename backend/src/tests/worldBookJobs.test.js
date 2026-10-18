import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'world-book-job-test-secret';
const { createAppDatabase } = await import('../db/runtime.js');
const { createDefaultJobHandlers } = await import('../services/jobs/jobHandlers.js');
const { submitJob, claimNextJob, completeJob, getJob } = await import('../services/jobs/jobQueue.js');
const { createProviderProfile } = await import('../repositories/providerProfileRepository.js');
const { encryptSecret } = await import('../security.js');
const { createEntry, createWorldBook, getWorldBook } = await import('../services/worldBooks/worldBookService.js');
const { createWorldBookWorkspace, executeWorldBookWorkspaceTool, serializeWorldBookWorkspace } = await import('../services/worldBooks/worldBookAssistantWorkspace.js');
const { insertUser } = await import('./routeTestUtils.js');

function toolResponse(calls = [], content = '') {
  return Response.json({ choices: [{ message: { role: 'assistant', content, tool_calls: calls.map(([name, args], index) => ({
    id: `call-${index}`, type: 'function', function: { name, arguments: JSON.stringify(args) }
  })) } }] });
}

test('world-book.assist jobs preserve owned reads, selected IDs, pending workspace, history and manual selection', async (t) => {
  const database = createAppDatabase(':memory:');
  t.after(() => database.close());
  const userId = 'world-book-job-owner';
  insertUser(database, userId);
  insertUser(database, 'world-book-job-other');
  createProviderProfile(database, userId, {
    providerType: 'custom', gatewayName: 'Job test', baseUrl: 'https://workspace.test/v1', model: 'test',
    encryptedApiKey: encryptSecret('test-provider-key'), extraBody: {}
  });
  const previous = createWorldBook(database, userId, { name: '此前编辑的书' });
  const selected = createWorldBook(database, userId, { name: '本轮指定的书' });
  const entry = createEntry(database, userId, selected.id, { name: '灯塔', triggerKeys: '灯塔', content: '仅本用户可读的灯塔正文。' });
  const foreign = createWorldBook(database, 'world-book-job-other', { name: '其他用户的书' });
  const workspace = createWorldBookWorkspace({ database, userId, selectedBookIds: [previous.id] });
  assert.equal(executeWorldBookWorkspaceTool(workspace, 'set_world_book_profile', { description: '上轮尚未应用的补充。' }).ok, true);
  assert.equal(executeWorldBookWorkspaceTool(workspace, 'create_world_book', { localId: 'pending-new', name: '待创建手册' }).ok, true);
  const snapshot = serializeWorldBookWorkspace(workspace);
  snapshot.activeRef = '';
  const submitted = submitJob(database, userId, 'world-book.assist', {
    requirement: '读取灯塔，再补充指定书的用途。', selectedBookIds: [selected.id], automatic: false, workspace: snapshot,
    history: [{ role: 'user', content: '上轮决定保留航海主题。' }]
  }, { idempotencyKey: 'world-book-workspace-job' });
  const job = claimNextJob(database, 'world-book-test-worker');
  assert.equal(job.id, submitted.id);
  const originalFetch = globalThis.fetch;
  try {
    let round = 0;
    globalThis.fetch = async (_url, request) => {
      const body = JSON.parse(request.body);
      round += 1;
      if (round === 1) {
        assert.match(body.messages[0].content, /本次由用户指定用书/);
        assert.ok(body.messages.some(message => message.content === '上轮决定保留航海主题。'));
        const input = JSON.parse(body.messages.at(-1).content);
        assert.equal(input.requirement, '读取灯塔，再补充指定书的用途。');
        assert.equal(input.worldBookWorkspace.activeRef, `existing:${selected.id}`);
        assert.equal(input.worldBookWorkspace.targets.find(target => target.bookId === previous.id).profile.description, '上轮尚未应用的补充。');
        assert.ok(input.worldBookWorkspace.targets.some(target => target.ref === 'new:pending-new'));
        return toolResponse([
          ['read_world_book', { entryIds: [entry.id] }],
          ['read_world_book', { bookId: foreign.id, includeContent: true }]
        ]);
      }
      if (round === 2) return toolResponse([['set_world_book_profile', { description: '本轮用途补充。' }]]);
      return toolResponse([['finish_world_book_task', { reply: '保留上轮草稿，并补充指定书。' }]]);
    };
    const handler = createDefaultJobHandlers(database, { config: { nodeEnv: 'test', providerResolveDns: false } })['world-book.assist'];
    const result = await handler({ job, payload: job.payload, signal: new AbortController().signal, progress: () => {} });
    assert.equal(round, 3);
    assert.equal(result.toolCalls[0].result.entries[0].content, entry.content);
    assert.equal(result.toolCalls[1].result.error, 'WORLD_BOOK_TARGET_REQUIRED');
    assert.deepEqual(result.workspace.selectedBookIds, [selected.id]);
    assert.equal(result.changes.find(change => change.bookId === previous.id).profile.description, '上轮尚未应用的补充。');
    assert.equal(result.changes.find(change => change.bookId === selected.id).profile.description, '本轮用途补充。');
    assert.ok(result.changes.some(change => change.ref === 'new:pending-new'));
    assert.equal(getWorldBook(database, userId, selected.id).description, '');
    assert.equal(completeJob(database, job.id, job.leaseOwner, result), true);
    assert.equal(getJob(database, userId, job.id).status, 'succeeded');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
