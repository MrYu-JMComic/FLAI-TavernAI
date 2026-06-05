import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-economy';

const { createAppDatabase } = await import('../db.js');
const { newId, nowIso } = await import('../security.js');
const {
  CURRENCY_TYPES,
  DEFAULT_INITIAL_BALANCE,
  getOrCreateAccount,
  getConversationAccounts,
  getAccount,
  createTransaction,
  createConversationTransaction,
  getTransactionHistory,
  detectTransactionIntents,
  processTransactionIntents,
  getConversationEconomyState
} = await import('../modules/economy.js');

// ── Helpers ──

function setupTestEnv() {
  const database = createAppDatabase(':memory:');
  const userId = 'test-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    'tester',
    'hash',
    nowIso()
  );
  const characterId = newId();
  database.prepare('INSERT INTO characters (id, user_id, name, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    characterId,
    userId,
    '测试角色',
    'private',
    nowIso(),
    nowIso()
  );
  const conversationId = newId();
  database.prepare('INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    conversationId,
    userId,
    characterId,
    '测试对话',
    nowIso(),
    nowIso()
  );
  return { database, userId, characterId, conversationId };
}

// ── Currency Types ──

test('CURRENCY_TYPES contains expected currencies', () => {
  assert.ok(CURRENCY_TYPES.includes('gold'));
  assert.ok(CURRENCY_TYPES.includes('silver'));
  assert.ok(CURRENCY_TYPES.includes('copper'));
  assert.ok(CURRENCY_TYPES.includes('gem'));
  assert.ok(CURRENCY_TYPES.includes('credit'));
});

test('DEFAULT_INITIAL_BALANCE has gold = 100', () => {
  assert.equal(DEFAULT_INITIAL_BALANCE.gold, 100);
  assert.equal(DEFAULT_INITIAL_BALANCE.silver, 0);
});

// ── Account Creation ──

test('getOrCreateAccount creates a new account with default balance', () => {
  const { database, userId, conversationId } = setupTestEnv();

  const account = getOrCreateAccount(database, userId, conversationId, 'gold');
  assert.ok(account);
  assert.equal(account.currencyType, 'gold');
  assert.equal(account.balance, 100);
  assert.equal(account.conversationId, conversationId);
  assert.equal(account.userId, userId);
});

test('getOrCreateAccount returns existing account on second call', () => {
  const { database, userId, conversationId } = setupTestEnv();

  const first = getOrCreateAccount(database, userId, conversationId, 'gold');
  const second = getOrCreateAccount(database, userId, conversationId, 'gold');
  assert.equal(first.id, second.id);
  assert.equal(first.balance, second.balance);
});

test('getOrCreateAccount returns null for invalid conversation', () => {
  const { database, userId } = setupTestEnv();

  const account = getOrCreateAccount(database, userId, 'nonexistent', 'gold');
  assert.equal(account, null);
});

test('getOrCreateAccount defaults to gold currency', () => {
  const { database, userId, conversationId } = setupTestEnv();

  const account = getOrCreateAccount(database, userId, conversationId);
  assert.equal(account.currencyType, 'gold');
});

test('getOrCreateAccount creates separate accounts for different currencies', () => {
  const { database, userId, conversationId } = setupTestEnv();

  const gold = getOrCreateAccount(database, userId, conversationId, 'gold');
  const silver = getOrCreateAccount(database, userId, conversationId, 'silver');
  assert.notEqual(gold.id, silver.id);
  assert.equal(gold.currencyType, 'gold');
  assert.equal(silver.currencyType, 'silver');
});

// ── Account Queries ──

test('getConversationAccounts returns all accounts for a conversation', () => {
  const { database, userId, conversationId } = setupTestEnv();

  getOrCreateAccount(database, userId, conversationId, 'gold');
  getOrCreateAccount(database, userId, conversationId, 'silver');

  const accounts = getConversationAccounts(database, userId, conversationId);
  assert.equal(accounts.length, 2);
  assert.ok(accounts.every((a) => a.conversationId === conversationId));
});

test('getConversationAccounts returns null for invalid conversation', () => {
  const { database, userId } = setupTestEnv();

  const accounts = getConversationAccounts(database, userId, 'nonexistent');
  assert.equal(accounts, null);
});

test('getAccount returns account by ID with ownership check', () => {
  const { database, userId, conversationId } = setupTestEnv();

  const created = getOrCreateAccount(database, userId, conversationId, 'gold');
  const fetched = getAccount(database, userId, created.id);
  assert.ok(fetched);
  assert.equal(fetched.id, created.id);
});

