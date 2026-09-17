# AI Context Runtime Upgrade

This change upgrades the backend pipeline and optional custom-extension runtime
without a new provider dependency. Migration 0013 adds conversation-scoped lore
state; existing settings, provider migrations, and legacy lore rows are preserved.

## Tool Execution

- All chat, Responses, and Anthropic tool loops use the same execution guard.
- Only a tool declared in the current request can execute. Duplicate names fail
  closed, and cached validators follow schema changes.
- Raw arguments must be valid JSON objects within 128,000 characters. The existing
  Zod dependency validates the original JSON Schema before the executor runs.
- Invalid calls return bounded structured errors to the model for correction in
  its remaining rounds. They do not partially write a malformed batch.
- Cancellation still propagates. Valid tool results and stop behavior are unchanged.
- Integer exclusive bounds are normalized exactly. Fractional exclusive bounds,
  explicit closed objects, and strict mode are preserved.
- Gemini adaptation retains union branches and required fields. `oneOf` is offered
  as `anyOf` while the original exclusive constraint is enforced locally; it no
  longer becomes an untyped parameter. See the [Gemini Schema reference](https://ai.google.dev/api/caching#Schema).
- World-book AI editing includes single-entry upsert/removal and a read-only
  trigger preview. Existing IDs and unspecified fields survive partial edits.
  Full replacement remains available for complete generation, while profile-only
  tools cannot smuggle an entry replacement through extra arguments.

## Prompt Construction

The director, character, preset, individual lore entries, current-state sources,
conversation memory, and individual mods are separate prompt messages. Internal
source metadata is removed before messages reach a provider.

Budget eviction follows source priority: mods, conversation memory, oldest whole
history exchanges, current-state sections, then lore entries. Within equally
ranked optional sections, later entries are evicted first. The character contract,
director, preset, and latest actual conversation turn remain intact. Injected lore
does not count as a new user request or split a history exchange.

No instruction or user message is sliced into an incomplete fragment. If protected
content alone exceeds the requested character budget, `budget.overBudget` and
`budget.overflowCharacters` report that condition. This is not a guarantee that a
provider will accept an oversized request. Token counts remain rough estimates;
they are not provider-specific tokenization or image-token accounting.

Preview source sections expose their candidate content plus a `budget` describing
the retained character count. The final `messages` array is authoritative. The
default retrieval query now uses the processed user text instead of an input object.

## Memory Responsibilities

- Conversation extraction proposes disabled, reviewable candidates. User messages
  supply explicit stable interaction preferences; either participant can narrate
  completed story actions. Hypothetical and planned outcomes are excluded
  conservatively by the heuristic candidate extractor.
- Candidate source IDs and excerpts stay with the originating speaker. Missing
  evidence IDs are not replaced with another speaker's message ID.
- Cast projection distinguishes character-specific knowledge from global narration,
  user preferences, and duplicate current-state rows in its prompt contract.
  Execution requires an exact quote from a supplied user or assistant message.
  Speaker identity does not determine whether an action already happened.
  Agents classify evidence as fact, intent, or hypothesis. Intent and hypothesis
  can be retained as memories of the matching type, but cannot establish completed
  events or mutate current-state fields. Classification is the agent's semantic
  responsibility; source, quote, and type consistency are enforced in code.
- Cast organization preserves historical evidence and sealed memories. A newer
  state does not erase an earlier event. Creating or rewriting memory content
  requires validated conversation evidence; metadata-only organization remains
  available without fabricating a new event. Missing evidence is rejected by the
  plan validator and can use the existing plan-repair path.
- Intent/hypothesis labels survive prompt construction and appear as selectable
  types in the existing memory editor. Manual memory editing remains under user
  control.
- Main generation reads confirmed memory as continuity evidence, not as universal
  character knowledge or authority to modify state.

Memory retrieval combines 200 recent enabled, non-archived candidates with up to
100 hits from the existing full-conversation FTS index, so older relevant evidence
is not excluded by the recent window. Ranking uses query relevance, confidence,
and recency. Up to 24 complete entries fit an independent character budget.
Oversized and duplicate entries do not crowd out smaller ones. This is bounded
lexical retrieval, not embedding search or automatic semantic fact verification.

## World Books and Mods

- Each book honors its own scan depth unless an explicit override is supplied.
- Conversation clocks and sticky/cooldown/delay state are persisted separately.
  Previews do not write or advance state, and another conversation cannot consume
  an activation window. Conversation and entry deletion cascade to derived state.
- Saves include the lore clock and activation state. Loading restores them in the
  same transaction as messages; loading a legacy save resets derived lore state.
- Lore budget selection skips an oversized entry and continues considering later
  entries. State activation uses only entries retained by the final prompt budget.
- Depth positions are computed from the original message tail. Same-depth entries
  retain their order and configured roles. All injected lore is labeled as lore.
- Start, before-character, and after-character positions are reflected in actual
  prompt placement instead of being merged into the character contract.
- Mods retain existing loading scopes and ordering. Blank, disabled, and repeated
  IDs are excluded; each mod is retained or omitted as a complete instruction.
- Style mods are limited to expression rather than changing character or world facts.
- Custom-script cleanup callbacks and returned cleanup functions stay in their
  sandbox instead of crossing `postMessage`. They execute in reverse order on
  disposal or script failure; disposal is idempotent and bounded by a timeout.
  The frame remains alive while callbacks need it and is removed after cleanup.
  Both named context helpers and `ctx` work without weakening origin isolation
  or exposing additional host APIs.

The old lore-state table is retained for explicit unscoped callers and to preserve
existing data. It is never imported into real conversation state because its
original conversation cannot be established. No live application database is
modified by the implementation or test workflow; migration runs on normal startup.

## Verification Map

| Requirement | Behavioral coverage |
| --- | --- |
| Tool capability and execution boundaries | `aiToolContracts.test.js`, `worldBookAssistantTools.test.js`, `providers.test.js` |
| Context selection and prompt construction | `aiContextUpgrade.test.js`, `promptBudgetPairing.test.js`, `conversationStreamingRoutes.test.js` |
| Memory responsibilities and evidence | `conversationMemoryExtraction.test.js`, `castPlan.test.js`, `castAutomation.test.js`, `settings-npc.spec.js` |
| Lore isolation, ordering, and save state | `worldBookSessionState.test.js`, `migrationLedger.test.js`, `backend.test.js` |
| Mod guidance and extension lifecycle | `aiContextUpgrade.test.js`, `chat-custom-script-sandbox.spec.js` |

The repository review gate covers full backend tests, encoding, frontend build,
unit tests, browser end-to-end tests, production dependency audits, and Git checks.
