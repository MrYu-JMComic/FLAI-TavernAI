# Database Performance And Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split database initialization into maintainable units and add query-path indexes plus SQL-side ordering for real backend database hot paths.

**Architecture:** Keep `backend/src/db.js` as the public compatibility entry point. Move runtime setup, schema creation, repeatable indexes, and startup migrations into focused files under `backend/src/db/`. Add tests that assert the index contract and regex ordering behavior on an in-memory SQLite database.

**Tech Stack:** Node 24, `node:sqlite` `DatabaseSync`, Express backend modules, `node:test`, PowerShell review gate.

---

## File Structure

- Modify: `backend/src/db.js`
  - Re-export the stable database API and create the process-wide `db`.
- Create: `backend/src/db/runtime.js`
  - Own backend paths, storage directory creation, PRAGMAs, `createAppDatabase`.
- Create: `backend/src/db/schema.js`
  - Own table creation, column cache helpers, `ensureColumn`, and `initializeDatabase`.
- Create: `backend/src/db/indexes.js`
  - Own all repeatable `CREATE INDEX IF NOT EXISTS` statements, including new composite indexes.
- Create: `backend/src/db/migrations.js`
  - Own legacy startup migrations: regex foreign-key removal and tag/user-scope normalization.
- Create: `backend/src/tests/database-structure.test.js`
  - Assert public exports, representative tables/columns, and required index definitions.
- Modify: `backend/src/modules/characters.js`
  - Push regex rule ordering into SQL for `getRegexRules` and `getRegexRulesByGroup`.
- Modify: `automation/reports/2026-06-30-database-performance-structure.md`
  - Record changed files, validation commands, and measured/observed effects.

## Task 1: Add Database Structure Tests

**Files:**
- Create: `backend/src/tests/database-structure.test.js`

- [ ] **Step 1: Write failing index and export tests**

Create `backend/src/tests/database-structure.test.js` with:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

const dbModule = await import('../db.js');
const { createAppDatabase, initializeDatabase } = dbModule;

function indexColumns(database, indexName) {
  return database
    .prepare(`PRAGMA index_info(${indexName})`)
    .all()
    .map((row) => row.name);
}

function indexSql(database, indexName) {
  return database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(indexName)?.sql || '';
}

test('database module preserves public exports after structure split', () => {
  assert.equal(typeof dbModule.backendRoot, 'string');
  assert.equal(typeof dbModule.dataDir, 'string');
  assert.equal(typeof dbModule.avatarUploadDir, 'string');
  assert.equal(typeof dbModule.ensureStorageDirs, 'function');
  assert.equal(typeof createAppDatabase, 'function');
  assert.equal(typeof initializeDatabase, 'function');
  assert.ok(dbModule.db);
});

test('database initialization creates expected high-value composite indexes', () => {
  const database = createAppDatabase(':memory:');
  try {
    const expected = {
      idx_messages_user_conversation_created: ['user_id', 'conversation_id', 'created_at'],
      idx_messages_conversation_created: ['conversation_id', 'created_at'],
      idx_message_swipes_message_user_created: ['message_id', 'user_id', 'created_at'],
      idx_conversations_user_updated: ['user_id', 'updated_at'],
      idx_conversations_branch_user_created: ['branched_from_id', 'user_id', 'created_at'],
      idx_characters_user_created: ['user_id', 'created_at'],
      idx_characters_user_last_used: ['user_id', 'last_used_at', 'created_at'],
      idx_characters_visibility_created: ['visibility', 'created_at'],
      idx_regex_user_character_order: ['user_id', 'character_id', 'priority', 'order_index'],
      idx_regex_user_group_order: ['user_id', 'group_name', 'priority', 'order_index'],
      idx_world_books_user_updated: ['user_id', 'updated_at'],
      idx_world_book_entries_book_order: ['world_book_id', 'order_index'],
      idx_cwb_character_order: ['character_id', 'order_index', 'created_at'],
      idx_saves_user_conversation_created: ['user_id', 'conversation_id', 'created_at'],
      idx_presets_user_default_updated: ['user_id', 'is_default', 'updated_at'],
      idx_mods_user_order: ['user_id', 'order_index', 'created_at'],
      idx_npc_memories_conversation_npc_created: ['conversation_id', 'npc_name', 'created_at'],
      idx_npc_behaviors_conversation_npc_priority: ['conversation_id', 'npc_name', 'priority', 'created_at'],
      idx_economy_transactions_account_created: ['account_id', 'created_at'],
      idx_character_images_character_order: ['character_id', 'order_index', 'created_at'],
      idx_character_talents_character_rolled: ['character_id', 'rolled_at']
    };

    for (const [indexName, columns] of Object.entries(expected)) {
      assert.deepEqual(indexColumns(database, indexName), columns, indexName);
    }
  } finally {
    database.close();
  }
});

