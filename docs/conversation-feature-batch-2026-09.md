# Conversation Feature Batch: 2026-09

Date: 2026-09-10. This batch implements the first two tiers of the conversation
review delivered on the same day, plus the user's request for a per-conversation
model source and operation library on the NPC management agent. Existing
conversation reliability, context budget and memory review work is preserved.

## Scope

### Fixes to existing behaviour

- Regenerate: `POST /conversations/:id/messages/:messageId/regenerate` (JSON and
  SSE) regenerates the latest assistant reply in place. The previous text is
  retained as a swipe, no recovery save is written, the pre-message checkpoint is
  restored and postprocessing is re-queued. The frontend "下一条候选" arrow past the
  last stored candidate now performs this regeneration instead of storing a copy
  of the current text. A "重新生成" button is shown on the latest reply.
- Tail truncation: `POST /conversations/:id/messages/truncate` deletes a message
  and everything after it as one history change. Rerunning an edited prompt uses
  it, so one recovery save and one job cancellation replace one per message.
- Recovery retention: `saves.kind` (migration `0018`) separates automatic
  recovery points from manual saves. `conversationRetention.js` keeps at most
  `CONVERSATION_RECOVERY_SAVE_LIMIT` recovery saves per conversation and removes
  step snapshots and pending checkpoints of settled or superseded jobs after
  `CONVERSATION_STALE_JOB_STEP_DAYS`. The sweep runs at startup and after each
  recovery save. Switching candidates no longer writes a recovery save. The save
  panel folds recovery points behind a toggle.
- Display regex: the `display` scope can now be stored and selected; the existing
  display-time application branch was previously unreachable.

### Memory agent

`services/conversationMemoryAgent.js` replaces the heuristic-only memory step
with a tool-driven review when the `memoryAgent` accessory skill is `auto` or
on and a provider is usable. Tools are registered in the `memory` domain of the
tool registry and audited like other job-step tools:

| Tool | Effect | Default |
| --- | --- | --- |
| `search_memories`, `search_history`, `finish_memory_review` | read | on |
| `record_memory`, `update_memory`, `merge_memories` | write | on |
| `invalidate_memory`, `pin_memory` | write | off |

Evidence rules: `sourceMessageId` must be one of the two observation messages;
an exact quote keeps the model's confidence, a paraphrase is capped at 0.6 and a
missing quote at 0.5. Pinned memories cannot be modified, merged or invalidated
by the agent. Revisions are checked on every write. Disabled skill, unusable
provider or an agent failure fall back to the previous rule extractor.

### Provider source for accessory skills and the NPC agent

`services/accessorySkillProvider.js` resolves a skill to either the main chat
settings (optionally with a model override) or a saved provider profile. Missing,
unusable or policy-rejected profiles fall back to the main settings with a
warning. All accessory agents use it; the memory agent and the NPC management
agent expose it through dialogs.

`castTracking` gains `providerProfileId`, `modelOverride`, `autoSyncOperations`
and `organizeOperations`. The projector and both organizer entry points resolve
the provider through `services/cast/castAgentSettings.js` and narrow the
`CastChangePlanV1` operation variants offered to the model. A proposed operation
outside the conversation's library is rejected with
`CAST_PLAN_FORBIDDEN_OPERATION` before anything is written. The model still
receives no tools; see the dated amendments in `NPC_REFACTOR_TASKS.md`.

## Verification

- Backend suites touched by this batch pass in isolation: streaming routes,
  timeline, memory review, memory agent, cast agent settings, cast automation
  (except one pre-existing evidence assertion), accessory agents, tool contracts,
  migration ledger, backup service and the frontend chat contract suites.
- Frontend production build, `node scripts/check-encoding.mjs` and the affected
  Vitest/contract suites pass.
- Browser check on an in-memory database with the mock provider: register, chat,
  regenerate (candidate counter shows `1/2` afterwards), open the memory agent
  and NPC agent dialogs, and fold recovery saves.

### Pre-existing failures in the shared working tree

The full backend run still reports failures that predate this batch and match
the superseded contracts listed in `context-memory-quality-stage-4.md` (budget,
pending memory, evidence, cancellation and Anthropic defaults). They were
reproduced with this batch's changes reverted and are not modified here except
where a test asserted an implementation detail this batch replaced.
