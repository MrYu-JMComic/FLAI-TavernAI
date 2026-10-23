# Character Assistant Large JSON Recovery Plan

## Objective

Fix the AI character assistant becoming impossible to open or use after large
JSON content is generated or saved, while preserving existing draft content.

## Scope

- Inspect assistant generation, session persistence, request validation, and UI rendering.
- Reproduce the relevant size or parsing failure with a focused regression case.
- Apply the smallest compatible fix and clean up only directly replaced logic.
- Preserve unrelated working-tree changes and do not modify stored user data.

## Checklist

- [x] Inspect repository instructions and current Git status.
- [x] Trace large JSON through assistant requests, stored sessions, and rendering.
- [x] Reproduce the failure and choose a compatible recovery strategy.
- [x] Implement the fix with meaningful regression coverage.
- [x] Run required validation and inspect the final scoped changes.

## Acceptance Criteria

- Large assistant-generated JSON does not prevent reopening or continuing a session.
- Existing drafts and generated content remain recoverable.
- Oversized or invalid input produces a usable error without wedging the interface.
- Existing assistant behavior and unrelated local changes are preserved.
- Applicable tests, frontend build, and encoding validation pass.

## Validation Commands

- Focused assistant regression tests selected after tracing the failure.
- `npm test` from `backend` for backend changes.
- `npm run build` from `frontend` for frontend changes.
- `node scripts/check-encoding.mjs` from the repository root.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` if scope is broad.

## Findings and Results

- The working tree already contains extensive assistant and UI work. Changes in
  this task will be scoped around the existing implementation without resets.
- The user confirmed the request JSON field-count/content-length error.
- Opening an existing session and autosaving used to repost complete generated
  state, including repeated process/tool records, checkpoints, and world books.
  The authenticated boundary caps requests at 10,000 keys, and client state
  writes are capped at 4,000,000 characters. Server generation can exceed these
  input limits, so echoing it prevents opening, saving, or starting another turn.
- Use additive `statePatch` and `characterPatch` inputs, validating only new
  input while retaining complete server-owned content. Existing replacement
  inputs keep their behavior. Autosave compares normalized exported snapshots
  when queued writes execute, including explicit null/empty updates.
- Backend regression reproduced both failures before implementation. Focused
  session, draft-version, and large-session tests pass.
- Review also reproduced the field-count error with four valid generated books
  containing 30 entries each: posting workspace/changes plus repeated checkpoint
  copies exceeded 10,000 keys at only about 188,000 characters. State patches now
  synchronize saved checkpoint/plan book snapshots on the server, and clients
  omit redundant book copies while preserving explicit snapshot edits/clears.
  Generation requests also need only the workspace copy used by the runtime.
- Final backend `npm test`: 1,610 passed.
- Final frontend `npm run test:unit`: 262 passed across 27 files. After refining
  fixtures to use real normalized entries and the actual backend boundary
  scanner, the two affected suites also passed all 50 tests. Resume regression
  covers six books with 30 entries each.
- Final frontend `npm run build`: passed. Existing large-chunk warning remains.
- `node scripts/check-encoding.mjs`: passed (686 files).
- Scoped browser rerun after the final implementation: all 14 tests passed in
  character-assistant-history, character-avatar-save, character-ai-panel-drag,
  and character-assistant-composer.
- Full review gate ran: backend/unit/build/encoding/audits and normal Git
  whitespace checks passed; browser suite had 85 passes and 5 failures. All five
  failures are the viewport variants of `ai-plan-review-mobile.spec.js:117`:
  the existing test clicks Send after discarding a plan with an empty composer.
  Trace review confirmed both earlier sends succeeded. This existing unrelated
  test assumption was left untouched; the full gate is therefore not green.
- Independent review found no regressions in ownership, running locks,
  explicit null/empty clears, snapshot synchronization, or queued saves.

## Changed Files

- `backend/src/modules/characterAssistantSessions.js`: additive validated patches
  and synchronization of dependent world-book snapshots.
- `frontend/src/composables/character/useCharacterEditor.js`: small reopen/bind
  requests and removal of duplicated world-book snapshot posts.
- `frontend/src/composables/character/useCharacterAssistantSessions.js`: queued
  state deltas against the last normalized saved snapshot, including unmount.
- `frontend/src/composables/character/useCharacterAiGeneration.js`: world-book
  context travels once during continuation and approved-plan execution.
- Backend large-session regression and frontend session, generation, avatar,
  saving, and world-book regression tests were added or updated.

## Remaining Work and Limits

- The JSON duplication fix and its applicable checks are complete. No stored
  user data was modified and no database migration is required.
- The unrelated full-gate plan-review test needs a separate update to submit a
  new requirement after discarding its previous plan.
- Existing limits still apply to genuinely new oversized edits; the fix avoids
  reposting stored/generated content and preserves validation of new input.
