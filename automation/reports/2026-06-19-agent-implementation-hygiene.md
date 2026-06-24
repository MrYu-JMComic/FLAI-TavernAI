# Agent Implementation Hygiene Rule

## Summary

- Rewrote `AGENTS.md` as an ASCII-only cross-agent entry file to avoid terminal or agent encoding ambiguity.
- Preserved the stricter implementation hygiene rule for cleaning up replaced UI paths, helper branches, style rules, tests, and dead code.
- Added an explicit rule that `AGENTS.md` itself should stay ASCII-only unless the user approves otherwise.

## Changed Files

- `AGENTS.md`
- `automation/reports/2026-06-19-agent-implementation-hygiene.md`

## Validation

- Pending rerun: `node scripts/check-encoding.mjs`
- Pending rerun: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`

## Protected Paths

- Did not edit `backend/data`, `backend/uploads`, `.env*`, `node_modules`, or generated build output.

## Next Recommended Task

- Continue applying the optimization plan in small iterations, and remove obsolete code paths in the same iteration whenever a new path replaces them.
