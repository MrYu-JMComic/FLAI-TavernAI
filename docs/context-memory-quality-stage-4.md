# Context and Memory Quality: Stage 4

Date: 2026-09-06. This is the next stage of the conversation reliability work
in `conversation-reliability-batch-1.md`, not the separate engineering roadmap's
observability milestone. Persistent task goal: context and memory quality.

## Acceptance

- [x] Implement model-scoped input allocation, reply reservation, image and tool
  estimates. Keep current user input intact and older exchanges paired.
- [x] Persist owner-scoped, redacted snapshots at the actual HTTP boundary and
  link generation results to source/assistant messages and timeline revisions.
- [x] Connect pinning, batch review, invalidation, conflict candidates and
  reversible memory merges to the existing context inspector.
- [x] Make cast-memory decay checkpointed and idempotent across repeated runs.
- [x] Add fixed, offline quality scenarios and behavioral regression cases.
- [x] Complete consolidated backend, frontend, E2E, encoding and review gates.
- [x] Inspect desktop/mobile screenshots and record actual results below.

## Budget Contract

`GET/PUT /api/conversations/:id/context/budget` stores only positive integer
allocations. Null clears an override. Defaults: 16384 dialogue tokens (4096 x 4), 4096 reserved
output tokens, and 1024 estimated tokens per image. Presets and provider output
settings supply the output default when configured. A conversation reservation
overrides that default. Anthropic reasoning normalization can raise it; the
normalized reservation is used in both the budget and the outbound request.

An explicit context window is bound by the server to the selected provider and
model. Switching models ignores the previous window with a warning. Model
limits are never guessed. Counts remain estimates, including protocol envelopes,
tools and images; they are not provider tokenizer results. Dialogue/window
overflow returns `CONTEXT_BUDGET_EXCEEDED`, `accepted: false`, before persisting
the user message. Draft text and attachments remain recoverable in the composer.

The dialogue allocation counts history, the current input, and dialogue images.
System-built character, preset, lore, memory, state, mods and tool schemas are
accounted separately and do not consume that allocation. A configured physical
model window still includes all input plus the reply reservation. Old dialogue
is removed as whole exchanges, retaining the latest complete exchange and input.
System sections are only evicted to satisfy an actual configured model window.
The optional legacy character limit also applies to dialogue only.

Token limits replace the old message-count cutoff. Relevant omitted history can
be recalled as bounded, quoted historical evidence even for legacy conversations
without extracted memories. Chinese memory recall also searches segmented terms
because the existing unicode61 index does not segment Chinese sentences.

## Request History

`GET /api/conversations/:id/context/traces` lists recent logical generations.
`GET /api/conversations/:id/context/traces/:traceId` returns the stored logical
messages, source selection manifest, budget and each constructed wire request.
The preview tab still performs a fresh dry run and is not historical evidence.

Every transport attempt has an ordinal, redirect/auth-fallback metadata, body
hash, sanitized body, redaction metadata, HTTP outcome and estimated input cost.
Headers, raw responses, credentials and inline binary payloads are not stored.
JSON records exceeding 250000 characters explicitly report truncation. Ordinary
URL text is preserved unless a credential or sensitive query value is removed.
Requests containing server-inherited Responses context report partial estimate
coverage. Mock generations have no wire requests.

Generation states distinguish completed, empty, failed, partial, cancelled,
stale and process-interrupted results. HTTP `response_received` only means a
response arrived, not that the model completed. Trace observer failures must not
change a usable provider response. Startup marks pending records interrupted.
Historical traces stay with their original conversation rather than being
remapped into a branch; timeline changes mark the original trace outdated.

## Memory and Compatibility

User-authored completed actions remain valid evidence. Automatic extraction now
enables bounded, source-linked memories, including short and ordinary narration.
Plans and hypothetical statements are retained with distinct types instead of
being discarded or becoming completed facts. Untouched legacy automatic candidates
with a valid local source are recallable regardless of age; explicit disables,
invalidations, archives and merges remain respected. Manual memory editing remains under
user control. Review operations check revisions and reject stale batch/merge/
undo writes. Undo restores exact prior memory rows only without intervening edits.

Migrations 0015-0017 add review state, decay checkpoints, budgets and traces.
Version-2 snapshots include the new review tables and budget setting; old valid
version-2 snapshots may omit only these new review tables. Branching remaps
embedded memory/message IDs so merge undo remains usable within the branch.

## Background Synchronization Update

Normal chat generation and durable postprocessing can overlap. State-mutating
manual operations remain exclusive. Synchronization completion refreshes state
panels, never replaces the message list or an active streaming draft. A failed or
cancelled turn does not prevent later queued turns from being processed. Steps
continue independently, retaining successful memory/cast/accessory results; the
failed step rolls back and remains visible for recovery. Retrying a task after
later tasks have started requires a rebuild rather than restoring stale state.

