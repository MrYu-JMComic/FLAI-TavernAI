# Character Assistant Quality Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add shared quality guidance to the character draft assistant prompts.

**Architecture:** Keep prompt guidance inside `backend/src/services/characterAssistant.js`. Add focused request-capture tests in `backend/src/tests/characterAssistant-normalize.test.js` so both non-streaming and streaming prompts stay aligned.

**Tech Stack:** Node 24, node:test, existing provider completion mocks.

---

### Task 1: Write Failing Prompt Tests

**Files:**
- Modify: `backend/src/tests/characterAssistant-normalize.test.js`

- [ ] **Step 1: Add non-streaming prompt assertion**

Capture the provider request from `completeCharacterDraft()` and assert the system prompt includes:

```text
Persona fields are durable roleplay contracts
Opening messages must be playable first scenes
Tie extension and status suggestions to observable roleplay use
```

- [ ] **Step 2: Add streaming prompt assertion**

Capture the provider request from `streamCharacterDraft()` and assert the same phrases exist.

- [ ] **Step 3: Run focused tests and watch them fail**

Run: `node --test src/tests/characterAssistant-normalize.test.js`

Expected: FAIL because the prompt guide does not exist yet.

### Task 2: Add Shared Quality Guide

**Files:**
- Modify: `backend/src/services/characterAssistant.js`

- [ ] **Step 1: Import stream helper in tests if needed**

Ensure the test imports both `completeCharacterDraft` and `streamCharacterDraft`.

- [ ] **Step 2: Add prompt guide constant**

Create `characterQualityInstructions` near `statusBarBlueprintInstructions`.

- [ ] **Step 3: Reuse in both prompts**

Spread `...characterQualityInstructions` into both system prompt arrays after the core generation goal and before enabled-section rules.

- [ ] **Step 4: Run focused tests and watch them pass**

Run: `node --test src/tests/characterAssistant-normalize.test.js`

Expected: PASS.

### Task 3: Validate And Report

**Files:**
- Create: `automation/reports/2026-06-24-character-assistant-quality-guide.md`

- [ ] **Step 1: Run full validation**

Run:

```powershell
cd backend; npm test
cd ..\frontend; npm run build
cd ..; node scripts/check-encoding.mjs
```

Expected: all commands exit 0.

- [ ] **Step 2: Write report**

Record changed files, validation result, scope notes, and next C-stage task.

- [ ] **Step 3: Commit**

Stage only B-stage files and commit:

```powershell
git commit -m "Add character assistant quality guide"
```

## Self Review

- Spec coverage: prompts, tests, validation, and report are covered.
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency: prompt guide constant name is used consistently.
