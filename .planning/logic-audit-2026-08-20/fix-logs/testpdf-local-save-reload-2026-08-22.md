# ?testPdf= local fixture save / reload-restore — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Fidelity audit of claimed E2E proofs (not a leftover hunt). Inspected current tree + receipts + Playwright. First incomplete reachable slice vs the objective: **local fixture save**. `fix-logs/pickers-every-swatch-2026-08-21.md` wrote `annotationsByPage_clickable-link-test.pdf-23183` and said reload-restore was **not** executed. X-02 download / wave9 export / `?testPdf=` import fixtures already have dedicated slices. Hub web import stays leftover-18. Cloud save stays leftover-18 **X-01**.

Did **not** invent `.env.local` / Stripe / MSAL / Turnstile / accounts / `file.id`. Did **not** hunt. Hosts still **absent** (30-second glance: no `.env.local` / `.env.test` / `.bot-credentials.json` / process auto-login).

## Why this was incomplete

| Prior claim | What was actually asserted |
|---|---|
| Pickers every swatch | localStorage keys **present**. Reload-restore **not** run. |
| leftover18-save-export | `file.id` null + Export download + History Save-version hidden. No reload. |
| phase27-roundtrip | `test.fixme` — cloud Y.Doc, not `?testPdf=` local cache. |
| X-01 | Cloud identity-churn. Correctly blocked. Not this slice. |

Reachable path: `?testPdf=` has no `file.id`, so `PDFViewer` persist `if (pdfFile?.id) return` does **not** skip. `saveAnnotationsByPage` / `loadAnnotationsByPage` are the local cache. Distinct from leftover-18 cloud save.

## Live-proved

Playwright `e2e-testpdf-local-save-reload.spec.mjs` **1 / 1 (17.2s)** on Vite `http://127.0.0.1:5199` (`npm run dev:ui`). Node `testPdfLocalSaveReload` **3 / 3**. leftover18FailClosed not replayed (no product diff).

IDs: rect `7208659f-…`; second `73436303-…`; third `e99bc758-…`; 390 `80acf7c2-…`. Key `annotationsByPage_clickable-link-test.pdf-23183`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

| Slice | Evidence |
|---|---|
| Draw rect writes local cache | Key `annotationsByPage_clickable-link-test.pdf-23183` holds `7208659f-…`. |
| Reload restores same id + geometry | Same id; left/top Δ < 2; width/height Δ < 4. |
| Fresh draw after wipe | `e99bc758-…` survives reload. |

### Break — **pass**

| Slice | Evidence |
|---|---|
| Pen-armed reload | Rect still present. |
| Missing cache key | Reload invents **0** of the wiped ids. |
| Corrupt JSON `{not-json` | Editor mounts; `Error loading annotationsByPage`; no invented mark; no error boundary. |

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Zoom then reload | `viewBox="0 0 612 792"` both times. No JS zoom. |
| Second rect | `73436303-…` + first both restore. |
| Other fixture | `?testPdf=text-search-glyph-lab.pdf` does not show clickable-link ids; clickable-link keys remain. |
| 390 | `80acf7c2-…` restores. |
| hubPreview | Draw **0**. Not the local annotation cache. |
| `file.id` | null throughout. |

## Official / focused Node

Focused `testPdfLocalSaveReload` **3 / 3**. Cap **8448** not loosened. Official `npm test` not re-run (no product / high-risk edit; standing isolated 8448 fail-stop unchanged).

## Product

No min-viable product diff. Persist skip-when-`file.id` and load-from-`annotationsByPage_*` for `!isCloudBackedDoc` already correct. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric fontFamily untouched.

## Next leftover

Leftover-18 live hosts. First named: **X-01** (needs `.env.local` — still missing; do not invent). Objective still requires host-gated / compile-hidden slices (Print panel, stamp/measure/Group/Extract/Note-Link/Forms, Copy-to-Spaces, Move/Copy stub, survey Y/N/N-A). Leftover **18** stay parked. Goal stays open.
