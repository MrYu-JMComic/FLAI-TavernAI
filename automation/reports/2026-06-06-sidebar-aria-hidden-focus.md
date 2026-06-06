# Sidebar Aria Hidden Focus Fix

## Summary

- Fixed browser accessibility warnings caused by focus remaining on the chat sidebar backdrop or history items while the sidebar was being hidden.
- Replaced sidebar/backdrop `aria-hidden` toggling with `inert` for the hidden state.
- Added synchronous focus release when the sidebar closes so focused descendants are blurred before the hidden state is applied.

## Changed Files

- `frontend/src/components/chat/ChatSidebar.vue`
- `automation/reports/2026-06-06-sidebar-aria-hidden-focus.md`

## Validation

- `npm.cmd run build` in `frontend`: passed.
- `node scripts/check-encoding.mjs`: passed.

## Notes

- This fix keeps the sidebar visually collapsed as before while preventing focused controls from being hidden from assistive technologies.
