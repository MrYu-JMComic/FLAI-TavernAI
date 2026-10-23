# Precise assistant editing and status bar sections

## Objective

Improve the character refinement assistant with precise, validated partial edits,
concise tool feedback, and independently editable status bar prompts and custom
templates so small changes do not require rewriting the full draft.

## Scope

- Inspect the current assistant tools, draft context, frontend editor, and tests.
- Add scoped read/search and exact-match edits using existing workspace patterns.
- Support guarded per-item JSON changes across tags, regex rules, render plugins,
  accessory agents, status variables, and Mod suggestions; retain granular world
  book entry tools.
- Separate status bar instructions, structured fields, and custom template editing.
- Preserve existing user changes, draft history, and compatible saved characters.
- Retire affected full-rewrite instructions and duplicate update paths where safe.

## Checklist

- [x] Inspect assistant and status bar flows and establish tool contracts.
- [x] Implement precise editing, conflict feedback, and concise tool results.
- [x] Implement separate status bar editing sections and assistant targets.
- [x] Add focused behavioral coverage and review related obsolete logic.
- [x] Run backend tests, frontend tests/build, encoding check, and review gate.
- [x] Record results, acceptance criteria, and any remaining limitations.

## Acceptance criteria

- An assistant can inspect and change a small part of an existing field/template.
- Exact edits fail safely on missing or ambiguous matches without changing drafts.
- Prompt edits and custom status bar edits preserve each other's content.
- Tool feedback avoids repeatedly returning unchanged full drafts/templates.
- Existing character saving, previews, draft review, and history remain usable.
- Applicable validation succeeds, or pre-existing failures are documented.

## Validation commands

- Backend: `npm test` (working directory `backend`).
- Frontend: `npm run test:unit` (working directory `frontend`).
- Frontend: `npm run build` (working directory `frontend`).
- Encoding: `node scripts/check-encoding.mjs`.
- Broad review: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Initial state

- The workspace contains extensive existing uncommitted changes, including the
  assistant and status bar implementation. Changes will build on current files
  and avoid resetting or overwriting unrelated work.
- The user clarified that precise edits apply to the whole character card. Text
  edits and guarded JSON Pointer changes now cover both prose and structured
  lists/settings; existing world book tools already support per-entry editing.

## Implementation progress

- Read/search tools paginate requested content without returning the full draft.
- Exact text batches and guarded data batches apply atomically; missing,
  ambiguous, stale, disabled, invalid, or oversized edits preserve the draft.
- Status prompt and custom status UI use separate mounted panels. HTML, CSS,
  and JavaScript retain independent editor values.
- Existing status blueprints merge only supplied fields; write-tool results
  contain summaries, and read/no-op calls do not emit draft checkpoints.
- Existing regex script/group/priority metadata and entry IDs survive unrelated
  assistant changes. Regex replacement limits match canonical storage.
- Related obsolete full-rewrite instructions and full-source result expectations
  have been updated. Full replacement tools remain for creation or intentional
  whole-section rewrites.
- Focused checks: 19 provider integration tests, 13 text-editing tests, 8
  structured-data tests, and 6 frontend status editor/preview tests pass.
- Field limits now preserve existing 50-character names, 20 tags, and 20 render
  plugins. New structured changes respect persisted limits and retain unrelated
  regex IDs, grouping, priority, and script settings.
- Removed obsolete tool-name tracking after no-op detection became based on
  actual draft contents for every write, including the first write.
- Backend `npm test`: 1650 passed. Frontend unit tests: 264 passed. Production
  build, encoding scan, whitespace checks, and production dependency audits pass.
- Initial review gate found stale tool-count expectations, now updated, and a
  pre-existing mobile plan-review E2E fixture that clicked Send after the composer
  was cleared. The fixture now enters a fresh message after discarding a plan.
  All five viewport cases pass in the final full review gate.

## Final validation and outcome

- Final full review gate: PASS (2026-10-19).
- Backend: 1650 tests passed, zero failures.
- Frontend: 264 unit tests passed; production build passed.
- End-to-end: 90 tests passed, including all five mobile/desktop plan-review
  viewports and existing assistant, status preview, history, and runtime flows.
- Both production dependency audits report zero vulnerabilities.
- Encoding and Git whitespace checks passed. Existing unrelated work remains
  in place; no commit, push, deployment, or external PR was performed.
- All acceptance criteria are met. Full replacements remain available for
  initial creation and explicit rewrites. Existing world book entry tools retain
  their per-entry/per-field editing flow.
- No blockers or remaining implementation work. Remote model behavior was
  validated through provider contract fixtures rather than paid live requests.
