import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { createAppDatabase } from '../db/runtime.js';
import { listCharacterPage } from '../modules/characters.js';
import { createConversationTransaction, getTransactionHistory } from '../modules/economy.js';
import { listConversationRows } from '../repositories/conversationRepository.js';
import { buildConversationContextPreview } from '../services/contextPreview.js';
import {
  performanceMetricsSnapshot,
  resetPerformanceMetrics
} from '../services/performanceMetrics.js';
import { listConversationMessagePage } from '../routes/helpers.js';
import { insertUser } from './routeTestUtils.js';

test('large-list cursors preserve tied rows without duplication and reject cross-scope reuse', () => {
  const database = createPaginationDatabase();
  try {
    const firstMessages = listConversationMessagePage(database, 'page-user', 'page-conversation', { limit: 5 });
    const secondMessages = listConversationMessagePage(database, 'page-user', 'page-conversation', {
      limit: 5,
      cursor: firstMessages.nextCursor
    });
    assert.equal(firstMessages.messages.length, 5);
    assert.equal(secondMessages.messages.length, 5);
    assert.equal(new Set([...firstMessages.messages, ...secondMessages.messages].map((row) => row.id)).size, 10);
    assert.throws(
      () => listConversationMessagePage(database, 'page-user', 'other-conversation', {
        limit: 5,
        cursor: firstMessages.nextCursor
      }),
      (error) => error?.code === 'INVALID_CURSOR'
    );

    const firstCharacters = listCharacterPage(database, 'page-user', { limit: 3, sort: 'name' });
    const secondCharacters = listCharacterPage(database, 'page-user', {
      limit: 3,
      sort: 'name',
      cursor: firstCharacters.nextCursor
    });
    assert.equal(new Set([...firstCharacters.items, ...secondCharacters.items].map((row) => row.id)).size, 6);

    const firstConversations = listConversationRows(database, 'page-user', {
      pagination: 'cursor',
      limit: 2
    });
    const secondConversations = listConversationRows(database, 'page-user', {
      pagination: 'cursor',
      limit: 2,
      cursor: firstConversations.nextCursor
    });
    assert.equal(new Set([...firstConversations.rows, ...secondConversations.rows].map((row) => row.id)).size, 4);
  } finally {
    database.close();
  }
});

test('economy cursor pages retain the legacy total while avoiding offsets', () => {
  const database = createPaginationDatabase();
  try {
    for (let index = 0; index < 7; index += 1) {
      createConversationTransaction(database, 'page-user', 'page-conversation', {
        type: 'income',
        amount: index + 1,
        description: `income-${index}`,
        source: 'user'
      });
    }
    const first = getTransactionHistory(database, 'page-user', 'page-conversation', {
      pagination: 'cursor',
      limit: 3
    });
    const second = getTransactionHistory(database, 'page-user', 'page-conversation', {
      pagination: 'cursor',
      limit: 3,
      cursor: first.nextCursor
    });
    assert.equal(first.total, 7);
    assert.equal(second.total, 7);
    assert.equal(first.offset, 0);
    assert.equal(new Set([...first.transactions, ...second.transactions].map((row) => row.id)).size, 6);
  } finally {
    database.close();
  }
});

test('message pagination and context preview meet the in-memory performance budget', () => {
  const database = createPaginationDatabase({ messageCount: 2000 });
  try {
    resetPerformanceMetrics();
    const pageStartedAt = performance.now();
    const page = listConversationMessagePage(database, 'page-user', 'page-conversation', { limit: 100 });
    const pageDurationMs = performance.now() - pageStartedAt;

    const contextStartedAt = performance.now();
    const preview = buildConversationContextPreview(
      database,
      { id: 'page-user', username: 'page-user', displayName: 'Page User' },
      'page-conversation',
      { content: 'benchmark marker', searchQuery: 'benchmark marker', searchLimit: 8 }
    );
    const contextDurationMs = performance.now() - contextStartedAt;

    assert.equal(page.messages.length, 100);
    assert.ok(preview);
    assert.ok(pageDurationMs < 2000, `message page took ${pageDurationMs.toFixed(1)}ms`);
    assert.ok(contextDurationMs < 2000, `context preview took ${contextDurationMs.toFixed(1)}ms`);
    const names = new Set(performanceMetricsSnapshot().map((metric) => metric.name));
    assert.equal(names.has('sqlite.messages.list'), true);
    assert.equal(names.has('sqlite.fts.search'), true);
    assert.equal(names.has('context.preview'), true);
  } finally {
    database.close();
  }
});

function createPaginationDatabase(options = {}) {
  const database = createAppDatabase(':memory:');
  insertUser(database, 'page-user');
  const timestamp = '2026-01-01T00:00:00.000Z';
  for (let index = 0; index < 8; index += 1) {
    database.prepare(
      `INSERT INTO characters (id, user_id, name, visibility, created_at, updated_at)
       VALUES (?, ?, ?, 'private', ?, ?)`
    ).run(`page-character-${index}`, 'page-user', `Character ${Math.floor(index / 2)}`, timestamp, timestamp);
  }
  for (let index = 0; index < 5; index += 1) {
    database.prepare(
      `INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      index === 0 ? 'page-conversation' : `page-conversation-${index}`,
      'page-user',
      'page-character-0',
      `Conversation ${index}`,
      timestamp,
      timestamp
    );
  }
  database.prepare(
    `INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run('other-conversation', 'page-user', 'page-character-0', 'Other', timestamp, timestamp);

  const statement = database.prepare(
    `INSERT INTO messages (id, user_id, conversation_id, role, content, created_at)
     VALUES (?, ?, ?, 'user', ?, ?)`
  );
  const messageCount = Math.max(12, Number(options.messageCount || 0));
  database.exec('BEGIN');
  try {
    for (let index = 0; index < messageCount; index += 1) {
      statement.run(
        `page-message-${index}`,
        'page-user',
        'page-conversation',
        `benchmark marker message ${index}`,
        timestamp
      );
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return database;
}
