# Chat typewriter newline stall plan

## Objective

Fix chat assistant messages that remain in the generating state but stop rendering through the typewriter after a line break, and keep the streaming caret attached to the visible text end.

## Scope

- Trace actual SSE updates, typewriter progress, and Markdown DOM commits to identify why visible progress stops after a newline.
- Reduce repeated rendering or animation work only where profiling or regression coverage demonstrates it affects long mobile streams.
- Place the caret at the end of the final rendered text block, including paragraph breaks and trailing newlines.
- Add regression coverage that exercises actual incremental SSE delivery, newline continuation, and caret geometry.
- Verify the affected mobile chat state and preserve ordinary Markdown formatting.

## Checklist

- [x] Inspect current worktree and affected stream/render code; preserve unrelated changes.
- [x] Reproduce the reported condition through the actual SSE-to-view path and distinguish source, typewriter, and Markdown progress.
- [x] Implement the smallest verified fix for long streaming updates after line breaks.
- [x] Align the caret with the last visible text position across paragraphs and trailing newlines.
- [x] Verify streamed source, typewriter output, Markdown text, and final content remain consistent.
- [x] Run relevant frontend unit tests, E2E tests, and build.
- [x] Capture and inspect affected chat state at desktop and mobile sizes; record paths and viewports.
- [x] Run encoding and diff checks; record results and remaining risks.

## Acceptance criteria

- A streamed assistant message continues rendering after a newline while the message remains in the generating state.
- The caret is on the same visual line as the last rendered grapheme and follows it within a small layout tolerance.
- When streaming completes, the entire final source is rendered without requiring a page refresh.
- Newlines and Markdown formatting retain their current behavior.
- Realistic incremental-stream tests, frontend build, encoding check, and diff check pass.
- Visual verification records the inspected viewports and screenshot paths.

## Validation commands

- From `frontend`: `npm run test:unit -- --run <focused test>` or the repository's equivalent focused Vitest command.
- From `frontend`: relevant chat Playwright E2E and `npm run build`.
- From repository root: `node scripts/check-encoding.mjs` and `git diff --check`.

## Validation record

- Removed the separate grapheme typewriter queue and per-character DOM wrappers. SSE text now becomes the message source directly, while streaming Markdown commits are coalesced to a 32 ms interval.
- The caret is inserted after the final rendered text node, with a line break marker for a trailing source newline. Markdown rendering skips KaTeX scans and fitting when the rendered fragment has no KaTeX.
- `frontend/src/components/__tests__/markdownStreamingCadence.test.js` covers coalesced updates, paragraph breaks, and caret placement. Related cache and dialogue-quote tests now advance the stream render timer.
- `frontend/e2e/chat-typewriter-newline.spec.js` sends delayed SSE events through a browser `ReadableStream`, verifies partial progress while generation remains active, checks caret geometry, and compares final Markdown content after 200 newline-separated lines.
- `npm run test:unit -- --run` from `frontend`: passed, 35 files and 334 tests.
- `npm run test:e2e -- e2e/chat-typewriter-newline.spec.js` from `frontend`: passed. It captures the streaming mobile state at 390x844 and completed desktop state at 1440x900.
- `npm run build` from `frontend`: passed. Vite reports the existing large KaTeX chunk warning.
- `node scripts/check-encoding.mjs`: passed across 747 files. `git diff --check`: passed; Git printed existing LF-to-CRLF working-copy warnings.
- Inspected screenshots: `.runtime-check/playwright-results/chat-typewriter-newline-mo-d8c62-et-at-the-rendered-text-end-chromium/chat-stream-after-newline-mobile-390.png` (390x844) and `.runtime-check/playwright-results/chat-typewriter-newline-mo-d8c62-et-at-the-rendered-text-end-chromium/chat-stream-after-newline-desktop-1440.png` (1440x900). The mobile screenshot shows the caret at the visible text end and the composer clear of the response; desktop shows the long response and composer without horizontal overflow.
- The worktree contained unrelated user changes before this task; they were preserved. Physical Android WebView/keyboard testing remains outside this browser-based verification.
