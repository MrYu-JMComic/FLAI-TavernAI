# Code Comment Guidance Plan

## Objective

Add concise code-comment guidance to `AGENTS.md` so meaningful methods and
functions explain their purpose and relevant parameters without requiring
line-by-line comments or comments in formats that do not support them.

## Scope

- Update the root `AGENTS.md` only for this task's policy.
- Preserve existing repository-specific rules and unrelated working-tree edits.
- Keep the guide ASCII-only and write Markdown as UTF-8.
- This documentation-only task does not change application code.

## Checklist

- [x] Inspect the current guide and relevant Git status.
- [x] Create this plan before implementation.
- [ ] Create a trackable task goal from this plan.
- [ ] Add concise method and function documentation guidance.
- [ ] Clarify that comments should explain purpose and relevant parameters, not
      restate every line or obvious implementation detail.
- [ ] Exempt files and formats where comments are unsupported or inappropriate.
- [ ] Run encoding, ASCII, whitespace, and diff checks.
- [ ] Record validation results and remaining work.

## Acceptance Criteria

- The guide asks for comments on meaningful methods and functions.
- Comments briefly explain behavior or purpose and the role of relevant
  parameters.
- Comments are not required on every line or trivial self-explanatory code.
- Files and formats that do not support appropriate comments are exempt.
- Existing safety, planning, frontend screenshot, and validation rules remain.

## Validation Commands

- `node scripts/check-encoding.mjs` from the repository root.
- `git diff --check -- AGENTS.md docs/code-comment-guidance-plan.md`.
- Check `AGENTS.md` for non-ASCII characters.
- Check both changed documents for trailing whitespace.

## Results and Remaining Work

- Current status shows extensive unrelated pre-existing changes; only the guide
  and this plan are in scope.
- Implementation and validation are pending.
