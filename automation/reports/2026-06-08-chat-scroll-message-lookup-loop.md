# Autonomous Report: Chat Scroll Message Lookup Loop

Date: 2026-06-08

## Scope

- Kept this pass focused on chat scroll message anchoring and message-element lookup.
- Preserved existing scroll-to-message behavior, including fallback `null` when no matching DOM node exists.

## Changed Files

- `frontend/src/composables/chat/useChatScroll.js`
  - Replaced `[...querySelectorAll('.deep-message')].find(...)` with a direct NodeList scan.
  - Reused a single normalized target message id while locating the DOM node.
- `backend/src/tests/frontendChatScroll.test.js`
  - Added source coverage requiring the direct NodeList scan.
  - Added negative checks to keep the spread-plus-find path from returning.

## Validation

- PASS: `node --test backend\src\tests\frontendChatScroll.test.js` (3 tests)
- PASS: `node scripts\check-encoding.mjs`
- PASS: `npm.cmd run build` from `frontend`
- PASS: `npm.cmd test` from `backend` (788 tests)
- PASS: `git diff --check` (CRLF warnings only)
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

Note: concurrent cookie-parser changes were present in `backend/src/security.js`, `backend/src/tests/backend.test.js`, and `automation/reports/2026-06-08-cookie-parser-direct-scan.md`; this pass leaves those files out of its commit.

## Next Recommended Task

Continue reviewing chat scroll and accessory refresh paths for repeated DOM/list clones during active conversations.
