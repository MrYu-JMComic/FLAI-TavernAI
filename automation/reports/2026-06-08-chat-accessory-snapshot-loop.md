# Chat Accessory Snapshot Loop

## Backlog item

- Reduce callback work in ChatView accessory refresh fingerprint serialization without changing status-bar or NPC update semantics.

## Changed files

- `frontend/src/views/ChatView.vue`
- `backend/src/tests/frontendChatAccessory.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-chat-accessory-snapshot-loop.md`

## What changed

- Replaced `value.variables.map(...)` in `serializeStatusBarSnapshot` with a direct loop that builds the same normalized variable rows.
- Replaced `items.map(...)` in `serializeNpcSnapshot` with a direct loop before the existing name sort.
- Added ChatView source coverage to guard the direct-loop snapshot contract and prevent reintroducing the two callback allocations.

## Validation

- Focused Chat accessory source coverage passed:
  - `node --test backend\src\tests\frontendChatAccessory.test.js --test-name-pattern "ChatView serializes accessory refresh snapshots|ChatView (stops redundant NPC accessory polling|refreshes the NPC panel|keeps final NPC accessory cleanup|accepts NPC panel loaded)"`
- Encoding check passed:
  - `node scripts\check-encoding.mjs`
- Full review gate passed:
  - `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
- Diff safety checks passed:
  - `git diff --check`
  - `git diff --cached --check`
  - `git status --short -- backend/data backend/uploads .env .env.local .env.development .env.production`

## Next recommended task

- Continue auditing ChatView serialization and render helpers only where source tests can prove behavior preservation; avoid widening into unrelated chat UI changes.
