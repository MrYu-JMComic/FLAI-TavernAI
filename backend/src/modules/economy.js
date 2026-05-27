import { newId, nowIso } from '../security.js';

// ── Default currency types ──

export const CURRENCY_TYPES = ['gold', 'silver', 'copper', 'gem', 'credit'];

export const DEFAULT_INITIAL_BALANCE = {
  gold: 100,
  silver: 0,
  copper: 0,
  gem: 0,
  credit: 0
};

// ── Account CRUD ──

/**
 * Get or create an economy account for a conversation + currency type.
 */
export function getOrCreateAccount(database, userId, conversationId, currencyType = 'gold') {
  const normalizedCurrency = normalizeCurrencyType(currencyType);

  // Verify conversation belongs to user
  const conversation = database
    .prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?')
    .get(conversationId, userId);
  if (!conversation) {
    return null;
  }

  const existing = database
    .prepare(
      `SELECT * FROM economy_accounts
       WHERE conversation_id = ? AND currency_type = ?`
    )
    .get(conversationId, normalizedCurrency);

  if (existing) {
    return toAccount(existing);
  }

  const id = newId();
  const timestamp = nowIso();
  const initialBalance = DEFAULT_INITIAL_BALANCE[normalizedCurrency] ?? 0;

  database
    .prepare(
      `INSERT INTO economy_accounts (id, user_id, conversation_id, currency_type, balance, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, userId, conversationId, normalizedCurrency, initialBalance, timestamp, timestamp);

  return toAccount(database.prepare('SELECT * FROM economy_accounts WHERE id = ?').get(id));
}

/**
 * Get all economy accounts for a conversation.
 */
export function getConversationAccounts(database, userId, conversationId) {
  // Verify conversation belongs to user
  const conversation = database
    .prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?')
    .get(conversationId, userId);
  if (!conversation) {
    return null;
  }

  const rows = database
    .prepare(
      `SELECT * FROM economy_accounts
       WHERE conversation_id = ?
       ORDER BY currency_type ASC`
    )
    .all(conversationId);

  return rows.map(toAccount);
}

/**
 * Get a single account by ID, verifying ownership.
 */
export function getAccount(database, userId, accountId) {
  const row = database
    .prepare(
      `SELECT economy_accounts.*
       FROM economy_accounts
       JOIN conversations ON conversations.id = economy_accounts.conversation_id
       WHERE economy_accounts.id = ? AND conversations.user_id = ?`
    )
    .get(accountId, userId);
  return row ? toAccount(row) : null;
}

// ── Transactions ──

/**
 * Create a transaction and update the account balance.
 * @param {'income'|'expense'|'transfer'|'reward'|'penalty'|'trade'} type
 */
export function createTransaction(database, userId, accountId, payload) {
  const account = getAccount(database, userId, accountId);
  if (!account) {
    return null;
  }

  const amount = normalizeAmount(payload.amount);
  const type = normalizeTransactionType(payload.type);
  const description = normalizeDescription(payload.description);
  const relatedNpc = normalizeRelatedNpc(payload.relatedNpc || payload.related_npc);

  if (amount === 0) {
    throw new Error('交易金额不能为 0');
  }

  // Normalize sign: debit types should have negative amounts
  const isDebit = ['expense', 'transfer', 'penalty', 'trade'].includes(type);
  const signedAmount = isDebit ? -Math.abs(amount) : Math.abs(amount);

  // Check for sufficient balance on debits
  if (isDebit && account.balance + signedAmount < 0) {
    throw new Error(`余额不足：当前 ${account.balance}，需要 ${Math.abs(signedAmount)}`);
  }

  const transactionId = newId();
  const timestamp = nowIso();

  database
    .prepare(
      `INSERT INTO economy_transactions (id, account_id, amount, type, description, related_npc, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(transactionId, accountId, signedAmount, type, description, relatedNpc, timestamp);

  // Update account balance
  const newBalance = account.balance + signedAmount;
  database
    .prepare('UPDATE economy_accounts SET balance = ?, updated_at = ? WHERE id = ?')
    .run(newBalance, timestamp, accountId);

  return {
    transaction: toTransaction(
      database.prepare('SELECT * FROM economy_transactions WHERE id = ?').get(transactionId)
    ),
    account: toAccount(database.prepare('SELECT * FROM economy_accounts WHERE id = ?').get(accountId))
  };
}

/**
 * Create a transaction for a conversation (convenience: finds/creates account first).
 */
export function createConversationTransaction(database, userId, conversationId, payload) {
  const currencyType = payload.currencyType || payload.currency_type || 'gold';
  const account = getOrCreateAccount(database, userId, conversationId, currencyType);
  if (!account) {
    return null;
  }

  return createTransaction(database, userId, account.id, payload);
}

/**
 * Get transaction history for a conversation.
 */
export function getTransactionHistory(database, userId, conversationId, options = {}) {
  // Verify conversation belongs to user
  const conversation = database
    .prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?')
    .get(conversationId, userId);
  if (!conversation) {
    return null;
  }

  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200);
  const offset = Math.max(Number(options.offset) || 0, 0);
  const currencyType = options.currencyType || options.currency_type || null;

  let whereClause = 'WHERE economy_accounts.conversation_id = ?';
  const params = [conversationId];

  if (currencyType) {
    whereClause += ' AND economy_accounts.currency_type = ?';
    params.push(normalizeCurrencyType(currencyType));
  }

  const rows = database
    .prepare(
      `SELECT economy_transactions.*, economy_accounts.currency_type
       FROM economy_transactions
       JOIN economy_accounts ON economy_accounts.id = economy_transactions.account_id
       ${whereClause}
       ORDER BY economy_transactions.created_at DESC, economy_transactions.rowid DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  const countRow = database
    .prepare(
      `SELECT COUNT(*) AS total
       FROM economy_transactions
       JOIN economy_accounts ON economy_accounts.id = economy_transactions.account_id
       ${whereClause}`
    )
    .get(...params);

  return {
    transactions: rows.map(toTransaction),
    total: countRow?.total || 0,
    limit,
    offset
  };
}

// ── Transaction Intent Detection ──

const TRANSACTION_PATTERNS = [
  // Gold patterns
  { regex: /(?:收到|获得|赚了?|得到|入账|奖励了?)\s*了?\s*(\d+)\s*(?:枚?金币|gold)/i, type: 'income', currency: 'gold', sign: 1 },
  { regex: /(?:花费了?|支出|消费|花了|扣了|失去|损失|支付了?)\s*了?\s*(\d+)\s*(?:枚?金币|gold)/i, type: 'expense', currency: 'gold', sign: -1 },
  { regex: /金币\s*[：:]\s*[+＋]?\s*(\d+)/i, type: 'income', currency: 'gold', sign: 1 },
  { regex: /金币\s*[：:]\s*[-－]\s*(\d+)/i, type: 'expense', currency: 'gold', sign: -1 },
  { regex: /(\d+)\s*(?:枚?金币|gold)\s*(?:到账|入账|到手)/i, type: 'income', currency: 'gold', sign: 1 },

  // Silver patterns
  { regex: /(?:收到|获得|赚了?|得到|入账|奖励了?)\s*了?\s*(\d+)\s*(?:枚?银币|silver)/i, type: 'income', currency: 'silver', sign: 1 },
  { regex: /(?:花费了?|支出|消费|花了|扣了|失去|损失|支付了?)\s*了?\s*(\d+)\s*(?:枚?银币|silver)/i, type: 'expense', currency: 'silver', sign: -1 },
  { regex: /银币\s*[：:]\s*[+＋]?\s*(\d+)/i, type: 'income', currency: 'silver', sign: 1 },
  { regex: /银币\s*[：:]\s*[-－]\s*(\d+)/i, type: 'expense', currency: 'silver', sign: -1 },

  // Gem patterns
  { regex: /(?:收到|获得|赚了?|得到|入账|奖励了?)\s*了?\s*(\d+)\s*(?:颗?宝石|gem)/i, type: 'income', currency: 'gem', sign: 1 },
  { regex: /(?:花费了?|支出|消费|花了|扣了|失去|损失|支付了?)\s*了?\s*(\d+)\s*(?:颗?宝石|gem)/i, type: 'expense', currency: 'gem', sign: -1 },

  // Credit patterns
  { regex: /(?:收到|获得|赚了?|得到|入账|奖励了?)\s*了?\s*(\d+)\s*(?:点?积分|credit)/i, type: 'income', currency: 'credit', sign: 1 },
  { regex: /(?:花费了?|支出|消费|花了|扣了|失去|损失|支付了?)\s*了?\s*(\d+)\s*(?:点?积分|credit)/i, type: 'expense', currency: 'credit', sign: -1 },

  // Copper patterns
  { regex: /(?:收到|获得|赚了?|得到|入账|奖励了?)\s*了?\s*(\d+)\s*(?:枚?铜币|copper)/i, type: 'income', currency: 'copper', sign: 1 },
  { regex: /(?:花费了?|支出|消费|花了|扣了|失去|损失|支付了?)\s*了?\s*(\d+)\s*(?:枚?铜币|copper)/i, type: 'expense', currency: 'copper', sign: -1 },

  // Buy/Sell patterns (Chinese)
  { regex: /(?:购买了?|买入了?|买下了?)\s*[^，。]*?(?:花费了?|支付了?|消费了?)\s*(\d+)\s*(?:枚?金币)?/i, type: 'expense', currency: 'gold', sign: -1 },
  { regex: /(?:出售了?|卖出|卖了)\s*[^，。]*?(?:获得|赚了?|得到|收入)\s*了?\s*(\d+)\s*(?:枚?金币)?/i, type: 'income', currency: 'gold', sign: 1 },

  // Reward/Penalty patterns
  { regex: /(?:奖励了?|赏赐了?|打赏了?)\s*(\d+)\s*(?:枚?金币|金币)/i, type: 'reward', currency: 'gold', sign: 1 },
  { regex: /(?:罚款了?|扣罚了?|惩罚了?)\s*(\d+)\s*(?:枚?金币|金币)/i, type: 'penalty', currency: 'gold', sign: -1 },

  // Generic gold amount in context of transaction
  { regex: /(\d+)\s*(?:枚)?金币\s*(?:的?)?(?:奖励|赏金|报酬|佣金)/i, type: 'reward', currency: 'gold', sign: 1 },
];

/**
 * Detect transaction intents from AI-generated text.
 * Returns an array of detected transactions (not yet committed).
 */
export function detectTransactionIntents(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const intents = [];
  const seen = new Set();

  for (const pattern of TRANSACTION_PATTERNS) {
    const match = pattern.regex.exec(text);
    if (match) {
      const amount = parseInt(match[1], 10);
      if (Number.isNaN(amount) || amount <= 0) {
        continue;
      }

      const key = `${pattern.currency}:${pattern.sign}:${amount}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      intents.push({
        currencyType: pattern.currency,
        type: pattern.type,
        amount: amount * pattern.sign,
        matchedText: match[0]
      });
    }
  }

  return intents;
}

