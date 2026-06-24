# Home Character Wheel Scroll

## Summary

- Allowed the desktop home character virtual scroller to propagate wheel scroll at its boundaries by changing `.home-character-scroll` from `overscroll-behavior: contain` to `overscroll-behavior: auto`.
- Updated the HomeView source test so the character card area cannot regress to trapping page wheel scroll.

## Changed Files

- `frontend/src/styles.css`
- `backend/src/tests/frontendHomeView.test.js`

## Validation

- `node --test backend/src/tests/frontendHomeView.test.js` - passed.
- `node scripts/check-encoding.mjs` - passed.
- `npm run build` in `frontend` - passed.
- `npm test` in `backend` - failed in pre-existing ChatComposer source-test assertions:
  - `ChatComposer keeps mobile model switching to one stable control with dark theme colors`
  - `ChatComposer shortcut toolbar stays compact and mobile-safe`

## Notes

- The repository already had unrelated dirty files before this iteration, including `frontend/src/styles.css` and ChatComposer-related tests/styles. This iteration only intended to change the home character scroll behavior and its HomeView test coverage.
- Next recommended task: reconcile the dirty ChatComposer mobile style changes with `backend/src/tests/frontendChatComposer.test.js` so the full backend test suite can pass again.
