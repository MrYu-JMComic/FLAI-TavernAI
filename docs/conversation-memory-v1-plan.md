# Conversation Memory V1 Plan

## Objective

Design and deliver one complete, project-native memory system for long-form
fiction and role-play. The system must keep continuity across long chats while
limiting prompt size, preserving provenance, and preventing a character from
using information they have not learned.

This document is the implementation reference. On 2026-11-01 the user
explicitly authorized implementation of the complete V1 and creation of a
tracked implementation goal. Earlier design-only records remain historical.

The follow-up [character memory and workflow upgrade](memory-character-workflow-upgrade-plan.md)
supersedes this document's original default core-wait UI: cast generation now
uses a bounded, protected raw continuity bridge with background synchronization.
Blocking and strict actor modes retain core waiting. Use the follow-up plan
for the current workflow controls, actor workbench and tool-contract audit.

## Required Reading and Implementation Goal

Read `AGENTS.md`, this plan, `conversation-memory-v1-impact-analysis.md`,
`architecture.md`, and `conversation.md` before implementation. Read affected
sections of `ai-runtime.md`, `chat-agent-context.md`, and `maintenance.md`
before changing provider, context, job, or recovery contracts. These documents
are the required reading named in the active tracked implementation goal.

The implementation goal covers all D1-D6 dependency groups. Its execution
order is contracts/storage, atomic extraction, queue/timeline integration,
retrieval/context, settings/interface, then migration/recovery and release
validation. Existing uncommitted changes are preserved and reviewed before
editing overlapping files.

### Implementation Execution: 2026-11-01

- [x] Create the active complete-V1 goal with required Markdown reading.
- [x] Recheck the working tree and read the design/impact baseline.
- [x] D1/D6: canonical schema, source versions, staged extraction, unified
  revision/commit service, policy round trips, bootstrap and legacy migration.
- [x] D2: explicit job scopes, ordered required core, independent derived jobs,
  pre-lock preparation and readiness UI.
- [x] D3: shared context bundle, as-of retrieval, actor permissions, hybrid
  retrieval, hierarchy, trace and prompt budget.
- [x] D4: full save versus compact checkpoint, typed branch remapping,
  deterministic restore, retention/deletion and cache invalidation.
- [x] D5: pinned DashScope adapter, native vector compatibility, scoped index
  generations, fallback, usage and all-connection checks.
- [x] Complete focused/full checks, desktop/mobile visual verification and
  update runtime documentation with actual results and remaining limitations.

The project dependency audit and same-change delivery groups are recorded in
[the change-impact analysis](conversation-memory-v1-impact-analysis.md). That
document is part of this implementation baseline; its A01-A16 rules and D1-D6
delivery groups close cross-module dependencies identified in the current
working tree.

## Scope

- One main generation model can portray the cast, while the memory system tracks
  story characters and their separate knowledge and beliefs.
- Canonical event and evidence records, current state, time-aware relationships,
  unresolved plot threads, and hierarchical summaries.
- Hybrid recall using exact state/entity lookups, SQLite FTS, graph traversal,
  and embeddings from a separately configured provider.
- Version-aware prompt assembly, token budgeting, branches, swipes, edits,
  checkpoints, retries, save/restore, and index rebuilds.
- Migration of current memory records and removal of obsolete parallel recall
  and repeated fact-extraction paths after their replacements are active.
- Memory review, context diagnostics, costs, operational repair, and quality
  evaluation.

## Acceptance Criteria

- A fact has one accepted, traceable source and cannot silently diverge among
  memory, scene, status, economy, quest, and summary representations.
- The system distinguishes an event from a statement, promise, attempt,
  intention, plan, inference, rumor, and false belief.
- Retrieval is restricted to the current user, conversation branch, historical
  cutoff, and eligible actor knowledge before ranking results.
- Current structured state is read directly from its authoritative domain;
  embeddings discover related narrative evidence and do not determine state.
- The complete prompt, including lore, status, cast, memory, tools, and output
  reservation, is subject to a model-window budget. The existing conversation
  allocation retains its current meaning.
- When structured memory is enabled, its required core event/state commit
  completes before the next generation by default. Summary and vector indexing
  may remain pending without hiding accepted facts. Disabled/unconfigured
  memory cannot create an unfinishable synchronization requirement.
- Regeneration, swipe selection, edit, truncation, branching, and restore do not
  retain derived facts from messages outside the selected timeline.
- Memory, graph, summary, and embedding results can be explained, corrected,
  invalidated, and rebuilt from their source records.
- Fixed Chinese story cases cover recall, chronology, actor knowledge,
  contradictions, branch isolation, failure recovery, prompt size, price, and
  latency.

## Project Baseline

The repository is a Node 24+ Express application with Vue/Vite and SQLite via
`node:sqlite`. It already has the following reusable pieces:

- `backend/src/modules/conversationMemories.js` owns current memory CRUD,
  review operations, and bounded memory selection. `backend/src/services/fullTextSearch.js`
  and migration `0007FullTextSearch` provide FTS5 and Chinese-oriented query
  preparation.
- `backend/src/services/conversationMemoryAgent.js` runs a configurable,
  tool-using memory model and validates evidence against the current turn.
  `backend/src/services/conversationMemoryExtraction.js` is the rules fallback.
- `backend/src/services/jobs/jobQueue.js` and
  `backend/src/services/jobs/conversationPostprocessing.js` provide durable
  jobs, idempotency, leases, retries, revision checks, and recoverable steps.
- `backend/src/services/conversationTimeline.js` versions history changes and
  cancels stale work. `backend/src/repositories/conversationSnapshotRepository.js`
  and branch/save modules restore conversation-owned state.
