# Character Assistant Quality Guide Design

Date: 2026-06-24

## Goal

Improve B-stage character draft assistant quality by making generated character cards more stable, immediately usable, and less filler-heavy.

## Design

Add a shared quality-guide instruction block to the backend character assistant prompt. The guide should apply to both non-streaming and streaming draft generation and should push the model toward:

- persona fields that act as durable roleplay contracts,
- opening messages that are playable first scenes rather than card summaries,
- extension and status suggestions that serve observable roleplay use,
- clear separation between character identity, world facts, and user control.

The guide should not change tool schemas, saved data shapes, frontend UI, or normalization behavior. It only gives the assistant a better target when filling the existing tools.

## Acceptance Criteria

1. Non-streaming character draft requests include the quality guide in the system prompt.
2. Streaming character draft requests include the same quality guide.
3. Existing enabled-section and normalization behavior remains unchanged.
4. Backend tests, frontend build, and encoding checks pass.

## Self Review

- No placeholders remain.
- Scope is limited to prompt quality guidance.
- The design is small enough to verify through existing provider request capture tests.
- User approval is treated as delegated by the active objective.
