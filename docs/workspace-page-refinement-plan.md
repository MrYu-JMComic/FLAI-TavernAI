# Workspace Page Refinement Plan

## Objective

Refine the extensions, character assistant, and character editor pages shown in
the user's screenshots so they fit the new desktop sidebar shell naturally.

## Scope

- Extensions: reduce repeated navigation columns, improve section hierarchy,
  and make tag management denser and easier to scan.
- Character assistant: use the available workspace height and width, reduce
  nested framing and excess padding, and improve conversation/composer balance.
- Character editor: reduce the oversized summary/save area and let the actual
  editor take priority, with clear section navigation and compact controls.
- Preserve existing functionality, unsaved-change protection, mobile layouts,
  theme support, and all unrelated work in the dirty working tree.
- Replace superseded layout rules instead of layering permanent workarounds.

## Checklist

- [x] Inspect the three page implementations and relevant layout expectations.
- [x] Refine extension section navigation and tag management layout.
- [x] Refine the assistant workspace, header, history area, and composer spacing.
- [x] Refine editor summary/actions placement and section/content proportions.
- [x] Update only obsolete layout expectations and necessary regressions.
- [x] Build, check encoding, and run applicable existing tests.
- [x] Inspect screenshots at desktop, narrow desktop, and mobile sizes in both
  themes; resolve clipping, excess whitespace, and scroll problems.
- [x] Record final changes, validation, and any remaining risks.

## Acceptance Criteria

- At approximately 1280px desktop width the pages do not waste most of their
  space on nested navigation, oversized summary cards, or oversized save buttons.
- The assistant uses a single full-height workspace with a readable transcript
  and a visible composer without an unnecessary outer page scrollbar.
- The extensions sections and tag controls remain easy to navigate and use.
- Editor saving, creation wizard, full-form sections, preview, and section
  navigation retain their current behavior.
- Desktop/narrow/mobile content fits horizontally, with clear light/dark themes.
- Required validation passes and existing unrelated edits remain intact.

## Validation Commands

- `npm run build` from `frontend`.
- `npm test` from `backend` if source contract expectations change.
- Focused Playwright coverage for settings/extensions, character workbench,
  character assistant, and existing desktop navigation as applicable.
- `node scripts/check-encoding.mjs` from the repository root.
- `git diff --check` for the files changed by this task.
- Use the review gate if implementation grows into broad application changes.

## Results

- Git inspection confirms the previous sidebar changes and substantial unrelated
  work are still present. This task will refine the three affected page surfaces.
- Extensions now use one full-width content column and sticky horizontal section
  navigation. Tag controls align in a responsive grid with truncated long names.
  Personal settings retain their existing internal navigation.
- The assistant fills the available workspace without a second frame or outer
  padding. Its history column and header are narrower, transcript/composer
  gutters align, and the composer grows with its draft up to a bounded height.
- The editor has a compact directory and a combined summary/action toolbar.
  Completion details and secondary operations expand on demand; primary save
  remains visible at 44px high. Superseded aside/grid breakpoint rules were
  removed while retaining the wizard and phone shell.
- Frontend production build passed. The existing KaTeX chunk-size advisory
  remains unchanged.
- Focused source/layout contracts passed: 56/56 tests.
- Updated the existing readonly browser check to open the secondary operations
  disclosure before verifying export. The test continues to require save and
  delete to be unavailable for non-owners.
- Mocked visual QA passed 42 cases across 320, 390, 768, 901, 1024, 1230, and
  1440px in light/dark themes: no horizontal page overflow or clipped controls,
  no assistant outer page scrollbar, and no browser runtime errors. Desktop
  and phone screenshots were inspected. Fixtures did not modify user data.
- Extension navigation passed 40 tab jumps and 24 personal-settings jumps across
  four widths and both themes. All headings remained visible below the sticky
  bar; 320px tag text truncates without overlapping usage/delete controls. Phone
  decorative panel icons were hidden to remove an unnecessary separate row.
- Assistant growth/reset passed six light/dark scenarios at 1230x960, 390x844,
  and 390x480. Empty/long/cleared heights were 56/180/56px on desktop,
  44/140/44px on phone, and 44/105.6/44px in the reduced viewport. Send and
  settings controls remained visible and focus survived transcript scrolling.
- Repository review gate passed: 1586 backend tests, 154 frontend unit tests,
  67 end-to-end tests, production build, encoding, production dependency audits
  (zero vulnerabilities), and Git whitespace checks.
- Editor stress verification passed for light/dark themes and 901/1024/1230px:
  completion and secondary-operation popovers stay within the page shell, the
  save control remains 44px high, and a long character name no longer creates
  horizontal overflow. The readonly export flow passes after opening the
  secondary-operations disclosure; save/delete remain unavailable to viewers.
- Final build, repository encoding scan (654 files), and scoped `git diff
  --check` passed. Remaining build output is the pre-existing KaTeX chunk-size
  advisory; no functional or layout risk remains from this task.
