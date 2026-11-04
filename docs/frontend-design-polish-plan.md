# Frontend Design Polish Plan

## Objective

Polish the shared frontend presentation with subtle surface contrast, softer focus states, adaptive dark-theme typography, streamed text reveal, stable numeric and inline-icon alignment, and restrained interaction feedback.

## Scope

- Add a shared polish stylesheet and a small dark-theme font-weight adapter.
- Animate only newly revealed graphemes in streamed Markdown and keep the work bounded per frame.
- Refine shared Markdown typography, form focus rings, draggable feedback, reaction/copy feedback, and completion toast duration.
- Preserve existing component layouts and unrelated working-tree changes.
- Follow up on browser feedback: refine the home filter bar, correct the profile avatar grid sizing, and keep the chat stable while an overlay sidebar is open.

## Checklist

- [x] Inspect repository status and read the affected theme, form, Markdown, chat, notification, and drag behavior.
- [x] Add the shared visual polish rules and dark-theme weight adaptation.
- [x] Add a short staggered reveal for newly streamed graphemes and align inline icons.
- [x] Apply tabular numerals, balanced line wrapping, immediate drag feedback, spring feedback, and 2.5-second success notices.
- [x] Run the frontend build, focused unit tests, encoding check, and `git diff --check`.
- [x] Capture and inspect desktop and mobile screenshots; record paths and results here.
- [x] Inspect the reported browser feedback and identify the profile avatar overflow and the 991px chat sidebar breakpoint mismatch.
- [x] Remove the unexplained dark strip behind the home filter controls while retaining an opaque pinned state.
- [x] Keep the profile avatar within its grid track at desktop and mobile widths.
- [x] Align chat sidebar auto-open with the 1180px two-column breakpoint and avoid expensive chat glass-layer repaint under the drawer overlay.
- [x] Tighten chat reading line height and paragraph spacing after feedback that chat text is too loose.
- [x] Keep the model search focus ring on its outer field and remove the conflicting inner input ring.
- [x] Prevent the chat background from compositing into dark blocks or vertical seams when message actions appear.
- [x] Preserve visible Markdown bold hierarchy in dark mode after the font-weight reduction.
- [x] Verify stable chat dimensions and profile alignment at 991px; capture and inspect updated screenshots.
- [x] Capture and inspect focused search, dark bold, and hovered-message screenshots at desktop and mobile widths.
- [x] Rerun focused browser and unit tests, frontend build, encoding check, and `git diff --check`.
- [x] Prevent phone-sized chat views from programmatically focusing the composer after an awaited AI operation completes.
- [x] Refine shared input focus and text-selection colors to use the warm theme primary in light and dark modes.
- [x] Keep the composer caret and visible text synchronized while typing and resizing on phone-sized viewports.

## Acceptance Criteria

- Borders and focus states use soft theme-relative contrast, with a two-layer focus shadow.
- Dark mode reduces authored font-weight values by one 100-point step and restores light-theme authored styles.
- New streamed graphemes alone receive a quick blur-to-focus reveal with a short stagger; reduced-motion preferences are respected.
- Numeric columns use tabular figures, text wrapping avoids short final lines where supported, and inline icons align to the text baseline.
- Drag targets respond without transition bounce, copy/reaction actions use a spring response, and success notices dismiss after 2.5 seconds by default.
- Desktop and mobile screenshots show no clipping, overlap, or broken message rendering.
- At 991px, opening the overlay sidebar does not change chat content width or visibly stutter the covered chat area.
- The profile avatar stays fully inside its reserved grid column at desktop and mobile widths.
- The home filter toolbar no longer reads as a full-width dark slab in its resting state and remains legible when pinned.
- The model search field has one warm outer focus ring, with no competing ring on the input itself.
- Hovering message actions does not create dark compositing blocks or seams over a chat background image.
- Markdown strong text remains visibly heavier than surrounding body text in dark mode.
- A completed AI reply does not programmatically focus the composer on phone-sized viewports; deliberate text insertion and desktop focus behavior remain intact.
- Composer caret position and visible text stay synchronized through multiline typing and viewport-driven textarea resizing.
- Shared input focus rings and selected text use readable, theme-aware warm accent colors.

## Validation

- `npm run build` from `frontend`
- Focused Vitest coverage for Markdown streaming and dark-theme typography
- `node scripts/check-encoding.mjs`
- `git diff --check`
- Desktop and mobile screenshots from the running frontend, visually inspected and recorded below
- Browser feedback regression coverage for the 991px chat drawer and profile avatar geometry
- Focus, dark Markdown emphasis, and hover-rendering regression coverage with screenshots
- Mobile composer focus and caret-following regression coverage with desktop and phone visual checks

