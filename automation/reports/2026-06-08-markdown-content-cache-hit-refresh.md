# Markdown Content Cache Hit Refresh

## Backlog item

- Make MarkdownContent render-cache hits exact and keep frequently used entries from being treated as oldest during cache eviction.

## Changed files

- `frontend/src/components/MarkdownContent.vue`
- `backend/src/tests/frontendMarkdownContent.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-markdown-content-cache-hit-refresh.md`

## What changed

- Replaced the truthy `renderCache.get(cacheKey)` hit check with `renderCache.has(cacheKey)` so cached empty sanitized HTML is still a hit.
- Refreshed a hit by deleting and reinserting the key before returning the cached HTML, keeping active render entries at the newest end of the existing Map eviction order.
- Added MarkdownContent source coverage to guard the exact-hit and recency-refresh behavior.

## Validation

- Focused MarkdownContent source coverage passed:
  - `node --test backend\src\tests\frontendMarkdownContent.test.js`
- Encoding check passed:
  - `node scripts\check-encoding.mjs`
- Full review gate passed:
  - `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
- Diff safety checks passed:
  - `git diff --check`
  - `git diff --cached --check`
  - `git status --short -- backend/data backend/uploads .env .env.local .env.development .env.production`

## Next recommended task

- Continue reviewing MarkdownContent and chat-render cache behavior only where a simple invariant can be tested without widening renderer complexity.
