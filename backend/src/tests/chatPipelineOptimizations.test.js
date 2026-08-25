import assert from 'node:assert/strict';
import express from 'express';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const { createAppDatabase } = await import('../db.js');
const { createCharacter } = await import('../modules/characters.js');
const {
  createEntry,
  createWorldBook,
  linkWorldBookToCharacter,
  matchWorldBookEntries,
  resetMessageCounter
} = await import('../modules/worldBooks.js');
const { createSwipesRouter } = await import('../routes/swipes.js');
const { insertUser, withServer } = await import('./routeTestUtils.js');

const streamResponseSource = readFileSync(new URL('../services/conversationStreamResponse.js', import.meta.url), 'utf8');
const generationRouteSource = readFileSync(new URL('../routes/conversationGeneration.js', import.meta.url), 'utf8');
const providersSource = readFileSync(new URL('../services/providers.js', import.meta.url), 'utf8');
const providerHttpSource = readFileSync(new URL('../services/providerHttp.js', import.meta.url), 'utf8');
const providerAnthropicSource = readFileSync(new URL('../services/providerAnthropic.js', import.meta.url), 'utf8');
const providerOpenAiResponsesSource = readFileSync(new URL('../services/providerOpenAiResponses.js', import.meta.url), 'utf8');
const providerSseSource = readFileSync(new URL('../services/providerSse.js', import.meta.url), 'utf8');
const accessoryAgentsSource = readFileSync(new URL('../services/accessoryAgents.js', import.meta.url), 'utf8');
const worldBooksSource = readFileSync(new URL('../modules/worldBooks.js', import.meta.url), 'utf8');
const promptPipelineSource = readFileSync(new URL('../services/promptPipeline.js', import.meta.url), 'utf8');
const contextPreviewSource = readFileSync(new URL('../services/contextPreview.js', import.meta.url), 'utf8');

// ── World book dry-run matching ──

function createStickyWorldBookFixture(databaseLabel) {
  resetMessageCounter();
  const database = createAppDatabase(':memory:');
  insertUser(database, `${databaseLabel}-user`);
  const character = createCharacter(database, `${databaseLabel}-user`, { name: `${databaseLabel}角色` });
  const book = createWorldBook(database, `${databaseLabel}-user`, { name: `${databaseLabel}书` });
  linkWorldBookToCharacter(database, book.id, character.id);
  createEntry(database, `${databaseLabel}-user`, book.id, {
    name: '粘性条目',
    triggerKeys: '触发',
    content: '粘性内容',
    enabled: true,
    sticky: 2
  });
  return { database, character };
}

test('world book dry-run matching leaves entry state untouched', () => {
  const { database, character } = createStickyWorldBookFixture('dry-run');

  const dryMatches = matchWorldBookEntries(database, character.id, '触发关键词', { persistState: false });
  assert.equal(dryMatches.length, 1);
  assert.equal(dryMatches[0].content, '粘性内容');

  // Dry-run must not create or mutate persisted state rows.
  const stateCount = database.prepare('SELECT COUNT(*) AS count FROM world_book_entry_state').get();
  assert.equal(stateCount.count, 0);

  // Repeat dry-runs are idempotent.
  const dryAgain = matchWorldBookEntries(database, character.id, '触发关键词', { persistState: false });
  assert.equal(dryAgain.length, 1);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM world_book_entry_state').get().count, 0);
});

test('world book dry-run does not consume sticky windows or advance the counter', () => {
  const { database, character } = createStickyWorldBookFixture('sticky-preview');

  // Real message 1: activates the entry with sticky=2.
  const m1 = matchWorldBookEntries(database, character.id, '触发关键词', { messageCount: 1 });
  assert.equal(m1.length, 1);

  // Previews between messages must not decrement sticky_remaining.
  for (let index = 0; index < 3; index += 1) {
    const preview = matchWorldBookEntries(database, character.id, '无关文本', { persistState: false });
    assert.equal(preview.length, 1, 'sticky entry stays visible in preview');
  }
  const stateAfterPreviews = database
    .prepare('SELECT sticky_remaining FROM world_book_entry_state')
    .get();
  assert.equal(stateAfterPreviews.sticky_remaining, 1);

  // Message 2 consumes the remaining sticky window; later messages stay inactive.
  assert.equal(matchWorldBookEntries(database, character.id, '无关文本', { messageCount: 2 }).length, 1);
  assert.equal(matchWorldBookEntries(database, character.id, '无关文本', { messageCount: 3 }).length, 0);
  assert.equal(matchWorldBookEntries(database, character.id, '无关文本', { messageCount: 4 }).length, 0);
});

