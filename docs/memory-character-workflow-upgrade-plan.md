# Character Memory and Agent Workflow Upgrade Plan

Date: 2026-11-01

## Objective and Required Reading

Deliver the user's complete upgrade: audit all AI tool contracts; improve
precise/batch changes; display story-character memories, events, relationships
and possessions; add automatic consolidation and status-agent cooperation
switches; and make ordinary memory processing silent background work with a
bounded, protected short-term continuity bridge.

Read `AGENTS.md`, this plan, `conversation-memory-v1-plan.md`,
`conversation-memory-v1-impact-analysis.md`, `memory-packet-contract-fix-plan.md`,
and affected sections of `architecture.md`, `conversation.md`, `ai-runtime.md`,
`chat-agent-context.md` and `maintenance.md`. Read each affected source before
editing. The user's new background requirement supersedes the previous default
blocking-core policy; historical records must be updated rather than followed
as an approval requirement.

## Scope and Decisions

- Preserve all existing uncommitted work. Do not edit live data, uploads,
  environment files, dependencies or generated output; use isolated databases
  and mock providers for validation. Do not launch paid rebuilds.
- Audit every actual AI tool group and its handler, including dynamic and
  optional tools. Explicitly document deliberately polymorphic JSON/map fields
  instead of misclassifying them as missing schemas. Close unsupported fields
  and specify bounded arrays, nested objects and patch semantics.
- Reuse native `memory_entities` and the canonical event/claim/knowledge graph.
  An author's character filter is separate from strict actor knowledge scope.
  A story character need not have a character card or legacy NPC record.
- Character possessions are evidence-backed object/ownership relationships,
  with authoritative scene records linked when present. Do not invent a
  second economic or quantity ledger. Existing canonical export/branch/history
  ownership continues to apply.
- Shared `memoryPolicy` fields: `syncMode` (`background` default, `blocking`
  optional), `shortTermTurns` (8 default, bounded 1-32), `autoConsolidate`
  (true default, matching the existing enabled merge capability), and
  `statusLink` (false default, explicit cooperation).
- Background cast-mode generation can proceed while an ordered core is
  pending or retryable-failed if all uncovered turns fit the protected raw
  bridge. Completed turns leave the bridge after canonical acceptance. Never
  silently trim the bridge. Capacity/context overflow reports a meaningful
  error; historical rebuild-required states and strict actor knowledge retain
  their correctness checks. Strict actor mode cannot inject unclassified raw
  history merely to avoid waiting.
- Silent means no ordinary queued/running construction banner in the chat.
  Keep polling, completion refresh and discoverable error recovery; detailed
  processing lives in the memory workspace. Hide no failed job state from its
  diagnostic view.
- Automatic consolidation uses existing staged, revision-guarded merge/update
  paths and preserves evidence/history. Disabling it removes automatic merge
  capability. Never merge pinned records or incompatible actor, audience,
  truth or semantic scopes. No destructive global auto-summary job.
- Status cooperation gives extraction the current authoritative status as
  context, and gives the status agent the validated extraction plus current
  source evidence. Off uses the status agent's current-turn evidence normally.
  Both enabled agents still use their own permissions/provider configuration
  and accept changes through the same guarded core transaction.
- User follow-up: add memory Agent model thinking strength with the same
  `thinkingLevel` inheritance, options and provider adapter as status-bar
  settings. Empty follows the selected provider, `off` explicitly disables;
  persist through conversation/character settings and use it for extraction
  and derived summaries without hard-coded disabling. Verify request options
  and desktop/mobile settings screenshots using mock providers.

## Execution Checklist and Ownership

- [x] Inspect Git state, required documents, screenshot and affected flows.
- [x] Create a tracked goal referencing this plan and required Markdown.
- [x] T1: Enumerate all callable tools; fix incomplete/open contracts, precise
  sparse updates and useful bounded batches; add an auditable tool report and
  regression coverage. Tool-audit agent owns non-memory/status tool contracts.
- [x] T2: Add scoped character list/dossier transport and read models, with
  memories/events/relationships/possessions and precise/batch author changes.
  Core agent owns workbench/repository/routes and related new tests.
- [x] T3: Round-trip policy switches through API, author defaults, inheritance,
  import/export and AI editing. Add memory precision/batch capabilities and
  evidence-safe actor association/consolidation/cooperation. Root owns shared
  policies, memory/status agents and orchestration.
- [x] T4: Implement background generation with complete protected short-term
  raw bridge, ordered/stale-safe acceptance, diagnostics and budget checks.
  Root owns processing/context/prompt/queue integration and related tests.
