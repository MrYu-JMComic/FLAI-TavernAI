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
- `automation/reports/2026-06-30-database-performance-structure.md`

## What Changed

- Split the database bootstrap into focused runtime, schema, index, and migration modules while preserving the public `backend/src/db.js` exports used by existing callers.
- Centralized repeatable index creation in `backend/src/db/indexes.js`.
- Preserved all existing indexes from the old `db.js` initialization path.
- Added composite indexes for observed hot query shapes, including conversation/message chronology, regex rule ordering, world-book lookups, linked book ordering, saves, presets, mods, NPC detail rows, economy transactions, character images, and character talents.
- Moved regex rule ordering from JavaScript sorting into SQL `ORDER BY priority ASC, order_index ASC, rowid ASC` so the new regex composite indexes can be used directly.
- Added database structure tests that assert public exports, required composite indexes, idempotent initialization, and representative `EXPLAIN QUERY PLAN` index usage.

## Validation

- `node --test src/tests/database-structure.test.js` in `backend`: PASS, 4 tests.
- `node --test src/tests/backend.test.js --test-name-pattern "regex"` in `backend`: PASS, 283 selected tests.
- `npm test` in `backend`: PASS, encoding pretest passed and 991 backend tests passed before the query-plan test was added.
- Final `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`: PASS, 6/6 stages; backend test stage passed 992 tests and frontend build passed.

## Observed Effects

- `EXPLAIN QUERY PLAN` confirms SQLite uses `idx_messages_user_conversation_created` for user-scoped conversation message chronology.
- `EXPLAIN QUERY PLAN` confirms SQLite uses `idx_regex_user_character_order` for character regex rule ordering.
- `EXPLAIN QUERY PLAN` confirms SQLite uses `idx_world_book_entries_book_order` for world-book entry ordering.
- `EXPLAIN QUERY PLAN` confirms SQLite uses `idx_npc_memories_conversation_npc_created` for NPC memory detail reads.
- `EXPLAIN QUERY PLAN` confirms SQLite uses `idx_conversations_user_updated` for conversation list ordering.

## Notes

- No files under `backend/data` or `backend/uploads` were edited.
- Existing unrelated frontend and frontend-source-test working-tree changes were left untouched.
- Review gate still reports those unrelated dirty frontend files in git status, but all validation stages passed.
- The frontend build generated `dist` output during verification only; generated build output was not edited manually.

## Next Recommended Task

Seed a development-size in-memory database and record `EXPLAIN QUERY PLAN` output for chat message lists, character search/sort modes, world-book matching, and NPC detail reads. Use the results to decide whether any added index should be narrowed, widened, or replaced.
