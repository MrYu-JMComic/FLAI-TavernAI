# World Book Assistant Quality Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add shared quality guidance to the world book draft assistant prompts.

**Architecture:** Keep prompt guidance inside `backend/src/services/worldBookAssistant.js`. Add focused request-capture coverage in `backend/src/tests/backend.test.js` so both non-streaming and streaming prompts stay aligned.

**Tech Stack:** Node 24, node:test, existing provider completion mocks.

---

### Task 1: Write Failing Prompt Tests

**Files:**
- Modify: `backend/src/tests/backend.test.js`

- [ ] **Step 1: Import the streaming assistant**

Change the world book assistant import to include both `completeWorldBookDraft` and `streamWorldBookDraft`.

- [ ] **Step 2: Add non-streaming prompt assertion**

Capture the provider request from `completeWorldBookDraft()` and assert the system prompt includes:

```text
Break lore into atomic entries
Trigger keys should be exact names, aliases, locations, factions, items, events, and recurring secrets
Choose injection positions intentionally
Use alwaysActive, regexMode, probability, sticky, cooldown, delay, and group sparingly
```

- [ ] **Step 3: Add streaming prompt assertion**

Capture the provider request from `streamWorldBookDraft()` and assert the same phrases exist.

- [ ] **Step 4: Run focused tests and watch them fail**

Run: `cd backend; node --test src/tests/backend.test.js`

Expected: FAIL because the prompt guide does not exist yet.

### Task 2: Add Shared Quality Guide

**Files:**
- Modify: `backend/src/services/worldBookAssistant.js`

- [ ] **Step 1: Add prompt guide constant**

Create `worldBookQualityInstructions` near `worldBookTools`.

- [ ] **Step 2: Reuse in both prompts**

Spread `...worldBookQualityInstructions` into both system prompt arrays after the core tool-use goal and before the existing world-info design lines.

- [ ] **Step 3: Run focused tests and watch them pass**

Run: `cd backend; node --test src/tests/backend.test.js`

Expected: PASS.

### Task 3: Validate And Report

**Files:**
- Create: `automation/reports/2026-06-24-worldbook-assistant-quality-guide.md`

- [ ] **Step 1: Run full validation**

Run:

```powershell
cd backend; npm test
cd ..\frontend; npm run build
cd ..; node scripts/check-encoding.mjs
```

Expected: all commands exit 0.

- [ ] **Step 2: Write report**

Record changed files, validation result, scope notes, and completion of the A/D/B/C sequence.

- [ ] **Step 3: Commit**

Stage only C-stage files and commit:

```powershell
git commit -m "Add world book assistant quality guide"
```

## Self Review

- Spec coverage: prompts, tests, validation, and report are covered.
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency: prompt guide constant name is used consistently.