test('database high-value indexes are idempotent when initializeDatabase runs twice', () => {
  const database = createAppDatabase(':memory:');
  try {
    initializeDatabase(database);
    assert.match(indexSql(database, 'idx_messages_user_conversation_created'), /CREATE INDEX IF NOT EXISTS/);
    assert.deepEqual(
      indexColumns(database, 'idx_regex_user_character_order'),
      ['user_id', 'character_id', 'priority', 'order_index']
    );
  } finally {
    database.close();
  }
});
```

- [ ] **Step 2: Run the new tests to verify failure before implementation**

Run: `node --test src/tests/database-structure.test.js` from `backend`.

Expected before implementation: FAIL because `database-structure.test.js` does not exist yet or at least one `idx_*` assertion is missing.

## Task 2: Split Runtime And Schema Modules

**Files:**
- Modify: `backend/src/db.js`
- Create: `backend/src/db/runtime.js`
- Create: `backend/src/db/schema.js`
- Create: `backend/src/db/indexes.js`
- Create: `backend/src/db/migrations.js`

- [ ] **Step 1: Create `runtime.js`**

Move path constants, `ensureStorageDirs`, `createAppDatabase`, PRAGMAs, column-cache reset call, and world-book message-counter reset into `backend/src/db/runtime.js`. Keep this public surface:

```js
export const backendRoot = path.resolve(sourceDir, '..', '..');
export const dataDir = path.join(backendRoot, 'data');
export const avatarUploadDir = path.join(uploadsDir, 'avatars');
export function ensureStorageDirs() {}
export function createAppDatabase(filename = path.join(dataDir, 'flai.sqlite')) {}
```

- [ ] **Step 2: Create `schema.js`**

Move `initializeDatabase`, the column cache, `getCachedTableColumns`, and `ensureColumn` into `backend/src/db/schema.js`. Export:

```js
export function resetColumnCache() {}
export function getCachedTableColumns(database, tableName) {}
export function ensureColumn(database, tableName, columnName, definition) {}
export function initializeDatabase(database) {}
```

Inside `initializeDatabase`, call `createDatabaseIndexes(database)` after table creation, column ensures, and migrations.

- [ ] **Step 3: Create `indexes.js`**

Move existing inline `CREATE INDEX IF NOT EXISTS` statements into `createDatabaseIndexes(database)`, then add the composite indexes from Task 1. Keep simple indexes when they are still useful for single-column lookups.

- [ ] **Step 4: Create `migrations.js`**

Move the `_schema_meta` helpers, regex foreign-key removal migration, `migrateTagsToUserScoped`, and `normalizeUnsafeTagIds` into `backend/src/db/migrations.js`. Export:

```js
export function applyStartupMigrations(database, helpers) {}
```

Use `helpers.getCachedTableColumns` for tag schema inspection.

- [ ] **Step 5: Replace `db.js` with a compatibility entry point**

Make `backend/src/db.js` thin:

```js
import path from 'node:path';
import { createAppDatabase, dataDir } from './db/runtime.js';

export {
  avatarUploadDir,
  backendRoot,
  createAppDatabase,
  dataDir,
  ensureStorageDirs
} from './db/runtime.js';
export { initializeDatabase } from './db/schema.js';

