# Status Limit and Assistant Send Plan

## Objective

Raise the status-bar variable limit from 60 to 120 and clear the character
assistant composer after a message has been sent successfully.

## Scope

- Share the 120-variable limit across frontend, validation, normalization, and
  assistant tools; remove the related duplicate hard-coded limit.
- Trace assistant sending and session restoration to prevent sent text from
  reappearing, while retaining unsent text when a request fails.
- Preserve all unrelated in-progress changes and application data.

## Checklist

- [x] Inspect repository instructions, Git status, and relevant entry points.
- [x] Raise and unify the variable limit; update meaningful boundary coverage.
- [x] Reproduce and fix the assistant composer/session draft lifecycle.
- [x] Verify successful send and failure recovery, including session reloads.
- [x] Run backend tests, applicable frontend tests, build, and encoding check.
- [x] Review changes and record outcomes and any remaining risks.

## Acceptance Criteria

- 120 variables can be created, saved, loaded, and edited without truncation.
- API validation and editor/assistant additions reject a 121st variable;
  normalizers retain their existing truncation behavior at the new 120 cap.
- Successfully sent assistant text does not remain or reappear in the composer.
- Failed sends retain recoverable text and attachments, and retry/Plan flows
  remain usable.
- Relevant automated checks pass.

## Validation Commands

- `npm test` from `backend`.
- `npm run test:unit` from `frontend` (focused assistant/session coverage first).
- `npm run build` from `frontend`.
- `node scripts/check-encoding.mjs` from the repository root.
- Focused existing E2E checks if needed for integration behavior, using the
  isolated test database and mock provider.

## Progress

- Raised the shared variable limit to 120 and replaced the advanced-settings
  hard-coded cap with the shared constant. Frontend editing, API validation,
  normalization, and assistant tools now inherit the same count.
- Updated boundary tests for character/status creation, persistence, frontend
  round-trips, and status-agent creation/editing at 120 and 121 variables.
- The assistant previously cleared only completed output in the view; Plan
  review retained text, and server snapshots retained submitted requirements.
- Accepted conversation sends now clear the composer in the generation layer;
  failures and pauses restore the original text. The view's redundant cleanup
  was removed. Session refresh also keeps successfully sent input empty.
- Plan context retains its original requirement independently, including
  execution after reload and replanning. Unsent follow-ups and intentional
  repeat messages remain recoverable; no text-equality deletion heuristic is
  used when restoring sessions.
- Successful backend turns persist an empty composer requirement; interrupted
  turns retain the task for recovery. Plan context includes the task text.
- Updated the existing process-reference source contract to allow the new
  optional request argument without changing its reference-stability checks.
- `npm test` from `backend`: 1607 passed, zero failures or skips.
- `npm run test:unit` from `frontend`: 250 passed across 27 files.
- `npm run build` from `frontend`: passed; existing large-chunk warning remains.
- `node scripts/check-encoding.mjs`: passed (684 files).
- Existing assistant image E2E: 3 passed, including retries and phone multiline
  input. New composer E2E: 2 passed, covering pending normal sends, reload,
  failed phone sends, Plan review and replanning with the original task.
- The initial Plan E2E attempted approved execution using the local mock, whose
  placeholder plan cannot satisfy real execution acceptance. The final test
  verifies replanning with that mock; approved execution and original-task
  preservation are covered by frontend/runtime and backend tests.
- E2E uses the isolated in-memory database and mock provider. User conversations
  and model services were not used for validation.
- No remaining work or blockers. The full review gate was not run for these
  focused changes; its applicable test/build/encoding checks were run directly.