/**
 * Process detected transaction intents from an AI reply.
 * Automatically creates accounts and transactions.
 * Returns the list of created transactions.
 */
export function processTransactionIntents(database, userId, conversationId, text) {
  const intents = detectTransactionIntents(text);
  if (intents.length === 0) {
    return [];
  }

  const results = [];
  for (const intent of intents) {
    try {
      if (intent.amount < 0) {
        const existingAccount = database
          .prepare('SELECT balance FROM economy_accounts WHERE conversation_id = ? AND currency_type = ?')
          .get(conversationId, intent.currencyType);
        const available = existingAccount?.balance ?? (DEFAULT_INITIAL_BALANCE[intent.currencyType] ?? 0);
        if (available + intent.amount < 0) {
          continue;
        }
      }
      const result = createConversationTransaction(database, userId, conversationId, {
        currencyType: intent.currencyType,
        amount: intent.amount,
        type: intent.type,
        description: `自动检测: ${intent.matchedText}`
      });
      if (result) {
        results.push(result);
      }
    } catch {
      // Skip transactions that fail (e.g., insufficient balance)
    }
  }

  return results;
}

// ── Economy State Summary ──

/**
 * Get the full economy state for a conversation.
 */
export function getConversationEconomyState(database, userId, conversationId, options = {}) {
  const accounts = getConversationAccounts(database, userId, conversationId);
  if (accounts === null) {
    return null;
  }

  const ensureDefaultAccount = options.ensureDefaultAccount !== false;
  if (ensureDefaultAccount && accounts.length === 0) {
    const goldAccount = getOrCreateAccount(database, userId, conversationId, 'gold');
    if (goldAccount) {
      return {
        accounts: [goldAccount],
        totalAccounts: 1
      };
    }
  }

  return {
    accounts,
    totalAccounts: accounts.length
  };
}

