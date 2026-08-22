# Live V-02 select / multi-select intended+break+edge — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named next leftover after V-04 zoom keyboard + Fit width. Prior V-02 was window smoke (stroke-click, Shift-click group chrome, marquee overlay). Annotation **Ctrl+A is not wired** (bare `A` arms Arrow). Distinct from hub Documents Select All, Archive Select, survey-rail Delete selected, adversarial marquee→Delete, leftover-18. Did **not** replay those proofs as a substitute.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright spawned Vite `127.0.0.1:5193` (`npm run dev:ui`) with process auto-login names cleared.

## Why this was incomplete

| Prior claim | What was actually asserted |
|---|---|
| V-02 **pass** (window) | Stroke-click selects; Shift-click kept group chrome; marquee left an overlay. No Ctrl+A, no window vs crossing, no Shift-union / Alt-subtract, no Esc / tiny / INPUT, no 390. |
| Undo-redo receipt | Said V-02 was already dedicated and Ctrl+A is not wired. No live intended+break+edge spec. |
| Hub / Archive / rail Select All | Different surfaces (`setSelDocs` / archive rows / survey categories). Not annotation selection. |

## Product

No product bug. Select tool: stroke-click replaces; Shift-click toggles; window marquee (L→R) requires full containment; crossing (R→L) uses overlap; Shift+marquee unions; Alt+marquee subtracts (Alt wins); Esc cancels an in-progress marquee; sub-5px drag is an empty click. Overlay lists `V` Select annotations and `A` Arrow; omits Select all / Ctrl+A. Viewer arms Arrow on bare `A` only (`!meta && !ctrl && !alt && !shift`). `__selectedAnnotationIds` is the DEV selection seam. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. High-risk files not edited.

Harness-only: Playwright `modifiers: ['Shift']` on `mouse.click` did not set `e.shiftKey` on the SVG pointer path — hold `keyboard.down('Shift')` (same as adversarial Shift-click). Arrow-armed window-drag creates an arrow (not a V-02 miss).

## Live-proved

Playwright `e2e-select-all-multi-select.spec.mjs` **2 / 2 (10.0s)** on Vite `http://127.0.0.1:5193`. Focused Node `selectAllMultiSelect` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop: overlay lists Select annotations; omits Select all / Ctrl+A. Stroke-click A. Shift-click adds B (group overlay); toggle B off/on. Empty click clears. Window L→R around A → A. Crossing R→L that only clips B → B. Same region window misses B. Window around both → A+B. Shift-marquee unions B. Alt-marquee subtracts B.

390: stroke-click A; Shift-click adds B; window around A → A.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty page | Ctrl+A | invents 0; imported ids held |
| Ctrl+A | A selected | stays A; B not added |
| Bare `A` | no modifier | selection held; invents 0 (Arrow, not select-all) |
| Tiny drag | 3px | deselect like empty click |
| Esc mid-marquee | Escape then mouseup | A+B held |
| Zoom % INPUT | Ctrl+A while focused | A+B stay; annotations not selected |
| Overlay `?` | catalog | Select all / Ctrl+A **0** |

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Isolation | A held across B toggle / marquees; imported ids survive |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Draw **0**; annotation layer **0** |
| 390 | Shift-click + window + Ctrl+A no-op; same viewBox |

## Official / focused Node

Focused `selectAllMultiSelect` + leftover18 **15 / 15**. Official `npm test` not run (8448 not reached / not loosened). Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

History remaining chrome that still needs a real `file.id` (Save version / named Restore) is leftover-18 **X-01**. Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.
