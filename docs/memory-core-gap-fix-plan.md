# Memory Core Gap Repair

## Objective and Required Reading

Fix `MEMORY_CORE_GAP` (previous core processing is incomplete) when obsolete
message flags disagree with accepted memory state or current required jobs.
Read `AGENTS.md`, `memory-character-workflow-upgrade-plan.md`,
`memory-rebuild-recovery-fix-plan.md`, `conversation.md`, and the affected
queue, commit, timeline recovery and short-term repository code.

## Scope and Decisions

- Preserve the existing uncommitted implementation and all unrelated edits.
- Keep real unfinished required/legacy turns ordered. Include queued work.
- Exclude explicitly adopted or accepted prefixes and optional raw failures
  from false gap failures; do not infer successful extraction from a flag.
- Scope dependency evidence to the selected conversation, timeline and live
  message revision. Preserve conservative handling of legacy orphan flags.
- Keep atomic rejection and existing explicit retry/rebuild behavior. Do not
  edit live data, enqueue paid work, or hide genuine failures.
- Clean up only the directly replaced gap query and related stale guidance.

## Checklist

- [x] Inspect Git state, repository guidance and previous repair plans.
- [x] Reproduce false failures and missing queued-turn protection in isolated tests.
- [x] Correct the dependency guard using current accepted state and job evidence.
- [x] Verify actual postprocessing and explicit recovery with mocked providers.
- [x] Independently review timeline, watermark, required-stage and retry boundaries.
- [x] Run backend tests, encoding and whitespace checks; record final results.

## Acceptance Criteria

1. An explicitly accepted prefix cannot permanently block a later valid core
   commit because of retained failed/running message metadata.
2. An explicitly optional raw job failure cannot become a required memory gap.
3. Live queued/pending/running/failed required or legacy gaps still reject
   out-of-order commits atomically, including equal-timestamp messages.
4. Stale timelines/revisions do not override current dependency evidence.
5. Sequential mocked workers finish a valid recovery and its following turn;
   rejected packets leave canonical/domain state unchanged.
6. `npm test` in backend, `node scripts/check-encoding.mjs` and
   `git diff --check` pass. No frontend changes are planned.

## Validation and Results

Completed on 2026-11-02. Added one repository dependency query shared by
pre-provider validation and atomic packet acceptance. Current exact-source
jobs determine whether work is unfinished. Without such jobs, retained flags
only block beyond the selected lineage's nearest accepted turn/adopted
baseline. Bootstrap and manual corrections do not imply extraction completion.
The replaced all-history flag query has been removed.

Read-only inspection confirmed the reported production case: historical
failed flags at narrative positions 31, 33 and 35 remained below an adopted
baseline. Comparing both predicates against one consistent read-only snapshot
found accepted coverage at 42 and the next pending source at 44: the former
guard incorrectly selected position 31, while the corrected guard found no
gap. Only metadata was inspected. No live database edits, recovery scheduling,
server restarts or provider requests were performed by the repair tools.

The new `memoryCoreGap.test.js` has 28 passing regressions covering adopted
prefixes, optional failed/cancelled jobs, required/legacy active and terminal
gaps, misleading flags, exact timeline/revision evidence, orphan bootstrap
under a manual head, accepted turn lineage, checkpoint restore, pre-provider
rejection, and manual retry followed by sequential postprocessing. Rejection
asserts no canonical/projection/source/outbox effects. Models are scripted and
every executable regression uses isolated in-memory SQLite.

Independent review identified a quadratic query-plan risk in the initial
implementation. Replace its grouped left join with source-PK joins and set
membership predicates. The reviewed final plan uses the scoped jobs index,
message PK and list lookups. Synthetic 10,000-message checks took about 20 ms
for completed jobs and 74 ms for optional failures, rather than about 4.4 s
for the earlier nested scan. These figures are local synthetic measurements.

Validation:

- Focused queue/packet/recovery/background/timeline/V1 combination: 97/97 passed.
  Log: `.runtime-check/memory-core-gap-focused.log`.
- Full backend `npm test`: 1876/1876 passed, zero skips or failures.
  Log: `.runtime-check/memory-core-gap-backend.log`.
- `node scripts/check-encoding.mjs`: passed, including the added plan/test.
- `git diff --check`: passed; new/affected text files also checked directly
  for trailing whitespace because untracked files are omitted by Git diff.
- No frontend files changed; frontend build/screenshots and the broad review
  gate are not required for this scoped backend repair.

Remaining operational boundary: actual unresolved required work still needs
the existing explicit retry/rebuild flow. This repair preserves historical
failures and does not silently accept, clear or reconstruct their contents.
Real-provider extraction quality and latency were not evaluated.
