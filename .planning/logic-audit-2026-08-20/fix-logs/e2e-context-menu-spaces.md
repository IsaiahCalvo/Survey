# Context menu + Spaces create — 2026-08-21

Vite `http://localhost:5173` reused (not killed). `?testPdf=clickable-link-test.pdf`. Did not stamp `file.id`.

## Live proof

`npx playwright test --config debug/playwright.reuse-5173.config.mjs debug/scenarios/e2e-context-menu-spaces.spec.mjs` → **3 / 0 fail**.

| ID | Result |
|---|---|
| UL-27 Cut | **pass** — owned rect removed; empty-page Paste restored a clone |
| UL-28 Copy | **pass** — original stayed; Paste added a new id |
| UL-29 Paste | **pass** — empty page is Paste-only; gray `#5a6473` + `cursor:default` while clipboard empty. Chrome (Draw button) right-click opens no annotation menu |
| UL-30 z-order | **pass** — Bring to front → last SVG sibling; Send to back → first |
| UL-31 Continue pin | **pass** — item present; after click `[data-counter-overlay]` stays armed, no stub log |
| U-02 Create space | **pass** — `Create space` (not Upgrade); Space 1 then Space 2; `window.__devTestPdf.id` is null |
| Multi-select edge | Group dashed box offered when Shift-select works; group menu not required to pass |

Prior “empty-page contextmenu swallowed by pdf.js” was a harness miss: viewer-relative `{x:40,y:40}` is chrome (off-page). Page-div fractions open the menu.

## Fix

**E2E-UL-04** — `item('Continue pin', 'continuePin')` was log-only. Now:

- `useAnnotationContextMenu.jsx` calls `handleContinuePin(ctx)`
- `PDFViewer.jsx` (tiny bundle add) switches `data.seriesId` via `handleSwitchCounterSeries` and `setActiveTool('counter')`

Invariants untouched: `zoomGeneration`, SVG viewBox, container-aware canvas, single-name fonts, CORS `*`.

## Node

`node --test tests/e2eUnlistedControls.test.mjs` → **17 / 0 fail** (includes `canManageCollaborativeSpaces` with null `documentId`).

`npm test` after the PDFViewer touch → **exit 0**.

## Still not this wave

Templates editor (hub). Checklist archive-with-markers (survey rail). Cloud named revisions, Stripe, MSAL, Capacitor, applied migrations.
