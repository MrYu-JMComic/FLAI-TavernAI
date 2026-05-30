# Iteration Report: Multi-Character Immersive Status Bar - Phase 1

**Date:** 2026-05-30
**Agent:** OpenCode (mimo-v2.5-pro)

## Changed Files

| File | Change Summary |
|---|---|
| `frontend/src/composables/chat/useChatAccessory.js` | Extended `parseTemplateConfig` to parse `displayMode`, `characters[]`, `quickReplies[]`. Added `parseCharacter`, `parseQuickReply` validators. Added helpers: `addStatusCharacter`, `removeStatusCharacter`, `addCharacterVariable`, `removeCharacterVariable`, `addQuickReply`, `removeQuickReply`. New status bar initializes default character from `conversation.characterName`. Updated `syncTemplateCfgFromForm`/`syncTemplateCfgToForm` to round-trip new fields. |
| `frontend/src/components/StatusBar.vue` | Added immersive multi-character rendering: grouped character cards with role/category badge, status chip (在线/死亡/遗忘/离开/隐藏), note, per-character variables with bars, per-character accent/customCss (allowlisted). Added quick reply buttons emitting `quick-reply` with text. Root `v-if` now also shows for `hasImmersiveContent`. Preserved reduced-motion and all existing effects/variants. |
| `frontend/src/components/chat/ChatSettingsDrawer.vue` | Added `displayMode` selector (compact/immersive) in template editor. Added character editor section (add/remove; name, category, status select, note, accent color, custom CSS, per-character variables add/remove/edit). Added quick replies editor (add/remove/edit label+text). All compact inline controls with labels, no nested cards. New emits wired. |
| `frontend/src/views/ChatView.vue` | Added `handleStatusBarQuickReply` that inserts text into composer input with newline separator, focuses textarea, triggers resize. Added `hasStatusBarVisible` computed (shows bar for immersive mode even without global variables). Wired new drawer emits (`add-status-character`, `remove-status-character`, `add-character-variable`, `remove-character-variable`, `add-quick-reply`, `remove-quick-reply`). Wired `@quick-reply` on StatusBar. |
| `frontend/src/styles.css` | Added `.sb-characters-editor`, `.sb-char-editor-row`, `.sb-char-editor-grid`, `.sb-char-vars`, `.sb-quick-replies-editor`, `.char-remove` styles for the drawer editor. |

## Key Behavior

1. **Template config storage:** All new data (`displayMode`, `characters`, `quickReplies`) stored inside the existing `statusBar.template` JSON field - no DB migration needed.
2. **Immersive mode:** When `displayMode: 'immersive'` and characters exist, StatusBar renders a multi-character section with grouped cards showing role badge, status chip, note, per-character variable bars, and accent/customCss.
3. **Quick replies:** Buttons render at the bottom of the StatusBar. Clicking emits `quick-reply` with the button's text. ChatView inserts that text into the composer (not auto-send), focuses, and resizes.
4. **Backward compatibility:** Existing variant/density/effects/customCss are fully preserved. `displayMode` defaults to `'compact'`, which hides the character section.
5. **Default character:** When creating a new status bar, if the conversation has a character name, a default character entry is auto-created.
6. **Encoding:** All files UTF-8 verified. No mojibake markers detected.

## Validation

- Frontend build: **passed** (`vite build` succeeded)
- Encoding check: **passed** (`check-encoding.mjs`)
- Backend: **untouched**

## Next Recommended Task

- Phase 2: Wire the StatusBar Agent to update character statuses and per-character variables from AI responses. Consider adding a character avatar/icon field.