Non-lore step recovery preserves current lore clocks and activations. Pending
snapshots cannot be used as complete historical checkpoints; completed job
checkpoints retain the lore state captured for their source turn. During a lag,
the reply prompt explicitly gives newer narrated events precedence over older
derived state. History changes still invalidate stale callbacks by revision.

Memory and behavior plan payloads tolerate optional null metadata, numeric
strings and extra descriptive fields. Evidence may be a paraphrase; audits
distinguish it from a verified quote. Invalid ownership, revisions, sealed
memories and forbidden operations remain protected. Automatic plans retain valid
operations when another operation fails and report the skipped records.

This update supersedes the blocking-generation and disabled-candidate contracts
in the earlier runtime and reliability documents. Historical validation results
below describe the previous implementation, not this update.

### September 7 Smoke Results

No test files were added or modified for this update. Validation ran after the
implementation batch, using the existing review gate and actual application/API
flows against an in-memory database. The configured provider handled real model
calls; no model responses were mocked. Existing conversation data was read-only.

- Successive replies returned HTTP 200 while prior synchronization was queued
  and running. Job/request timestamps confirmed overlapping execution.
- The model retained the compass inscription, pocket, agreed destination and
  time, then correctly followed the changed holder and location.
- Browser send remained enabled during synchronization; both replies survived
  background completion with no page errors or message-list replacement.
- A real legacy conversation's 25 messages yielded 13231 dialogue tokens and
  4477 separately counted system tokens. All 16 source-backed legacy automatic
  memories were recallable. A query recalled its oldest omitted history entry.
- Dialogue and physical-window overflow returned HTTP 400 with accepted=false
  before storing the input. Default dialogue/output values were 16384/4096.
- Cancelling synchronization did not block the next reply or job. The recovery
  preview identified the two affected turns and disallowed unsafe old-job retry.
- A final fresh-process model run verified that ordinary events and typed plans
  were enabled, while pure reply instructions and questions were not recorded.
- Desktop (1440x900), phone (375x812) and landscape (844x390) screenshots were
  inspected. Budget and composer controls fit without horizontal overflow.
- Encoding, build, frontend unit tests (11), accessibility diagnostics, dependency
  audits and Git whitespace checks passed. The existing full gate was not green:
  backend 1457/1490 and browser 37/38. Failures include superseded budget, pending
  memory, evidence and cancellation contracts; the browser failure targets the
  old input-limit label. Existing Anthropic default/import-order failures are
  outside this change. Gate log: .runtime-check/review-gate-20260907-005017.log.

The smoke workflow did not restart the live backend. Refresh the existing frontend
and restart the backend if its normal launcher has not already reloaded the source.

## Validation

Run after the implementation batch:

1. `cd backend; npm test`
2. `cd backend; npm run evaluate:context`
3. `cd frontend; npm run test:unit`
4. `cd frontend; npm run build`
5. `cd frontend; npm run test:e2e`
6. `node scripts/check-encoding.mjs`
7. `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`

The quality evaluation is an in-memory contract suite, not a live-model semantic
benchmark. It reports recall/precision, erroneous state changes, secret leaks,
estimated tokens, characters and timings over fixed actions, plans, secrets,
ownership, long-history retrieval and branching scenarios. It makes no paid
provider calls. Timing percentiles describe local contract operations only.

Final results: backend 1488/1488, frontend unit 11/11, browser E2E 37/37, frontend
build, encoding, accessibility diagnostics, Git whitespace checks and both
production dependency audits passed. Review gate PASS:
`.runtime-check/review-gate-20260906-012059.log`.

Real browser coverage includes budget rejection with draft preservation, a mock
generation and its stored trace, memory batch confirmation, pinning, conflict
merge and undo. All three provider protocols have JSON and SSE wire-body equality
tests without network access. Partial/cancelled/stale/empty terminal states,
owner isolation, signed-URL/credential/binary redaction and interrupted-process
recovery have focused tests. Budget rejection and failed lore commits leave no
unreferenced attachment assets or accepted messages.

Screenshots inspected: `.runtime-check/stage4-context-desktop.png` (1440x900),
`stage4-context-mobile.png` (390x844), and `stage4-context-mobile-dark.png`
(375x812). The browser test also checks 844x390 landscape, reduced motion,
keyboard tabs and horizontal overflow. The inspector is teleported outside the
chat stacking context so the mobile history sidebar cannot cover its controls.
The existing development frontend at `http://127.0.0.1:5173` returned HTTP 200;
its request-history API proxy returned the expected unauthenticated HTTP 401.
No live data, deployment, publishing, commits or external provider calls were
needed for verification. The existing KaTeX chunk-size advisory remains.

Fixed-contract evaluation: 11/11 invariants; recall/precision 1.0 for the single
gold recall target; zero erroneous state changes and zero secret leaks; 1532
estimated prompt tokens and 3636 characters. Local first-run operation timings:
43.086 ms total, 9.031 ms p50, 13.581 ms p95. These timing samples are not model
latency measurements and are not a statistically meaningful performance claim.
