# E2E U-04 — archive-with-markers on hubPreview

**Date:** 2026-08-21  
**Worktree:** `nifty-elion-773074`  
**Vite:** reused `http://localhost:5173` (`npm run dev:ui`, not killed)  
**Harness:** `debug/scenarios/e2e-u04-archive.spec.mjs` + leftovers U-04 smoke  
**Result:** **pass**. Did not stamp `file.id`. Did not talk to live Stripe / MSAL / Capacitor.

## Prior blocker (leftovers wave)

`?testPdf=` + KAL-436 has no checklist and the survey rail has no Archive-item control. KAL-44 lives in `TemplatesEditor` + `getChecklistItemUsageCount`. HubPreview already seeded checklists (`i1`–`i6` on Security Walk-Through) but did not pass the usage callback, so × always hard-deleted.

## Product fix (min-diff)

`src/home/HubPreview.jsx` now passes `getChecklistItemUsageCount` — the same SurveyHub prop Dashboard wires to Supabase.

- Static seed on an **existing** mock id: `i1` → 3 (“Is the camera cable pulled?”).
- All other ids (including unused `i2`) return 0.
- No new backend. No `file.id`. TemplatesEditor / PDFViewer / `zoomGeneration` / viewBox / CORS untouched.

## Live proof (`/?hubPreview=1&tab=templates`)

Open Security Walk-Through → expand Cameras.

| Case | Result |
|---|---|
| **Intended** — delete used `i1` | `archive-confirm-modal`: “Archive checklist item?”, **3 survey markers have** responses for *Is the camera cable pulled?*, Cancel + Archive |
| **Break** — delete unused `i2` | No modal. Item hard-deleted (not archived) |
| **Edge Cancel** | Modal closes; `i1` stays active; no `data-archived-item-id="i1"` |
| **Edge Archive** | Item leaves the active list; appears under `archived-items-c1` |

Playwright: `e2e-u04-archive.spec.mjs` **1 / 1**. Leftovers U-04 smoke **pass**.

`U04_ARCHIVE_PROOF` `{"route":"/?hubPreview=1&tab=templates","usedItem":"Is the camera cable pulled?","unusedItem":"Is the camera installed?","usedUsage":3,"cancelLeftItem":true,"confirmArchived":true,"unusedHardDeleted":true}`

## Remaining

- Cloud usage count (Dashboard → `countSurveyMarkersReferencingChecklistItem`) still needs a signed-in user + real markers. HubPreview uses the existing callback with a static seed.
- Survey rail still only **displays** already-archived items. It does not open `archive-confirm-modal`. Archive-with-markers is TemplatesEditor.
- `?testPdf=` / KAL-436 still has no checklist items — not this route.

## Files

- `src/home/HubPreview.jsx` — `MOCK_CHECKLIST_ITEM_USAGE` + pass-through
- `debug/scenarios/e2e-u04-archive.spec.mjs`
- `debug/scenarios/e2e-hub-templates-leftovers.spec.mjs` — U-04 smoke now hubPreview
- this receipt
- `E2E-STATUS.md` / `E2E-NEW-ISSUES.md`

No commit.
