# Character Assistant Avatar and Save Plan

## Objective

Fix character avatars disappearing after AI assistance and character save
buttons remaining busy after a successful save.

## Scope

- Trace avatar handling through AI generation, assistant sessions, and editor
  handoff. Preserve manually selected avatars during unrelated AI changes.
- Reset save state before successful navigation without weakening stale request
  protection or changing partial-save recovery.
- Remove only superseded logic directly related to these two defects.
- Preserve all existing unrelated working-tree changes and protected data.

## Checklist

- [x] Inspect Git state, existing changes, and relevant avatar/save flows.
- [x] Reproduce avatar loss and stuck saving with focused regression tests.
- [x] Fix avatar preservation and save completion with small scoped edits.
- [x] Run focused tests, frontend build, encoding and whitespace validation.
- [x] Record results, remaining risks, and completion status.

## Follow-up: Avatars in Older Conversations

The user reports continued avatar loss after saving, possibly while reusing an
older conversation. Reopen the avatar work and cover explicit empty/stale session
avatars, not only omitted fields. Treat the saved character as the avatar source
unless a manual unsaved avatar edit has an explicit origin. Preserve deliberate
upload/removal across editor-assistant navigation and refresh.

- [x] Reinspect current source, prior validation, and dirty Git state.
- [x] Reproduce old empty/stale session avatars overriding saved character avatars.
- [x] Fix avatar authority and remove the superseded missing-field-only fallback.
- [x] Verify old conversations, saved avatars, and unsaved manual upload/removal.
- [x] Run focused regressions, frontend build, encoding and diff checks.
- [x] Record follow-up results and remaining limits.

### Follow-up Acceptance Criteria

- Reusing an old conversation with an empty, omitted, or stale avatar does not
  clear or revert the current saved character avatar.
- Explicit manual uploads/removals still survive assistant handoff and reload.
- Switching between conversations does not change the character avatar merely
  because their snapshots were captured at different times.
- Full save round trips retain an accessible avatar and repeat saving still works.

## Acceptance Criteria

- AI profile/story changes and checkpoint resumes retain the current avatar
  when the AI returns an empty or omitted avatar. Older assistant sessions that
  omit the avatar inherit the current editor avatar.
- Manual avatar upload and removal remain available in the character editor.
- Successful saves release the busy state even when navigation stays on the
  current route; subsequent edits can be saved again.
- Save failures and partial session-binding failures release the busy state;
  stale responses remain guarded.
- Applicable regression tests, frontend build, and encoding checks pass.

## Validation Commands

- Focused Vitest tests for character generation and editor saving from frontend.
- Relevant assistant browser regressions where supported by local tooling.
- `npm run build` from frontend.
- `node scripts/check-encoding.mjs` from the repository root.
- `git diff --check` for files touched by this task.
- Backend tests if backend changes are necessary; review gate if scope expands.

## Results

- The working tree contains substantial pre-existing work. This task will use
  targeted patches and preserve it.
- Confirmed save bug: successful assistant navigation incremented the submit
  token before finally, preventing saving from being reset on the same route.
  Save completion now clears the busy state before invalidating the token.
- Confirmed avatar bug: backend AI checkpoints contain only AI-editable fields,
  excluding the avatar. Resuming with that incomplete snapshot replaced the
  server session draft without the avatar, and restoring it cleared the editor.
- Every AI request and generated checkpoint now carries the current manual
  avatar. AI result application excludes avatar fields because AI tools cannot
  update them. Editor/session handoff preserves avatars missing in old drafts.
- The initial fix treated explicit empty session avatars as manual removal.
  Follow-up reproduction showed this was incomplete: old empty values and stale
  URLs still overwrote the saved avatar. The follow-up now requires explicit
  manual draft metadata tied to the current saved avatar before restoring it.
- Regression tests reproduced 4 save failures, 2 editor avatar failures, and
  5 AI runtime avatar failures before the fixes. They pass with the fixes.
- All character composable suites passed: 8 files, 77 tests.
- Browser regression passed: 1 test covering an older avatar-less paused
  session, resume request, two saves on the same route, reload and visible avatar.
  Playwright used an isolated in-memory database with the local mock provider.
