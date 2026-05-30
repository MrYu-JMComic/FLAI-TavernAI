# Phase 2 — ChatView Component Extraction

**Date:** 2026-05-30
**Commit:** `cddf8f2` — ui: refactor chat experience
**Scope:** `frontend/src/views/ChatView.vue`, `frontend/src/components/chat/`, `frontend/src/styles.css`

## Summary

Extracted 5 reusable Vue components from `ChatView.vue` (2295 lines). After extraction, ChatView was 1837 lines. Phase 2b (commit `029c6e9`) later extracted composables, bringing ChatView to its final 441 lines.

## New Components

| Component | Lines | Responsibility |
|---|---|---|
| `ChatSidebar.vue` | 138 | Conversation list, search, batch delete, user footer |
| `ChatSettingsDrawer.vue` | 311 | Appearance, CSS/JS, accessory skills, status bar editor |
| `ChatHeader.vue` | 48 | Title, provider/model label, economy/NPC/save buttons |
| `ChatMessageItem.vue` | 146 | Message bubble, reasoning toggle, edit/copy/delete actions |
| `ChatComposer.vue` | 101 | Textarea, send/stop, stream toggle, thinking toggle, preset select |

## Modified Files

- `ChatView.vue` — 2295 to 1837 lines (template: ~608 to ~152 lines)
- `styles.css` — mobile touch target improvements

## Mobile UX Improvements

- `.message-action-button` on mobile (<=520px): 32px to 44px touch targets
- `.round-send` button: 38px to 44px
- `.mode-pill` buttons: 34px to 44px min-height
- `.message-actions` always visible on mobile (<=980px), flex-wrap with gap

## Validation

- `node scripts/check-encoding.mjs` — PASS
- `npm run build` (frontend) — PASS

## Behavior Preserved

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

## Note

This was the initial component extraction. The script section (~1685 lines) remained in ChatView. Phase 2b (commit `029c6e9`) subsequently extracted logic into 6 composables, reducing ChatView to 441 lines.