- `backend/src/services/promptPipeline.js` is the prompt compiler;
  `conversationContextBudget.js`, prompt traces, context preview, and the
  Context Inspector provide budget and request diagnostics.
- Chat already has a memory review view and memory-agent settings. Provider
  profiles, network policy, provider HTTP handling, task usage, and model
  settings are also present.
- `backend/src/db/schema.js` has unused `layer`, `importance`, and
  `emotional_intensity` columns on `conversation_memories`. These fields do
  not currently implement promotion or layered retrieval.
- There is no current embedding, vector, or narrative-knowledge-graph runtime.
  Old NPC management was removed, so story actors must be modeled independently
  of the main character card and legacy NPC subsystem.

The current postprocessing pipeline asks several accessory agents to interpret
the same turn separately. The design must centralize evidence extraction while
keeping domain-specific validation and write services authoritative. The
current context budget already trims the whole prompt against a known model
window, but its user-configured allocation primarily limits dialogue history;
V1 must add a conservative total when the model window is unknown, section
allocations, and one resolver shared with previews. Regeneration also builds
history before the target reply while other context can still reflect the
current database state. Both behaviors are explicit integration requirements.

## Architecture Decisions

1. **SQLite remains the authority.** Use normalized tables and transactions
   inside the existing modular monolith. No graph database service or permanent
   per-character agents are required for V1.
2. **The event/evidence log is the source for narrative memory.** Current
   state, summaries, graph edges used for retrieval, FTS rows, and vectors are
   projections. Every projection identifies its source revision and can be
   invalidated or rebuilt.
3. **Existing game-domain services remain authoritative.** Money, quests,
   checks, travel, scene objects, and status values are changed through their
   current domain services. Narrative memory stores provenance and references
   to committed results instead of maintaining parallel balances or objects.
4. **One extraction packet per accepted turn.** The memory model emits a
   structured packet. Code resolves entity IDs, validates evidence and
   permissions, and commits accepted records in one short transaction.
   Specialized agents may produce domain commands, but they consume the same
   packet and cannot independently reinterpret the raw turn as a second source
   of facts. Core commit and downstream durable-job enqueue are atomic.
5. **Summaries and embeddings are derived, rebuildable work.** Core event and
   state records are made available before the next generation. Expensive
   hierarchical summarization and embedding may run in durable background
   jobs.
6. **The prompt compiler receives a fixed context bundle.** Generation,
   preview, and evaluation use the same resolver result, cutoff, actor scope,
   processing watermark, and token accounting.
7. **Vectors use a pinned profile.** The V1 default candidate is
   `qwen3.7-text-embedding-flash`, 1024 dimensions, with document/query modes.
   A query can only compare vectors from the same model profile and processing
   version. Failure falls back to FTS, exact lookup, and graph retrieval.

## Target Module Boundaries

Keep the implementation inside the existing backend/frontend modular
monolith. These are proposed ownership paths, not files created by this design
pass:

| Path | Responsibility |
|---|---|
| `backend/src/domain/conversationMemory/` | Typed record contracts, temporal rules, status transitions, extraction packet validation, and pure ranking policy. |
| `backend/src/repositories/conversationMemoryRepository.js` | SQL for entities, evidence, events, claims, knowledge, summaries, commits, and index metadata. |
| `backend/src/services/conversationMemory/` | Extraction orchestration, validated commit, layered memory, shared retrieval/context resolution, summary jobs, migration helpers, and repair operations, split into focused files. |
| `backend/src/services/embeddings/` | Provider-neutral embedding contract and DashScope implementation; provider response validation and usage accounting. |
| `backend/src/routes/conversationMemories.js` | Authenticated memory review, graph/actor inspection, retrieval diagnostics, and reindex operations. Migrate relevant memory endpoints out of compatibility aggregation routes after clients move. |
| `frontend/src/api/memories.js` | The sole frontend request contract for memory CRUD/review, actor/graph inspection, and retrieval diagnostics. Migrate memory methods in `api/chat.js` and component-direct URLs together; remove transition forwarding after all callers move. |
| Existing chat settings, memory review, and Context Inspector components | User configuration, correction, review, provenance, and prompt diagnostics. |

The commit service owns the only write path for narrative memory. Domain
repositories do not call providers. Provider calls do not run inside SQLite
transactions. Route handlers only authenticate, validate, call a service, and
shape a response. Extraction, search, and command planning finish outside the
transaction. The commit transaction then rechecks the source revisions, job
lease, and base watermark; applies domain mutations; appends accepted narrative
records and its commit receipt; advances the core watermark; and inserts
summary/index work into the durable queue/outbox. These writes commit or roll
back together. `withSavepoint` callbacks remain synchronous and must never
contain provider awaits.

## Data Model

Names below describe logical records; final SQL names and normalization belong
to the implementation review.

