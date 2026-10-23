# Default Related Cleanup Policy Plan

## Objective

Document that feature work includes directly related obsolete-code cleanup by
user default, without a separate approval request, while keeping the cleanup
scoped and protecting unrelated files, user data, and uncertain dependencies.

## Scope

- Update the root `AGENTS.md` only for the policy wording.
- Add this plan as the execution reference.
- Preserve the existing planning, validation, screenshot, encoding, and safety
  requirements.
- Clarify when related file removal is allowed and what checks are required.

## Checklist

- [x] Inspect the current guide and working-tree state.
- [x] Create a task goal.
- [x] Add default authorization for directly related obsolete-code cleanup.
- [x] Preserve boundaries for unrelated work, user data, and uncertain files.
- [x] Run encoding and formatting checks.
- [x] Record final validation results and remaining work.

## Acceptance Criteria

- New feature work allows direct cleanup of related obsolete code by default.
- The rule covers code, helpers, styles, tests, and documentation without
  authorizing broad refactors.
- Obsolete-file removal requires reference and responsibility checks and a
  workspace-path check.
- Uncertain dependencies remain in place and are reported for follow-up.
- Existing AGENTS.md rules remain consistent and the documentation checks pass.

## Validation Commands

- `node scripts/check-encoding.mjs` from the repository root.
- `git diff --check -- AGENTS.md docs/agents-md-cleanup-default-plan.md`.
- Check `AGENTS.md` and this plan for trailing whitespace.
- Check `AGENTS.md` for non-ASCII characters.

## Results and Remaining Work

- Encoding check passed across 703 files; `AGENTS.md` is ASCII-only.
- `git diff --check` and trailing-whitespace checks passed.
- No frontend source changed; UI, build, backend tests, and screenshots were not applicable.
- No remaining work.
