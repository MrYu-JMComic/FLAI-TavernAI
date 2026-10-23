# AI Plan Failure Status Recovery

## Objective

Ensure AI-assisted plan execution always leaves the running state when execution
fails, reports the failure, and allows the user to retry.

## Scope

- Trace plan execution, progress events, terminal errors, and UI status cleanup.
- Make a focused fix using existing state and event handling patterns.
- Cover the failing lifecycle with regression tests.
- Preserve existing unrelated work and avoid protected runtime data.

## Checklist

- [x] Inspect frontend and backend plan execution lifecycles and identify the cause.
- [x] Fix failure completion and remove obsolete related handling if applicable.
- [x] Add or update focused lifecycle regression coverage.
- [x] Run applicable tests, frontend build, and encoding validation.
- [x] Review the final diff and record results and remaining risks.

## Acceptance Criteria

- A failed plan execution clears the running state and displays the error.
- Pending plan steps do not remain executing after a terminal failure.
- Successful execution and retry behavior remain correct.
- Relevant regression tests, required build, and encoding checks pass.

## Validation Commands

- Focused frontend tests for plan execution and failure recovery.
- `npm test` in `backend` if backend code changes.
- `npm run build` in `frontend`.
- `node scripts/check-encoding.mjs`.
- Run `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` if the
  final change spans broad project surfaces.

## Progress

- Inspected repository instructions and Git status. The workspace contains
  extensive pre-existing changes; keep this fix scoped and preserve them.
- Root cause: frontend failure and pause paths leave the approved plan phase at
  `executing`; the review UI locks its controls on that phase independently of
  the request loading flag. Backend session completion and reload recovery also
  retain this stale phase.
- Use explicit `failed` and `paused` plan phases so interrupted execution unlocks
  while retaining approval for retries and checkpoint continuation. Planning
  failures remain unapproved. Normalize legacy sessions on restore.
- Frontend and backend terminal phase recovery implemented. Plan card retries
  continue existing checkpoints. Conversation refresh also preserves a local
  failed/paused plan when the request never reached the server.
- Removed the old restore branch and test expectation that incorrectly treated
  interrupted approved plans as actively executing.
- Backend complete suite: 1591 passed, zero failures or skips.
- Focused plan lifecycle suite: 21 passed; focused session suite: 18 passed.
- Final frontend complete suite: 22 files, 202 tests passed.
- Frontend production build: passed; existing bundle-size advisory remains.
- Encoding validation: passed, 666 files scanned.
- Git whitespace validation: passed. Reviewed all task changes and preserved
  pre-existing work, including the existing untracked assistant session files.
- The complete review gate and browser E2E suite were not needed for this scoped
  lifecycle fix; backend tests, frontend tests (including mounted plan UI), build,
  and encoding checks were run directly.
- No remaining task blockers. Failure/pause behavior is validated with simulated
  provider/network interruptions; no live external model request was required.

## Changed Files

- `frontend/src/composables/useAiPlanSession.js`: support terminal plan phases.
- `frontend/src/composables/character/useCharacterAiGeneration.js`: settle plan
  and process states; preserve approval and checkpoints during retries/restores.
- `frontend/src/components/AiPlanReview.vue`: show failure/pause and retry text.
- `frontend/src/composables/character/useCharacterAssistantSessions.js`: retain
  the local terminal plan phase when the server has no new turn.
- `backend/src/modules/characterAssistantSessions.js`: persist terminal plan
  phases and normalize legacy/abandoned sessions.
- `frontend/src/composables/character/__tests__/useCharacterAiPlan.test.js`:
  exercise plan UI, failure, pause, planning, retry, checkpoint, and restore.
- `frontend/src/composables/character/__tests__/useCharacterAiWorldBooks.test.js`:
  replace the stale expectation of executing after failed session restoration.
- `frontend/src/composables/character/__tests__/useCharacterAssistantSessions.test.js`:
  cover pre-server failure/pause phase preservation.
- `backend/src/tests/characterAssistantSessions.test.js`: verify persisted
  failure/pause phases, retries, checkpoints, and legacy restart recovery.
