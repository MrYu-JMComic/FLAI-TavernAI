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
- [ ] Add the shared visual polish rules and dark-theme weight adaptation.
- [ ] Add a short staggered reveal for newly streamed graphemes and align inline icons.
- [ ] Apply tabular numerals, balanced line wrapping, immediate drag feedback, spring feedback, and 2.5-second success notices.
- [ ] Run the frontend build, focused unit tests, encoding check, and `git diff --check`.
- [ ] Capture and inspect desktop and mobile screenshots; record paths and results here.

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

- Pending implementation and validation.
