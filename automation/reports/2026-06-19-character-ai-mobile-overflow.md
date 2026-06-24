# Character AI Mobile Overflow Fix

## Summary

Fixed the character editor AI assistant panel overflowing the mobile viewport when long AI process output or tool payloads are rendered. The panel and its nested process/log elements now shrink within their parent instead of forcing horizontal page overflow.

## Changed Files

- `frontend/src/styles.css`
  - Constrained `.ai-draft-panel` with `width: 100%`, `max-width: 100%`, `min-width: 0`, and hidden horizontal overflow.
  - Replaced mobile `width: auto`, `max-width: none`, and `overflow: visible` overrides for the AI panel.
  - Added `min-width: 0`, width bounds, and aggressive wrapping for AI process text, reasoning summaries, tool detail blocks, and tool payload `<pre>` output.
  - Allowed AI action-row buttons to shrink inside the panel and ellipsize text rather than stretching the row.
- `backend/src/tests/frontendCharacterFormView.test.js`
  - Added source coverage that guards mobile AI assistant layout constraints and prevents the old overflow-prone panel overrides from returning.

## Validation

- PASS: `node --test src/tests/frontendCharacterFormView.test.js` in `backend` (28 tests).
- PASS: `npm run build` in `frontend`.
- PASS: `node scripts/check-encoding.mjs`.
- FAIL: `npm test` in `backend`.
  - Unrelated existing failure in `src/tests/frontendSettingsView.test.js` at the `setActiveExtensionSection` source assertion.
  - This run did not edit `SettingsView.vue` or its tests.

## Notes

The worktree already contained unrelated ChatComposer edits and a report. This run preserved those changes and only touched the character AI mobile overflow fix plus this report.

## Next Recommended Task

Verify the character editor on a real narrow mobile viewport after the current ChatComposer work is settled, especially with a long AI process log visible.