| Record | Required fields and behavior |
|---|---|
| Story entity | Stable ID, owner, conversation scope, kind, canonical name, optional reference to a character card or scene object, lifecycle status. |
| Entity alias | Entity ID, alias, locale/normalization, source and confidence. Alias collisions remain unresolved until confirmed. |
| Message source version | Message ID and revision, role, retained source text/attachment metadata, content hash, and timeline membership. Retain the source versions required to explain evidence; a revision counter alone is insufficient. Explicit deletion still follows the user's data-deletion scope. |
| Source evidence | Message ID and revision, timeline revision, quoted span or source excerpt, speaker, and evidence kind. A record may have several evidence rows. |
| Story event | Stable ID, event kind, narrative time/order, system recorded time, participants, location, outcome, extraction batch, and provenance. Accepted events are immutable; corrections append a superseding revision. |
| Claim/relation | Subject entity, predicate, object/value, polarity/modality, truth status, narrative valid-from/to, system recorded-from/to, confidence, evidence, and supersession link. Relations are temporal claims, not timeless edges. |
| Actor knowledge/belief | Actor entity, claim/event, epistemic state (`experienced`, `told`, `knows`, `believes`, `suspects`, `false_belief`, or `unknown`), learned-from event, learned-at order, and evidence. Unknown is usually represented by absence plus an explicit restriction, not a guessed fact. |
| Current-state projection | Domain name/key, authoritative domain record ID or structured value, effective timeline point, projection version, and the event/command that produced it. It never supersedes the owning domain table. |
| Plot thread | Goal, promise, conflict, clue/foreshadowing, or unresolved question; owner/participants, status, expected resolution trigger, and source evidence. Future author plans stay separate from story history. |
| Summary | Level (`scene`, `chapter`, `arc`), text, source range/set, parent summary, generator/profile version, status, and source hash. Summary dependencies permit invalidation and regeneration. |
| Embedding profile/document | Provider profile, model ID, dimensions, normalization and text-template versions, query instruction version, index generation, document kind/source revision/hash, scope key, vector, and state. The raw text remains in canonical records. |
| Memory commit/job | Turn and timeline revision, extraction packet hash, accepted/rejected proposals, idempotency key, processing watermark, attempts, stage status, and audit provenance. |

Narrative time and system time must remain distinct. Narrative order is derived
from the selected message timeline or explicit in-story clock, while system
timestamps record when the application stored or revised the claim. A later
claim can supersede the current view without deleting the historical claim.
An extraction's timeline revision is a write guard, not a requirement that all
valid historical records equal the latest timeline number. Earlier unchanged
messages remain valid members of the new timeline. Content, attachment, and
speaker changes all invalidate affected evidence dependencies.

## Turn Processing

1. Save the generated reply using the existing generation/timeline guard.
2. Create one durable, idempotent memory-processing job bound to conversation,
   message ID/revision, timeline revision, and generation profile.
3. Provide the extractor with the new user/assistant evidence, recent raw
   context, relevant state and memories, and a bounded cast/entity catalogue.
4. Require a schema-versioned packet containing entity references, observed
   events, utterances/claims, commitments, attempts, knowledge changes,
   state/domain commands, plot-thread changes, confidence, and evidence refs.
5. Permit read/search tools for unresolved entities or possible conflicts.
   Write tools stage proposals only; they do not mutate canonical records during
   model tool-loop execution.
6. Validate source message IDs/revisions, owner and conversation scope,
   actor eligibility, timeline, entity resolution, event type, current domain
   revision, permissions, and policy thresholds.
7. Outside a transaction, finish all model calls, conflict reads, and domain
   command planning. Never hold SQLite's synchronous transaction across a
   provider call.
8. In one short synchronous savepoint, recheck job lease, timeline/message
   revisions, and the expected prior watermark; apply validated domain
   mutations through formal services; append accepted events, claims,
   knowledge, commit receipt, and review proposals; advance the core-state
   watermark; and enqueue summary/index work with idempotency keys. The durable
   queue insertion and core commit either both succeed or both roll back.
9. Core commits run in conversation order. A failed earlier core commit blocks
   later core commits from advancing the watermark until retry or explicit
   repair. A worker retry may not restore an old whole-conversation snapshot
   over newer commits. Summary/index workers have their own ordering and
   generation guards; a failed derived job invalidates only its own outputs.
10. Before acquiring the next generation lock or accepting/writing its user
    message, wait for required pending core extraction/commit up to a bounded
    timeout. Recheck the timeline, core watermark, and configuration after
    acquiring the lock; restart preparation if the base changed. Never hold a
    lock while waiting for a job that cannot be claimed under that lock. On
    timeout or failure return a retryable error with `accepted:false`, keep the
    composer/draft/attachments available, and do not generate from stale state
    by default. An explicit continue-with-stale override includes the complete
    raw delta and committed-through watermark. Summary/vector jobs never block
    the default next turn. Send, continue, and regenerate share this behavior.
11. Build a context bundle from one coherent checkpoint. If any raw messages
    are newer than its watermark under an explicit stale-state override, include
    the complete bounded raw delta and label the state snapshot's cutoff.

Interrupted generations are not accepted story turns. The selected swipe is
the accepted content; unselected swipe text is searchable only in an explicit
author/debug scope and is never active story memory.

### Processing Policy and Task Scope

Resolve `requiredStages` from effective user/conversation settings before
scheduling work. `memoryAgent=off` does not call the memory model or create a
memory-core pending requirement; auto without a usable provider uses a clearly
labeled raw-history mode. Explicitly enabled memory with invalid configuration
returns a configuration error before accepting the next message, with a repair
or explicit raw-mode path. Other enabled domain operations keep their own
requirements. Disabling embeddings only removes that retrieval channel.
Public character defaults do not grant the author's provider bindings or
automatic write permissions to another user.

Jobs have explicit owner, conversation, source revision, stage, and index
generation scope. Serial keys control scheduling only. Cancellation, deletion,
timeline invalidation, retry eligibility, and processing summaries query the
explicit scope, so splitting core/summary/index keys cannot hide work. UI
readiness reflects required core stages, independently of derived job failure.

The public `memory.extract` job and manual review endpoints use the same memory
commit/revision service as automatic turns. No legacy rule-write path remains
after migration. Manual edits, merges, invalidation, and undo update dependent
summaries, graph projections, indexes, and caches. A merge may not collapse two
actors' beliefs or two distinct validity intervals just because text is similar.

