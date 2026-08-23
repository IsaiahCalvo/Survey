# Hub primary nav type=button — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `725f28d7` hide fixture Sync chrome until cloudSync explicitly enabled.  
**Product SHA:** `83177e9b`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Unique leftover after Sync-chip hide. Last hunt collected `/?hubPreview=1` `.survey-hub .nav` / `.mobile-home-tabs` types as **null** while `MobileRailNav` already had `type="button"`. Implicit submit default is the same hygiene class as Spaces-rail / Expand Survey / Bookmarks Add — this leftover is hub primary nav (Documents / Projects / Templates / Archive), not those families. Distinct from leftover-18 / X-01 / nameless-menu / rail-toggle / dismiss / Home `?` / remapped-after-CW / Sync chip / hub Account menuitem. Keep-mounted unnamed Search/select is **not** this leftover.

**Product:** min-viable-diff in `HubShell.jsx` — `navBtn` now `type="button"`. Isolated 8448 standing. Cap **8448** / 75/250 not loosened.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** replay Sync chip / nameless-menu / rail-toggle / dismiss / Home `?`.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| X-01 / leftover-18 hosts | **Parked.** `.env.local` names PRESENT; process env absent; no coordinator `scripts/test-account-lease.mjs` token; no real `file.id`. |
| Official leftover besides overlay / spacesRail / popover / hub-account / 8448 | **No stale fail vs live source.** Isolated 8448 standing. |
| Rail-toggle / dismiss / Home `?` / nameless-menu / remapped-after-CW / Sync chip | **Exhausted / do not replay.** |
| Keep-mounted unnamed Search/select | Hub `Search documents...` is named via placeholder. Editor keep-mounted unnamed **text + checkbox** remain (next hunt, not this leftover). |
| 390 Presence “1 active user” | leftover-18 A-06 — not unique. |
| **Hub nav missing `type="button"`** | **This pass.** Desktop aside Documents / Projects / Templates / Archive + 390 Home sections share `navBtn` with no type. |

## Live-proved

Playwright `e2e-hub-nav-type-button.spec.mjs` **2 / 2** + hunt `e2e-after-hub-nav-type-independent-hunt.spec.mjs` **1 / 1** (**3 / 3**, 7.3s) on Playwright Vite `http://127.0.0.1:5173`. Focused Node `hubNavTypeButton` + hunt + leftover18 **15 / 15**.

| Slice | Intended / break / edge |
|---|---|
| Intended desktop | `?hubPreview=1`. Aside nav types all **button**. Click Projects → Tower 5 — Security; Templates → Security Walk-Through; Archive → desktop Search archive; Documents → SE-011. Enter on Projects; double-click Documents stays. |
| Break | hubPreview Draw **0**; Start trial / Connect Microsoft / Turnstile **0**. Hidden tools **0**. Nameless-menu not replayed. Isolated 8448 standing. |
| Edge | 390 `?mobileNav=tabs` Home sections Documents / Projects / Templates type=button; Archive **0**; Templates card visible. Default 390 Open navigation already type=button. empty=1 nav still typed + No documents yet. `?testPdf=` Draw live; viewBox **`0 0 612 792`**; Sync **0**; keep-mounted aside nav typed, not absent. `file.id` null. |
| Lease | Process auto-login / service-role **absent**. No lease token. `file.id` not invented. |

No high-risk file edit. Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. Official `npm test` not required this pass. Cap **8448** / 75/250 not loosened. Isolated 8448 standing. `graphify` CLI absent.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

After this fix, keep-mounted unnamed editor **text + checkbox** remain compile-visible on `?testPdf=` (not leftover-18). Hub Search is named. Goal stays open.

## Files

- `src/home/HubShell.jsx`
- `debug/scenarios/e2e-hub-nav-type-button.spec.mjs`
- `debug/scenarios/e2e-after-hub-nav-type-independent-hunt.spec.mjs`
- `tests/hubNavTypeButton.test.mjs`
- `tests/afterHubNavTypeIndependentHunt.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.
