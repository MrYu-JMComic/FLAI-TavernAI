# Safe Commit Preparation

## Summary

- Added `scripts/prepare-commit.ps1` as a guarded pre-commit staging helper with path-scoped staging.
- Documented the workflow in `README.md` so contributors avoid broad `git add -A` usage.
- Expanded `.gitignore` for common coverage, cache, temporary, backup, and merge residue files.

## Changed Files

- `.gitignore`
- `README.md`
- `scripts/prepare-commit.ps1`

## Validation

- `node scripts/check-encoding.mjs` - passed through the prepare script and review gate.
- `powershell -ExecutionPolicy Bypass -File scripts\prepare-commit.ps1` - passed dry run; ignored local data, env files, logs, dependency folders, build output, and generated prompt drafts stayed out of staging candidates.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` - passed; backend 351 tests passed and frontend build passed.

## Next Recommended Task

- Use `scripts/prepare-commit.ps1 -Stage -Path <path>` for future commit preparation, then commit with an explicit message after reviewing the staged diff.