Migrate current eligibility to explicit candidate/active/superseded/rejected
lifecycle states, using recorded review operations and conservative handling of
ambiguous disabled records. Archive/pin and epistemic truth remain separate
dimensions. Retire the `RECALLABLE_MEMORY_SQL` exception for untouched disabled
auto candidates; one eligibility policy governs all formal recall channels.
Unaccepted rule candidates cannot become world facts, current state, or normal
generation context. Accepted legacy text is not itself permission to mutate
structured domain state without adequate evidence.

User plans and action attempts remain typed proposals. Preserve the current
world-director exception that an unresolved attempt may request a server-side
skill check. Only the trusted server result can establish its outcome.

## Memory Layers and Retrieval

### Layers

- **Canon:** character-card identity, author-approved world rules, and stable
  constraints. Edits are explicit and versioned.
- **Working scene:** recent raw turns, present actors, pending actions,
  immediate questions, and short-lived scene state.
- **Current facts:** exact current location, health, ownership, relationship
  projection, active goal, and knowledge permissions, read from typed records.
- **Narrative history:** atomic events, promises, conflicts, emotional turns,
  resolved plot points, and source evidence.
- **Hierarchical summaries:** scene, chapter, and arc overviews that point to
  the underlying event set and are regenerated when that set changes.

Promotion is policy-driven. Repetition, author pinning, consequence, recency,
emotional significance, unresolved obligation, and contradiction can affect
priority. Recency decay may lower retrieval priority but never deletes evidence.
Pinned memories still obey a documented hard prompt budget.

### Retrieval Order

1. Resolve `user_id`, conversation, selected branch/cutoff, and active speaker
   or explicitly requested narration scope.
2. Read canonical state, active plot threads, actor knowledge, and core canon
   through indexed structured queries.
3. Resolve entity names, aliases, pronouns, and local time cues using recent
   dialogue plus the current cast. An ambiguous entity stays unresolved.
4. Run exact/entity retrieval, FTS, dense-vector search, optional sparse search,
   and bounded graph expansion over already eligible IDs.
5. Deduplicate results by source event; rerank using relevance, exact entity
   match, actor eligibility, importance, unresolved status, and recency.
6. Pack by section budget while preserving mandatory current state, recent
   dialogue, core canon, and explicit user intent. Record selected and omitted
   candidates with reasons.

The resolver enforces branch visibility before retrieval. Actor visibility is
applied to every section of the final prompt: recent messages, memories,
summaries, world-book text, cast descriptions, state, graph expansions, tool
results, and citations. The single-agent mode is a soft role-play boundary
because the model may see multiple speaking characters in one generation. A
strict-secret mode must build a single-actor view across all sources or invoke
the same generation model separately for each constrained viewpoint.

Shared lore uses portable cast references mapped to conversation-local actor
IDs; it cannot embed an arbitrary session actor ID. Define public knowledge,
author-only truth, and restricted lore policies in the editor, AI schemas,
normalization, matching, import/export, and runtime. A lore entry excluded by
actor scope or final budget must not consume an injected-entry sticky/cooldown
transition. Preview remains free of state mutations.

### Prompt Budget

Keep the existing `inputTokenLimit` as the user allocation for dialogue history.
Reuse the existing known-model-window estimate and whole-prompt trimming, then
add model capability resolution, a configured conservative total when the
window is unknown, and category ceilings/floors for system/preset, canon,
world-book lore, current state/actor knowledge, working scene, summaries,
retrieved events, tools, and media. Estimate all messages together. Trimming
preserves current state and near-recent continuity before older optional recall.
If mandatory state, canon, recent input, and output reservation cannot fit
together, stop before calling the provider and report the exact sections and
estimated overage; never silently omit a required fact or exceed the known
window.

## Embedding and Index Plan

Use the cloud embedding configuration independently from the memory extraction
model. The API key stays in the existing encrypted provider configuration and
is never sent to the browser or written to source files. The settings UI must
state that selected narrative text is sent to the configured embedding
provider. A user can disable cloud embedding; FTS and graph retrieval remain
available.

Initial profile:

- Provider: Alibaba Cloud DashScope, using the official embeddings API.
- Model: `qwen3.7-text-embedding-flash`.
- Dimensions: 1024 by default; the profile pins the chosen dimension.
- The official Beijing synchronous API page currently lists 1024/768/512/256
  dimensions, 20 input rows per request, up to 128,000 tokens per input,
  201 languages/dialects, and a list price of CNY 0.000125 per 1,000 input
  tokens (Batch: CNY 0.000063). These are reference values as checked on
  2026-11-01; runtime accounting must use provider-reported token usage and a
  dated regional price record.
- Index text: compact, self-contained event statements with actor names,
  aliases, narrative time, relevant object/place, event type, and epistemic
  scope. Index source snippets and accepted event summaries as separate
  documents with source references.
- Query: construct from current input, recent scene, active entities, and
  unresolved references; use `text_type=query`. Use `text_type=document` for
  indexed records. Store any instruction-template version with the profile.
- Batching: respect the documented limits of 20 strings and 128,000 tokens per
  string for this model. Story events should remain small retrieval units; the
  large per-input limit is not a reason to embed whole books as one document.
- Cost: record provider usage, CNY amount, price source/effective date, and
  operation type (`ingest`, `query`, `rebuild`). Price data must be configurable
  or versioned rather than a stale constant.

