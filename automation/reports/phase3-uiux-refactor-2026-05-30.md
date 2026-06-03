# Phase 3 — Home & Character Editor

**Date:** 2026-05-30
**Commit:** `cb5b78e` — ui: improve home and character editor
**Scope:** `frontend/src/views/HomeView.vue`, `frontend/src/views/CharacterFormView.vue`, `frontend/src/styles.css`

## Summary

HomeView and CharacterFormView experience improvements: skeleton loading, error states, import preview, form section navigation, and mobile adaptation.

## Modified Files

### HomeView.vue

- Skeleton loading: 6 animated skeleton cards replace plain "loading..." text (avatar, title, description, tag placeholders)
- Error state: `loadError` ref with AlertTriangle icon and retry button
- Import preview: preview avatar now shows data URL images (not just initials)
- Added AlertTriangle and RefreshCw icon imports
- All existing logic (v-model, API calls, events) unchanged

### CharacterFormView.vue

- Section navigation: sticky tab bar at top (Basic / Settings / Advanced) with smooth scroll
- Section reorganization:
  - `#section-basic`: avatar, permissions, name, tags, world book, gender, age
  - `#section-settings`: background, world view, persona, greeting
  - `#section-advanced`: AI polish, author settings, render plugins, regex replacement
- Visual separation: `.form-section-group` with `border-top` and `scroll-margin-top`
- All form fields, v-model bindings, API payloads, validation, and events preserved

### styles.css

Added ~170 lines of CSS:

| Category | Styles |
|---|---|
| Skeleton cards | `.home-skeleton-grid`, `.skeleton-card`, `.skeleton-avatar`, `.skeleton-line`, `@keyframes skeleton-pulse` |
| Section nav | `.form-section-nav`, `.form-section-tab`, `.form-section-tab.active` |
| Section groups | `.form-section-group`, `.form-section-title`, `.form-section-desc` |
| Import avatar | `.import-preview-avatar img` |
| Error state | `.error-state` variants |
| Mobile 768px | Single-column skeleton, sticky nav, scroll-margin adjustments |
| Mobile 480px | 44px touch targets on section tabs, compact font |

## Preserved

- Backend APIs unchanged
- All v-model bindings, form validation, API payloads unchanged
- Desktop layout unchanged (769px+ breakpoints)
- ChatView, SettingsView, WorldBookView unchanged

## Validation

- `node scripts/check-encoding.mjs` — PASS
- `npm run build` — PASS (584ms)
