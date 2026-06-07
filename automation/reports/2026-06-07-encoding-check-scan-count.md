# Encoding Check Scan Count

## Scope

- Added a scanned-file count to the successful `scripts/check-encoding.mjs` output.
- Confirmed `automation/backlog.md` reads correctly as UTF-8; the earlier mojibake seen in shell output was display decoding, not stored file corruption.
- Kept the existing failure reporting and skip rules unchanged.

## Changed Files

- `scripts/check-encoding.mjs`

## Validation

- `node scripts/check-encoding.mjs` passed: scanned 307 files before this report was added.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` passed:
  - Encoding checks reported scanned file counts.
  - Backend test suite passed: 385 tests.
  - Frontend build passed.
- `node scripts/check-encoding.mjs` passed: scanned 308 files; no common Chinese mojibake markers found.

## Notes

- This makes validation output more auditable now that iteration reports are included in the encoding scan.
- Next useful follow-up: consider a small regression test for the encoding checker if validation scripts gain more behavior.
