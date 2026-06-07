# Character Form Image Upload Unmount Guard

Date: 2026-06-07

## Scope

Closed a stale FileReader completion gap in CharacterFormView image upload flows.

## Changes

- Invalidated avatar and advanced-background upload tokens when the character form unmounts.
- Added a current-upload helper for avatar reads so stale callbacks cannot update a destroyed form.
- Made avatar and advanced-background upload handlers tolerate malformed or missing event targets.
- Included the component disposed state in advanced-background upload completion checks.

## Changed Files

- `frontend/src/views/CharacterFormView.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-character-form-image-upload-unmount-guard.md`

## Validation

- PASS: `git diff --check` completed with only existing CRLF normalization warnings.
- PASS: `npm.cmd run build` in `frontend`.
- PASS: `node scripts/check-encoding.mjs`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.

## Next Recommended Task

Continue reviewing FileReader, timer, and mutation entry points for stale completions after component teardown.
