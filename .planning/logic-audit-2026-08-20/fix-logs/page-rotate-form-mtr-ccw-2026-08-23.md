# Form-widget persist after CW + mtr after CCW — 2026-08-23

Named leftover after CCW/180 remapper persist (`ec1a2103`). Live form-widget leftover-portrait remap is already type-level (`e2e-page-rotate-form-widgets`). This pass is export→reimport persist. Named remapped `mtr` is CW-only — this pass is object-level `mtr` after CCW. Named cloud save stays leftover-18 **X-01**. Did **not** stamp `file.id`. Did **not** invent a Forms editor or Curve tool.

## X-01 glance (names only)

| Check | Result |
|---|---|
| Process `VITE_DEV_AUTO_LOGIN_*` / `SUPABASE_SERVICE_ROLE_KEY` | **absent** |
| `.env.local` those three names | **PRESENT** (gitignored; values not printed) |
| Coordinator lease | **none** |
| `.bot-credentials.json` | **none** |

## Form persist

Playwright `e2e-page-rotate-form-widgets-persist.spec.mjs` **2 / 2**. `?testPdf=clickable-link-test.pdf`. Live after CW name **0.662 / 0.363** on host **1012×782**; export → re-import kept the same fractions + viewBox **`0 0 792 612`**. Leftover portrait miss. Widgets invent **0** Survey marks. `file.id` null.

## Curve create

**Skipped — no tool.** Shape catalogs (desktop `PDFViewer.jsx` shape dropdown + mobile `MobilePdfViewerChrome.jsx`) are rect / ellipse / line / arrow / counter. Curve is Line/Arrow midpoint handle (`useSVGInteraction.js` `ds.mode === 'midpoint'`). Handle commit is already receipted as failing in this VM; `e2e-page-rotate-line-midpoint-remap` seeds `data.midpoint`. Did **not** invent a Curve tool.

## Unique leftover — `mtr` after CCW

Playwright `e2e-page-rotate-remap-mtr-ccw.spec.mjs` **2 / 2**. Rect `ab5784b9-…` **183.60, 277.20 → 277.20, 428.40** angle **-90**; `mtr` **-90 → 225**; size held; undo restores **-90**; viewBox **`0 0 792 612`**. Empty CCW invents **0**. No product edit.

## Official / focused Node

Focused form-persist + curve-unreachable + mtr-CCW + leftover18 **20 / 20**. Cap **8448** / 75/250 not loosened. No high-risk edit. `graphify` CLI absent.

## Leftover-18

Still parked. Goal stays OPEN.
