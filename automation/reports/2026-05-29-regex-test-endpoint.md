# Iteration Report: Regex Test/Preview Endpoint

**Date:** 2026-05-29
**Task:** Add regex test/preview endpoint for debugging regex rules

## Summary

Added a `POST /api/regex/test` endpoint that allows users to test regex rules against sample text before saving them. This is a key debugging feature from SillyTavern's regex extension system.

## Changes

### Backend

#### `backend/src/modules/characters.js`
- Added exported `testRegexRule(rule, sampleText, context)` function
- Validates regex pattern syntax, returning `{ valid: false, error }` on failure
- Collects all matches with index and capture groups
- Supports both standard replacement (with macro expansion) and script mode (sandboxed vm execution)
- Returns `{ valid: true, result, matches }` on success

#### `backend/src/routes/regex.js`
- Added `POST /test` route that validates input (pattern + sampleText required)
- Delegates to `testRegexRule()` from modules/characters.js
- Removed unused `vm` and `expandMacros` imports (logic moved to module)

### Tests

#### `backend/src/tests/backend.test.js`
- Added `testRegexRule` to imports from characters.js
- Added 6 new test cases:
  1. Validates regex and returns matches
  2. Returns error for invalid regex
  3. Handles capture groups correctly
  4. Supports script mode execution
  5. Handles non-global regex
  6. Expands macros in replacement

## Validation

| Check | Result |
|-------|--------|
| Backend tests | ✅ 134/134 pass (128 existing + 6 new) |
| Encoding check | ✅ Passed |
| Frontend build | ✅ Success |

## Files Modified

- `backend/src/modules/characters.js` — added `testRegexRule` function
- `backend/src/routes/regex.js` — added `/test` route, cleaned imports
- `backend/src/tests/backend.test.js` — added 6 tests

## Next Recommended Tasks

- Add frontend UI for regex test/preview in the regex rules management page
- Add backend tests for saves module (currently untested)
- Improve empty/loading/error states in Vue views
