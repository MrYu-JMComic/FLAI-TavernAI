# Fixed Model Prompt English Plan

## Objective

Convert every fixed, model-facing built-in prompt in the repository to clear,
unambiguous English, with adjacent Chinese maintainer comments. Review prompt
semantics and keep user-facing output requirements explicit without making
internal prompt text read like help written for the user.

## Scope

- Audit fixed prompt text in backend services, modules, shared model-tool schemas,
  and prompt builders. Exclude user-authored content, editable presets, role
  cards, world-book entries, Mods, and interface-only copy.
- Convert model-visible system/developer instructions and tool descriptions to
  English; add adjacent Chinese comments that explain the intent and boundaries.
- Split any prompt guide that is also rendered in the UI so the model receives
  English while existing user-facing documentation remains Chinese.
- Preserve output-language contracts (for example, Chinese plan text shown to
  authors) as explicit English instructions to generate that output in Chinese.
- Add focused contract tests for model-visible prompt language and critical
  permission/authority boundaries.
- Preserve all unrelated working-tree changes and user-authored data.

## Checklist

- [x] Verify the character assistant prompt assembly, feature names, and runtime boundaries.
- [x] Write and inject the internal environment guide.
- [x] Test that the guide reaches the model and describes the key boundaries.
- [ ] Inventory all fixed model-visible prompts and separate them from editable or user-facing text.
- [ ] Translate fixed model instructions and model-facing tool descriptions to English with Chinese maintainer comments.
- [ ] Split shared UI/model guide data where needed and preserve Chinese UI copy.
- [ ] Add language and semantic contract tests for the fixed prompts.
- [ ] Run targeted and required backend validation, encoding check, and diff check.
- [ ] Record validation results and remaining limitations.

## Acceptance Criteria

1. Every fixed model-facing built-in prompt in the audited code paths is written
   in English; Chinese is retained only for literal domain data such as exact
   tokens or as the explicitly required language of model-generated output.
2. Each changed prompt block has a concise adjacent Chinese maintainer comment;
   those comments are not interpolated into model messages.
3. Prompt instructions reflect actual tool/runtime permissions and do not ask
   the model to explain internal prompt mechanics to end users.
4. User-authored prompts, editable presets, role/world-book content, Mods, and
   interface-only copy are not rewritten as built-in prompt text.
5. Focused tests and repository-required validation pass, or any blocker is
   documented accurately.

## Validation Commands

- `node --test backend/src/tests/characterAssistantEnvironmentGuide.test.js`
- `npm test` from `backend`
- `npm run build` from `frontend` when shared UI/model prompt data changes affect frontend imports
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
