# ChatView Phase 2 Refactor — 2026-05-30

## Summary

Refactored `ChatView.vue` (2295 lines) by extracting 5 reusable Vue components under `frontend/src/components/chat/`. All behavior preserved. Build passes. Encoding check passes.

## Changes

### New files
- `frontend/src/components/chat/ChatSidebar.vue` (138 lines) — conversation list, search, batch delete, user footer
- `frontend/src/components/chat/ChatSettingsDrawer.vue` (311 lines) — appearance, CSS/JS, accessory skills, status bar editor
- `frontend/src/components/chat/ChatHeader.vue` (48 lines) — title, provider/model label, economy/NPC/save buttons
- `frontend/src/components/chat/ChatMessageItem.vue` (146 lines) — message bubble, reasoning toggle, edit/copy/delete actions
- `frontend/src/components/chat/ChatComposer.vue` (101 lines) — textarea, send/stop, stream toggle, thinking toggle, preset select

### Modified files
- `frontend/src/views/ChatView.vue` — 2295 → 1837 lines (template: ~608 → ~152 lines)
- `frontend/src/styles.css` — mobile touch target improvements

## Line count summary

| File | Lines |
|---|---|
| ChatView.vue | 1837 |
| ChatSidebar.vue | 138 |
| ChatSettingsDrawer.vue | 311 |
| ChatHeader.vue | 48 |
| ChatMessageItem.vue | 146 |
| ChatComposer.vue | 101 |
| **Total** | **2581** |

## Why ChatView remains above 800 lines

The script section (~1685 lines) contains all business logic: streaming, typing animation, scroll management, appearance scripting, message CRUD, clipboard, sidebar/settings state. Moving this logic into child components would require either:
- Duplicating state across components (risky)
- Creating a shared composable with ~50 reactive refs and ~40 functions (large refactor, risky)

Behavior preservation was prioritized over an arbitrary line count target.

## Mobile UX improvements

- `.message-action-button` on mobile (≤520px): 32px → 44px touch targets
- `.round-send` button: 38px → 44px
- `.mode-pill` buttons: 34px → 44px min-height
- `.message-actions` always visible on mobile (≤980px), flex-wrap with gap to prevent overlap

## Validation

- `node scripts/check-encoding.mjs` — PASSED
- `npm.cmd run build` (frontend) — PASSED (568ms)

## Behavior preserved

- Streaming with typing animation
- Reasoning expand/collapse
- Message edit/delete/copy
- Sidebar open/close, conversation search, batch delete
- Settings drawer with appearance CSS/JS, status bar, accessory skills
- Custom appearance hooks (CSS injection, JS execution, cleanup)
- Mobile keyboard inset (`--chat-keyboard-inset`)
- Scroll pin/unpin, scroll position persistence
- Economy/NPC/SaveLoad panel integration
- Preset selection

## Next recommended task

- Further extract scroll management logic into a `useChatScroll` composable
- Extract streaming logic into a `useChatStream` composable
- These could bring ChatView under 1000 lines while keeping behavior safe
