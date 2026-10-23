# Frontend Design Polish Plan

## Objective

Polish the shared frontend presentation with subtle surface contrast, softer focus states, adaptive dark-theme typography, streamed text reveal, stable numeric and inline-icon alignment, and restrained interaction feedback.

## Scope

- Add a shared polish stylesheet and a small dark-theme font-weight adapter.
- Animate only newly revealed graphemes in streamed Markdown and keep the work bounded per frame.
- Refine shared Markdown typography, form focus rings, draggable feedback, reaction/copy feedback, and completion toast duration.
- Preserve existing component layouts and unrelated working-tree changes.

## Checklist

- [x] Inspect repository status and read the affected theme, form, Markdown, chat, notification, and drag behavior.
- [x] Add the shared visual polish rules and dark-theme weight adaptation.
- [x] Add a short staggered reveal for newly streamed graphemes and align inline icons.
- [x] Apply tabular numerals, balanced line wrapping, immediate drag feedback, spring feedback, and 2.5-second success notices.
- [x] Run the frontend build, focused unit tests, encoding check, and `git diff --check`.
- [x] Capture and inspect desktop and mobile screenshots; record paths and results here.

## Acceptance Criteria

- Borders and focus states use soft theme-relative contrast, with a two-layer focus shadow.
- Dark mode reduces authored font-weight values by one 100-point step and restores light-theme authored styles.
- New streamed graphemes alone receive a quick blur-to-focus reveal with a short stagger; reduced-motion preferences are respected.
- Numeric columns use tabular figures, text wrapping avoids short final lines where supported, and inline icons align to the text baseline.
- Drag targets respond without transition bounce, copy/reaction actions use a spring response, and success notices dismiss after 2.5 seconds by default.
- Desktop and mobile screenshots show no clipping, overlap, or broken message rendering.

## Validation

- `npm run build` from `frontend`
- Focused Vitest coverage for Markdown streaming and dark-theme typography
- `node scripts/check-encoding.mjs`
- `git diff --check`
- Desktop and mobile screenshots from the running frontend, visually inspected and recorded below

## Results

- Added theme-relative micro-contrast surfaces, layered focus rings, and dark-theme font-weight adaptation.
- Added staggered blur-to-focus reveal for newly streamed graphemes, preserving active glyph animations during Markdown reconciliation and respecting reduced-motion preferences.
- Applied tabular numerals, balanced wrapping, inline icon alignment, immediate draggable feedback, spring action feedback, and a default 2.5-second success notice timeout.
- `npm run build` passed. Vite reported the existing `katex-math` chunk at 524.35 kB, above its 500 kB advisory threshold.
- `npm run test:unit` passed: 34 files and 330 tests.
- `npm run test:e2e -- e2e/design-polish.spec.js` passed: 1 browser test covering focus styling, tabular numerals, dark-theme font weight, and mobile overflow.
- `node scripts/check-encoding.mjs` passed, scanning 739 files; `git diff --check` passed.
- Screenshot review passed at desktop 1440x980 in light and dark themes and mobile 390x844 in dark theme. No clipping, overlap, or horizontal overflow was observed. Screenshots: `.runtime-check/design-polish-home-light-desktop.png`, `.runtime-check/design-polish-home-dark-desktop.png`, and `.runtime-check/design-polish-home-dark-mobile.png`.
