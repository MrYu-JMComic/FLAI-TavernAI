# Memory Rebuild Recovery Repair

## Objective and required reading

Fix the reported failed rebuild and zero-turn confirmation for a conversation
whose opening postprocessing failed. Required reading: `AGENTS.md`,
`memory-schema-upgrade-fix-plan.md`, `conversation-memory-v1-plan.md`,
`conversation-memory-v1-impact-analysis.md`, `architecture.md`,
`conversation.md`, and the migration/isolation sections of `maintenance.md`.

## Evidence and scope

A read-only inspection found a failed opening `conversation.postprocess` job:
`ERR_SQLITE_ERROR: table conversation_memories has no column named visibility`.
The live database has recorded 0035. Comparing all memory table columns with
an isolated fresh database also found missing `truth_status` and
`actor_ids_json` on the review projection. The previous upgrade audit covered
the canonical tables and missed this projection table.

The processing HTTP route nests the new summary under `job`, while the UI
reads top-level `coreReady` and `stages`. Stage arrays are ordered oldest first,
and the UI selects their first entry. The rebuild planner can select an opening
checkpoint that precedes the failed opening extraction logically but already
covers its message, yielding a zero-turn preview.

Preserve unrelated work and existing migration checksums. Do not initialize
the live database or start paid recovery/model calls. Use isolated fixtures
and local mocks. Finish and test forward migration 0036 before registering it,
because the user's development watcher can apply a newly registered migration.

## Checklist

- [x] Read repository guidance, inspect Git state, UI and job evidence.
- [x] Compare all memory table columns against a fresh isolated schema.
- [x] Add and test forward migration 0036 for the missing projection fields,
  preserving rows, IDs, lifecycle and conservative visibility/truth defaults.
- [x] Fix recovery planning so failed/cancelled required core work cannot be
  hidden behind a later text-only checkpoint or a zero-turn rebuild.
- [x] Align the processing API and UI contract, select active/latest stage
  work correctly, and display actionable failure reasons.
- [x] Handle true zero-turn and invalid rebuild previews accurately; preserve
  confirmation before any model work and existing retry/cancel behavior.
- [x] Add isolated migration, real HTTP recovery and UI regressions, including
  the failed opening and mixed core/derived states.
- [x] Keep optional raw failures consistent with queue readiness; known rebuild
  requirements must report recovery guidance rather than wait for core work
  that is not running.
- [x] Run backend/frontend validation and review gate; inspect desktop/mobile
  screenshots and record paths, results and remaining limitations.
- [x] Update maintenance/repair records and complete the task goal only after
  the applicable checks pass.

## Acceptance criteria

A database already recorded through 0035 gains all current memory projection
columns on the next startup, without deleting data or changing old ledgers.
The complete memory schema comparison has no missing columns. Rebuilding a
failed opening schedules that opening, and a mocked worker can finish its
canonical commit and projection. Failed required core work is not silently
accepted by a zero-job rebuild. The processing UI reflects the real HTTP
payload, shows the relevant failure, and accurately reports preview counts.
Confirmed recovery is local-test-only; no real provider is invoked by this
task. Unrelated later checkpoints and optional/raw work remain compatible.

## Validation

- Isolated Node tests with `FLAI_DB_PATH=:memory:`; use explicit early review
  DDL and an already-recorded 0035 ledger, not the current 0030 implementation.
- `npm test` from backend; `npm run test:unit` and `npm run build` from frontend.
- Targeted Playwright desktop/mobile recovery scenarios and screenshot review.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.
- `node scripts/check-encoding.mjs` and `git diff --check`.

## Results

Migration 0036 was tested before registration. Eight projection regressions
cover early explicit DDL, partial schemas, selected-lineage metadata, original
rows/IDs/lifecycle, atomic canonical/review writes, rollback and startup
idempotency. Together with the previous schema/ledger suite, 25/25 passed.

An existing temporary user-data copy recorded at 0035 upgraded through the
registered 0036, preserving all prior ledger rows. Comparing its 17 static
memory tables with a fresh database found zero missing columns. A real local
canonical packet produced the correct restricted review projection, with
zero FK violations. Copy:
`C:\Users\34214\AppData\Local\Temp\flai-memory-upgrade-final-GHPnXv\upgrade.sqlite`.
This copied user-data file is not a shareable fixture or repository artifact.

The isolated recovery HTTP suite reproduces the failed opening with no user
message, obtains a one-turn preview, restores the bootstrap's initial status
blueprint, and completes a mocked memory/domain worker. Additional cases cover
failed/cancelled prefixes, future-head exclusion, missing required sources,
derived independence and stale confirmation. A confirmation now carries its
previewed count; a changed count rejects with 409 before mutation or model work.

Frontend changes preserve both current and older nested HTTP payloads, select
relevant core jobs, show all unresolved derived jobs, retain operation errors,
and validate preview counts. A true zero-turn confirmation explains that no
rebuild model call is scheduled. Desktop 1440 x 1000 and mobile 390 x 844 cover
failed core, confirmation, persistent action error, multiple derived tasks and
zero-turn recovery. All ten PNGs were actually inspected; no clipped controls,
overlap or horizontal overflow was found. Root also inspected the mobile failed
state and desktop one-turn confirmation.

Screenshot directories under the repository root:

- `.runtime-check/playwright-results/memory-rebuild-recovery-fa-ebd4d-40px-without-provider-calls-chromium/`
- `.runtime-check/playwright-results/memory-rebuild-recovery-fa-22035-90px-without-provider-calls-chromium/`

Each contains `recovery-{failed,confirm,action-error,derived,zero}-{1440|390}.png`.
Final results on 2026-11-01:

- Full review gate PASS; log:
  `.runtime-check/review-gate-20261101-195645.log`. Its backend snapshot passed
  1745 tests, frontend build passed, unit tests passed 360/360, E2E passed
  118/118, and both production dependency audits reported zero vulnerabilities.
- The final two queue/readiness adjustments added eight regressions. Required
  and legacy gaps still block, explicit optional raw failures do not, and
  known rebuild requirements report immediately without waiting or mutation.
  Combined targeted tests passed 43/43.
- After those backend changes, the latest full backend `npm test` passed
  1753/1753, with no skips or failures. Log:
  `C:\Users\34214\AppData\Local\Temp\flai-memory-recovery-final-backend-6de16eab407f4bfe868a3bceba675518.log`.
- Encoding check passed for 799 files; changed and new text files passed
  whitespace checks. All frontend screenshot states were captured again by
  the complete E2E run.

The final schema is 0036. Restart the backend and refresh the page before
retrying the failed opening; its rebuild preview must include that opening
(one turn in the reported conversation). Do not delete the database or its
migration ledger. Existing failed jobs remain available for explicit retry or
rebuild; the repair tools did not enqueue real paid recovery.

Live database reads used `DatabaseSync` read-only mode; no paid rebuild or direct
live database migration has been performed by the repair tools. Model output
quality and real provider availability were not evaluated by these local mock
regressions. Older raw/no-summary generation behavior remains compatible.