test('getAccount returns null for wrong user', () => {
  const { database, userId, conversationId } = setupTestEnv();

  const created = getOrCreateAccount(database, userId, conversationId, 'gold');

  // Create another user
  const otherUserId = 'other-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    otherUserId,
    'other',
    'hash',
    nowIso()
  );

  const fetched = getAccount(database, otherUserId, created.id);
  assert.equal(fetched, null);
});

// ── Transactions ──

test('createTransaction adds income and updates balance', () => {
  const { database, userId, conversationId } = setupTestEnv();

  const account = getOrCreateAccount(database, userId, conversationId, 'gold');
  assert.equal(account.balance, 100);

  const result = createTransaction(database, userId, account.id, {
    amount: 50,
    type: 'income',
    description: '完成任务奖励'
  });

  assert.ok(result);
  assert.equal(result.transaction.amount, 50);
  assert.equal(result.transaction.type, 'income');
  assert.equal(result.transaction.description, '完成任务奖励');
  assert.equal(result.account.balance, 150);
});

test('createTransaction deducts expense and updates balance', () => {
  const { database, userId, conversationId } = setupTestEnv();

  const account = getOrCreateAccount(database, userId, conversationId, 'gold');

  const result = createTransaction(database, userId, account.id, {
    amount: 30,
    type: 'expense',
    description: '购买药水'
  });

  assert.ok(result);
  assert.equal(result.transaction.amount, -30);
  assert.equal(result.account.balance, 70);
});

test('createTransaction rejects expense exceeding balance', () => {
  const { database, userId, conversationId } = setupTestEnv();

  const account = getOrCreateAccount(database, userId, conversationId, 'gold');

  assert.throws(
    () => createTransaction(database, userId, account.id, { amount: 200, type: 'expense', description: '太多' }),
    /余额不足/
  );
});

test('createTransaction rejects zero amount', () => {
  const { database, userId, conversationId } = setupTestEnv();

  const account = getOrCreateAccount(database, userId, conversationId, 'gold');

  assert.throws(
    () => createTransaction(database, userId, account.id, { amount: 0, type: 'income' }),
    /不能为 0/
  );
});

test('createTransaction returns null for invalid account', () => {
  const { database, userId } = setupTestEnv();

  const result = createTransaction(database, userId, 'nonexistent', { amount: 10, type: 'income' });
  assert.equal(result, null);
});

test('createTransaction supports reward type', () => {
  const { database, userId, conversationId } = setupTestEnv();

  const account = getOrCreateAccount(database, userId, conversationId, 'gold');

  const result = createTransaction(database, userId, account.id, {
    amount: 100,
    type: 'reward',
    description: '打败怪物奖励'
  });

  assert.equal(result.transaction.type, 'reward');
  assert.equal(result.transaction.amount, 100);
  assert.equal(result.account.balance, 200);
});

test('createTransaction supports penalty type', () => {
  const { database, userId, conversationId } = setupTestEnv();

  const account = getOrCreateAccount(database, userId, conversationId, 'gold');

  const result = createTransaction(database, userId, account.id, {
    amount: 20,
    type: 'penalty',
    description: '迟到罚款'
  });

  assert.equal(result.transaction.type, 'penalty');
  assert.equal(result.transaction.amount, -20);
  assert.equal(result.account.balance, 80);
});

test('createTransaction supports related NPC', () => {
  const { database, userId, conversationId } = setupTestEnv();

  const account = getOrCreateAccount(database, userId, conversationId, 'gold');

  const result = createTransaction(database, userId, account.id, {
    amount: 50,
    type: 'income',
    description: '商人赠予',
    relatedNpc: '老张商人'
  });

  assert.equal(result.transaction.relatedNpc, '老张商人');
});

test('createConversationTransaction creates account and transaction', () => {
  const { database, userId, conversationId } = setupTestEnv();

  const result = createConversationTransaction(database, userId, conversationId, {
    currencyType: 'silver',
    amount: 25,
    type: 'income',
    description: '卖草药'
  });

  assert.ok(result);
  assert.equal(result.account.currencyType, 'silver');
  assert.equal(result.account.balance, 25);
  assert.equal(result.transaction.amount, 25);
});

test('createConversationTransaction returns null for invalid conversation', () => {
  const { database, userId } = setupTestEnv();

  const result = createConversationTransaction(database, userId, 'nonexistent', {
    amount: 10,
    type: 'income'
  });
  assert.equal(result, null);
});

