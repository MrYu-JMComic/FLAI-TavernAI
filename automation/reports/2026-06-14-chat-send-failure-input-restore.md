# 2026-06-14 Chat Send Failure Input Restore

## Changed
- Restored failed chat send content back into the composer automatically when the user is still on the same conversation and the composer is empty.
- Kept the existing failed-prompt recovery state so visible retry/restore actions continue to work.
- Added regression coverage for:
  - Non-stream send failures preserving previous messages while removing only the failed local drafts.
  - Stream provider errors preserving previous messages while restoring the failed prompt.
  - Pending failures not overwriting a newer draft typed into the composer.

## Validation
- `node --test src/tests/frontendChatSubmit.test.js`
- `node scripts/check-encoding.mjs`
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`

All checks passed.

## Notes
- The restore guard intentionally skips restoration when the composer already contains new text, so a late failure cannot clobber the user's newer draft.

## Next Recommended Task
- Consider finalizing accepted non-stream failure user drafts from the error payload so persisted user messages get their server id immediately after an accepted provider failure.
