# Accessory Agent Observation Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give background accessory agents a structured current-turn observation window so they record fewer stale or inferred facts.

**Architecture:** Keep the change inside the existing backend accessory agent path. Add a small observation-window helper in `backend/src/services/accessoryAgents.js`, thread the accepted user message through `backend/src/routes/conversations.js`, and verify payload and prompt behavior in existing backend tests.

**Tech Stack:** Node 24, Express route handlers, node:test, existing provider tool-completion helpers.

---

### Task 1: Add Failing Payload And Prompt Tests

**Files:**
- Modify: `backend/src/tests/accessoryAgents.test.js`
- Modify: `backend/src/tests/accessoryAgentsNpc.test.js`

- [ ] **Step 1: Add status/economy payload assertions**

Add a test that runs provider-backed status and economy agents with `userMessage` and captures `globalThis.fetch` request bodies. Assert the user payload has `observationWindow.user` and `observationWindow.assistant`, and assert the system prompts mention current-turn evidence.

- [ ] **Step 2: Add NPC source prompt assertion**

Extend the NPC source test to require current-turn observation language in `buildNpcMessages()`.

- [ ] **Step 3: Run focused tests and watch them fail**

Run: `npm test -- src/tests/accessoryAgents.test.js src/tests/accessoryAgentsNpc.test.js`

Expected: FAIL because the payload still contains a bare `reply` or bare content and the prompts do not contain the new observation-window guard.

### Task 2: Implement Observation Window

**Files:**
- Modify: `backend/src/services/accessoryAgents.js`
- Modify: `backend/src/routes/conversations.js`

- [ ] **Step 1: Add helper**

Add `buildObservationWindow(userMessage, assistantMessage)` that returns:

```js
{
  user: String(userMessage?.content || '').trim(),
  assistant: String(assistantMessage?.content || '').trim()
}
```

- [ ] **Step 2: Thread helper through agent jobs**

Create the observation window once in `runAccessoryAgents()` and pass it to `runStatusBarAgent()`, `runNpcAgent()`, and `runEconomyAgent()`.

- [ ] **Step 3: Update provider message builders**

Change the provider payloads so status, NPC, and economy messages include `observationWindow`. Preserve `reply` for compatibility where existing tests or model instructions still read it.

- [ ] **Step 4: Pass user messages from chat routes**

Add `userMessage` to both non-streaming and streaming `startAccessoryAgentsInBackground()` calls.

- [ ] **Step 5: Run focused tests and watch them pass**

Run: `npm test -- src/tests/accessoryAgents.test.js src/tests/accessoryAgentsNpc.test.js`

Expected: PASS.

### Task 3: Validate And Report

**Files:**
- Create: `automation/reports/2026-06-24-accessory-agent-observation-window.md`

- [ ] **Step 1: Run full validation**

Run:

```powershell
cd backend; npm test
cd ..\frontend; npm run build
cd ..; node scripts/check-encoding.mjs
```

Expected: all commands exit 0.

- [ ] **Step 2: Write report**

Record changed files, validation output summary, cleanup notes, and the next recommended B-stage task.

- [ ] **Step 3: Commit**

Stage only the D-stage files and commit with:

```powershell
git commit -m "Add accessory agent observation window"
```

## Self Review

- Spec coverage: the plan covers route threading, payload shape, prompt guards, tests, validation, and reporting.
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency: `userMessage`, `assistantMessage`, and `observationWindow` names are consistent across tasks.