// ── Helpers ──

function normalizeCurrencyType(value) {
  const normalized = String(value || 'gold').trim().toLowerCase();
  return CURRENCY_TYPES.includes(normalized) ? normalized : 'gold';
}

function normalizeAmount(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error('金额必须是有效数字');
  }
  return Math.round(Math.abs(num) * 100) / 100; // Always positive, sign handled by caller
}

function normalizeTransactionType(value) {
  const valid = ['income', 'expense', 'transfer', 'reward', 'penalty', 'trade'];
  const normalized = String(value || 'income').trim().toLowerCase();
  return valid.includes(normalized) ? normalized : 'income';
}

function normalizeDescription(value) {
  const str = String(value || '').trim();
  return str.length > 500 ? str.slice(0, 500) : str;
}

function normalizeRelatedNpc(value) {
  const str = String(value || '').trim();
  return str.length > 100 ? str.slice(0, 100) : str;
}

function toAccount(row) {
  return {
    id: row.id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    currencyType: row.currency_type,
    balance: row.balance,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toTransaction(row) {
  return {
    id: row.id,
    accountId: row.account_id,
    amount: row.amount,
    type: row.type,
    description: row.description,
    relatedNpc: row.related_npc || '',
    currencyType: row.currency_type || undefined,
    createdAt: row.created_at
  };
}
