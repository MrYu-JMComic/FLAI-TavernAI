# 2026-06-06 NPC Agent No Keyword Scan

## Scope

Human-directed NPC management accuracy fix. The NPC panel was recognizing Markdown outline headings and other prose fragments as NPC names because local keyword and text-pattern scanning were still feeding the NPC list.

## Changed Files

- `backend/src/modules/npcs.js`
  - Stopped merging NPC names scanned from assistant message text into `listConversationNpcs()`.
  - Kept NPC listing based on explicit memories, behaviors, and assistant-managed `npc_registry` records.
  - Disabled the legacy `scanNpcsFromMessages()` text scanner for compatibility while returning no discovered NPCs.
- `backend/src/services/accessoryAgents.js`
  - Removed the NPC Agent fallback that created NPC memories from local Markdown/dialogue text patterns when structured tool calls were absent.
- `backend/src/routes/conversations.js`
  - Removed the unused automatic text-scan NPC reply helper and its scanner import.
- `backend/src/tests/accessoryAgents.test.js`
  - Updated NPC Agent coverage to assert text-pattern fallback memories are not created.
- `backend/src/tests/npcs.test.js`
  - Updated NPC listing and scan coverage so Markdown headings, dialogue-looking text, and keyword-like snippets are ignored unless backed by memory, behavior, or registry data.

## Validation

- `node --test src\tests\npcs.test.js src\tests\accessoryAgents.test.js` - PASS, 21 tests
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` - PASS
  - Encoding check PASS
  - Backend tests PASS, 235 tests
  - Frontend build PASS
- `node scripts/check-encoding.mjs` - PASS after report creation

## Risk Notes

- The repository already had many unrelated uncommitted changes before this run. This run intentionally only changed the NPC text-scan paths, their tests, and this report.
- `scanNpcsFromMessages()` remains exported for compatibility but now returns an empty result. A later cleanup can remove dead extraction helpers once no callers depend on them.

## Next Recommended Task

Improve the assistant-side NPC extraction prompt/tool contract so newly mentioned real characters are registered through structured assistant output instead of local keyword scanning.
