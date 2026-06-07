# 2026-06-07 Mod Loading Scope Bindings

## Summary

Added Mod loading scopes so enabled Mods can stay global, apply to all character chats, or bind to one or more specific characters.

## Changed Files

- `backend/src/db.js`
- `backend/src/modules/mods.js`
- `backend/src/routes/conversations.js`
- `backend/src/validations/schemas.js`
- `backend/src/tests/backend.test.js`
- `frontend/src/views/SettingsView.vue`
- `frontend/src/styles.css`
- `frontend/src/services/modExtension.js`

## Details

- Added `scope` and `character_ids` columns to `mods` with migration-safe defaults.
- Filtered enabled Mods against the current conversation character before building chat system prompts.
- Preserved legacy behavior by treating existing Mods as `global`.
- Added backend normalization for duplicate/blank character bindings and max binding count.
- Added settings UI controls for global, all-character, and selected-character loading.
- Added role option loading, selected-role counts, and scope badges on Mod cards.
- Updated dormant frontend Mod extension sync helpers to respect the same scope rules.

## Validation

- `npm test` in `backend`: PASS, 437 tests.
- `npm.cmd run build` in `frontend`: PASS.
- `node scripts/check-encoding.mjs`: PASS, scanned 408 files.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`: PASS.

## Notes

- The worktree already had many unrelated modified and untracked files before this run; this iteration only layered scoped Mod changes on the files listed above.
- Next recommended task: add route-level tests for `/api/mods` create/update payloads with `scope` and `characterIds`.
