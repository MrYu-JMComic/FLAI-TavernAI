# World Book Assistant Quality Guide Design

Date: 2026-06-24

## Goal

Improve C-stage world book draft assistant quality by making generated lore entries more atomic, triggerable, and intentional about prompt placement.

## Design

Add a shared quality-guide instruction block to the backend world book assistant prompt. The guide should apply to both non-streaming and streaming draft generation and should push the model toward:

- breaking lore into atomic entries instead of broad encyclopedic pages,
- using exact names, aliases, locations, factions, items, events, and recurring secrets as comma-separated trigger keys,
- choosing injection positions intentionally for entry purpose and timing,
- keeping entry content concise instead of dumping the whole setting into every entry,
- using advanced controls such as alwaysActive, regex, probability, sticky, cooldown, and group only when they have a clear gameplay or narrative reason.

The guide should not change tool schemas, saved data shapes, frontend UI, or normalization behavior. It only gives the assistant a better target when filling the existing world book tools.

## Acceptance Criteria

1. Non-streaming world book draft requests include the quality guide in the system prompt.
2. Streaming world book draft requests include the same quality guide.
3. Existing world book normalization and fallback behavior remains unchanged.
4. Backend tests, frontend build, and encoding checks pass.

## Self Review

- No placeholders remain.
- Scope is limited to prompt quality guidance.
- The design is small enough to verify through existing provider request capture tests.
- User approval is treated as delegated by the active objective.