Use SQLite tables as authority and evaluate pinned `sqlite-vec` for indexed
nearest-neighbor retrieval. The library documents a Node.js `node:sqlite`
binding and a Windows x64 package. The implementation must explicitly test
`DatabaseSync(..., { allowExtension: true })`, load only the pinned bundled
library, disable extension loading immediately after initialization, and verify
packaged deployment, backup/restore, native binary integrity, and actual
conversation-scope query plans/correctness before committing to the dependency.
Extension loading must use only the bundled, pinned library; never accept a
filesystem path from a request.
If extension compatibility fails, preserve the embedding provider boundary
and select a compatible local SQLite vector implementation before schema and
API contracts are finalized.

Vectors are derived and may be rebuilt. Model or template changes create a new
index generation; query only the active completed generation. Build and verify
the replacement, then atomically switch its active marker. Never compare vectors
from different model profiles even when their dimensions match. Provider
failure falls back to exact, graph, and FTS search while recording pending
index work.

Task capability and model catalogue caches distinguish chat from embedding.
Provider profile IDs do not themselves identify a vector space: changing model,
endpoint semantics, dimensions, or text processing in the same profile creates
a new effective fingerprint. Reuse network/secret infrastructure, but account
for embedding usage exactly once with explicit currency and price version.

## Timeline, Branches, and Restore

- Bind every event, claim, knowledge change, summary, and job to source message
  revisions and the conversation timeline revision.
- Create a versioned bootstrap baseline from character/lore/opening-message
  sources for a new conversation. An explicit accept-current action creates an
  `adopted_baseline` whose accepted state and missing historical coverage are
  recorded separately; it does not fabricate a fully extracted event history.
- Extend message/timeline invalidation to derived memory dependencies. A stale
  job cannot commit after a swipe, edit, truncation, branch, or restore.
- Add an `as_of` read mode anchored to the message before the regenerated
  target. Resolve memory and typed state from the matching checkpoint without
  changing the live conversation during prompt construction.
- At a branch point, copy or project only records visible through the selected
  message. Remap source IDs consistently. Branch-local future records remain
  in the parent and cannot rank as candidates in the child.
- Register typed ID-reference mappings for evidence, commits, summary ranges,
  and JSON payloads. Do not rely solely on key-name regexes or remap provider,
  model, and shared character-card references. Recompute source hashes/index
  keys after copying local sources.
- Separate full saves/exports from per-turn checkpoints. Full saves/exports
  contain the canonical event/claim/evidence/knowledge/plot-thread records
  needed for restoration; compact per-turn checkpoints contain materialized
  current projections plus an event-commit watermark and revision reference,
  never a repeated copy of the append-only log.
- Extend snapshot versioning and branch-copy logic for canonical records.
  Branch creation copies or links the visible event-log prefix once and remaps
  references consistently. Restore verifies the referenced log base remains
  available; compaction cannot prune records needed by a save or branch.
  Keep large embedding vectors out of checkpoints and full exports; restore
  marks the affected scope for reindexing.
- Use accepted event/command journals and compact state checkpoints for
  deterministic restore. Do not ask a model to reinterpret the whole old chat
  just to restore state.
- Core jobs are serialized by conversation and base watermark. Derived summary
  and index jobs use separate idempotency/version rules and may run
  independently; their failure handlers only delete or mark stale outputs
  produced by that job, never restore a full old state snapshot.
- Retain old messages/swipes for audit and user-selected alternatives, but
  distinguish active timeline content from discarded alternatives in every
  retrieval API.

Full save/export, compact checkpoint, diagnostic project snapshot, and author
asset envelope are distinct contracts. Update hardcoded v2 save readers and
responses along with repository versioning; existing author asset envelopes do
not support full conversations. Full conversation portability needs its own
schema, size limits, owner validation, and reference mapping. Character-card
sharing never implicitly includes private story memory.

Restore, branch, corrections, lore/configuration changes, and domain commits
invalidate context/projection caches with source revision fingerprints. The
bundle and trace identify the actual configuration, memory/knowledge revision,
core watermark, as-of cutoff, database restore generation, and active index.
Historical requests remain inspectable even when a fresh preview would differ.
Async previews use the same resolver without committing lore transitions;
viewing traces or polling progress does not repeatedly call paid embeddings.

Native-extension verification covers every connection factory, including
backup integrity checks, restore preflight/drills, migration connections, and
test databases. Conversation/character deletion cleans scoped vectors, tasks,
and caches and rejects late provider results. Retention preserves referenced
logs; new records and vector BLOBs are included in scoped storage quotas and
diagnostic counts.

## Project Integration and Cleanup

| Existing path | V1 responsibility |
|---|---|
| `conversationMemoryAgent.js` and `memoryAgentTools.js` | Keep provider selection, cancellation, and evidence-safe search. Replace direct per-tool canonical writes with schema-validated proposal packets and one commit service. |
| `conversationMemoryExtraction.js` | Retire regex-derived facts as accepted truth. Retain only deterministic safe parsing or unresolved-candidate output where it has measured value. |
| `conversationMemories.js` | Split repository persistence, review, retrieval, and prompt rendering into owned services. Keep one temporary API adapter while existing UI calls migrate. |
| `fullTextSearch.js` and FTS triggers | Keep FTS as one first-class retrieval channel, add actor/branch eligibility joins and rank inputs, remove duplicate legacy memory-only lookup after context resolver parity. |
| `conversationPostprocessing.js` / job handlers | Make one fact packet the source for narrative updates; retain durable job machinery, stage recovery, revision guards, and domain-specific transaction boundaries. |
| Accessory agents | Preserve specialized functions such as template editing, map organization, and domain operations. Consume the canonical packet or emit typed commands; remove duplicate free-form interpretation of the same turn. |
| `conversationTimeline.js`, branches, swipes, snapshots | Extend established timeline invalidation, checkpoints, idempotency, ID remapping, and recovery to new authoritative data. |
| `promptPipeline.js` | Compile only the prepared context bundle. Remove fixed-character memory injection and in-memory keyword backfill once the resolver supplies equivalent or better results. |
| `contextPreview.js`, prompt trace, Context Inspector | Use the same bundle and selection manifest as generation. Show actual recalled sources, filters, token contributions, and omitted reasons. |
| Memory review/settings UI | Extend the current workbench for actors, events, claims, plot threads, source revisions, corrections, embedding profile/status, and provider privacy. Do not create a duplicate memory console. |

