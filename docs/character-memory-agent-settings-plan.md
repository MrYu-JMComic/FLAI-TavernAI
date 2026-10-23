# Character Memory Agent Settings Plan

## Objective

Expose memory-agent defaults in character creation and editing so new conversations inherit the author's enabled state, model/provider selection, and tool configuration.

## Scope

- Reuse the existing character accessory-skills panel and memory-agent settings dialog.
- Verify character save/load and new-conversation inheritance against the current implementation.
- Preserve unrelated work already present in the checkout.
- Keep memory extraction and recall behavior outside this change.
- Review affected controls and helpers for obsolete or duplicate configuration paths.

## Checklist

- [x] Inspect Git status, repository instructions, and relevant entry points.
- [x] Trace existing character settings and conversation memory-agent controls.
- [x] Add the missing memory-agent author controls using existing components.
- [x] Verify creation, editing, persistence, and conversation inheritance.
- [x] Run applicable checks and review the scoped diff.
- [x] Record validation results and remaining risks.

## Acceptance Criteria

- Both character creation and editing expose memory-agent enabled state and configuration.
- The existing dialog supports provider/model and tool defaults without a parallel implementation.
- Saving and reopening preserves configured values.
- The owner's new conversations inherit the saved character defaults; per-conversation overrides and existing public-character permission rules continue to work.
- Existing unrelated changes remain intact.
- Frontend build and encoding validation pass; any additional checks and limitations are recorded.

## Validation Commands

- Focused existing frontend component/composable checks, chosen after inspecting package scripts.
- `npm run build` from `frontend`.
- `node scripts/check-encoding.mjs` from the repository root.
- `npm test` from `backend` if backend source changes are necessary.

## Progress

- Initial inspection: memory-agent configuration already exists in default payloads and backend normalization, but the character accessory-skills list does not expose it. The checkout contains substantial pre-existing work; only scoped edits will be made.
- Added memory-agent controls to the shared character panel used by creation and editing. Reused the chat settings dialog, including provider/model selection and tool permissions; no parallel configuration path was added.
- Moved the unchanged memory-agent tool catalog into a shared module so both dialog entry points use the same defaults. The backend retains its existing export.
- Persistence tracing confirms character create/update already save these settings. Conversations dynamically inherit author defaults until a conversation-specific override is saved. Existing public-character permission handling is preserved.
- Backend validation after catalog extraction: `npm test` passed (1,653 tests, zero failures or skips); pretest encoding check passed.
- Frontend validation: `npm run test:unit -- src/composables/character/__tests__/useCharacterEditorSaving.test.js src/composables/character/__tests__/useCharacterFormDraft.test.js src/components/__tests__/statusBarCodeEditor.test.js` passed (3 files, 21 tests).
- `npm run build` passed. Vite reported its existing large-chunk advisory. `node scripts/check-encoding.mjs` and the scoped `git diff --check` passed.
- Browser verification: creation in full-form mode exposes automatic/on/off and the complete model/tool dialog; mobile editing loads the existing enabled state, provider, model and tool permissions correctly. Both entry points render all eight tools and keep the required finish tool disabled. Dialogs were canceled; no live character was submitted. Save/load and inheritance were verified by tracing the unchanged persistence path and the existing backend suite, rather than creating live test data.
- Independent scoped review found no regression. Changed source files: `CharacterAccessorySkillsPanel.vue`, `MemoryAgentSettingsDialog.vue`, `useCharacterEditor.js`, `conversationMemoryAgent.js`, and the new `shared/memoryAgentTools.js`.
- Remaining behavior: public characters do not automatically enable author agents for other users under the existing sanitizer. Author defaults dynamically affect the owner's conversations that have no saved accessory override. This task adds configuration access without changing those rules or memory extraction behavior.
- No remaining implementation work. The broad review gate and isolated end-to-end suite were not required for this scoped control addition; the required frontend/backend checks and browser checks are recorded above.
