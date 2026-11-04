# Pre-reset important-content backup plan

## Objective

Save the current source work to GitHub and provide a verified recovery archive
before the user's computer reset. The user will copy the ZIP to external storage.
The final requested scope is reusable content: characters, world books, MODs and
other libraries. Regenerable conversations, messages and runtime data are excluded.

## Scope

- Preserve all existing source changes and untracked source files in a checkpoint.
- Push the current branch without force; include an offline bundle of all Git refs.
- Preserve characters, world books and entries, MODs, presets, regular expressions,
  tags, template libraries, talent pools, character images, required assets and links.
- Keep reusable display code and town initialization definitions separately.
- Build a fresh database containing the retained library, with a new recovery-only
  account; exclude original account credentials and provider/API settings.
- Exclude conversations, messages, memories, saves, assistant history, jobs, logs,
  simulation state, vectors, dependencies, caches and historical database backups.
- Leave the original application data and private configuration unchanged.
- Remove only superseded temporary backup artifacts created by this task.
- No application implementation changes or feature cleanup are needed.

## Checklist and acceptance criteria

- [x] Inspect Git status, storage, repository instructions and remote.
- [x] Confirm the user will transfer the final archive to a USB drive or cloud.
- [x] Review staged source for private files, large files and credential literals.
- [x] Run the review gate, encoding and whitespace checks; record their scope.
- [x] Commit all source changes and push the checkpoint to GitHub.
- [x] Verify the remote branch hash matches the source checkpoint.
- [x] Read a consistent SQLite snapshot through a read-only source connection.
- [x] Build the library from an empty schema and compare every retained source field.
- [x] Verify integrity, foreign keys, content queries, login and 21 image endpoints.
- [x] Verify excluded runtime tables contain zero rows.
- [x] Create and verify the Git bundle and the final ZIP.
- [x] Exercise the Windows restore script from an independently extracted ZIP.
- [x] Remove superseded task-generated backup files and prepare the final archive for delivery.

The archive must contain recovery instructions, a usable library database, offline
code history, JSON content exports and checksums. The restore script must refuse to
overwrite an existing target and must verify file hashes before restoring.

## Validation commands

- `node scripts/check-encoding.mjs`
- `git diff --check` and `git diff --cached --check`
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`
- `git ls-remote origin refs/heads/MrYu/upgrade-phase-0`
- `git bundle verify` and a fresh clone from the bundle.
- SQLite `PRAGMA integrity_check` and `PRAGMA foreign_key_check` on the export.
- Compare all retained source fields and exercise login/library/image HTTP routes
  on an independent database copy with no provider calls.
- Independently extract the ZIP, hash every payload file and exercise its restore
  script into a new directory; compare the restored database and commit hashes.

## Results

- Initial state: 235 changed/untracked entries; checkpoint expanded to 250 files.
- Source checkpoint: `d7aa78e1cba1fe8e37919e768005a3fc3944e618`, pushed and
  verified on `MrYu/upgrade-phase-0` at the existing GitHub origin.
- An empty index lock dated 2026-10-24 prevented staging. No owning writer was
  present; the lock was preserved outside the repository before staging.
- The staged-file check found no private runtime paths or oversized files.
  Credential-pattern findings were test fixtures and an environment reference.
- Encoding passed. Initial staged whitespace checks identified existing extra EOF
  blank lines in two memory files; source content was preserved without cleanup.
  Subsequent clean-tree review-gate whitespace checks passed.
- Review gate passed: 1876 backend tests, 370 frontend unit tests, 120 end-to-end
  tests, frontend production build and both production dependency audits.
- Library retained: 10 characters, 16 world books, 454 entries, 15 MODs, 1 regex,
  92 tags, 61 character-tag links, 16 character-book links, 5 character-image rows,
  10 asset rows and 11 avatar rows. Presets/template-library/talent-pool tables
  currently have no rows; their empty state was checked.
- Additional exports retain 19 distinct display templates, 2 display settings and
  4 town initialization definitions without conversation IDs or runtime state.
- The fresh library database is 17,457,152 bytes; all retained source fields match,
  foreign keys and integrity pass, and all excluded runtime tables are empty.
- Independent HTTP drill passed: recovery-account login, 10 characters, 16 books,
  15 MODs, zero conversations, and all 21 stored image endpoints.
- Final output directory: `D:/FLAI-Backups/pre-reset-20261104`.
- Frontend screenshot acceptance is not claimed: this task edits no UI; existing
  UI changes were checkpointed and the 120 end-to-end tests passed. Desktop/mobile
  screenshot inspection for the earlier feature work remains outside this task.
- Original `backend/data`, `backend/uploads` and `.env` files were not edited.

## Final recovery validation

- A complete Git bundle preserves 19 refs, including local branches and stash.
  Historical Git object paths contain no tracked backend data/uploads or private
  environment files. A fresh clone and `git fsck --full` passed.
- The ZIP was independently extracted and all 16 payload file hashes matched.
  The Windows restore script passed; its checkout was clean and the restored
  database hash matched the verified library exactly.
- The final ZIP is about 20 MiB and includes code history, the reusable library,
  temporary recovery login, JSON exports, a Chinese recovery guide, restore script,
  verification reports and a SHA-256 manifest. Its sibling `.sha256` checks the ZIP.
- Superseded full-data snapshots, the cancelled historical backup archive and copied
  old environment credentials were removed only from this task's backup directory.
  Original application storage and historical backups were left intact.
- No source implementation was altered by this preservation task. A final docs-only
  commit records the requested scope and recovery validation; its branch is pushed
  and checked, and the final bundle/ZIP is refreshed to include that documentation.
- Remaining user action: copy `FLAI-important-content-20261104.zip` (and preferably
  its `.sha256`) to external storage before resetting this computer. Original API
  settings must be configured again after recovery. Extra display/town-definition
  exports are retained as reusable source material, not resumed simulation state.
