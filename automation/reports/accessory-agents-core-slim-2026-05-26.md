# FLAI TavernAI Core Slim + Accessory Agents

## Summary
- Moved NPC, status bar updates, economy extraction, talent prompts, and CG scene matching behind accessory skill settings.
- Removed default talent badges, talent Roll entry, character image/CG management entry, and chat portrait auto-display from the core UI path.
- Added conversation and character accessory skill settings using existing advanced settings JSON, with economy/talent/CG disabled by default and status bar auto mode.
- Added accessory agent SSE handling, CSRF refresh-and-retry, regex rule import API usage, Markdown render plugin folding, and AI character extension suggestions.

## Changed Files
- `backend/src/modules/advancedSettings.js`
- `backend/src/modules/economy.js`
- `backend/src/routes/conversations.js`
- `backend/src/routes/characters.js`
- `backend/src/routes/regex.js`
- `backend/src/services/accessoryAgents.js`
- `backend/src/services/characterAssistant.js`
- `backend/src/validations/schemas.js`
- `backend/src/tests/accessoryAgents.test.js`
- `backend/src/tests/backend.test.js`
- `backend/src/tests/economy.test.js`
- `frontend/src/api.js`
- `frontend/src/components/MarkdownContent.vue`
- `frontend/src/views/ChatView.vue`
- `frontend/src/views/CharacterFormView.vue`
- `frontend/src/views/HomeView.vue`
- `frontend/src/views/SettingsView.vue`
- `frontend/src/styles.css`

## Validation
- Backend: `npm.cmd test` passed, 128 tests.
- Frontend: `npm.cmd run build` passed. Vite reported only the existing large-chunk warning.
- Local dev server: `npm.cmd run dev -- --host 127.0.0.1` started at `http://127.0.0.1:5173/`; `Invoke-WebRequest` returned HTTP 200.
- Review gate: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` could not run because `scripts/review-gate.ps1` is not present in this workspace.

## Notes
- Economy, talents, and CG data/API are preserved; only automatic core UI and chat side effects were detached.
- Economy state can now be inspected without creating a default account, so the chat header can avoid surfacing economy UI until enabled or used.
- Main chat no longer receives the status-bar tool path; status updates run through the status bar accessory agent.

## Next Recommended Task
- Add a small in-chat skill activity indicator/history if users want visibility into which accessory agents ran and what they changed.