export const db = createAppDatabase(process.env.FLAI_DB_PATH || path.join(dataDir, 'flai.sqlite'));
```

- [ ] **Step 6: Run structure tests**

Run: `node --test src/tests/database-structure.test.js` from `backend`.

Expected after implementation: PASS.

## Task 3: Push Regex Ordering Into SQL

**Files:**
- Modify: `backend/src/modules/characters.js`
- Existing tests: `backend/src/tests/backend.test.js`

- [ ] **Step 1: Change `getRegexRules` SQL**

Replace the current `getRegexRules` query and JS `.sort(...)` with SQL ordering:

```js
return database
  .prepare(
    `SELECT *, rowid AS _rowid FROM regex_rules
     WHERE user_id = ? AND character_id = ?
     ORDER BY priority ASC, order_index ASC, rowid ASC`
  )
  .all(userId, characterId)
  .map((row) => ({
    id: row.id,
    label: row.label,
    pattern: row.pattern,
    replacement: row.replacement,
    flags: row.flags,
    scope: row.scope,
    enabled: Boolean(row.enabled),
    order: row.order_index,
    groupName: row.group_name || 'default',
    priority: row.priority ?? 0,
    scriptMode: Boolean(row.script_mode),
    jsScript: row.js_script || ''
  }));
```

Keep the existing localized default group string from the file rather than replacing it with `default`.

- [ ] **Step 2: Change `getRegexRulesByGroup` SQL**

Keep the dynamic group filter, then append:

```js
sql += ' ORDER BY priority ASC, order_index ASC, rowid ASC';
```

Remove the JS `.sort(...)` call from this helper.

- [ ] **Step 3: Run existing regex tests**

Run: `node --test src/tests/backend.test.js --test-name-pattern "regex"` from `backend`.

Expected: PASS, including insertion-order tie tests under `PRAGMA reverse_unordered_selects = ON`.

## Task 4: Validate Full Backend

**Files:**
- No additional source files.

- [ ] **Step 1: Run encoding check**

Run: `node scripts/check-encoding.mjs` from repo root.

Expected: PASS with no replacement-character or non-UTF-8 failures.

- [ ] **Step 2: Run backend tests**

Run: `npm test` from `backend`.

Expected: PASS.

- [ ] **Step 3: Run review gate**

Run: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` from repo root.

Expected: PASS or a reportable pre-existing unrelated failure. If it fails, inspect the exact failing command before deciding whether to fix or record.

## Task 5: Report Results

**Files:**
- Create: `automation/reports/2026-06-30-database-performance-structure.md`

- [ ] **Step 1: Write the iteration report**

The report must include:

```md
# Database Performance And Structure

Date: 2026-06-30

## Changed Files

- `backend/src/db.js`
- `backend/src/db/runtime.js`
- `backend/src/db/schema.js`
- `backend/src/db/indexes.js`
- `backend/src/db/migrations.js`
- `backend/src/modules/characters.js`
- `backend/src/tests/database-structure.test.js`
- `docs/superpowers/specs/2026-06-30-database-performance-structure-design.md`
- `docs/superpowers/plans/2026-06-30-database-performance-structure.md`

## What Changed

- Split database runtime, schema, indexes, and migrations into focused modules while preserving public exports.
- Added composite indexes aligned to observed backend query paths.
- Moved regex rule ordering from JavaScript sorting into SQL ordering.

## Validation

- `node scripts/check-encoding.mjs`: result
- `npm test` in `backend`: result
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`: result

## Notes

- Existing unrelated frontend working-tree changes were left untouched.
- No files under `backend/data` or `backend/uploads` were edited.

## Next Recommended Task

Measure `EXPLAIN QUERY PLAN` output for chat message list, world-book matching, and character search against seeded development-size data.
```

- [ ] **Step 2: Check git status**

Run: `git status --short` from repo root.

Expected: only database optimization files plus pre-existing unrelated frontend changes.

## Self Review

- The plan covers every acceptance criterion in the design spec.
- No placeholders remain.
- Paths and commands are concrete for this repository.
- The implementation plan avoids editing `backend/data`, `backend/uploads`, `.env`, `node_modules`, or generated output.
