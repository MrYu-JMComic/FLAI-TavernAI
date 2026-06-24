# Chat Context Director Design

## Goal

Make the main chat assistant smarter in the order approved by the user:

1. Use available information more accurately.
2. Preserve context continuity.
3. Keep role behavior stable.
4. Push story only when it does not conflict with higher-priority facts.

This is the first iteration in the broader assistant-improvement sequence:

1. Main chat assistant.
2. Background accessory agents.
3. Character draft assistant.
4. World book draft assistant.

This spec covers only the first item.

## User-Approved Priority Model

When context conflicts, the assistant should follow this priority order:

1. Explicit user instruction.
2. Core character card identity and persona.
3. World book rules.
4. Status bar and NPC memory/state.
5. Recent conversation details.

The assistant should use lower-priority context to fill gaps, preserve continuity, and enrich the scene, but not to override higher-priority context.

## Architecture

Add a small backend context director layer for the main chat prompt path.

The layer should live near the existing chat message construction flow in `backend/src/routes/conversations.js`, where `buildModelMessagesV2()` currently combines character data, world book context, Mods, NPC behavior, talent prompts, presets, and recent messages.

The director should not query the database, call providers, mutate messages, or change frontend behavior. It should only generate a stable system prompt block that explains how the model should use the context already assembled by the route.

The resulting system message should sit after the base character context and before the preset system prompt. That placement keeps the director close to the core role instructions while still allowing user-selected presets to add final session-specific guidance.

## Components

### `buildContextDirectorPrompt()`

Create a helper that accepts the context fields already passed into `buildModelMessagesV2()`:

- `worldBookContext`
- `worldBookEntries`
- `modSystemPrompt`
- `npcBehaviorPrompt`
- `talentPrompt`

The helper returns a non-empty string containing the core priority and conflict-handling guidance. It conditionally adds source-specific instructions only for active context sources. Recent history and user text are not inputs for the first implementation; they already enter the model as chat messages.

### `buildModelMessagesV2()`

Update message assembly so the director block is appended to the system message list after the base character prompt.

The current flow already builds:

- one base system prompt from role card and optional context text,
- an optional preset system prompt,
- recent chat history,
- the current user message.

The new flow should keep that shape. It adds one director system message between base and preset.

## Data Flow

1. The route resolves existing context exactly as it does today: role card, world book matches, Mods, accessory skill prompt state, talents, preset, history, and current user text.
2. `buildModelMessagesV2()` renders the base character prompt.
3. `buildContextDirectorPrompt()` receives the already-normalized context signals.
4. The director prompt describes:
   - context priority,
   - conflict handling,
   - natural use of active context sources,
   - continuity expectations,
   - role stability expectations,
   - restrained story progression.
5. Provider request generation proceeds unchanged.

No database schema, API contract, streaming protocol, frontend UI, or provider integration changes are required for this first iteration.

## Prompt Behavior Requirements

The director prompt should instruct the model to:

- Treat explicit user instructions as highest priority.
- Preserve the character card's core identity and speaking style.
- Apply matched world book facts as setting rules and lore constraints.
- Use NPC/status/talent/Mod context naturally when relevant.
- Let recent messages preserve continuity without overriding higher-priority facts.
- Avoid exposing internal context section names, hidden rules, or system mechanics.
- Avoid mechanically listing context.
- Advance the scene only when it fits the established role, setting, and recent exchange.

When optional context is absent, the prompt should not claim that source exists.

## Error Handling

The director must be fail-soft:

- Empty or missing context fields should be treated as absent.
- Malformed optional arrays or objects should not throw.
- The chat route should not fail because the director cannot describe a context source.
- Existing provider, streaming, image-generation, and accessory-agent error paths remain unchanged.

The helper should use simple string and array checks rather than new parser dependencies.

## Testing

Add focused backend tests that prove:

1. The director prompt includes the approved priority order.
2. The director prompt mentions world book guidance only when world book context or entries are present.
3. The director prompt mentions NPC/status guidance only when related context is present.
4. The director prompt mentions Mod and talent guidance only when those prompts are present.
5. `buildModelMessagesV2()` inserts the director after the base character context and before the preset system prompt.
6. Empty or malformed optional context still produces a valid message list.

Run the project-required validation before completion:

- Backend tests in `backend`: `npm test`
- Frontend build in `frontend`: `npm run build`
- Encoding check at repo root: `node scripts/check-encoding.mjs`

If implementation touches only backend prompt construction, the frontend build is still part of this repo's definition of done for reported autonomous changes.

## Non-Goals

This iteration does not include:

- persistent long-term memory,
- new database tables,
- new frontend controls,
- provider or model selection changes,
- prompt-debug UI,
- background accessory-agent behavior changes,
- character draft assistant changes,
- world book draft assistant changes.

## Follow-Up Sequence

After this spec is implemented and verified, continue the broader assistant-improvement goal with separate specs:

1. Background accessory agents: make NPC/status/economy extraction more reliable and less noisy.
2. Character draft assistant: improve generated character cards, extension suggestions, and status bar drafts.
3. World book draft assistant: improve lore decomposition, trigger keys, and injection-position choices.

Each follow-up should have its own design, implementation plan, validation, and iteration report.
