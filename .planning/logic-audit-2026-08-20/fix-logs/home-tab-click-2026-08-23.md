# TabBar Home click (`?testPdf=` / no returnTab) — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `5b04c677` toolbar click-to-arm.  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Unique leftover after toolbar / category-strip click-to-arm. Close tab (`e2e-tab-close`) removes the PDF tab. Open-file Home uses `returnToDevHubPreview` when `returnTab` is set. Create-path clicks then draw stay each tool's live-create spec. This leftover is desktop **Home click** on `?testPdf=` (`handleTabClick` → `setCurrentView('dashboard')`, keep `selectedPDF` mounted).

**Product:** Home was a clickable `<div>` with visible text but no `role` / `tabIndex` / keyboard. Close tab already had a named button. Home now exposes `role="tab"`, `aria-label="Home"`, `aria-selected`, `tabIndex={0}`, and Enter/Space.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** replay remapped-after-CW, Ctrl+2 / Ctrl+M, rail Previous/Next, keyboard letters, toolbar click-to-arm, or Close tab. Did **not** invent measure / Note-Link / Forms / stamp.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| X-01 / leftover-18 hosts | **Parked.** `.env.local` names PRESENT; process env absent; no `scripts/test-account-lease.mjs` token; no real `file.id`. |
| Remapped-after-CW catalog | **Exhausted / do not replay.** |
| Ctrl+2 Fit height / Ctrl+M MANUAL | **Already proved** at `7b86c22f`. |
| Rail Previous / Next click | **Already proved** at `ba953321`/`ed56e5ec`. |
| Overlay-listed P-04 letters | **Already proved** at `f19910c2`. |
| Toolbar click-to-arm | **Just proved** at `c87a53d7`/`5b04c677`. |
| Rectangle/Ellipse create-path | **Already proved** (`e2e-shape-live-create`). |
| Search Match case / Whole word | **0.** |
| Comments / Forms / Print / Actual size / Measure / Group / Extract / Note-Link / Marquee zoom | **Compile-hidden.** Live counts **0**. |
| Layers / Attachments | **Compile-hidden.** |
| Toolbar Zoom ± | **Replay-adjacent** after V-04 keyboard Ctrl++/−. Same `zoomIn`/`zoomOut`. |
| File → Open / Close | Open leftover-18 UL-03. Close tab already `e2e-tab-close`. |
| History besides Restore | A-07 dedicated click-restore / collapse. Filter chrome absent. |
| Text B/I/U/S / pickers without rotate | T-05 / callout-formatting / pickers-every-swatch already dedicated. |
| Selection / Select All / Undo/Redo / Delete | V-02 / E-05 / E-04 dedicated. |
| **Home click without returnTab** | **This pass.** Distinct from Close tab and from Open-file Home. |

## Live-proved

Playwright `debug/scenarios/e2e-home-tab-click.spec.mjs` (desktop + 390). Focused Node `homeTabClick` + leftover18.

| Slice | Intended / break / edge |
|---|---|
| Intended click | `?testPdf=clickable-link-test.pdf` 1400×900. Home hides Draw + page layer; PDF tab + Close tab stay **1**; URL stays `testPdf`; hubPreview **null**. Rect survives Home → PDF-tab return. viewBox **`0 0 612 792`**. |
| Break invent / Close contrast | Home has **0** Close. Round-trip invents **0**. hubPreview TabBar / Home / Draw **0**. |
| Break keyboard | Focused Home Enter / Space hide Draw and do not assign hubPreview. |
| Edge search fixture | `text-search-glyph-lab.pdf` Home keeps `testPdf`; `file.id` null; return keeps viewBox **`0 0 612 792`**. |
| Edge 390 | TabBar / Home / Close **0**; Back is handleBack. viewBox **`0 0 612 792`**. `file.id` null. |

Hunt live counts: Match case / Whole word / Comments / Forms / Print / Actual size / Measure / Group / Extract / Note / Marquee zoom / Layers / Attachments **0**. `file.id` null.

Product edit: `src/TabBar.jsx` Home tab only (not a high-risk file). Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. Official `npm test` not re-run (no high-risk touch). Cap **8448** / 75/250 not loosened. Isolated `partialEraserComplexity` 8448 standing.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

## Files

- `src/TabBar.jsx` (Home `role="tab"` + named + Enter/Space)
- `debug/scenarios/e2e-home-tab-click.spec.mjs`
- `tests/homeTabClick.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.
