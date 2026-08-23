# Home `?` overlay singleton on `?testPdf=` — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Product SHA:** `afac0655`  
**Tip before this pass:** `3b1bca25` after-Pages-tab independent hunt.  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Unique leftover after the after-Pages-tab hunt claimed no unique leftover. V-09 is the viewer `?` overlay. Home click leftover is `handleTabClick` → dashboard. This leftover is **two stacked** `KeyboardShortcutsOverlay` instances after Home on `?testPdf=` (AppShell + DevTestRoute each mounted one `?` listener and one `[data-keyboard-shortcuts-modal="true"]`).

**Product:** AppShell skips its Home overlay when `?testPdf=` is in the URL (`isDevTestPdfRoute`). DevTestRoute still remounts the single instance for viewer + Home.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** replay rail-toggle / dismiss-family / last-hunt Export-chords-390-More / V-09 catalog / Home click leftover.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| X-01 / leftover-18 hosts | **Parked.** `.env.local` names PRESENT; process env absent; no coordinator `scripts/test-account-lease.mjs` token; no real `file.id`. |
| Rail-toggle / dismiss-family / last-hunt inventory | **Exhausted / do not replay.** |
| Official exclusive-layer / popover / dismiss contracts | Already `pointerdown` where live. Ran 117 official contracts earlier this turn (not isolated 8448). Font-color still capture `mousedown` (dismiss-family; not taken). Isolated 8448 standing. |
| V-09 viewer overlay | **Already dedicated.** `e2e-shortcuts-overlay` proves viewer `?` / catalog / INPUT no-steal. Official V-09 required both AppShell Home mount **and** DevTestRoute remount — stacking on testPdf Home was not in that proof. |
| Home click leftover | **Already dedicated.** Proves hide/return/keep-mounted. Does not press `?` after Home. |
| **Home `?` singleton on `?testPdf=`** | **This pass.** Distinct from V-09 and from Home click. |

## Live-proved

Playwright `debug/scenarios/e2e-home-shortcuts-overlay-singleton.spec.mjs` **2 / 2 (6.7s)** on Playwright Vite `http://127.0.0.1:5173`. Focused Node `homeShortcutsOverlaySingleton` + `shortcutsOverlay` + leftover18 **17 / 17**.

| Slice | Intended / break / edge |
|---|---|
| Intended viewer | `?testPdf=clickable-link-test.pdf` 1400×900. Viewer `?` count **1**. Esc → **0**. |
| Intended Home | Home hides Draw. `?` count **1** (not 2). One heading + one Close. `file.id` null. |
| Break dismiss | Esc / click-outside / Close each return count **0**. |
| Edge toggle / return | Second `?` toggles closed. PDF tab (`[data-pdf-tab-id]`) return keeps count **1**. |
| Edge hubPreview | `/?hubPreview=1` `?` count **0**. |
| Edge 390 | Viewer `?` **1**. Back to documents → Home `?` ≤ **1**. `file.id` null. |

Log: `HOME_SHORTCUTS_OVERLAY_SINGLETON_DESKTOP {"viewerOne":1,"homeOne":1,"fileId":null}`.

Product edit: `src/AppShell.jsx` only (not a high-risk file). Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. Official `npm test` not re-run (no high-risk touch). Cap **8448** / 75/250 not loosened. Isolated `partialEraserComplexity` 8448 standing. `graphify` CLI absent.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

## Files

- `src/AppShell.jsx`
- `tests/shortcutsOverlay.test.mjs`
- `tests/homeShortcutsOverlaySingleton.test.mjs`
- `debug/scenarios/e2e-home-shortcuts-overlay-singleton.spec.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.
