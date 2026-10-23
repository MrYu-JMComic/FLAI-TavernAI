# Chat Status Summary UI Plan

## Objective

Improve the fixed collapsed chat status summary and composer model control on narrow and desktop layouts.

## Scope

- Show the active character avatar in the collapsed status summary, with the Activity icon as the fallback.
- Keep the fixed summary title and update metadata compact, readable, and on one line at mobile widths.
- Refine the composer model switch button typography and spacing without changing picker behavior.
- Leave expanded user-authored status content and its rendering untouched.

## Checklist

- [x] Pass the active character avatar into the summary and implement image fallback.
- [x] Refine fixed summary layout and composer model control styles for desktop and mobile.
- [x] Add focused coverage for avatar fallback.
- [x] Build the frontend and run focused tests.
- [x] Capture and inspect desktop and mobile screenshots; record paths and findings.
- [x] Run encoding and diff checks and record final results.

## Acceptance Criteria

- A configured character avatar is displayed in the collapsed summary; missing or failed images show the existing Activity icon.
- Summary title and fixed update metadata remain a single line, with the title truncating before metadata.
- The composer model name remains legible and contained in its button at desktop and mobile widths.
- Expanded custom status content and model picker behavior remain unchanged.
- Frontend build, focused tests, encoding check, and screenshot review pass.

## Validation

- `npm run build` from `frontend`
- Focused frontend component or browser tests for the changed UI
- `node scripts/check-encoding.mjs`
- `git diff --check`
- Desktop and mobile screenshots of the chat summary and composer controls

## Results

- The collapsed summary now shows the active character avatar, falling back to the Activity icon when the URL is missing or the image fails to load.
- The fixed summary title truncates before its one-line item count and update status. The composer model button uses tighter spacing and smaller single-line model text.
- Expanded user-authored status content and model picker behavior were left unchanged.
- Focused component tests passed: 2 tests. Chat model switcher end-to-end test passed: 1 test.
- Frontend production build passed. It reports the existing large-chunk advisory.
- `node scripts/check-encoding.mjs` passed, scanning 710 files. `git diff --check` passed.
- Visual verification passed on mobile at 362x652 in the in-app browser and desktop at 1280x720 in Edge. The title, item count, and update status stayed on one line; the avatar cropped cleanly; the model name fit without overflow. Screenshots were captured inline in the CUA output for this task turn; they were not saved as repository files.
