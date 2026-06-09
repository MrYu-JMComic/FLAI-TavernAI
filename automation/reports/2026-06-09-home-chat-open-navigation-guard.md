# 2026-06-09 - Home Chat Open Navigation Guard

## Changed Files

- `frontend/src/views/HomeView.vue`
- `backend/src/tests/frontendHomeView.test.js`
- `automation/reports/2026-06-09-home-chat-open-navigation-guard.md`

## Summary

- Added a local `chatOpenNavigationToken` for Home chat-open actions.
- Invalidated that token before emitting successful chat navigation so the old Home view does not clear pending chat-open state during route replacement.
- Reused the existing Home active-state checks and `usePendingKeys` flow instead of introducing a broader navigation abstraction.

## Coverage

- Extended `frontendHomeView.test.js` to require the chat-open navigation token, reset invalidation, guarded `openChat()` completion checks, and helper-based chat navigation.

## Validation

- PASS: `node --test src/tests/frontendHomeView.test.js` in `backend`.
- PASS: `npm test` in `backend`.
- PASS: `npm run build` in `frontend`.
- PASS: `node scripts/check-encoding.mjs`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Next Recommended Task

- Continue auditing route-changing success paths in chat composables and sidebar actions where local cleanup may still run after a navigation emit.
