// Boundary tests for the world book feature.
//
// These enforce the ownership rules in docs/architecture.md so the boundaries
// cannot silently erode:
//   - world book SQL only in repositories/ and db/
//   - a single business write entry point (services/worldBooks/worldBookService.js)
//   - routes only do auth, validation and responses
//   - the retired modules/worldBooks.js stays retired
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const backendSourceRoot = fileURLToPath(new URL('../', import.meta.url));

// All world book tables, fully converged onto worldBookRepository.js.
// `world_book_entry_state` is listed so any attempt to resurrect the retired
// process-global table is caught as an SQL-boundary violation.
const WORLD_BOOK_TABLES = [
  'world_books',
  'world_book_entries',
  'world_book_entry_state',
  'character_world_books',
  'conversation_world_book_state',
  'conversation_world_book_clock',
];

const routeSource = readFileSync(new URL('../routes/worldBooks.js', import.meta.url), 'utf8');
const serviceSource = readFileSync(new URL('../services/worldBooks/worldBookService.js', import.meta.url), 'utf8');
const runtimeSource = readFileSync(new URL('../services/worldBooks/worldBookRuntime.js', import.meta.url), 'utf8');
const previewSource = readFileSync(new URL('../services/worldBooks/worldBookMatchPreview.js', import.meta.url), 'utf8');
const matcherSource = readFileSync(new URL('../services/worldBooks/worldBookMatcher.js', import.meta.url), 'utf8');

test('runtime SQL access to world book tables stays inside repositories and database setup', () => {
  const sqlTablePattern = new RegExp(
    `\\b(?:FROM|JOIN|INTO|UPDATE|TABLE|REFERENCES)\\s+(?:IF\\s+(?:NOT\\s+)?EXISTS\\s+)?(?:${WORLD_BOOK_TABLES.join('|')})\\b`,
    'i'
  );
  const violations = [];

  for (const file of listJavaScriptFiles(backendSourceRoot)) {
    const relativePath = normalizePath(path.relative(backendSourceRoot, file));
    if (isSqlBoundaryFile(relativePath)) continue;
    const match = readFileSync(file, 'utf8').match(sqlTablePattern);
    if (match) violations.push(`${relativePath}: ${match[0]}`);
  }

  assert.deepEqual(violations, []);
});

test('the retired world book module has no callers and no file', () => {
  assert.equal(existsSync(path.join(backendSourceRoot, 'modules/worldBooks.js')), false);

  const violations = [];
  for (const file of listJavaScriptFiles(backendSourceRoot)) {
    const relativePath = normalizePath(path.relative(backendSourceRoot, file));
    if (relativePath === 'tests/worldBookArchitecture.test.js') continue;
    if (readFileSync(file, 'utf8').includes('modules/worldBooks.js')) {
      violations.push(relativePath);
    }
  }
  assert.deepEqual(violations, []);
});

