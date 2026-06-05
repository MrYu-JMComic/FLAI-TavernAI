# 2026-06-06 Theme Storage Guard

## Scope

Autonomous frontend robustness pass. A source scan found that `App.vue` read and wrote `localStorage` directly during app setup/theme changes. In browsers or embedded contexts where storage is blocked, that can throw and prevent the app from booting.

## Changed Files

- `frontend/src/App.vue`
  - Replaced direct theme storage access with guarded helper functions.
  - Normalizes theme values to `light` or `dark`.
  - Falls back to `light` when `localStorage` is unavailable.
  - Ignores storage write failures so theme switching does not break app runtime.

## Validation

- `node scripts/check-encoding.mjs` - PASS
- `frontend`: `npm.cmd run build` - PASS
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` - PASS
  - Encoding check PASS
  - Backend tests PASS, 228 tests
  - Frontend build PASS

## Risk Notes

- `frontend/src/App.vue` already contained unrelated uncommitted changes before this run. This run only added guarded theme storage helpers and wired the theme watcher/initial value through them.
- No frontend unit test runner exists in this project, so coverage is through build and the full review gate.

## Next Recommended Task

Apply the same storage-guard pattern to feature-specific `localStorage` usage in `CharacterFormView.vue` and `WorldBookView.vue`, keeping each view as a separate small iteration.
