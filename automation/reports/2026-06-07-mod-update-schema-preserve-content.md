# 2026-06-07 Mod Update Schema Preserve Content

## Summary

Fixed a data-loss bug in Mod partial updates and restored the affected Mod content from backup.

## Changed Files

- `backend/src/validations/schemas.js`
- `backend/src/tests/backend.test.js`

## Details

- Replaced `updateModSchema = createModSchema.partial()` with a dedicated update schema that has no default values.
- Added regression coverage proving `updateModSchema.safeParse({ enabled: false })` preserves only the provided field and does not add omitted `content`, `description`, or `type`.
- Confirmed the affected Mod `X级小说生成规范提示词` currently has shortened content in the live database, while older backups contain a longer same-ID version:
  - current `backend/data/flai.sqlite`: content length 82
  - `backend/data/backups/flai-2026-06-06.sqlite`: content length 746
  - `backend/data/backups/flai-2026-06-05.sqlite`: content length 746
  - `backend/data/backups/flai-2026-06-04.sqlite`: content length 746
- After explicit user approval, restored Mod `b8b9005d-458e-4268-9b64-2c42e1df1e91` content from `backend/data/backups/flai-2026-06-06.sqlite`.
- Preserved the current loading scope and character binding while restoring only `content`.
- Created a restore safety snapshot at `backend/data/backups/flai-before-mod-restore-2026-06-07T06-38-57-508Z.sqlite`.
- Verified the restored live Mod content length is 746.

## Validation

- `npm.cmd test` in `backend`: PASS, 441 tests.
- `node scripts/check-encoding.mjs`: PASS, scanned 423 files before this report.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`: PASS.
- Read-only restore verification query: PASS, live content length 746.

## Notes

- The restore writes to `backend/data` were performed only after explicit user approval.