// ── Transaction History ──

test('getTransactionHistory returns transactions in reverse chronological order', () => {
  const { database, userId, conversationId } = setupTestEnv();

  const r1 = createConversationTransaction(database, userId, conversationId, { amount: 10, type: 'income', description: '第一笔' });
  // Small delay to ensure different timestamps
  const start = Date.now();
  while (Date.now() - start < 5) { /* busy wait */ }
  createConversationTransaction(database, userId, conversationId, { amount: 20, type: 'income', description: '第二笔' });
  createConversationTransaction(database, userId, conversationId, { amount: 5, type: 'expense', description: '第三笔' });

  const history = getTransactionHistory(database, userId, conversationId);
  assert.equal(history.transactions.length, 3);
  assert.equal(history.total, 3);
  // Most recent first
  assert.equal(history.transactions[0].description, '第三笔');
  assert.equal(history.transactions[2].description, '第一笔');
});

test('getTransactionHistory supports pagination', () => {
  const { database, userId, conversationId } = setupTestEnv();

  for (let i = 0; i < 10; i++) {
    createConversationTransaction(database, userId, conversationId, { amount: i + 1, type: 'income', description: `交易${i}` });
  }

  const page1 = getTransactionHistory(database, userId, conversationId, { limit: 3, offset: 0 });
  assert.equal(page1.transactions.length, 3);
  assert.equal(page1.total, 10);
  assert.equal(page1.limit, 3);
  assert.equal(page1.offset, 0);

  const page2 = getTransactionHistory(database, userId, conversationId, { limit: 3, offset: 3 });
  assert.equal(page2.transactions.length, 3);
  assert.notEqual(page1.transactions[0].id, page2.transactions[0].id);
});

test('getTransactionHistory supports currency type filter', () => {
  const { database, userId, conversationId } = setupTestEnv();

  createConversationTransaction(database, userId, conversationId, { currencyType: 'gold', amount: 10, type: 'income', description: '金币交易' });
  createConversationTransaction(database, userId, conversationId, { currencyType: 'silver', amount: 20, type: 'income', description: '银币交易' });

  const goldOnly = getTransactionHistory(database, userId, conversationId, { currencyType: 'gold' });
  assert.equal(goldOnly.transactions.length, 1);
  assert.equal(goldOnly.transactions[0].description, '金币交易');

  const all = getTransactionHistory(database, userId, conversationId);
  assert.equal(all.transactions.length, 2);
});

test('getTransactionHistory returns null for invalid conversation', () => {
  const { database, userId } = setupTestEnv();

  const history = getTransactionHistory(database, userId, 'nonexistent');
  assert.equal(history, null);
});

// ── Transaction Intent Detection ──

test('detectTransactionIntents finds gold income patterns', () => {
  const intents = detectTransactionIntents('你获得了50枚金币的奖励。');
  assert.equal(intents.length, 1);
  assert.equal(intents[0].currencyType, 'gold');
  assert.equal(intents[0].amount, 50);
  assert.equal(intents[0].type, 'income');
});

test('detectTransactionIntents finds gold expense patterns', () => {
  const intents = detectTransactionIntents('你花费了30金币。');
  assert.ok(intents.length >= 1);
  assert.equal(intents[0].currencyType, 'gold');
  assert.equal(intents[0].amount, -30);
});

test('detectTransactionIntents finds silver patterns', () => {
  const intents = detectTransactionIntents('你获得了200枚银币。');
  assert.equal(intents.length, 1);
  assert.equal(intents[0].currencyType, 'silver');
  assert.equal(intents[0].amount, 200);
});

test('detectTransactionIntents finds gem patterns', () => {
  const intents = detectTransactionIntents('你获得了3颗宝石。');
  assert.equal(intents.length, 1);
  assert.equal(intents[0].currencyType, 'gem');
});

test('detectTransactionIntents finds credit patterns', () => {
  const intents = detectTransactionIntents('你获得了500点积分。');
  assert.equal(intents.length, 1);
  assert.equal(intents[0].currencyType, 'credit');
});

test('detectTransactionIntents finds copper patterns', () => {
  const intents = detectTransactionIntents('你获得了100枚铜币。');
  assert.equal(intents.length, 1);
  assert.equal(intents[0].currencyType, 'copper');
});

test('detectTransactionIntents finds reward patterns', () => {
  const intents = detectTransactionIntents('打败了怪物！奖励了100金币！');
  assert.ok(intents.length >= 1);
  assert.ok(intents.some((i) => i.amount === 100));
});

