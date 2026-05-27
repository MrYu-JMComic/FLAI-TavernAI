# Encoding Fix Report - 2026-05-26

## Changed Files

- `frontend/src/views/ChatView.vue`
- `frontend/src/styles.css`
- `AGENTS.md`
- `.editorconfig`
- `scripts/check-encoding.mjs`
- `frontend/package.json`
- `backend/package.json`

## Summary

- Repaired mojibake Chinese UI strings in `ChatView.vue`.
- Replaced a corrupted CSS comment.
- Added UTF-8 rules for autonomous agents.
- Added an encoding guard script and wired it into frontend build and backend test preflight.
- Synced UTF-8 edit rules into OpenClaw workspace agent instructions.

## Validation

- `node scripts/check-encoding.mjs` passed.
- `npm.cmd --prefix D:\Cat\FLAI-TavernAI\frontend run build` passed.
- `npm.cmd --prefix D:\Cat\FLAI-TavernAI\backend test` passed.