- Full backend and frontend source-contract suite passed: 1586 tests. Only an
  obsolete frontend source-contract expectation changed; backend runtime code
  was not modified.
- Frontend production build passed. Vite retains the existing advisory for the
  KaTeX chunk exceeding 500 kB.
- Encoding validation passed (658 files), and targeted whitespace checks passed.
- Read-only peer review found no material defect. Scope stayed within the two
  bugs, so the broad review gate was not required. No remaining blockers.

## Changed Files

- `frontend/src/composables/character/useCharacterAiGeneration.js`: preserve
  the manual avatar across AI requests/checkpoints and exclude AI avatar writes.
- `frontend/src/composables/character/useCharacterEditor.js`: finish save state
  before navigation and retain missing avatars in assistant drafts/handoffs.
- `frontend/src/composables/character/__tests__/useCharacterAiConversation.test.js`:
  five avatar checkpoint/resume/manual-edit regression cases.
- `frontend/src/composables/character/__tests__/useCharacterEditorAvatar.test.js`:
  avatar restore, handoff, and explicit manual removal coverage.
- `frontend/src/composables/character/__tests__/useCharacterEditorSaving.test.js`:
  repeat saves, duplicate prevention, failure and stale-response coverage.
- `frontend/e2e/character-avatar-save.spec.js`: complete browser regression.
- `backend/src/tests/frontendCharacterFormView.test.js`: updated save completion
  contract while preserving existing navigation token protection.
- This plan: execution reference and validation record.

## Follow-up Findings and Implementation

- Both empty and stale nonempty avatars in legacy conversations reproduced in
  the browser before the follow-up fix, already failing at the first preview.
- Nine avatar unit regressions failed before the fix, covering legacy snapshots,
  manual intent, stale intent, handoff and canonical save URLs.
- Bound characters now keep the current avatar when applying old conversation
  snapshots. Explicit unsaved avatar edits include a versioned baseline marker;
  their image remains in the character draft rather than being duplicated in
  state. This preserves uploads/removals while ignoring stale conversation data.
- Opening the assistant from the editor carries the current avatar and replaces
  obsolete avatar intent. Unbound character drafts retain avatar restoration.
- Saving now adopts the backend-returned canonical avatar URL in the form and
  session. It no longer resubmits raw image data on repeated saves, avoiding
  unnecessary resource replacement and stale avatar URLs in conversations.
- Canonical response application is guarded by the active submit token and does
  not overwrite an avatar changed locally while the request was pending.
- The character composable suites passed: 8 files, 85 tests. Frontend source
  contracts passed: 31 tests. Frontend production build and encoding validation
  passed. The unchanged KaTeX chunk-size advisory remains.
- All five browser regressions passed on stable sources (37.3 seconds): omitted,
  empty and obsolete session avatars, real pending upload and removal, assistant
  handoff, refresh, generation, repeated saving, and actual image loading.
  Both new legacy cases failed before the fix. An intermediate manual-removal
  check required proper editor/preview readiness waits; the complete rerun passed.
- Read-only peer review found no new material defect. Diff and final encoding
  checks passed. No new backend code changed, so the focused existing frontend
  contracts were sufficient for this follow-up; no broad review gate was needed.
- No backend runtime code or protected user data changed. Avatars already removed
  from both the saved character and all usable image resources cannot be restored
  from an empty session snapshot; users can re-upload once and keep old chats.
- Remaining known limit outside this follow-up: the existing editor save logic
  marks the live form clean if fields change while a save is pending. Canonical
  avatar adoption does not overwrite such a newer edit, but general pending-save
  draft baseline handling remains a separate task.

### Follow-up Changed Files

- `frontend/src/composables/character/useCharacterEditor.js`: avatar baseline,
  explicit pending manual intent, authoritative handoff and canonical save URL.
- `frontend/src/composables/character/useCharacterAssistantSessions.js`: pass
  explicit avatar intent when restoring a conversation draft.
- `frontend/src/composables/character/__tests__/useCharacterEditorAvatar.test.js`:
  old empty/stale avatars, manual pending intent, stale intent and canonical saves.
- `frontend/e2e/character-avatar-save.spec.js`: four additional browser cases.
- This plan: follow-up reproduction, validation and known limits.
