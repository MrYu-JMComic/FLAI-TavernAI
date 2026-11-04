# Memory Schema Upgrade Repair

## Objective and required reading

Fix the reported `POST /api/conversations` failure: an existing database has
recorded migration 0030 but lacks `memory_commits.parent_commit_id` and other
fields/constraints added to 0030 during the V1 implementation.

Required reading: `AGENTS.md`, `conversation-memory-v1-plan.md`,
`conversation-memory-v1-impact-analysis.md`, `architecture.md`,
`conversation.md`, and the migration/recovery sections of `maintenance.md`.

## Scope and evidence

A read-only schema inspection confirms migrations 0030-0033 are already recorded.
The database has no memory commits, and its schema predates commit ancestry,
event sequences, scoped aliases/entities, append-only actor knowledge and plot
threads. The old FTS triggers are also installed. The previous full test suite
used fresh databases and missed this already-recorded intermediate schema.

Only source migrations, isolated tests and related documentation are changed.
Do not edit the running database, backups, uploads, environment, or unrelated
working-tree changes. Preserve the existing 0030 checksum/ledger; introduce an
additive recorded migration rather than deleting ledger rows or rebuilding
the user's database.

A subsequent read-only inspection found that the running database had already
recorded the first 0034 at `2026-11-01T11:28:31.392Z` and contained one memory
commit. Development-server reload is a possible cause; the repair tools never
initialized the live path. Therefore 0035 independently reconciles the early
0034 provenance behavior. Its implementation and direct tests are completed
before registration, so a watcher cannot apply a partially written migration.

## Checklist

- [x] Inspect Git state, required guides, migration runner and read-only schema.
- [x] Add migration 0034 covering all intermediate memory schema differences,
  obsolete uniqueness constraints, deterministic safe backfills and FTS repair.
- [x] Register the migration and update schema-ledger contract expectations.
- [x] Add and register 0035 for databases that already recorded the first 0034;
  scope changes to old metadata and preserve new bootstrap conversations.
- [x] Test a recorded early 0030 database with preserved data, plus fresh and
  partially upgraded schemas; verify creation/bootstrap and real commit/read.
- [x] Test restart idempotency, foreign keys, alias/actor revisions, FTS updates
  and rollback on invalid migration data.
- [x] Run backend tests, encoding and diff checks; update this record with the
  results and the precise restart action needed for the live database.

## Acceptance criteria

Existing databases recorded through 0033 or the first 0034 upgrade automatically on startup,
without clearing data or changing old migration checksums. New conversation
creation and memory commit no longer fail on missing fields or old uniqueness.
No old actor belief is converted into author truth or assigned fabricated
branch ancestry. Fresh databases and repeated startup remain valid. Foreign
keys and existing entity/event/evidence identifiers are preserved.

## Validation commands

- `node --test src/tests/memorySchemaUpgrade.test.js src/tests/migrationLedger.test.js`
  from `backend`, with `FLAI_DB_PATH=:memory:` set before import.
- `npm test` from `backend` with isolated storage.
- `node scripts/check-encoding.mjs` from the repository root.
- `git diff --check` from the repository root.

## Results

Migration 0034 is registered without changing the earlier migration checksums.
It adds the missing columns, rebuilds the obsolete table-level unique rules,
and rebuilds both FTS projections against source rowids. Event sequence
backfill uses a materialized read to preserve ordering independently of the
query planner. Failed migration work rolls back and restores FK enforcement.

Legacy metadata is attached only to a proven head and cannot backdate learned
knowledge. Missing false-belief text stays empty instead of becoming author
truth. Where old commits exist but no unique head can be proved, mutable
metadata is preserved under an unselected recovery snapshot with no parent;
the migration does not invent a branch or silently expose it in old commits.
Such conversations are marked `legacy_partial`, and derived data is stale.

Final validation on 2026-11-01:

- Focused migration suite: 17/17 passed. Explicit old DDL fixtures preserve the
  recorded 0030-0033 ledger, IDs, FK references and source data. They cover
  fresh/partial schemas, real memory commits and branching, FTS update/delete,
  no invented ancestry, missing/ambiguous heads, materialized event ordering,
  historical actor filtering, rollback and restart idempotency.
- Recorded early-0034 reconciliation tests preserve modern bootstrap and
  post-upgrade rows exactly. Bound knowledge uses its own commit's order, and
  both data and the reconciliation marker roll back on FK failure. A completed
  reconciliation is a no-op.
- `npm test` from backend: 1730/1730 passed, no failures or skips, using
  `FLAI_DB_PATH=:memory:`. Log:
  `C:\Users\34214\AppData\Local\Temp\flai-memory-final-tests-68d16a2a20914daab4c32642f7de72ef.log`.
- The earlier 0033-to-0034 source-copy rehearsal returned HTTP 201. A later
  read-only-source backup already recorded the first 0034, with no completed
  provenance marker; that temporary copy upgraded through the registered 0035
  while preserving all previous ledger rows. A real local
  `POST /api/conversations` again returned 201 with a bootstrap commit and zero
  FK violations. No worker or paid provider was invoked.
- Rehearsal copy:
  `C:\Users\34214\AppData\Local\Temp\flai-memory-upgrade-final-GHPnXv\upgrade.sqlite`.
  It contains copied user data and is not a repository artifact or shareable
  test fixture.
- Encoding check passed for 794 files; `git diff --check` passed. New test and
  migration files were also checked for whitespace errors.

This repair changes backend migrations/tests and documentation only. No
frontend build, screenshots or full frontend review gate were rerun; the
earlier V1 gate results remain historical. No live database was initialized
directly by the repair tools; live connections used read-only mode.

The final schema version is 0035. Restart the backend (or allow its development
watcher to reload), then retry conversation creation. Existing data and old
ledger rows must remain in place. Historical metadata that cannot be proved is
retained as `legacy_partial`; migration cannot recover missing old belief text
or fabricate a complete earlier branch history.

## Subsequent projection/recovery follow-up

The later opening-state failure exposed three remaining fields on
`conversation_memories`, which this batch's canonical-table fixtures had not
removed. That separate repair adds 0036 and fixes the zero-turn recovery/API
contract. Its complete schema comparison and execution results are tracked in
[the rebuild recovery plan](memory-rebuild-recovery-fix-plan.md). The 0035
version and test counts above describe this earlier batch only.
