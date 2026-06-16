# 2026-06-11 - World-Book Explain Collapse Shell

## Changed Files

- `frontend/src/views/ChatView.vue`
- `automation/reports/2026-06-11-worldbook-explain-collapse-shell.md`

## Summary

- Reworked the collapsed world-book match explainability panel so it no longer renders as a full-width empty shell above the composer.
- Kept the source details available: the collapsed state is now a compact summary pill, and the full bordered card only appears after expansion.
- Reverted the earlier horizontal-scrollbar hypothesis so the chat scroller behavior is left as it was.

## Validation

- PASS: `node scripts/check-encoding.mjs`.
- PASS: `npm run build` in `frontend`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Notes

- The working tree already contained many unrelated modified and untracked files before this run; they were preserved.

## Next Recommended Task

- Add a focused frontend source guard for the collapsed world-book explainability styles if this panel continues to receive UI polish.