test('world book routes only wire auth, validation and responses', () => {
  assert.doesNotMatch(routeSource, /database\.prepare\(|db\.prepare\(/);
  assert.match(routeSource, /from '\.\.\/services\/worldBooks\/worldBookService\.js'/);
  // Ownership and shape checks belong to the service, not the route.
  assert.doesNotMatch(routeSource, /FROM world_books|INSERT INTO world_books/i);
});

test('world book writes go through the service, never straight to the repository', () => {
  const violations = [];
  const writeFunctions = [
    'insertWorldBookRecord',
    'updateWorldBookRecord',
    'deleteWorldBookRecord',
    'insertWorldBookEntryRecord',
    'updateWorldBookEntryRecord',
    'deleteWorldBookEntryRecord',
    'upsertCharacterWorldBookLink',
    'deleteCharacterWorldBookLink',
  ];

  for (const file of listJavaScriptFiles(backendSourceRoot)) {
    const relativePath = normalizePath(path.relative(backendSourceRoot, file));
    if (relativePath.startsWith('repositories/')
      || relativePath.startsWith('tests/')
      || relativePath === 'services/worldBooks/worldBookService.js') continue;
    const source = readFileSync(file, 'utf8');
    for (const name of writeFunctions) {
      if (source.includes(name)) violations.push(`${relativePath}: ${name}`);
    }
  }

  assert.deepEqual(violations, []);
});

test('trigger rules live in the domain layer, not in the matcher or the preview', () => {
  for (const source of [matcherSource, previewSource]) {
    assert.match(source, /from '\.\.\/\.\.\/domain\/worldBooks\/entryRules\.js'/);
    // Key parsing and selective logic must not be reimplemented locally.
    assert.doesNotMatch(source, /function (?:parseStringModeRegexKey|forEachEntryKey|splitEntryKeys)\s*\(/);
    assert.doesNotMatch(source, /new RegExp\s*\(/);
  }
});

test('the service and runtime keep their own concerns', () => {
  // Authoring writes never advance conversation trigger state.
  assert.doesNotMatch(serviceSource, /persistWorldBookEntryStates|nextWorldBookMessageCount/);
  // Runtime activation never writes world book content.
  assert.doesNotMatch(runtimeSource, /insertWorldBookRecord|insertWorldBookEntryRecord|updateWorldBookRecord/);
  // Both resolve "which books feed this chat" through one helper.
  assert.match(runtimeSource, /export function collectChatWorldBookIds/);
  assert.match(previewSource, /collectChatWorldBookIds\(database, \{ characterId, conversationId, userId \}\)/);
});

test('the process-global trigger state table is gone from source and schema', () => {
  // `world_book_entry_state` keyed sticky/cooldown/delay by entry alone, so every
  // conversation sharing a world book shared one activation window. Dropped in 0020.
  // SQL use of the table name is covered by the boundary test above; what matters
  // here is that the code paths that reached it are gone.
  const stateServiceSource = readFileSync(new URL('../services/worldBooks/worldBookStateService.js', import.meta.url), 'utf8');
  assert.doesNotMatch(stateServiceSource, /legacyCounters|export function resetWorldBookMessageCounter/);
  assert.doesNotMatch(readFileSync(new URL('../db/schema.js', import.meta.url), 'utf8'), /world_book_entry_state/);
  // Trigger state can only be reached with a conversation.
  assert.match(stateServiceSource, /function requireConversationId/);
  assert.match(runtimeSource, /requires options\.conversationId/);
});

test('the legacy direct character column is only referenced by its migration', () => {
  // `world_books.character_id` was dropped in migration 0019; `characterId` is
  // now derived from the primary character_world_books link.
  const directColumnPattern = /\b(?:world_books|wb)\.character_id\b/;
  const violations = [];

  for (const file of listJavaScriptFiles(backendSourceRoot)) {
    const relativePath = normalizePath(path.relative(backendSourceRoot, file));
    if (relativePath.startsWith('db/migrations/') || relativePath.startsWith('tests/')) continue;
    if (directColumnPattern.test(readFileSync(file, 'utf8'))) violations.push(relativePath);
  }

  assert.deepEqual(violations, []);
  assert.doesNotMatch(
    readFileSync(new URL('../db/indexes.js', import.meta.url), 'utf8'),
    /idx_world_books_character\b/
  );
});

function listJavaScriptFiles(root, extensions = ['.js']) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJavaScriptFiles(target, extensions));
    } else if (extensions.includes(path.extname(entry.name))) {
      files.push(target);
    }
  }
  return files;
}

function isSqlBoundaryFile(relativePath) {
  return relativePath.startsWith('repositories/')
    || relativePath.startsWith('db/migrations/')
    || relativePath.startsWith('tests/')
    || relativePath === 'db/schema.js'
    || relativePath === 'db/indexes.js';
}

function normalizePath(value) {
  return value.replaceAll(path.sep, '/');
}
