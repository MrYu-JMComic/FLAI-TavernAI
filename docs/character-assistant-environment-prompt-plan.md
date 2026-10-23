# Character Assistant Environment Prompt Plan

## Objective

Teach the AI character assistant the FLAI runtime environment and the semantic
boundaries between character content, world books, session state, and optional
features, without presenting this internal reference as user-facing help.

## Scope

- Add a concise, model-facing environment guide in backend source and inject it
  into every character assistant request as part of the stable system prefix.
- Clarify that the guide describes product capabilities while enabled sections,
  current payload, and tools define the authority and scope for this turn.
- Add a focused backend contract test and record results here.
- Preserve all unrelated working-tree changes; no UI, database, or user-data
  changes are in scope.

## Checklist

- [x] Verify current prompt assembly, feature names, and runtime boundaries.
- [x] Write and inject the internal environment guide.
- [x] Test that the guide reaches the model and describes the key boundaries.
- [x] Run targeted and required backend validation, encoding check, and diff check.
- [x] Record validation results and remaining limitations.

## Acceptance Criteria

1. The model receives a concise FLAI environment map in the system message for
   both creation/editing and free conversation modes.
2. The guide distinguishes character-card canon, world-book lore, dynamic
   session state, post-reply agents, memory, and presentation/text extensions.
3. The guide forbids assuming unavailable or disabled tools, hidden context, or
   unsupported runtime capabilities, and does not encourage unnecessary feature
   activation.
4. The user-facing assistant response does not echo the internal guide.
5. Relevant tests and repository-required validation pass, or any blocker is
   documented accurately.

## Validation Commands

- `node --test backend/src/tests/characterAssistantEnvironmentGuide.test.js`
- `npm test` from `backend`
- `node scripts/check-encoding.mjs`
- `git diff --check`

## Completion Record

- Added `backend/src/services/characterAssistantEnvironmentGuide.js` and
  injected it into the shared system prompt. Creation/editing and free
  conversation use the same environment map while retaining their distinct
  mode instructions.
- Added `backend/src/tests/characterAssistantEnvironmentGuide.test.js`; the
  focused test passed and verified the guide in both request modes, including
  the runtime/tool permission boundary.
- `npm test` ran 1668 tests: 1666 passed and 2 failed in pre-existing modified
  frontend files: `frontendKatexCompatibility.test.js` and
  `frontendMarkdownContent.test.js`. The failed assertions concern Markdown /
  KaTeX rendering and are outside this backend prompt change.
- Encoding check passed across 739 files. `git diff --check` and
  `git diff --cached --check` exited successfully; Git reported only existing
  LF/CRLF working-copy warnings.
- Remaining limitation: this concise guide is deliberately static. Update it
  when runtime feature ownership changes; actual enabled sections and tools
  remain authoritative for each request.

## Follow-up: English Model Prompt

### Objective

Write the model-facing environment guide entirely in English while keeping
Chinese source comments as a maintainer reference. The comments must not enter
the model prompt.

### Checklist

- [ ] Translate the guide without changing runtime facts or permission limits.
- [ ] Add concise Chinese comments that explain each prompt section.
- [ ] Test that the injected guide contains no Chinese and remains present in
  both request modes.
- [ ] Run focused tests, encoding check, and diff check; record results.

### Acceptance Criteria

1. The complete environment guide delivered to the model is English-only.
2. Chinese source comments explain the guide's meaning for maintainers but are
   not part of the exported prompt string.
3. The focused contract test confirms English-only content and both-mode
   injection.
