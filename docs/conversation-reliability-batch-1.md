# Conversation Reliability: Batch 1

## Scope and Baseline

This batch implements plan stages 1-3: baseline verification, complete conversation
snapshots, and durable post-response processing. Existing town, image, provider,
home-library, and appearance changes are preserved. No live database or upload
directory is modified by the development workflow. Migration 0014 runs on normal
application startup after the existing migrations.

The earlier home-library E2E failure concerned wide-screen column counts. Its
implementation and test have since changed in the shared worktree; validation
must use the current tree, not restore an earlier test expectation.

## Acceptance Checklist

- [x] Versioned snapshots cover every owned conversation-state table plus child
  transactions, objectives, encounter participants/actions, messages and swipes.
- [x] Asset URLs remain references; binary media is not copied into snapshots.
- [x] Snapshot restore uses one transaction, validates foreign keys, and preserves
  the existing conversation if restoration fails.
- [x] Branches remap local IDs and structured references. Historical branches use
  a matching history checkpoint, never a later live state.
- [x] Legacy saves and unavailable historical checkpoints are explicitly partial;
  future cast, inventory, economic and scene state is not silently inherited.
- [x] Message edits, deletes and swipe changes increment versions, preserve a
  recovery save, invalidate old tasks and restore the preceding checkpoint.
- [x] Multi-turn historical rebuilds require explicit confirmation; users may
  instead accept the current state as a new baseline.
- [x] Completed assistant persistence and postprocessing enqueue are atomic.
- [x] Real automatic memory, accessory and cast processing runs from the existing
  durable worker, not an in-process fire-and-forget callback.
- [x] Source revisions, leases and per-conversation serialization guard processing.
  Generation, save and conflicting UI mutations cannot race a pending state job.
- [x] Recoverable steps keep before-state snapshots. An interrupted attempt rolls
  back its incomplete step before retry; completed steps are reused.
- [x] History changes invalidate old callbacks without rolling back newer state.
- [x] Tool policy and execution records include domain, effect, idempotency,
  job/step/attempt and redacted bounded arguments/results.
- [x] Chat exposes processing status, cancellation, retry and confirmed rebuild.
- [x] Full backend tests, frontend build/unit/E2E, encoding and review gate verified.
- [x] Final diff and rendered processing states inspected.

All acceptance items were verified against the final implementation. The earlier
wide-library failure no longer reproduces on the current shared worktree.

## Data and Compatibility

Snapshot format v2 owns conversation state, not global character cards, assets,
provider credentials, user settings, or town worlds. Cast audits and all runtime
cast tables are included. Source IDs inside structured JSON are remapped by field
semantics rather than replacing arbitrary story text.

Before history-changing operations the current conversation is retained as a
recovery save. A restored legacy save clears unavailable derived state and returns
warnings. A historical branch without a matching checkpoint begins with explicit
partial state. New checkpoints record message IDs, revisions and a history hash.

Postprocessing is serialized per conversation, while different conversations may
run concurrently. Model calls are outside SQLite transactions. Each state step has
a durable recovery record; partial writes may exist while the step is running,
but conflicting mutations and new generation are blocked until the job settles.
Cancelling does not refund already incurred provider usage. Earlier completed
steps remain available for retry; the active step rolls back when cancellation is
acknowledged. UI confirmation is required to accept incomplete state as a baseline.

The existing direct manual cast-organization and multi-role endpoints also use a
versioned generation lease and guarded database facade, preserving their APIs
while preventing a late response from changing a restored timeline.

## Verification

Behavioral tests: `conversationTimeline.test.js`, existing conversation streaming,
save, branch, swipe, job-worker, provider and cast suites. Browser workflow:
`conversation-timeline.spec.js`, existing chat, world-book, NPC and home-library E2E.

Run all implementation and test changes as a batch before invoking validation:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1
```

No commits, publishing, deployment, branch reset or file deletion is part of this
batch. Any unrelated baseline failure must be reported separately with evidence.

## Final Results

- Backend: 1,424 tests passed, zero failed or skipped.
- Frontend: build passed, 11 unit tests passed, 35 browser E2E tests passed.
- Encoding, dependency audits, accessibility diagnostics and Git whitespace checks
  passed. The review gate returned PASS.
- Processing-state screenshots were inspected at 1440x900, 375x812 and 844x390.
  The status band stays compact and the landscape empty state clears the composer.
- Worker shutdown/restart, lease recovery, cancelled replay order, old callbacks,
  full restore, historical branches, source revisions and tool auditing have
  behavioral regression coverage in `conversationTimeline.test.js`.
- Acceptance log: `.runtime-check/conversation-batch1-acceptance.log`.
- A separate in-memory demo launch was denied by the execution environment; the
  existing frontend at `http://127.0.0.1:5173` still returned HTTP 200. No alternate
  launch path or live-database modification was used to bypass that restriction.

Recovery saves and per-step snapshots intentionally trade storage for reliable
rollback. A future retention policy can bound this derived storage, but it must
not prune recovery data required by an active or retryable task.

The following context and memory quality stage is implemented and verified in
`context-memory-quality-stage-4.md`. Its acceptance results supersede this batch's
test counts without changing the completed batch-1 scope.
