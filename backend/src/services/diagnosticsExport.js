import { appConfig } from '../config.js';
import { normalizeProviderRow } from './providers.js';
import { sanitizeDiagnosticValue } from './diagnosticRedaction.js';
import { getSelectedProviderProfileRow } from '../repositories/providerProfileRepository.js';
import { countMemoryRecords } from '../repositories/memoryStorageRepository.js';
import { countOwnedWorldBookEntries } from '../repositories/worldBookRepository.js';

const diagnosticTables = [
  'characters',
  'conversations',
  'messages',
  'world_books',
  'world_book_entries',
  'conversation_memories',
  'assets',
  'presets',
  'mods',
  'regex_rules',
  'status_bars'
];

export function buildDiagnosticsExport(database, userId) {
  const providerRow = getSelectedProviderProfileRow(database, userId);
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    app: {
      serviceName: appConfig.serviceName,
      version: appConfig.version,
      logLevel: appConfig.logLevel,
      jsonBodyLimit: appConfig.jsonBodyLimit,
      allowPrivateNetworkOrigins: appConfig.allowPrivateNetworkOrigins
    },
    runtime: {
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch
    },
    provider: providerRow ? sanitizeDiagnosticValue(normalizeProviderRow(providerRow)) : null,
    counts: {
      ...readUserScopedCounts(database, userId),
      ...countMemoryRecords(database, userId),
    }
  };
}

function readUserScopedCounts(database, userId) {
  const counts = {};
  for (const tableName of diagnosticTables) {
    counts[tableName] = countRows(database, tableName, userId);
  }
  return counts;
}

function countRows(database, tableName, userId) {
  if (!tableExists(database, tableName)) {
    return 0;
  }
  if (tableHasColumn(database, tableName, 'user_id')) {
    return database.prepare(`SELECT COUNT(*) AS count FROM ${tableName} WHERE user_id = ?`).get(userId).count;
  }
  if (tableName === 'world_book_entries') {
    return countOwnedWorldBookEntries(database, userId);
  }
  // A missing owner column is never permission to expose another user's global totals.
  return 0;
}

function tableExists(database, tableName) {
  return Boolean(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function tableHasColumn(database, tableName, columnName) {
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all();
  for (const column of columns) {
    if (column.name === columnName) {
      return true;
    }
  }
  return false;
}
