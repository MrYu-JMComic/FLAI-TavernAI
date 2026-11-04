# Mobile chat focus jitter plan

## Objective

Prevent the mobile chat page from visibly jumping when the message composer receives focus and the software keyboard opens, while preserving normal keyboard scrolling and desktop behavior.

## Scope

- Inspect `ChatView.vue` and the shared chat/workspace styles for viewport, composer, and keyboard handling.
- Make the smallest focused frontend change that stabilizes the mobile chat layout during focus/keyboard viewport changes.
- Keep the chat textarea borderless and transparent in focused and unfocused states, matching the requested composer references.
- Add or update focused regression coverage if the existing test structure supports it.
- Remove only directly obsolete keyboard/layout logic introduced by the fix.

## Checklist

- [x] Identify the focus-triggered layout shift and affected selectors/handlers.
- [x] Implement the mobile stabilization.
- [x] Add/update regression coverage where practical.
- [x] Run frontend build and relevant tests.
- [x] Capture and inspect desktop/mobile screenshots of the chat composer before and during focus.
- [x] Run encoding and diff checks; record results here.

## Acceptance criteria

- Focusing the composer on a mobile viewport does not cause a visible one-frame page jump or duplicated viewport adjustment.
- The composer remains usable above the software keyboard and can scroll normally when needed.
- The textarea has no separate border, background, or focus ring; the outer composer remains visually distinct.
- Desktop chat behavior is unchanged.
- Existing frontend checks pass.

## Validation commands

- `npm run build` from `frontend`
- Relevant frontend tests/e2e checks
- `node scripts/check-encoding.mjs`
- `git diff --check`
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`

## Validation record

Diagnosis: visualViewport resize and scroll were scheduled through separate paths.
Resize also triggered an unnecessary Vue layout pass for keyboard-only height
changes. A later responsive rule also overrode the shell's dynamic visual
viewport height with 100%, so the keyboard-height variable was not applied.

Implementation: coalesced visualViewport resize and scroll into one dock frame,
limited composer remeasurement to phone breakpoint changes, and removed the
conflicting responsive shell height declarations.

Composer styling: removed the textarea's separate border, fill, and focus
shadow; kept its background transparent above the outer composer surface and
hid the native resize grip on mobile.

Validation record:

- `npm run build` passed; Vite reported its existing large-chunk advisory.
- `npm run test:e2e -- e2e/chat-composer-viewport.spec.js --output ../.runtime-check/mobile-chat-focus-jitter-results` passed (4 tests). The keyboard-reopen case checks same-frame event coalescing and composer docking at 700px, 560px, and 430px viewport heights.
- `npm run test:unit` passed (34 files, 331 tests).
- The reopen test initializes dark theme through the existing `flai-theme` storage setting and verifies textarea border, outline, shadow, background, and mobile resize behavior before and after focus.
- `node scripts/check-encoding.mjs` passed (742 files scanned).
- Scoped `git diff --check` passed for the task plan, chat view, responsive styles, and E2E file.
- Screenshots captured and inspected:
  - `.runtime-check/mobile-chat-focus-jitter-results/chat-composer-viewport-mob-9da3d-ing-while-focus-is-retained-chromium/chat-composer-mobile-before-focus.png` (390x844)
  - `.runtime-check/mobile-chat-focus-jitter-results/chat-composer-viewport-mob-9da3d-ing-while-focus-is-retained-chromium/chat-composer-mobile-keyboard-reopened.png` (390x844 capture with simulated 430px visual viewport)
  - `.runtime-check/mobile-chat-focus-jitter-results/chat-composer-viewport-mob-0bed9-r-stays-inside-the-viewport-chromium/chat-typography-mobile-390.png` (390px mobile)
  - `.runtime-check/mobile-chat-focus-jitter-results/chat-composer-viewport-mob-0bed9-r-stays-inside-the-viewport-chromium/chat-typography-desktop-1440.png` (1440x900)
- Playwright simulated visualViewport geometry; a physical Android keyboard animation was not available in this environment.
- The broad review gate was not run because this is a focused frontend change.