- [x] T5: Deliver responsive character workspace, shared settings switches,
  silent normal progress and retained completion refresh/recovery. UI agent
  owns frontend components/composables/API/tests/E2E.
- [x] T6: Review cross-module interactions, remove related obsolete branches,
  update runtime docs, run full checks and actual desktop/mobile screenshot
  inspection. Record final results and remaining limitations here.

## Acceptance Criteria

1. Every callable tool family has a reviewed format/handler contract. Missing
   nested formats, unbounded lists and undeclared mutation options are closed;
   exact patches/batches are bounded and preserve unrelated values.
2. Newly encountered story actors can be extracted and independently inspected
   without creating cards. Dossiers separate memories, events, relationships
   and possessions, obey owner/branch/history boundaries, and do not confuse
   author filtering with a character's actual knowledge.
3. All four policy settings persist and inherit correctly. Automatic review
   can consolidate during the AI run while preserving accepted evidence and
   incompatible scopes. Status cooperation can be switched independently.
   Memory thinking strength persists/inherits and reaches both extraction
   and summary provider requests using the existing model-capability adapter.
4. Several uncovered turns can proceed without waiting for ordinary background
   memory work. Every uncovered raw turn survives budget selection, no future
   branch data enters historical prompts, and failed/late work never overwrites
   newer state. Strict actor and explicit blocking modes remain correct.
5. Chat contains no ordinary building-progress banner. Background completion
   still updates panels. Memory inspection exposes lag/failure and retry.
6. Backend tests, frontend unit tests/build, relevant E2E, encoding, whitespace
   and broad review gate pass. Desktop and mobile screenshots are captured
   and visually inspected against the repository's existing design patterns.

## Validation Commands

- Focused Node tests for tool contracts, actors, policies, background bridge,
  core queue, timeline, consolidation and status cooperation.
- `npm test` in `backend`.
- `npm run test:unit`, `npm run build` and `npm run test:e2e` in `frontend`;
  Playwright suites use mock/isolated fixtures.
- `node scripts/check-encoding.mjs` and `git diff --check` plus new-file checks.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Results and Validation

The production inventory is 64 unique tool names / 69 schema variants across
12 actual runtime directories, with two explicitly documented polymorphic
JSON Pointer fields. See `ai-tool-contract-audit.md` for the full inventory,
bounded exact/batch contracts and provider compatibility limits. Actor API
contracts are in `memory-actor-workbench-api.md`.

Cross-module review found and fixed four integrity gaps before release:
historical compression now retains every source through chained merges and
checks live revision plus content hash; text/pin changes preserve canonical
participants/time/location and typed dependents; explicit packet corrections
take precedence over inherited rows; and status fallback reads original turn
evidence regardless of the cooperation switch. Semantic merge guards compare
canonical identities/time/place/participants/kind, reject subject relabeling
and reject uncertain mixed new/accepted scopes. Explicit canonical packet
revisions remain deliberate full structured revisions; automatic inheritance
belongs to the plain-text/pin tool path, not arbitrary graph replacements.

Focused checks so far include actor dossiers (13), revision integrity (7),
semantic merge scopes (12), historical merge evidence (4), tool inventory and
precision, background continuity/budget and cooperation. The new thinking
strength follow-up and the final complete gate are complete.
Only isolated databases and mock/scripted providers have been used.

Visual review has inspected final-title actor workspaces at 1440x1000 and
390x844 under `.runtime-check/memory-workbench-title-ui/`, plus the full
desktop/mobile states under `.runtime-check/memory-character-workflow-ui-final/`.
No overflow, overlapping controls or clipped content was found. The pagination
fixture's count was corrected to match its third loaded memory; assertions
verify full counts and all loaded cards agree.

Thinking strength adds 5 backend tests covering all levels, provider request
adapters, independent profiles, author/conversation inheritance and summary
cache separation. The backend focused combination passed 81/81, and actual
tool inventory passed 4/4. Frontend focused unit checks passed 22/22 and the
two-viewport workflow E2E passed 2/2, including author high -> explicit off ->
reload off -> restore high -> empty/provider-follow. Root inspected both new
screenshots below after the UI agent's own visual review:

- Desktop 1440x1000:
  `.runtime-check/memory-thinking-ui/memory-character-workflow--b47ff-40px-without-provider-calls-chromium/memory-thinking-1440.png`.
- Mobile 390x844:
  `.runtime-check/memory-thinking-ui/memory-character-workflow--4b337-90px-without-provider-calls-chromium/memory-thinking-390.png`.

Both layouts preserve readable labels, scrolling content and accessible
footer controls without horizontal overflow or overlapping elements.