## Results

- Added theme-relative micro-contrast surfaces, layered focus rings, and dark-theme font-weight adaptation.
- Added staggered blur-to-focus reveal for newly streamed graphemes, preserving active glyph animations during Markdown reconciliation and respecting reduced-motion preferences.
- Applied tabular numerals, balanced wrapping, inline icon alignment, immediate draggable feedback, spring action feedback, and a default 2.5-second success notice timeout.
- `npm run build` passed. Vite reported the existing `katex-math` chunk at 524.35 kB, above its 500 kB advisory threshold.
- `npm run test:unit` passed: 34 files and 330 tests.
- Focused dark font-weight unit tests passed: 2 tests.
- Focused Playwright regression coverage passed: 6 tests across chat rendering, mobile composer, 991px sidebar, and personal-center layouts.
- `node scripts/check-encoding.mjs` passed, scanning 741 files; `git diff --check` passed.
- Screenshot review passed at desktop 1440x980 in light and dark themes and mobile 390x844 in dark theme. No clipping, overlap, or horizontal overflow was observed. Screenshots: `.runtime-check/design-polish-home-light-desktop.png`, `.runtime-check/design-polish-home-dark-desktop.png`, and `.runtime-check/design-polish-home-dark-mobile.png`.
- Chat hover screenshot at 1280x900 showed a continuous background image with no dark block or vertical seam: `.runtime-check/playwright-results/chat-rendering-regressions-cb6f8-essage-hover-render-cleanly-chromium/chat-hover-rendering-dark-1280.png`.
- Model search focus screenshots were reviewed at 1280x900 and 390x844; both show a single warm outer ring and no overflow: `.runtime-check/playwright-results/chat-rendering-regressions-cb6f8-essage-hover-render-cleanly-chromium/chat-model-focus-dark-1280.png` and `.runtime-check/playwright-results/chat-rendering-regressions-cb6f8-essage-hover-render-cleanly-chromium/chat-model-focus-dark-390.png`.
- Profile screenshots at desktop, 991px, and 519px confirm the avatar stays inside its grid track. The 991px overlay-sidebar screenshot retains the chat dimensions while open.

## Follow-up: Mobile Composer

### Objective

Keep completed AI replies from reopening the phone keyboard, correct composer caret/text tracking, and make input focus and selection colors fit the warm theme.

### Scope

- Inspect asynchronous chat actions that focus the composer only after a reply finishes.
- Preserve focus after intentional quick-reply insertion and other direct editing actions.
- Verify textarea sizing and scroll synchronization when multiline content changes.
- Use theme-primary focus rings and a coordinated text-selection palette in both themes.

### Validation

- Focused Playwright coverage for completed reply focus, multiline caret tracking, and focus/selection styles.
- `npm run build` from `frontend`
- `node scripts/check-encoding.mjs`
- `git diff --check`
- Desktop and phone screenshots of the composer, inspected for caret visibility, selection contrast, layout, and overflow.

### Results

- Phone-sized retry and edit/rerun completion now update composer layout without programmatically focusing the textarea; desktop focus and direct text-insertion actions remain unchanged.
- Textarea auto-sizing preserves its internal scroll position across the temporary height collapse, keeping the active caret line visible in long drafts.
- Shared focus rings, text selection, and the input caret use the warm theme primary in light and dark themes.
- Three focused Playwright tests passed for phone edit/rerun completion, long-draft caret tracking across viewport resizing, and focus/selection colors.
- The frontend build passed with the existing `katex-math` chunk-size advisory. All 34 frontend unit-test files passed (331 tests); encoding check and `git diff --check` passed.
- Screenshot review passed at desktop 1280x900 in light and dark themes and phone 390x844 in dark theme. Long-draft caret screenshots were reviewed at 390x844 and 390x500. Files: `.runtime-check/playwright-results/chat-runtime-composer-focu-c7309-ction-use-warm-theme-colors-chromium/chat-composer-focus-selection-light-1280.png`, `.runtime-check/playwright-results/chat-runtime-composer-focu-c7309-ction-use-warm-theme-colors-chromium/chat-composer-focus-selection-dark-1280.png`, `.runtime-check/playwright-results/chat-runtime-composer-focu-c7309-ction-use-warm-theme-colors-chromium/chat-composer-focus-selection-dark-390.png`, `.runtime-check/playwright-results/chat-runtime-phone-compose-a0389-long-drafts-grow-and-resize-chromium/chat-composer-caret-mobile-390.png`, and `.runtime-check/playwright-results/chat-runtime-phone-compose-a0389-long-drafts-grow-and-resize-chromium/chat-composer-caret-mobile-short-390.png`.