## Proposed Delivery Checklist

The implementation checklist below is tracked against the current working
tree. Runtime checks and external provider evaluation have separate statuses;
implemented behavior does not imply measured live-model quality.

- [x] Deliver all A01-A16 dependency requirements and D1-D6 groups in the linked
  impact analysis, including public/manual entry points, configuration round
  trips, job scopes, all database connections, export consumers, and UI guards.

### 1. Contracts and storage

- [x] Define schema-versioned extraction packet and typed event/claim/knowledge
  contracts in the memory domain.
- [x] Define canonical ownership rules for every current status and gameplay
  field so each value has one formal writer.
- [x] Add migrations for entities, aliases, evidence, events, relations/claims,
  actor knowledge, plot threads, summary dependencies, embedding profiles,
  index generations, and processing watermarks.
- [x] Specify temporal fields, status transitions, foreign keys, indexes,
  uniqueness/idempotency keys, and deletion/retention behavior.
- [x] Define how current memories map into the new records; leave ambiguous
  subjects and summaries reviewable instead of guessing identities.
- [x] Define the `sqlite-vec` compatibility and packaging spike with pass/fail
  criteria before depending on native extension loading.

### 2. Extraction and commit

- [x] Implement a single extraction orchestrator using existing provider
  settings and durable job execution.
- [x] Change memory tools to read/search or stage proposals; commit only after
  packet validation.
- [x] Preserve multi-source evidence, message revision, narrative order, and
  actor knowledge scope.
- [x] Route accepted gameplay/state changes through current domain services and
  journal their outcomes in the same application mutation boundary.
- [x] Make extraction idempotent, stale-safe, recoverable, and visible in job
  progress; define safe behavior when the extraction model is unavailable.
- [x] Connect the existing `layer`, `importance`, and emotional metadata to
  explicit promotion, retention, and context-priority rules or remove the
  redundant fields during migration.

### 3. Summary, graph, and retrieval

- [x] Implement canonical entity resolution and alias review, including
  ambiguous names and pronouns.
- [x] Implement temporal graph queries over eligible actor/event/claim records.
- [x] Implement hierarchical summaries with bounded source ranges and
  dependency-based invalidation/rebuild.
- [x] Add the embedding provider interface and DashScope adapter with response
  count/dimension/finite-number validation, retry policy, batching, timeouts,
  and accounting.
- [x] Implement versioned vector indexing, scope filtering, active-generation
  switch, backfill, retry, and rebuild.
- [x] Create one retrieval service that combines exact state, aliases, FTS,
  vector, and bounded graph expansion; deduplicate and rank once.
- [x] Define ranking and hard exclusion rules, including user, branch, actor,
  validity interval, rejected/superseded state, and discarded swipe scope.

### 4. Context, revisions, and interface

- [x] Add one version-pinned context resolver and `contextBundle` consumed by
  generation, preview, and evaluation.
- [x] Extend existing whole-prompt budget logic with a conservative unknown
  window, section budgets, and an explicit mandatory-context overflow response
  while preserving dialogue-history allocation semantics.
- [x] Add processed-through watermarks, per-conversation core-job ordering,
  bounded wait/retry behavior, and explicit stale-state override semantics.
- [x] Add point-in-time retrieval for regeneration and branch restore.
- [x] Separate compact checkpoints from complete save/export records; extend
  branch copies, backup, restore, retention, and recovery without serializing
  the full event log into every checkpoint; regenerate vectors after restore.
- [x] Extend existing memory review, memory settings, Context Inspector, and
  processing status UI with actor views, provenance, corrections, retrieval
  reasons, index status, token use, price, and privacy disclosure.
- [x] Migrate current memory APIs and remove superseded write/retrieval paths
  only after reference and parity checks.

### 5. Evaluation and release

- [x] Add deterministic tests for temporal truth, source validation, entity
  identity, actor knowledge, idempotency, stale jobs, and projection ownership.
- [x] Add branch/swipe/edit/regenerate/restore tests proving future or discarded
  memories cannot affect earlier prompts.
- [x] Add provider tests for query/document mode, dimensions, malformed
  responses, batching limits, model-version separation, cost accounting, and
  FTS fallback.
- [x] Add a fixed Chinese story set covering a long-delayed promise, lie and
  false belief, object transfers, secret disclosure, alias/pronoun resolution,
  changing alliances, unresolved clues, and an edited/re-generated scene.
- [ ] Measure event extraction precision, retrieval recall@k, wrong-state rate,
  actor-secret leakage, context tokens, total CNY cost per turn, indexing cost,
  and p50/p95 latency. Compare equivalent story quality against the current
  pipeline.
- [x] Run data migration/restore drills and full regression gates before
  rollout; retain a recovery route for failed index builds.

## Acceptance and Validation

The V1 release is accepted only when all acceptance criteria above pass and the
following project checks pass:

- Backend: `npm test` from `backend`.
- Frontend: `npm run build` and `npm run test:unit` from `frontend`.
- UI: run affected chat/memory/context-inspector flows and capture desktop and
  mobile screenshots; inspect layout and record image paths in the execution
  plan.
