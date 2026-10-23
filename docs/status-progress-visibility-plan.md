# Status Progress Visibility Plan

## Objective

Make the chat status panel's progress bars accurately show their values and clearly distinguish the filled portion from the empty track.

## Scope

- Inspect the reported live status template and its rendered styles.
- Fix the responsible template rendering or built-in meter styles with a small, scoped change.
- Preserve custom templates, status updates, accordion behavior, and unrelated workspace changes.
- Remove directly superseded logic or styles where applicable. Do not edit saved user data.
- Clarify percent versus percentage in the shared editor/AI guide and status agent prompt; correct the misleading pipeline example.

## Checklist

- [x] Diagnose the live progress markup, computed widths, and rendering path.
- [x] Add the smallest renderer fix, unit regression coverage, and corrected AI guidance.
- [x] Verify numeric proportions, empty/full meters, updates, and responsive presentation.
- [x] Run applicable tests, frontend build, encoding check, and diff checks.
- [x] Record results and remaining limitations.

## Acceptance Criteria

- A partial value produces a proportional filled segment with a visible empty track.
- Zero and full values render correctly; subsequent status updates preserve accurate widths.
- Existing authored styles and accordion interactions remain functional.
- Applicable validation passes without changes to protected data or unrelated work.

## Validation Commands

- Focused status template unit/browser tests, selected after diagnosis.
- `npm run build` in `frontend`.
- `node scripts/check-encoding.mjs` at the repository root.
- `git diff --check` for the touched paths.
- `npm test` in `backend` if backend code changes.

## Results

- Initial repository inspection completed; substantial existing work must be preserved.
- Live DOM confirmed `width:22%%`, `width:80%%`, and `width:0%%`; Chromium ignores those widths and uses full block width.
- `.percent` already returns a percent sign. The fix coalesces only an immediate authored percent sign at a percent-token boundary, leaving source templates, literal text, filters, and custom styles intact.
- The shared reference now documents both valid width forms and is also supplied to the status editing agent. The obsolete `percent | suffix:"%"` comment was corrected to use `percentage`.
- Browser coverage: four new cases cover plain templates and scripted iframes, 943px dark and 390px light fixtures, all three width forms, 0/22/80/100 values, reactive updates, authored colors, and folding.
- Focused renderer/features/tokens/script tests: 34 passed. Full backend `npm test`: 1,588 passed after final source changes.
- Combined status progress/accordion/runtime browser run: 12 passed. Final progress browser rerun after case-insensitive property fix: four passed.
- Frontend build passed after final source changes; the existing large-chunk advisory remains non-blocking.
- Encoding check and touched-path diff whitespace check passed.
- Live original conversation verified: fill-to-track ratios are 0.80, 0.22, 0.85, 0.25, 0.75; empty/full examples are 0 and 1. Screenshot: `.runtime-check/status-progress-fixed.png`.
- Independent review caught and resolved mixed-case `.Percent` compatibility; the regression covers it.
- Scope remained small, so the broad review gate was not required. No saved user templates or protected data were modified. Explicit custom filter output and arbitrary malformed literal CSS remain author-controlled.
