# 2026-06-07 Prepare Commit Single Path Staging

## Goal

Keep `scripts/prepare-commit.ps1` reliable when there is exactly one tracked path and one allowed untracked path to stage.

## Changes

- Wrapped `Get-UniquePaths` assignments in array expressions so single-item path lists do not degrade to strings.
- Preserved array behavior when combining unstaged tracked files with allowed untracked files.
- Kept the existing protected-path filtering and dry-run output unchanged.

## Files Touched

- `scripts/prepare-commit.ps1`
- `automation/backlog.md`

## Validation

- `node scripts/check-encoding.mjs`: pass.
- `powershell -ExecutionPolicy Bypass -File scripts\prepare-commit.ps1 -Stage -AllAllowed -IncludeUntracked`: used to stage this batch after the fix.

## Notes

- The bug was triggered by PowerShell string concatenation when single-item lists were combined with `+`.
