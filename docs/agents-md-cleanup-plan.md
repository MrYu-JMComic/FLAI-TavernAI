# AGENTS.md Cleanup Plan

## Objective

Standardize the repository agent guide and require screenshot-based visual
verification after frontend changes, including scoped UI improvements when
inspection reveals layout or appearance problems.

## Scope

- Edit the root `AGENTS.md` and this execution plan only.
- Preserve existing safety, planning, encoding, and validation requirements.
- Preserve the existing uncommitted additions to `AGENTS.md`.
- Consolidate duplicate instructions and clarify code cleanup versus file deletion.
- Keep `AGENTS.md` ASCII-only and both documents UTF-8.
- This documentation-only task does not change the frontend UI.

## Checklist

- [x] Inspect Git status, the current guide, and its existing diff.
- [x] Create this plan before implementation.
- [x] Create a task goal from this plan.
- [x] Organize the guide into a clear execution workflow and validation reference.
- [x] Add screenshot capture, visual inspection, and UI refinement requirements.
- [x] Review the diff for preserved rules and unintended changes.
- [x] Run encoding and whitespace checks and record the results.

## Acceptance Criteria

- Existing repository protections and uncommitted guide additions remain intact.
- The guide specifies how to plan, implement, verify, and report a task.
- Frontend changes require screenshots that are actually inspected for visual
  quality, including applicable desktop and mobile layouts.
- Visual problems require scoped improvements and repeat screenshot inspection.
- Screenshot evidence, checked viewports, results, and blockers are recorded.
- All applicable documentation checks pass.

## Validation Commands

- `node scripts/check-encoding.mjs` from the repository root.
- `git diff --check -- AGENTS.md`.
- Check `AGENTS.md` for non-ASCII characters and the plan for trailing whitespace.
- Backend tests, frontend build, UI screenshots, and the review gate do not
  apply to this documentation-only change.

## Results and Remaining Work

- Initial inspection found extensive pre-existing working-tree changes.
- The existing guide diff added scoped legacy cleanup and task planning rules;
  both were retained and reorganized.
- Encoding check passed across 702 files.
- `AGENTS.md` is ASCII-only, and `git diff --check` passed.
- No frontend UI changed, so screenshots, a frontend build, backend tests, and
  the review gate were not applicable.
- No remaining work.
