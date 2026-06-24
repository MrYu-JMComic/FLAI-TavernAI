# Accessory Agent Observation Window Design

Date: 2026-06-24

## Goal

Make background accessory agents more reliable and less noisy by giving them a clear observation window for the current chat turn.

This is the D-stage follow-up after the main chat context director. It targets the background agents that update status bars, NPC memory/behavior, economy transactions, and scene image matching after a reply is saved.

## Design

Add an observation-window contract to the backend accessory agent path. The contract contains the current user message and the saved assistant reply. Provider-backed status, NPC, and economy agents should receive this structured payload instead of a bare reply string.

The system prompts should explicitly say that the agent may only extract durable changes that are clearly evidenced in the current turn. It should not convert world lore, character-card facts, prior history, headings, hypotheticals, plans, examples, or unchanged state into new status values, NPC memories, behavior rules, or economy transactions.

The fallback text extractors should continue to read only the assistant reply because they are simple deterministic parsers and do not receive provider context.

## Data Flow

1. The chat route saves the user message and assistant message as it does today.
2. `startAccessoryAgentsInBackground()` passes both messages into `runAccessoryAgents()`.
3. `runAccessoryAgents()` builds one observation window and shares it with the status, NPC, and economy agents.
4. Each provider-backed agent includes the observation window JSON in its user message payload.
5. The existing tool handlers keep ownership, hidden-NPC, duplicate, and cap guards unchanged.

## Scope

In scope:

- Add optional `userMessage` support to `runAccessoryAgents()`.
- Pass `userMessage` from non-streaming and streaming chat routes.
- Update status, NPC, and economy provider prompts and payloads.
- Add tests that inspect provider request payloads and source-level prompt guards.
- Add an iteration report.

Out of scope:

- Database schema changes.
- Frontend UI changes.
- New accessory tools.
- Changes to deterministic fallback extraction beyond using the existing assistant reply.

## Acceptance Criteria

1. Provider-backed status bar updates receive `observationWindow.user` and `observationWindow.assistant`.
2. Provider-backed NPC extraction receives the same observation window and prompt guard.
3. Provider-backed economy extraction receives the same observation window and prompt guard.
4. Chat routes pass the accepted user message into background accessory agents.
5. Existing accessory behavior remains compatible when `userMessage` is omitted.
6. Backend tests, frontend build, and encoding checks pass.

## Self Review

- No placeholders remain.
- Scope is limited to the accessory agent boundary.
- The design preserves current fallback behavior and existing database safety guards.
- User approval is treated as delegated by the active objective: "you have all decision power; do not ask until complete."
