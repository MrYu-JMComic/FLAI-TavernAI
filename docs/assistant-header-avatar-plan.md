# Assistant Header Avatar Plan

## Objective

Show the current character avatar in the AI assistant header, using the existing sparkle icon only when no usable avatar is available.

## Scope

- Update the existing header mark in CharacterAssistantView and its scoped stylesheet.
- Use the current editor draft avatar so saved characters and session changes stay in sync.
- Preserve the current header sizing on desktop and mobile.
- Retain the existing icon as the fallback, with no duplicate controls or unrelated cleanup.

## Checklist

- [x] Inspect repository instructions, Git status, header markup, and avatar conventions.
- [x] Implement conditional avatar rendering and image failure fallback.
- [x] Verify avatar and no-avatar presentation and responsive header layout.
- [x] Run frontend build, encoding check, and touched-path whitespace check.
- [x] Record validation results and remaining limitations.

## Acceptance Criteria

- A character with an available avatar displays it in the header mark.
- Missing or failed avatar images display the original sparkle icon.
- Changing the draft avatar updates the header without changing persisted character data.
- The header remains aligned and readable on desktop and mobile.

## Validation

- Browser inspection of the existing character assistant, including a screenshot.
- Existing relevant assistant UI/browser checks where useful; no new tests for this small presentation change.
- `npm run build` in `frontend`.
- `node scripts/check-encoding.mjs` at the repository root.
- `git diff --check` for touched tracked paths.

## Results

- The current header always renders Sparkles despite the editor already exposing `form.avatarUrl`.
- Existing unrelated changes will be preserved.
- Header rendering now follows the reactive draft avatar URL, clips the image to the existing rounded mark, and falls back to Sparkles on absence or load failure. Changing URLs resets failure state; error events record the failed element URL.
- Live browser inspection confirmed the saved character avatar loads, Sparkles is absent, and both image and rounded mark measure 39 x 39 pixels with object-fit cover.
- Added zero minimum image dimensions after browser inspection exposed intrinsic portrait sizing in the grid mark. The image now fills the square without overflow or stretching.
- Existing avatar save and assistant status preview browser tests: eight passed, including pending avatar removal, uploads, refresh, and phone preview workflows. No new tests were added for this presentation change.
- The existing mobile rule still hides the decorative mark, retaining the centered title layout. Independent source review confirmed this is consistent with current header behavior.
- Final frontend build passed. Encoding and touched-path diff whitespace checks passed. The existing build chunk-size advisory remains non-blocking.
- Screenshot: `.runtime-check/assistant-header-avatar.png`.
- Only the assistant view, its stylesheet, and this plan changed for this task; saved character data was not modified. Backend tests and the broad review gate were not applicable to this small frontend change.
