# Memory Packet Contract Fix Plan

Date: 2026-11-01

## Objective

Fix `核心同步失败：记忆 entities 数量无效` at the extraction protocol
boundary. The model must receive the actual bounded packet schema, receive
actionable feedback before finishing, and be able to correct an invalid packet
within the existing bounded tool loop. Invalid output must never become an
empty successful extraction or leave partial canonical/domain writes.

## Required Reading

- `AGENTS.md`
- `docs/conversation-memory-v1-plan.md`
- `docs/conversation-memory-v1-impact-analysis.md`
- `docs/memory-rebuild-recovery-fix-plan.md`
- Affected memory/tool/job sections of `docs/architecture.md`,
  `docs/conversation.md`, and `docs/ai-runtime.md`
- `backend/src/domain/conversationMemory/contracts.js`
- `backend/src/services/conversationMemoryAgent.js`
- `backend/src/services/providerToolResults.js`
- `backend/src/services/conversationMemory/commit.js`
- `backend/src/services/jobs/conversationPostprocessing.js`

## Evidence and Scope

A read-only inspection of the local tool audit found a successful finish call
whose `packet.entities` was an object keyed by three entity keys. It was not an
array exceeding 80 items. The advertised packet schema only specified an
object, and the handler sealed it without validation. Final validation occurred
after optional domain-agent calls. The existing error conflated wrong types
with excessive counts. The finish tool also consumed its sole call before
validation, preventing a direct-handler correction.

Only source, isolated tests, and documentation are in scope. Preserve existing
uncommitted work. Do not modify `backend/data`, uploads, environment files,
dependencies, or generated outputs. Do not retry a real provider or paid rebuild.
No database migration or frontend change is currently needed.

## Actionable Checklist

- [x] Inspect Git state, required documents, extraction/commit/tool boundaries,
  and actual failing argument shape without exposing narrative contents.
- [x] Create the tracked goal and use this plan as the execution reference.
- [x] Define explicit bounded extraction-array/item schemas using the canonical
  packet limits and current field names; exclude server-owned fields.
- [x] Distinguish malformed packet types/items from array-count violations.
- [x] Validate the fully assembled packet before sealing finish and before
  returning prepared work; allow bounded correction while retaining one
  successful finish and the existing maximum loop rounds.
- [x] Keep source versions, actions, message anchors, idempotency and version
  server-owned; account for generated record-memory event projections.
- [x] Remove the obsolete generic schema and late-only-validation behavior.
  Retain final commit validation as the transaction boundary.
- [x] Add regressions through the real tool validator and mock postprocessing
  pipeline, including malformed-to-corrected output, limits, no partial writes,
  prepared validation, and record-memory-only compatibility.
- [x] Review affected paths, update runtime documentation, run checks, and
  record results and limitations here before completing the goal.

## Acceptance Criteria

1. The object-map form observed in the audit is rejected with an array/path
   error and can be corrected in the same invocation without a job retry.
2. All advertised extraction collections have explicit item and count
   contracts. The 80-entity limit remains unchanged; malformed contents are
   not silently dropped or converted to empty memory.
3. Failed finish attempts do not seal the session. Accepted finish is unique,
   correction remains bounded, and packets violating the type, capacity or
   server-field contract cannot trigger downstream domain-provider calls or
   canonical writes. Database-dependent source/reference/temporal semantics
   remain validated at the authoritative atomic commit boundary.
4. Server-generated event projections count toward the combined 80-event
   limit. Server-owned fields cannot be overridden by model output.
5. Existing evidence, privacy, revision, raw-mode, retry and atomicity behavior
   remains covered. No real paid requests or live-data writes are performed.

## Validation Commands

- Focused Node tests for packet contracts, memory agent, provider contracts,
  conversation memory V1, and postprocessing integration/recovery.
- `npm test` from `backend`.
- `node scripts/check-encoding.mjs` from the repository root.
- `git diff --check` for affected tracked text files, with equivalent checks
  for new text files.

## Validation Results and Remaining Work

The previous schema/rebuild-recovery fixes and their completed goals are
retained; this is a separate protocol fix.

- Added one model-owned schema with canonical shared limits, strict array/item
  fields, references, evidence, bounded JSON values, and no server-owned fields.
- Wrong array types, excessive counts, and invalid items now have distinct
  errors. Duplicate nonempty event keys and the reserved `projection:` model
  key prefix are rejected. Legal manual packets remain supported.
- Finish validates before sealing; prepared work is normalized before domain
  planning. The unique successful finish remains mandatory. Handler attempts
  are bounded to three, with the existing eight-round/90-second loop retained.
- All text-tool effects share the same affected-memory ID collection for
  preparation and commit, including metadata, pins, rejected memories and
  merge sources. Final records count once toward the 80-event limit.
- Direct-handler correction, trusted-field rejection and metadata/merge
  capacity regressions passed. Real queue-worker integration tests reproduce
  object-map rejection and same-invocation correction, bounded failure with
  no story writes, and 80 explicit events plus a text projection followed by
  a valid corrected finish. Tests use mock transports and isolated databases.
- Independent read-only review exercised the actual nested schema through
  Chat Completions, Responses and Anthropic mock tool loops, plus Qwen,
  DeepSeek and Gemini outbound adapters; array bounds, optional fields,
  knowledge alternatives and typed nested values were preserved.
- Final `npm test` from `backend`: **1768/1768 passed**, including eight new
  packet-contract cases, four agent-boundary cases, and three queue-worker
  regressions. Final log:
  `C:/Users/34214/AppData/Local/Temp/flai-memory-packet-final-47b8da4d53704b8493568690319d3fcd.log`.
- `node scripts/check-encoding.mjs`: **803 files passed**. Affected tracked
  text files passed `git diff --check`; five affected untracked text files
  also passed explicit whitespace checks. Git only reported its existing
  LF-to-CRLF normalization notices.
- Removed the obsolete staged `contentChanged` marker after all final
  projections switched to the shared affected-ID set; reference search found
  no remaining source or test consumers.
- Updated `docs/conversation.md` and `docs/ai-runtime.md` for the schema,
  correction budget, preparation boundary, and final semantic validation.
- This focused backend/tool-contract repair did not require a frontend build,
  UI screenshots, or the broad-change review gate. Full backend checks cover
  the shared tool metadata; rendered tool labels/descriptions are unchanged.
- No frontend visual changes, live-data changes, migration, or real paid
  provider/rebuild invocation. Remote-model output quality is not verified.
