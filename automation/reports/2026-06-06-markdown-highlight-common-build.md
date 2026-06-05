# 2026-06-06 Markdown Highlight Common Build

## Scope

Autonomous robustness/performance pass for the frontend chat bundle. The previous run identified a Vite warning where the async `StatusBar` chunk exceeded 500 kB after minification.

## Changed Files

- `frontend/src/components/MarkdownContent.vue`
  - Changed the syntax highlighter import from `highlight.js` to `highlight.js/lib/common`.
  - Keeps markdown code-block highlighting for common languages while avoiding bundling the full Highlight.js language set into the chat/status chunk.

## Evidence

Before this run, frontend build output reported:

- `StatusBar-Bwnu-VWg.js`: 1,060.08 kB, gzip 366.29 kB
- Vite large chunk warning over 500 kB

After the change:

- `StatusBar-B6-0xcnX.js`: 297.82 kB, gzip 113.34 kB
- No Vite large chunk warning
- Transformed modules dropped from 2050 to 1894

## Validation

- `node scripts/check-encoding.mjs` - PASS
- `frontend`: `npm.cmd run build` - PASS
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` - PASS
  - Encoding check PASS
  - Backend tests PASS, 228 tests
  - Frontend build PASS

## Risk Notes

- This intentionally uses Highlight.js' common language bundle rather than the full language bundle. Code blocks with uncommon language identifiers still render safely as escaped code; they may not receive language-specific highlighting.
- Existing dirty worktree state remains; unrelated files were not reverted or reformatted.

## Next Recommended Task

Add a small frontend-side smoke check for markdown rendering behavior if the project later adds a frontend test runner.