test('prompt pipeline persists world book state while context preview stays dry', () => {
  assert.match(promptPipelineSource, /persistState: source\.persistWorldBookState !== false/);
  assert.match(promptPipelineSource, /contextSize: Math\.ceil\(contextBudgetCharacters \/ TOKEN_CHAR_DIVISOR\)/);
  assert.match(contextPreviewSource, /persistWorldBookState: false/);
  assert.match(worldBooksSource, /withSavepoint\(database, 'sp_world_book_entry_state', \(\) => \{/);
  assert.doesNotMatch(worldBooksSource, /for \(const entry of entries\) \{[^]{0,400}INSERT OR IGNORE INTO world_book_entry_state/);
});

// ── Streaming data-loss fixes ──

test('stream response persists partials and reports terminal events on all error paths', () => {
  // Non-abort provider errors persist the partial and attach it to the error event.
  assert.match(
    streamResponseSource,
    /const interruptedMessage = saveInterruptedAssistantResult\(\{[^]{0,600}\.\.\.\(interruptedMessage \? \{ assistantMessage: interruptedMessage \} : \{\}\)/
  );
  // Server-initiated aborts (timeout) still emit a terminal error while the socket is writable.
  assert.match(
    streamResponseSource,
    /const serverAborted = isAbortError\(error\) \|\| controller\.signal\.aborted \|\| response\.destroyed;/
  );
  assert.match(streamResponseSource, /interrupted: true/);
  assert.match(streamResponseSource, /const reason = controller\.signal\.reason;/);
  // Both error paths flush queued writes before ending the response.
  assert.match(
    streamResponseSource,
    /interrupted: true,[^]{0,200}await streamWrites\.wait\(\);\s*response\.end\(\);/
  );
});

test('anthropic streaming merges message_start usage under message_delta', () => {
  assert.match(
    providerAnthropicSource,
    /if \(json\.type === 'message_start' && json\.message\?\.usage\) \{\s*usage = \{\s*\.\.\.json\.message\.usage,\s*\.\.\.\(usage \|\| \{\}\)\s*\};/
  );
});

test('parseSse always releases the upstream reader', () => {
  assert.match(providerSseSource, /} finally \{\s*await reader\.cancel\(\)\.catch\(\(\) => \{\}\);\s*\}/);
});

// ── Generation route hardening ──

test('generation route locks per conversation and skips usage aggregation', () => {
  assert.match(generationRouteSource, /getConversationForUser\(db, userId, conversationId, \{ includeUsage: false \}\)/);
  assert.match(generationRouteSource, /const generatingConversations = new Set\(\);/);
  assert.match(generationRouteSource, /if \(!tryLockGeneration\(conversation\.id, response\)\) \{\s*return;\s*\}/);
  assert.match(generationRouteSource, /finally \{\s*unlockGeneration\(conversation\.id\);\s*\}/);
  assert.match(generationRouteSource, /response\.status\(409\)/);
  // Status bar is fetched once per response, not per field.
  assert.doesNotMatch(
    generationRouteSource,
    /statusBar: getStatusBar\(db, request\.auth\.user\.id, conversation\.id\),[^]{0,600}statusBar: getStatusBar\(db, request\.auth\.user\.id, conversation\.id\) \|\| statusBar/
  );
});

test('non-stream completions carry an abort signal with a timeout ceiling', () => {
  assert.match(providersSource, /const signal = buildNonStreamSignal\(options\);/);
  assert.match(providersSource, /AbortSignal\.any\(\[options\.signal, timeoutSignal\]\)/);
  assert.match(providersSource, /export const NON_STREAM_COMPLETION_TIMEOUT_MS = 300_000;/);
  assert.match(providerAnthropicSource, /buildAnthropicBody\(settings, messages, false, options\);[^]{0,200}signal: options\.signal/);
  assert.match(providerOpenAiResponsesSource, /stream: false\s*\}\),\s*signal: options\.signal/);
  assert.match(providerHttpSource, /if \(error\?\.name === 'TimeoutError'\) \{/);
});

test('accessory agents abort their provider calls at the deadline', () => {
  assert.match(accessoryAgentsSource, /const controller = new AbortController\(\);/);
  assert.match(accessoryAgentsSource, /const statusBarAgentTimeoutMs = 60000;/);
  assert.match(accessoryAgentsSource, /\{ timeoutMs: statusBarAgentTimeoutMs \}/);
  assert.match(accessoryAgentsSource, /controller\.abort\(new Error\(`\$\{skill\} timed out`\)\);/);
  assert.match(accessoryAgentsSource, /await withTimeout\(handler\(controller\.signal\), timeoutMs \+ agentAbortGraceMs/);
  assert.match(accessoryAgentsSource, /onNoToolCall: statusBarNoToolNudge/);
  assert.match(accessoryAgentsSource, /maxRounds:\s*2,[\s\S]{0,80}thinkingEnabled:\s*false,[\s\S]{0,80}signal/);
});

// ── Swipe input validation ──

test('swipe routes validate input and keep ownership checks in the module', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'swipe-route-user';
  insertUser(database, userId);
  const character = createCharacter(database, userId, { name: 'Swipe角色' });
  const timestamp = new Date().toISOString();
  database.prepare(
    `INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at)
     VALUES ('conv-swipe', ?, ?, 'test', ?, ?)`
  ).run(userId, character.id, timestamp, timestamp);
  database.prepare(
    `INSERT INTO messages (id, user_id, conversation_id, role, content, created_at)
     VALUES ('msg-swipe', ?, 'conv-swipe', 'assistant', 'original', ?)`
  ).run(userId, timestamp);

  const app = express();
  app.use(express.json());
  app.use('/api/messages', createSwipesRouter({
    db: database,
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: userId, username: userId } };
      next();
    }
  }));

  await withServer(app, async (baseUrl) => {
    const invalidResponse = await fetch(`${baseUrl}/api/messages/msg-swipe/swipes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { nested: 'object' } })
    });
    assert.equal(invalidResponse.status, 400);

    const emptyResponse = await fetch(`${baseUrl}/api/messages/msg-swipe/swipes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(emptyResponse.status, 400);

    const validResponse = await fetch(`${baseUrl}/api/messages/msg-swipe/swipes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '替代回复', reasoning: '', usage: null })
    });
    const validBody = await validResponse.json();
    assert.equal(validResponse.status, 201);
    assert.equal(validBody.content, '替代回复');

    const foreignResponse = await fetch(`${baseUrl}/api/messages/missing-message/swipes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '替代回复' })
    });
    assert.equal(foreignResponse.status, 404);

    const missingSwipeIdResponse = await fetch(`${baseUrl}/api/messages/msg-swipe/swipes/active`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(missingSwipeIdResponse.status, 400);
  });
});