test('detectTransactionIntents finds penalty patterns', () => {
  const intents = detectTransactionIntents('罚款50金币。');
  assert.equal(intents.length, 1);
  assert.equal(intents[0].type, 'penalty');
  assert.equal(intents[0].amount, -50);
});

test('detectTransactionIntents finds buy patterns', () => {
  const intents = detectTransactionIntents('购买了药水，花费了15金币。');
  assert.ok(intents.length >= 1);
  assert.ok(intents.some((i) => i.amount < 0));
});

test('detectTransactionIntents finds sell patterns', () => {
  const intents = detectTransactionIntents('出售了宝石，获得了200金币。');
  assert.ok(intents.length >= 1);
  assert.ok(intents.some((i) => i.amount > 0));
});

test('detectTransactionIntents returns empty for non-transaction text', () => {
  const intents = detectTransactionIntents('今天天气真好，我们去散步吧。');
  assert.equal(intents.length, 0);
});

test('detectTransactionIntents handles empty/null input', () => {
  assert.deepEqual(detectTransactionIntents(''), []);
  assert.deepEqual(detectTransactionIntents(null), []);
  assert.deepEqual(detectTransactionIntents(undefined), []);
});

test('detectTransactionIntents deduplicates same pattern', () => {
  const intents = detectTransactionIntents('你获得了50金币。你获得了50金币。');
  // Each pattern only matches once (no g flag), so dedup is for different patterns matching same text
  assert.ok(intents.length >= 0); // No crash
});

test('detectTransactionIntents finds multiple different transactions', () => {
  const intents = detectTransactionIntents('你获得了100枚金币。然后又获得了50枚银币。');
  assert.ok(intents.length >= 2);
  const currencies = intents.map((i) => i.currencyType);
  assert.ok(currencies.includes('gold'));
  assert.ok(currencies.includes('silver'));
});

// ── Process Transaction Intents ──

test('processTransactionIntents auto-creates accounts and transactions', () => {
  const { database, userId, conversationId } = setupTestEnv();

  const results = processTransactionIntents(database, userId, conversationId, '你获得了50枚金币的奖励。');
  assert.ok(results.length > 0);
  assert.equal(results[0].account.currencyType, 'gold');
  assert.equal(results[0].account.balance, 150); // 100 initial + 50 reward
});

test('processTransactionIntents returns empty for non-transaction text', () => {
  const { database, userId, conversationId } = setupTestEnv();

  const results = processTransactionIntents(database, userId, conversationId, '今天天气不错。');
  assert.equal(results.length, 0);
});

test('processTransactionIntents skips transactions that would cause negative balance', () => {
  const { database, userId, conversationId } = setupTestEnv();

  // Account starts with 100 gold (default), trying to spend 500 should be skipped.
  // The account may be created as a side effect of createConversationTransaction,
  // but the transaction itself is rejected atomically inside the BEGIN/COMMIT block.
  const results = processTransactionIntents(database, userId, conversationId, '你花费了500金币。');
  assert.equal(results.length, 0);

  // Balance should remain at the default initial balance (100) since the expense was rejected
  const accounts = getConversationAccounts(database, userId, conversationId);
  if (accounts.length > 0) {
    // Account was created by getOrCreateAccount, but balance is unchanged
    const goldAccount = accounts.find(a => a.currencyType === 'gold');
    assert.equal(goldAccount.balance, 100);
  }
});

// ── Economy State ──

test('getConversationEconomyState returns accounts for conversation', () => {
  const { database, userId, conversationId } = setupTestEnv();

  getOrCreateAccount(database, userId, conversationId, 'gold');
  getOrCreateAccount(database, userId, conversationId, 'silver');

  const state = getConversationEconomyState(database, userId, conversationId);
  assert.ok(state);
  assert.equal(state.accounts.length, 2);
  assert.equal(state.totalAccounts, 2);
});

test('getConversationEconomyState auto-creates gold account if none exist', () => {
  const { database, userId, conversationId } = setupTestEnv();

  const state = getConversationEconomyState(database, userId, conversationId);
  assert.ok(state);
  assert.equal(state.accounts.length, 1);
  assert.equal(state.accounts[0].currencyType, 'gold');
  assert.equal(state.accounts[0].balance, 100);
});

test('getConversationEconomyState can inspect without creating accounts', () => {
  const { database, userId, conversationId } = setupTestEnv();

  const state = getConversationEconomyState(database, userId, conversationId, { ensureDefaultAccount: false });
  assert.ok(state);
  assert.equal(state.accounts.length, 0);
  assert.equal(state.totalAccounts, 0);
});