- Full gate: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.
- Encoding: `node scripts/check-encoding.mjs`.
- Text diff: `git diff --check`.
- Runtime evaluation: `npm run evaluate:context` from `backend`, extended to
  report semantic memory cases and provider-backed cost/latency when enabled.
- Provider smoke: optional credentials only in local environment; verify
  Qwen query/document calls, batch response order, privacy settings, and
  failure fallback without exposing keys or story text in logs.

Implementation validation is recorded below. The earlier design-only record
remains historical; it is not a statement about the current implementation.

## Implementation Results: 2026-11-01

The active tracked goal names the required reading above. Implementation covers
the complete D1-D6 group rather than a separate prototype or parallel memory
runtime. No commit, push, deployment or paid provider request is part of this run.

### Delivered modules and boundaries

- `shared/memoryPolicy.js`, `shared/loreKnowledge.js`, domain contracts and
  migrations `0030`-`0033` define one policy, canonical schema and lore audience
  contract. Legacy accepted records become evidence-backed canonical records;
  uncertain candidates remain excluded until review.
- `services/conversationMemoryAgent.js` stages all tools. `conversationMemory/commit.js`
  validates evidence, source revisions, entity references and commit ancestry.
  `domainPlanning.js` runs the existing domain writers on a private state copy;
  validated domain changes, memory facts, watermarks and durable outbox rows
  commit together. Failed or unfinished extraction commits no partial facts.
- `processingPolicy.js` and the job queue wait for required core work before
  acquiring generation locks or accepting user input. Core failure blocks the
  next required core; summary/index failures retain independent retry/readiness.
  Off/raw/unconfigured-auto modes never promote rule guesses to world facts.
- `retrieval.js`, `context.js` and `resolvedPromptPipeline.js` share eligibility,
  FTS/Chinese lexical/entity graph/vector recall, valid-time claims, canon
  priority and one budgeted context bundle. Historical reads pin both a message
  cutoff and a checkpoint commit. Checkpoint domain/lore state is projected into
  an isolated connection; the live conversation is never restored for preview.
- Strict actor prompts filter every source, omit unclassified raw history,
  author summaries, full author cards, presets, mods and unscoped domain data.
  False-belief text replaces the underlying author truth. Author plot triggers
  are also hidden in the actor workbench. Default cast generation is explicitly
  soft isolation.
- Snapshot v3 carries canonical memory in full saves and only a compact commit
  receipt in per-turn checkpoints. Typed remapping preserves branch evidence;
  v2 restore remains supported. Restores invalidate derived indexes and scene
  caches. A 10,001-event restoration regression verifies no hidden 10k cutoff.
- `services/embeddings/` pins DashScope document/query semantics and an explicit
  owned provider profile. Native vector queries apply owner/conversation and
  canonical eligibility before top-k. Generation guards reject late responses
  from invalidated indexes. Active generation switching, rebuild, bounded
  generation retention, fallback, quota reservation and single usage settlement
  are covered independently of the core transaction.
- The sole frontend memory API serves review, structured corrections, actor
  knowledge, provenance, watermarks and reindex controls. Shared settings survive
  partial overrides and round trips; portable cards remove private provider and
  conversation actor bindings. World-book knowledge scope is preserved through
  editor, AI draft, import/export, preview and actual triggering.
- Related obsolete runtime routes/retrieval paths were retired. Historical
  migrations and the rule parser remain only for supported upgrades or explicit
  diagnostic contracts. Existing unrelated work, including deleted old renderer
  files, was preserved. Relevant old source-contract tests were migrated to the
  current rendering behavior without restoring the deleted implementation.

### Validation record

- Initial complete gate found two outdated E2E contracts and production
  dependency advisories. The model cache fixture must use its task-aware v2 key;
  merge review is now an accessible dialog. Their behavior is checked through
  real requests rather than dropping assertions.
- Required dependency audit fixes stay within compatible releases:
  backend Zod 4.6.7, body-parser 2.4.0, qs 6.17.1; frontend markdown-it 15.0.3
  and Vite 8.3.5. Both production audits then report zero vulnerabilities.
- Native compatibility: Windows x64, Node 24.16.0, `sqlite-vec@0.1.9`.
  A temporary directory with only backend package files completed
  `npm ci --ignore-scripts`; real scoped KNN, eligibility-before-top-k and
  disabled subsequent extension loading passed. Backup/restore connections have
  separate regression coverage. The final lockfile was rechecked in
  `C:/Users/34214/AppData/Local/Temp/flai-embedding-final-clean-5c16607380bf418ab33815639d4c900c/`:
  127 packages installed, and all four native smoke assertions passed.
- Meaningful integration regressions cover atomic domain+memory acceptance,
  evidence-failure rollback, durable receipt reuse, outbox uniqueness, API
  optimistic concurrency, actor false beliefs, same-order historical corrections,
  independent derived failures and scoped cancellation.
- The synchronous Chinese evaluation is version 3: eight fixed cases and 42
  invariants cover temporal truth, false belief, actor knowledge, aliases,
  object ownership transfers, alliance validity, a promise after 20 dialogue
  turns, unresolved/resolved clues and bidirectional checkpoint selection.
  Its original small retrieval fixture is reported separately and is not a
  measured overall or live-model recall score.
- Complete review gate: PASS. Backend `npm test`: 1720/1720; frontend unit:
  348/348 across 37 files; frontend build: PASS; Playwright: 116/116; backend
  and frontend production dependency audits: zero vulnerabilities; text diff:
  PASS. Gate log: `.runtime-check/memory-review-gate-complete.log`.
