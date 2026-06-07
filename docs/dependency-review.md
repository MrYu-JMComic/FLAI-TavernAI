# Dependency Review

Reviewed on 2026-06-07. This document records upgrade candidates before changing dependency versions.

No dependency was upgraded during this review.

## Commands

```powershell
cd backend
npm.cmd outdated --json --long
npm.cmd audit --json

cd ..\frontend
npm.cmd outdated --json --long
npm.cmd audit --json
```

## Audit Result

- Backend: 0 known vulnerabilities reported by `npm audit`.
- Frontend: 0 known vulnerabilities reported by `npm audit`.

## Backend Candidates

| Package | Current | Wanted | Latest | Type | Candidate |
|---|---:|---:|---:|---|---|
| `dompurify` | `3.4.5` | `3.4.8` | `3.4.8` | dependency | Patch update within the declared range. |

## Frontend Candidates

| Package | Current | Wanted | Latest | Type | Candidate |
|---|---:|---:|---:|---|---|
| `@tanstack/vue-virtual` | `3.13.25` | `3.13.28` | `3.13.28` | dependency | Patch update within the declared range. |
| `dompurify` | `3.4.5` | `3.4.8` | `3.4.8` | dependency | Patch update within the declared range. |
| `@lucide/vue` | `1.16.0` | `1.16.0` | `1.17.0` | dependency | Minor update; requires explicit version change. |
| `vite` | `8.0.14` | `8.0.14` | `8.0.16` | devDependency | Patch update; requires explicit version change because the package is pinned. |
| `vue` | `3.5.34` | `3.5.34` | `3.5.35` | dependency | Patch update; requires explicit version change because the package is pinned. |

## Recommended Upgrade Batches

1. Low-risk patch batch:
   `dompurify` in both workspaces and `@tanstack/vue-virtual` in the frontend.
2. Frontend pinned patch batch:
   `vue` and `vite`, with a frontend build and a quick manual smoke test for routing and chat rendering.
3. Icon library batch:
   `@lucide/vue`, with a build and visual spot-check of icon-heavy controls.

Do not combine these with unrelated UI or backend behavior changes. Keep each batch small enough to review and roll back independently.

## Validation To Run After Any Upgrade

```powershell
node scripts/check-encoding.mjs
cd backend
npm.cmd test
cd ..\frontend
npm.cmd run build
cd ..
powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1
```
