# Desktop rail Previous/Next page click — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `7b86c22f` Ctrl+2 Fit height + Ctrl+M MANUAL.  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Unique leftover after Ctrl+2 / Ctrl+M. V-05 is keyboard ←/→ Home/End (`e2e-page-nav-keyboard`). UL-07 is the page # field. V-06 is thumbnail left-click. 390 prev/next was mobile hit-targets sample only. Prefer-live-bug hunt found no product defect; took compile-visible rail Previous/Next.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh (no new product SHA). Did **not** replay remapped-after-CW or Ctrl+2 / Ctrl+M. Did **not** invent measure / Note-Link / Forms / stamp / Group.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| X-01 / leftover-18 hosts | **Parked.** `.env.local` names PRESENT; process env absent; no `scripts/test-account-lease.mjs` token; no real `file.id`. |
| Remapped-after-CW catalog | **Exhausted / do not replay.** |
| Ctrl+2 Fit height / Ctrl+M MANUAL | **Just proved** at `7b86c22f`. Menu Fit height / Ctrl+0 / Ctrl+1 already covered. |
| Search Match case / Whole word | **0.** Opened Search text; V-08 dedicated. |
| Comments / Forms / Print / Actual size / Measure / Group / Extract / Note-Link / Marquee zoom | **Compile-hidden.** Live counts **0**. |
| Ctrl+S local save | **Already dedicated** as `e2e-testpdf-local-save-reload` (not leftover-18 cloud). Overlay omits Ctrl+S. Not this leftover. |
| Toolbar Zoom in/out | **Replay-adjacent** after V-04 keyboard Ctrl++/−. Same `zoomIn`/`zoomOut`. |
| Keyboard nudge | **Not wired.** ArrowLeft/Right are page nav. |
| **Rail Previous / Next click** | **This pass.** Compile-visible `aria-label="Previous page"` / `Next page` → `goToPreviousPage` / `goToNextPage`. Overlay lists keyboard Previous/Next only. |

## Live-proved

Playwright `debug/scenarios/e2e-page-nav-toolbar.spec.mjs` **2 / 2 (9.8s)** on reused Vite `http://localhost:5173`. Focused Node `pageNavToolbar` + leftover18 **15 / 15**.

| Slice | Intended / break / edge |
|---|---|
| Intended Next / Previous | `?testPdf=spike-120-pages.pdf` 1400×900. Page 1 Previous **disabled**; Next click **1→2**; Previous click **2→1**. |
| Break first / last | Previous stays disabled on page 1. Page-field setup to **120**; Next **disabled**; Previous click **119**. |
| Break hubPreview | `/?hubPreview=1` Draw **0**; Previous **0**; Next **0**. |
| Break invent / overlay | Overlay lists keyboard Previous/Next; omits rail labels. Next/Previous invent **0** annotations. |
| Edge 1-page | `clickable-link-test.pdf` Previous **and** Next **disabled**. viewBox **`0 0 612 792`**. |
| Edge isolation | Page-1 rect `8c893b6d-…` survives Next/Previous; page 2 user marks **[]**. Pen-armed Next still **1→2** and invents **0**. |
| Edge 390 | Next **1→2**; Previous **2→1**; Previous disabled on 1; viewBox **`0 0 612 792`**; `file.id` null. |

Hunt live counts: Match case / Whole word / Comments / Forms / Print / Actual size / Measure / Group / Extract / Note / Marquee zoom **0**. `file.id` null.

No product edit. High-risk files untouched. Official `npm test` not re-run (no high-risk touch). Cap **8448** / 75/250 not loosened. Isolated `partialEraserComplexity` 8448 standing. `chromeE2EContracts` `.ts` loader standing.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

## Files

- `debug/scenarios/e2e-page-nav-toolbar.spec.mjs`
- `tests/pageNavToolbar.test.mjs`
- `debug/playwright.reuse.config.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.
