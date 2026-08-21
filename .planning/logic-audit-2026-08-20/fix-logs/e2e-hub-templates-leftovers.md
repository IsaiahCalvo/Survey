# E2E leftovers — hub templates / pen tap / U-04 / form widgets

**Date:** 2026-08-21  
**Worktree:** `nifty-elion-773074`  
**Vite:** reused `http://localhost:5173` (`npm run dev:ui`, not killed)  
**Harness:** `debug/scenarios/e2e-hub-templates-leftovers.spec.mjs` + `debug/playwright.reuse-5173.config.mjs`  
**Result:** 4 / 4 passed. Did not stamp `file.id`. Did not talk to live Stripe / MSAL / Capacitor.

## Product fix (min-diff)

**E2E-HUB-01 — blank template rename left the title field empty**

- `renameTemplate` already no-ops on a blank/whitespace name (state keeps the last name).
- The desktop + mobile title inputs use `defaultValue`, so a blank blur left the field visually empty while the list still showed the old name.
- **Fix:** on empty blur, restore `e.currentTarget.value = tpl.name` (same as Escape). Desktop `input.inline-edit.cat-title` and mobile `.templates-mobile-title-input`.
- **Proof:** live `?hubPreview=1&tab=templates` — rename to `E2E Leftover Template`, Save, fill spaces, Enter → field and list both stay `E2E Leftover Template`.

`zoomGeneration` / SVG viewBox / canvas sizing / CORS / `file.id` untouched.

## Live rows this wave

| ID | Result | Proof |
|---|---|---|
| U-03 Templates editor | **pass** (hubPreview) | `/?hubPreview=1&tab=templates`. New template → `Template 3` with default GC entity. Rename + Save. Blank rename no-op. Second create → `Template 4`. Select + Delete removes Template 4. `/?hubPreview=1&empty=1&tab=templates` empty state + New template. |
| D-01 1-dot pen tap | **pass** (intended create) | `?testPdf=clickable-link-test.pdf`. Pen down+up at the same point (no drag) committed path `268ff89b-…`. Policy: `createProductionPaperInk` keeps a 1-point centerline (circle). Null only if `compactPoints` is empty. |
| U-04 archive-with-markers | **blocked** | Stamped Walls marker on `?surveyTransitionE2E=1`. KAL-436 E2E template has **no checklist items**. Survey rail has no Archive-item control (`[data-testid^=archived-checklist-]` = 0). Hub sidebar **Archive** tab is document archive, not KAL-44. KAL-44 modal lives in `TemplatesEditor` and needs `getChecklistItemUsageCount` (HubPreview does not pass it). Category Select→Delete is hard-delete of markers, not archive; Walls select did not enable Delete this window. |
| X-05 Form widgets | **pass** (fill/edit) | `kal441-form-fields.pdf` already exists (do not invent). `.pdfjsFormLayer` rendered **8** widgets: 2 text, 1 textarea, 1 checkbox, 3 radios, 1 select. Select/pan (`v`) required for pointer-events. Typed `wave-form` into the first text widget; value stuck after blur. Checkbox click does not flip Playwright `check()` state (pdf.js widget). Form values persist via `usePdfjsFormFieldPersistence`, not SVG `data-anno-id` groups (`annotationRow` null — expected). |

## Exact U-04 blocker

1. `src/DevTestRoute.jsx` `surveyTransitionE2ETemplates` Walls category has `name` + `color` only — no `checklist`.
2. Survey rail (`SurveySpacesRail.jsx`) only **displays** already-archived items with responses. It never opens `archive-confirm-modal`.
3. Archive-with-markers is TemplatesEditor `deleteItem` → usage > 0 → Archive confirm. `?testPdf=` cannot open that editor against the live survey template. HubPreview `onSaveTemplates={setTemplates}` does not pass `getChecklistItemUsageCount`, so unused-item delete hard-deletes.

Not a fake pass. Not a `file.id` stamp.

## Remaining truly blocked (cloud / native / deploy)

- Named cloud revisions / restore (real saved `file.id`)
- Live Stripe Checkout / portal
- Live MSAL / OneDrive
- Native Capacitor / XCUI pinch / sheets
- Applied migrations
- Captcha-gated password login
- Share copy-link mint (paid user + real item id)
- Custom Print panel (`PRINT_PANEL_ENABLED = false`)
- Live collab roster / outbox Retry flush
- Electron File→Open dialog
- Form-field **cloud** persist (needs a saved doc; in-session fill is proven)

## Files

- `src/home/TemplatesEditor.jsx` — blank-rename restore
- `debug/scenarios/e2e-hub-templates-leftovers.spec.mjs`
- this receipt
- `E2E-STATUS.md` / `E2E-NEW-ISSUES.md` / `E2E-UNLISTED.md`

No commit.