- The final synchronous recovery-step snapshot uses a compact memory receipt,
  and historical diagnostics report the selected checkpoint's memory revision
  and watermark. Focused timeline, projection, integration and evaluation
  checks after these refinements passed 33/33; the historical/evaluation
  subset passed 5/5 after the diagnostic assertion was added.
- `npm run evaluate:context`: PASS, 42/42 invariants, zero fixture wrong-state
  changes and zero fixture secret leaks. Output:
  `.runtime-check/memory-context-evaluation-final.json`.
- Final backend confirmation after the recovery/diagnostic refinements:
  1720/1720 PASS (`.runtime-check/memory-backend-confirmation.log`). Final
  encoding check: 790 files PASS. Both working-tree and staged text-diff checks
  pass; the two plan/impact documents' local Markdown links resolve.
  No live provider result is inferred from these checks.

### Visual verification

Desktop 1440 x 1000 and mobile 390 x 844 were exercised by
`frontend/e2e/conversation-memory-v1.spec.js`. Both tests passed. All 14 PNGs were
actually opened and checked for spacing, text wrapping, contrast, overflow,
clipping and overlapping controls. The mobile edit form was refined so its
actions remain available while its body scrolls. Final affected states include
recall, actor knowledge, manual editing, structured packet editing, settings,
embedding settings and lore audience editing.

Screenshot directories, relative to the repository root:

- `.runtime-check/playwright-results/conversation-memory-v1-mem-548b6-ngs-remain-usable-at-1440px-chromium/`
- `.runtime-check/playwright-results/conversation-memory-v1-mem-b15ec-ings-remain-usable-at-390px-chromium/`

Each directory contains `memory-recall-{width}.png`, `memory-actors-{width}.png`,
`memory-edit-{width}.png`, `memory-packet-{width}.png`,
`memory-settings-{width}.png`, `memory-embedding-{width}.png`, and
`lore-knowledge-{width}.png`.

### External validation still required

No real Qwen or story-generation provider was called. The Chinese evaluation is
a deterministic repository contract check; its retrieval and timing numbers
describe fixtures/local processing. They cannot establish model extraction
precision, equivalent long-form story quality, actual CNY cost or provider
p50/p95 latency. The unchecked live-measurement item remains explicit. Native
Windows installation was tested; other OS/CPU deployment targets were not.

## Design Execution Record: 2026-11-01

- [x] Inspect the current worktree and map existing memory, generation, job,
  snapshot, configuration, review UI, and provider capabilities.
- [x] Create the complete V1 architecture and dependency-ordered checklist.
- [x] Inspect current uncommitted changes and preserve their behavior as a
  baseline; identify direct and indirect consumers in an impact report.
- [x] Independently review backend, frontend, and cross-module impact; fold
  lock ordering, task scoping, configuration modes, source versions, bootstrap,
  save/export contracts, trace/caches, and cleanup requirements into this plan.
- [x] Run encoding and changed-document whitespace/path checks. The encoding
  checker passes; no changed-document whitespace errors were found.
- [ ] Implement the feature and run application tests, screenshots, provider
  evaluation, and native-extension compatibility checks in an implementation
  phase. No such results are claimed by this design-only pass.

## Risks and Decisions to Confirm During Implementation

- `sqlite-vec` is a promising fit for the repository's SQLite and Node stack,
  but extension loading, package support, and real conversation scoping must be
  proven on supported Windows deployments before schema commitment. The spike
  must include enabling extension loading for initialization, loading the fixed
  package path only, disabling it again, and testing the actual query plan.
- A single call portraying several actors cannot provide hard secret
  isolation. V1 must label the default as soft isolation and provide an
  actor-scoped generation mode for strict secrecy.
- Model extraction can misclassify claims. Uncertain entity resolution,
  contradictions, and high-impact changes must stay reviewable; evidence
  strength is not truth confidence.
- Cloud embedding sends selected story text to Alibaba Cloud. The user must
  select/configure that provider with a clear privacy disclosure.
- Provider usage formats and regional pricing differ. Cost metrics must keep
  currency, region, price version, and provider-reported token usage.
- Existing save and branch code copies conversation-owned table sets. New
  tables must be added deliberately, and vector tables should be rebuilt rather
  than copied blindly.
- Existing project changes are present in the working tree. Implementation
  must re-check status and preserve unrelated work before touching shared
  files.

## Recorded-schema compatibility follow-up

The first complete regression pass used fresh databases and did not cover an
already-recorded early 0030. The reported missing `parent_commit_id` is handled
by forward migrations 0034 and 0035, including intermediate uniqueness rules,
FTS repair and conservative legacy provenance. This is a separate repair batch;
the earlier validation counts remain historical. Required reading, regression
cases and final results are tracked in
[the schema upgrade repair plan](memory-schema-upgrade-fix-plan.md).
The later failed-opening report additionally required projection migration
0036 and checkpoint/API/UI recovery fixes; see
[the rebuild recovery repair plan](memory-rebuild-recovery-fix-plan.md).

## External Technical References

- Alibaba Cloud Model Studio embedding guide:
  https://help.aliyun.com/zh/model-studio/embedding
- Alibaba Cloud synchronous embedding API:
  https://help.aliyun.com/zh/model-studio/text-embedding-synchronous-api
- sqlite-vec JavaScript/Node binding, including `node:sqlite`:
  https://alexgarcia.xyz/sqlite-vec/js.html
- Node.js v24 SQLite API:
  https://nodejs.org/docs/latest-v24.x/api/sqlite.html
- Long-term conversational memory evaluation:
  https://arxiv.org/abs/2410.10813