The first complete gate (`.runtime-check/review-gate-20261101-212427.log`)
passed frontend unit/build/audit and 1831/1832 backend plus 118/120 E2E.
One backend source-contract assertion and two E2E flows still assumed the
prior inspector/recovery paths; they were migrated to the new explicit
all-memory review and workbench recovery entry points. Recovery testing also
exposed a real gap: a successful workbench action must refresh the chat's
separate quiet processing reader and authoritative panels immediately.
This is fixed through scoped `processing-settled` events from review through
inspector to ChatView, and a dedicated quiet-reader refresh key. Its own
settled event does not advance that key, preventing refresh loops. Targeted
unit checks passed 24/24 and the two migrated E2E files passed 3/3. Recovery
acceptance confirms immediate quiet-banner removal, status/economy refresh,
new memory visibility, unchanged message-read counts and preserved draft
without reloading the page.

The UI agent inspected desktop 1440x900, mobile 375x812 and horizontal
844x390 recovery screenshots in
`.runtime-check/memory-workflow-gate-contracts-final/conversation-timeline-chat-6e76b-accept-a-historical-rebuild-chromium/`.
Root also inspected `timeline-rebuild-confirm.png` and
`timeline-recovered.png`: confirmation remains readable, the old warning
disappears after acceptance and the draft remains visible.

The second full gate (`.runtime-check/review-gate-20261101-214329.log`)
passed 1832/1832 backend and 370/370 frontend unit tests, build and both
production dependency audits. Its two workflow browser failures were traced
to Chromium `net::ERR_NO_BUFFER_SPACE` under eight workers, rather than a Vue
compile failure; top-level modules returned HTTP 200 but a dependency download
failed. Add an optional positive `FLAI_E2E_WORKERS` override and use two workers
for the final local gate. Keep every test, timeout and assertion intact.

Final canonical review also reproduced a conflicting-write case: a staged
update plus pin and an explicit event superseding the same record could
create two active revisions and leave the text projection behind. Reject
overlapping tool/packet revisions and duplicate explicit replacements at
finish with corrective feedback, then recheck at atomic commit. Choose one
revision path per record rather than attempting to infer a merge of two
incompatible proposals. Add regression tests for the actual multi-action
case, no partial writes, and a corrected same-loop finish.

Identity review reproduced a separate name-fallback collision: two explicitly
different cast keys with the same name could receive one canonical entity ID,
including restricted event audiences. Enrollment now uses an explicit cast
key as identity, creates a new entity when it has no visible match, and rejects an
explicit ID/key mismatch. Name/alias resolution remains available only when
no cast key is supplied. Preserve commit-lineage/branch visibility; do not
add a global unique constraint or guess how to split prior historical data.
Verify same-name knowledge isolation, cross-turn reuse/aliases, conflicts and
restore/branch behavior in an isolated regression suite before the final gate.

The revision overlap suite has 10 passing regressions and its related focused
combination passed 135/135. The entity identity suite has 6 passing regressions;
its related V1/actor/migration/Agent/integration checks passed 87/87. No prior
data is split or rewritten. Unkeyed same-name proposals and an explicitly
enrolled card actor remain distinct unless the caller supplies shared identity.
The final complete gate ran with `FLAI_E2E_WORKERS=2`, preserving all
120 browser tests and their original timeouts/assertions.

### Final Complete Gate

`powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` passed with
the current process environment `FLAI_E2E_WORKERS=2`. Full log:
`.runtime-check/review-gate-20261101-220538.log`.

| Check | Final result |
| --- | --- |
| Backend `npm test` | 1848/1848 passed |
| Frontend `npm run test:unit` | 370/370 passed, 38 files |
| Frontend `npm run build` | Passed |
| Frontend `npm run test:e2e` | 120/120 passed, two workers, 3.2 minutes |
| Both production dependency audits | Zero reported vulnerabilities |
| Encoding | 825 files, passed |
| Tracked text whitespace | `git diff --check` passed |
| Actual tool contracts | 64 names / 69 variants / 2 documented polymorphic fields, passed |
| Desktop/mobile/landscape visual inspection | Passed; evidence paths above |

Existing non-blocking diagnostics remain in the maintenance queue: two
possibly unreferenced unrelated components, one unrelated plan textarea label,
and the existing KaTeX bundle-size advisory. None was suppressed or deleted
to obtain a passing gate. New text files are checked separately for trailing
whitespace because Git's ordinary diff check excludes untracked files.

All requested acceptance criteria are satisfied. Validation used isolated
databases and scripted/mock model requests; real-provider extraction quality,
latency, billing and gateway-specific schema compatibility were not measured.
No live data/uploads/environment files were edited, and no real-history
rebuild or historical identity split was executed. Existing uncommitted work
was preserved; there was no commit, push or deployment.