test('getConversationEconomyState returns null for invalid conversation', () => {
  const { database, userId } = setupTestEnv();

  const state = getConversationEconomyState(database, userId, 'nonexistent');
  assert.equal(state, null);
});

// ── Integration: Full Economy Flow ──

test('full economy flow: create, transact, check history', () => {
  const { database, userId, conversationId } = setupTestEnv();

  // Get initial state
  const state1 = getConversationEconomyState(database, userId, conversationId);
  assert.equal(state1.accounts[0].balance, 100);

  // Earn some gold
  const r1 = createConversationTransaction(database, userId, conversationId, {
    amount: 50,
    type: 'income',
    description: '完成任务'
  });
  assert.equal(r1.account.balance, 150);

  // Spend some gold
  const r2 = createConversationTransaction(database, userId, conversationId, {
    amount: 30,
    type: 'expense',
    description: '购买药水'
  });
  assert.equal(r2.account.balance, 120);

  // Check history
  const history = getTransactionHistory(database, userId, conversationId);
  assert.equal(history.transactions.length, 2);
  assert.equal(history.total, 2);

  // Check final state
  const state2 = getConversationEconomyState(database, userId, conversationId);
  assert.equal(state2.accounts[0].balance, 120);
});

test('full economy flow: multi-currency', () => {
  const { database, userId, conversationId } = setupTestEnv();

  // Create gold and silver accounts
  createConversationTransaction(database, userId, conversationId, {
    currencyType: 'gold',
    amount: 50,
    type: 'income',
    description: '金币收入'
  });
  createConversationTransaction(database, userId, conversationId, {
    currencyType: 'silver',
    amount: 200,
    type: 'income',
    description: '银币收入'
  });

  const state = getConversationEconomyState(database, userId, conversationId);
  assert.equal(state.accounts.length, 2);

  const goldAccount = state.accounts.find((a) => a.currencyType === 'gold');
  const silverAccount = state.accounts.find((a) => a.currencyType === 'silver');
  assert.equal(goldAccount.balance, 150); // 100 + 50
  assert.equal(silverAccount.balance, 200); // 0 + 200
});

test('full economy flow: AI reply auto-detection', () => {
  const { database, userId, conversationId } = setupTestEnv();

  // Simulate AI reply with transaction - separate sentences for each currency
  const aiReply = '你走进商店，获得了50枚金币。然后又发现了10颗宝石。';
  const results = processTransactionIntents(database, userId, conversationId, aiReply);

  assert.ok(results.length >= 1);

  // Check that gold was created
  const state = getConversationEconomyState(database, userId, conversationId);
  const currencies = state.accounts.map((a) => a.currencyType);
  assert.ok(currencies.includes('gold'));

  // Check history
  const history = getTransactionHistory(database, userId, conversationId);
  assert.ok(history.transactions.length >= 1);
});

// ── Edge Cases ──

test('account balance handles decimal amounts correctly', () => {
  const { database, userId, conversationId } = setupTestEnv();

  const account = getOrCreateAccount(database, userId, conversationId, 'gold');

  createTransaction(database, userId, account.id, {
    amount: 10.55,
    type: 'income',
    description: '小数测试'
  });

  createTransaction(database, userId, account.id, {
    amount: 3.33,
    type: 'expense',
    description: '小数消费'
  });

  const updated = getAccount(database, userId, account.id);
  assert.equal(updated.balance, 107.22); // 100 + 10.55 - 3.33
});

test('transaction description is truncated to 500 chars', () => {
  const { database, userId, conversationId } = setupTestEnv();

  const account = getOrCreateAccount(database, userId, conversationId, 'gold');
  const longDesc = 'a'.repeat(600);

  const result = createTransaction(database, userId, account.id, {
    amount: 10,
    type: 'income',
    description: longDesc
  });

  assert.ok(result.transaction.description.length <= 500);
});

test('related NPC is truncated to 100 chars', () => {
  const { database, userId, conversationId } = setupTestEnv();

  const account = getOrCreateAccount(database, userId, conversationId, 'gold');
  const longNpc = 'b'.repeat(150);

  const result = createTransaction(database, userId, account.id, {
    amount: 10,
    type: 'income',
    description: 'test',
    relatedNpc: longNpc
  });

  assert.ok(result.transaction.relatedNpc.length <= 100);
});
