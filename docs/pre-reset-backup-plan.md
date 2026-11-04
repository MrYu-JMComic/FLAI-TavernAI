# Pre-reset project preservation plan

## Objective

Preserve the current FLAI TavernAI workspace and its private application data
before the user resets this computer. The user explicitly authorized a GitHub
push and will copy the resulting local archive to a USB drive or cloud storage.

## Scope

- Preserve all existing tracked changes and untracked project source files.
- Commit and push a clearly identified checkpoint to the current GitHub branch.
- Keep private data and credentials out of the public GitHub repository.
- Package the source snapshot, all Git refs/history, SQLite data and historical
  backups, uploads, application encryption secret, and local environment files.
- Exclude reinstallable dependencies, generated builds, and test/runtime caches.
- Include a Chinese recovery guide, file checksums, and verification results.
- This is a preservation task; no application behavior or legacy code is changed.
  No feature cleanup is necessary.

## Trackable checklist

- [x] Inspect Git status, repository guidance, storage paths, and GitHub target.
- [x] Confirm the user will transfer the archive to external storage themselves.
- [ ] Inventory private storage and custom paths without exposing secret values.
- [ ] Check the code snapshot for accidentally included secrets.
- [ ] Run applicable validation and record any existing failures faithfully.
- [ ] Commit the complete source checkpoint and push it without force.
- [ ] Confirm the remote branch resolves to the checkpoint commit.
- [ ] Build an archive outside the repository with a consistent SQLite snapshot.
- [ ] Verify database integrity, archive extraction, checksums, and Git history.
- [ ] Deliver the archive path and recovery instructions.

## Acceptance criteria

- The current source work is recoverable from GitHub at a verified commit.
- Private application data is included only in the local recovery archive.
- The database snapshot includes committed WAL content, passes integrity checks,
  and retains application records; uploads and app-secret are included.
- All archived payload files have hashes checked after independent extraction.
- A Git bundle contains all local refs and can recreate the checkpoint branch.
- The archive has a SHA-256 checksum and contains a clear recovery guide.
- The user is reminded to transfer the archive before resetting the computer.

## Validation commands

- `node scripts/check-encoding.mjs`
- `git diff --check` and `git diff --cached --check`
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`
- `git ls-remote origin refs/heads/MrYu/upgrade-phase-0`
- SQLite online backup with a read-only source; `PRAGMA integrity_check` on copy.
- `git bundle verify`, a clone from the bundle, and checkpoint hash comparison.
- Extract the ZIP into a separate temporary directory and verify all file hashes.
- Compute SHA-256 of the final ZIP.

## Results and remaining work

- Initial state: 235 changed/untracked entries on `MrYu/upgrade-phase-0`.
- Public remote: `https://github.com/MrYu-JMComic/FLAI-TavernAI.git`.
- Primary storage: `backend/data/flai.sqlite`, `backend/data/app-secret`,
  `backend/data/backups`, `backend/uploads`, and `backend/.env`.
- The final archive will be outside the repository, under `D:/FLAI-Backups`.
- Frontend screenshots are not applicable to this preservation operation: no UI
  implementation is edited here. Existing UI changes are saved as a checkpoint;
  their visual acceptance is not asserted by this backup task.
