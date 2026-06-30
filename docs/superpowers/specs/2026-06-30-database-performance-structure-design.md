# Database Performance And Structure Design

Date: 2026-06-30

## Goal

Improve the SQLite data layer based on real backend query paths, not speculative cleanup. The iteration should make common reads and writes faster or more predictable while splitting the database bootstrap code into clearer maintainable units.

## Scope

This iteration covers backend database code only:

- runtime database creation and PRAGMA setup,
- base table schema creation,
- repeatable index creation,
- startup migrations,
- high-frequency SQL paths in backend modules and routes,
- backend tests and automation reporting.

It does not edit `backend/data`, `backend/uploads`, environment files, generated build output, or frontend files already modified in the working tree.

## Performance Design

Add repeatable composite indexes that match existing `WHERE` and `ORDER BY` patterns. Target paths include:

- conversation lists and message reads by `user_id`, `conversation_id`, and chronological order,
- message swipe reads by `message_id`, `user_id`, and chronological order,
- character lists by owner/visibility plus created, used, and name sort orders,
- regex rules by user, character, group, priority, and order,
- world book lists, bound-book lookup, linked-character lookup, and entry ordering,
- save, preset, mod, NPC, economy, image, talent, and tag lookups that already filter by owner or parent id.

Where SQL currently fetches rows and then sorts them in JavaScript, push stable ordering into SQL when it matches the existing behavior. Keep response shapes unchanged.

Avoid broad data rewrites. Any schema work must be idempotent and safe to run on an empty in-memory test database and an existing development database.

## Structure Design

Refactor `backend/src/db.js` into a small public entry point backed by focused database modules:

- `backend/src/db/runtime.js`: storage directories, PRAGMAs, database creation, and cache reset.
- `backend/src/db/schema.js`: base `CREATE TABLE IF NOT EXISTS` statements and column helpers.
- `backend/src/db/indexes.js`: all repeatable `CREATE INDEX IF NOT EXISTS` statements.
- `backend/src/db/migrations.js`: startup migrations that reshape old schemas or normalize legacy rows.

The exported API should remain compatible:

- `backendRoot`
- `dataDir`
- `avatarUploadDir`
- `ensureStorageDirs`
- `createAppDatabase`
- `initializeDatabase`
- `db`

Existing imports should not need to change outside the database module tree unless tests expose an actual problem.

## Validation Design

Add backend tests that prove structure and performance intent:

1. Required composite indexes exist after `createAppDatabase(':memory:')`.
2. Regex rule list helpers return the same stable priority/order/rowid ordering from SQL.
3. Database exports remain compatible with existing callers.

Run:

- `node scripts/check-encoding.mjs`
- `npm test` in `backend`
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`

Write an automation report under `automation/reports` with changed files, validation output, and follow-up work.

## Risks And Controls

Composite indexes can increase write overhead, so the set should be tied to observed query paths and avoid indexing every column combination. Schema splitting can accidentally change initialization order, so tests must create a fresh in-memory database and assert representative tables, columns, and indexes.

The current working tree has unrelated frontend changes. This iteration must not overwrite them.

## Acceptance Criteria

1. Database initialization is split into focused modules while preserving existing public exports.
2. Repeatable composite indexes cover the observed high-frequency query paths listed above.
3. At least one existing JavaScript-side database sort is moved into SQL without changing returned data shape.
4. Backend tests cover the new index contract and ordering behavior.
5. Encoding check, backend tests, and review gate pass or any failure is recorded with exact cause.
6. An automation report is written under `automation/reports`.

## Self Review

- No placeholders remain.
- Scope is limited to backend database performance and structure.
- The plan does not require editing actual SQLite data files.
- The implementation is small enough to review as one database-focused iteration.
- User approval is treated as delegated by the active objective.
