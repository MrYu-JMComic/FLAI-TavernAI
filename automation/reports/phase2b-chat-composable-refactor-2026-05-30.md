# Phase 2b — Chat Composable Refactor

**Date:** 2026-05-30
**Scope:** `frontend/src/views/ChatView.vue`, `frontend/src/composables/chat/`

## Summary

Extracted logic from the monolithic `ChatView.vue` (1837 lines) into focused composables. The view now stands at 441 lines — well under the 800-line requirement.

## New Composables

| Composable | Lines | Responsibility |
|---|---|---|
| `useChatConversation.js` | 275 | Conversation CRUD, sidebar state, selection, cost/token formatting |
| `useChatSubmit.js` | 351 | Message sending, streaming, retry, abort |
| `useChatMessageActions.js` | 312 | Copy, edit, delete, regenerate individual messages |
| `useChatAppearance.js` | 286 | Theme, layout, display settings |
| `useChatScroll.js` | 216 | Auto-scroll, scroll-to-bottom, scroll lock |
| `useChatAccessory.js` | 263 | Panels (save, NPC, economy), accessory state |

**Total composable lines:** 1703
**ChatView.vue:** 441 lines (was 1837)

## Why This Closes the <800-Line Requirement

- 441 lines is 45% below the 800-line ceiling.
- Each composable has a single responsibility and can be tested independently.
- ChatView.vue is now a thin orchestrator: it wires composables together and renders the template.

## Validations

- Encoding check (`node scripts/check-encoding.mjs`): **PASS** — no mojibake markers found.
- Frontend build (`npm run build`): **PASS** — built in 844ms, 2045 modules transformed.
- Mojibake grep (`rg` for `楼|鍒|鎬|鐢|鐘|鑷|妯|閫|鎷`): **PASS** — zero matches in ChatView.vue and composables/.

## Post-Refactor Fix

- Fixed mojibake in `formatCost`: replaced `楼` (U+697C) with `¥` (U+00A5) so CNY amounts render correctly.
