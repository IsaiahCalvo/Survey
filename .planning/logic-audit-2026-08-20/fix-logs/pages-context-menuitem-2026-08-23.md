# Pages thumbnail context *actions* role=menuitem — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `8d95e104` annotation context menuitem a11y.  
**Product SHA:** `d5b6d570`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Unique leftover after annotation context menuitem. Official leftover files besides `spacesRailToggle` / overlay-mount / isolated 8448 do **not** still fail vs live source. Hunt axis: other compile-visible menus that may still lack `role="menuitem"` — Pages thumbnail context *actions* (not dismiss). Live right-click on a Pages thumb opened `[data-pages-context-menu]` while `getByRole('menuitem')` was **0** (named `<button>`s inside a nameless `div`). Same a11y class as Home-tab / annotation context. Distinct from leftover-18 / X-01 / remapped-after-CW / dismiss-family / rail-toggle / overlay-mount / Home `?` / annotation context actions / Pages apply catalogs (rotate / insert / delete / move).

**Product:** min-viable-diff in `PagesPanel.jsx` — panel `role="menu"` + `aria-label={Page N actions}`; items `role="menuitem"` + `type="button"`. Native buttons already supply name + Enter/Space. Isolated 8448 standing. Cap **8448** / 75/250 not loosened.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** replay annotation context actions, Pages dismiss, or rail-toggle E2E.

## Hunt (why this leftover)

Axis this turn: other context menus after annotation menuitem.

| Candidate | Verdict |
|---|---|
| X-01 / leftover-18 hosts | **Parked.** `.env.local` names PRESENT; process env absent; no coordinator `scripts/test-account-lease.mjs` token; no real `file.id`. |
| Official leftover besides spaces / overlay / 8448 | **No stale fail** this pass (not replayed; prior align still holds). Isolated 8448 standing. |
| Rail-toggle / dismiss-family / Home tab / Home `?` / annotation context actions | **Exhausted / do not replay.** |
| Fit options items | Live buttons Fit page / width / height. `getByRole('menuitem')` **0** by design (`items stay buttons so apply-mode specs hold`). Not this leftover. |
| Style / Width items | `role="option"` **4**. Menuitem **0**. Already the listbox contract. |
| Survey / Spaces export items | Spaces export trigger **0** (no space). CSV menuitem **0**. Apply stays leftover-18. |
| 390 More besides Export/Zoom | Export + Zoom ± only. Save log **0**. |
| Hub More | Already dedicated (Preview & details / Rename / Copy / Paste / Delete / Share / Lock). |
| **Pages thumbnail context *actions*** | **This pass.** Menu open **1**; before fix `getByRole('menuitem')` **0**. After fix: 13 named menuitems. Extract **0**. |
| Hub Account menu | `role="menu"` **1**; Settings is a **button** (`menuitem` **0**). Compile-visible on `?hubPreview=1`. **Remaining candidate** — not leftover-18 apply. Not claimed GAP = 0. |

## Live-proved

Playwright `e2e-pages-context-menuitem.spec.mjs` **2 / 2** + hunt `e2e-after-annotation-menuitem-independent-hunt.spec.mjs` **1 / 1**. Pair **3 / 3 (10.2s)** on Playwright Vite `http://localhost:5173`. Focused Node `pagesContextMenuitem` + hunt + leftover18 **15 / 15**.

| Slice | Intended / break / edge |
|---|---|
| Intended desktop | `?testPdf=clickable-link-test.pdf`. Menu `role="menu"` name Page 1 actions. Menuitems Move up / Move down / Cut / Copy / Paste / Duplicate / Insert blank page / Rotate / Rotate counter-clockwise / Mirror horizontally / Mirror vertically / Reset / Delete. Enter on Duplicate **3 → 4** page divs. Copy then Paste enabled. viewBox **`0 0 612 792`**. |
| Break | Extract / Group **0**. Empty clipboard Paste disabled. Move up disabled on page 1. hubPreview Draw / Pages menu / Rotate menuitem **0**. Official leftover files not replayed. Isolated 8448 standing. |
| Edge | 390 More = Export + Zoom ±; Rotate menuitem **0** until Page 1 actions; Save log **0**. Fit items stay buttons. Style options **4**. `file.id` null. |
| Lease | Process auto-login / service-role **absent**. No lease token. `file.id` not invented. |

No high-risk file edit. Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. Official `npm test` not required this pass. Cap **8448** / 75/250 not loosened. Isolated 8448 standing. `graphify` CLI absent.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

Hub Account menu Settings still lacks `role="menuitem"` (button inside `role="menu"`). Unique leftover remains. Goal stays open.

## Files

- `src/sidebar/PagesPanel.jsx`
- `debug/scenarios/e2e-pages-context-menuitem.spec.mjs`
- `debug/scenarios/e2e-after-annotation-menuitem-independent-hunt.spec.mjs`
- `tests/pagesContextMenuitem.test.mjs`
- `tests/afterAnnotationMenuitemIndependentHunt.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.
