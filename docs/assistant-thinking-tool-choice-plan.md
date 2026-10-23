# Assistant Thinking Tool Choice Plan

## Objective

Fix character assistant requests that fail when thinking mode is combined with a required tool choice, and support automatic tool selection in that mode.

## Scope

- Trace character assistant thinking and tool-choice selection through provider request construction.
- Use automatic tool selection when thinking is enabled where forced selection is incompatible.
- Preserve required first-round tool choice when thinking is disabled.
- Add focused regression coverage for enabled and disabled thinking.

## Checklist

- [x] Inspect repository state and affected provider/assistant paths.
- [x] Implement compatible tool-choice selection with regression tests.
- [x] Run focused backend tests and the backend suite.
- [x] Run encoding and diff checks; record results and any remaining risks.

## Acceptance Criteria

- Character assistant requests with thinking enabled use `tool_choice: "auto"` and no longer trigger the reported incompatibility.
- Character assistant requests with thinking disabled retain required first-round tool selection.
- Later tool rounds continue to use automatic selection.
- Applicable tests and repository encoding checks pass.

## Validation Commands

- Focused character assistant runtime tests.
- `npm test` from `backend`.
- `node scripts/check-encoding.mjs` from the repository root.
- `git diff --check`.

## Results

- Thinking-enabled character assistant requests now use `auto` on the first round; thinking-disabled draft and plan requests retain `required` on the first round, and subsequent rounds use `auto`.
- The existing no-tool format-repair retry remains responsible for cases where automatic selection returns text without a tool call.
- `node --test src/tests/characterAssistantRuntime.test.js`: passed, 24 tests.
- `npm test` from `backend`: passed, 1665 tests.
- `node scripts/check-encoding.mjs`: passed, scanned 726 files.
- `git diff --check` on the changed backend source and test paths: passed.
