# Chat Reply And Agent Context Plan

Date: 2026-10-23

## Objective

Clarify how the saved main reply relates to the status-bar Agent, and make the
status-bar sync indicator follow the background job for that exact reply.

## Scope

- Document the main reply, postprocessing, status-bar Agent, and prompt-context
  flow.
- Carry the assistant reply's postprocessing job ID into accessory refresh.
- Poll that job until it reaches a terminal state, then refresh derived panels
  once and settle the status-bar indicator from the observed result.
- Distinguish a completed check with no status change from waiting for a reply,
  and show when background processing fails.
- Preserve the immediate main reply and existing independent Agent settings.

## Checklist

- [x] Inspect the worktree and trace generation, postprocessing, Agent context,
  and status-bar UI behavior.
- [x] Add the architecture/context map and record this implementation plan.
- [x] Associate accessory refresh with the saved assistant message's job ID.
- [x] Replace the fixed refresh deadline with job-state polling and terminal
  status handling.
- [x] Add focused regression coverage for job tracking and status labels,
  including tracking shared postprocess work while the status-bar Agent is off.
- [x] Run backend tests, frontend build, encoding check, and diff checks.
- [x] Capture and inspect desktop and mobile chat screenshots; record paths.

## Acceptance Criteria

- The main response remains visible as soon as it is saved; status-bar
  postprocessing stays asynchronous.
- A status-bar sync indicator remains active while the matching job is queued or
  running, regardless of elapsed time.
- A completed job with changed status is shown as updated; a completed check
  with no change is distinct from waiting for the next reply; a failed job is
  visible as a failure state.
- Send, continue, and regenerate all track the corresponding saved reply.
- Documentation identifies each model call's input context and which state is
  visible to the next main reply.

## Validation

- `npm test` from `backend`
- `npm run build` from `frontend`
- `node scripts/check-encoding.mjs`
- `git diff --check`
- Desktop and mobile screenshots of the chat status indicator, inspected for
  spacing, contrast, overflow, and overlap.

## Findings

- Main generation uses the prompt pipeline, including current status variables
  when retained by the context budget.
- The status-bar Agent runs after the final assistant text is saved. It receives
  the current user/assistant turn, current status-bar data and template hints,
  plus status-bar rules; it cannot rewrite the main response.
- The current indicator infers completion from snapshot differences and a
  bounded timer sequence instead of the postprocessing job lifecycle.

## Results

The main assistant reply remains independent from background Agent work. The
status-bar Agent reads the saved turn and prior status, then changes only the
status panel for later turns. Accessory refresh now follows the exact reply's
postprocessing job through terminal completion. Shared job tracking continues
when the status-bar Agent is disabled, so other accessory panels still refresh.

- Targeted frontend regression tests: `node --test backend/src/tests/frontendChatAccessory.test.js backend/src/tests/frontendChatSubmit.test.js` passed (72 tests).
- Isolated visual capture: `npm run test:e2e -- --grep "captures desktop and mobile chat status layouts"` passed.
- Desktop screenshot: `.runtime-check/screenshots/chat-agent-context/desktop.png` (1440x900).
- Mobile screenshot: `.runtime-check/screenshots/chat-agent-context/mobile.png` (390x844).
- Visual inspection: the assistant reply, collapsed status summary, and composer remain legible and inside the viewport; no horizontal overflow or overlapping controls.
- Full backend suite: `npm test` passed (1667 tests).
- Production frontend build: `npm run build` passed. Vite reported the existing 524 KB KaTeX chunk size warning.
- Encoding scan: `node scripts/check-encoding.mjs` passed (729 files).
- Diff check: `git diff --check` passed; Git emitted only existing LF-to-CRLF working-tree notices.
