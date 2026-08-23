# Hub Account menu *actions* role=menuitem — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `2bbc746d` Pages context menuitem receipt after `d5b6d570`.  
**Product SHA:** `46ffa455`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Unique leftover after Pages context menuitem. Official leftover files besides `spacesRailToggle` / overlay-mount / isolated 8448 do **not** still fail vs live source. Hunt axis: other compile-visible menus that may still lack `role="menuitem"` — hub Account menu *actions* (not Settings content). Live `/?hubPreview=1` opened `[role="menu"][aria-label="Account menu"]` while `getByRole('menuitem')` was **0** (named `<button>`s inside the menu). Same a11y class as Home-tab / annotation / Pages context. Distinct from leftover-18 / X-01 / remapped-after-CW / dismiss-family / rail-toggle / overlay-mount / Home `?` / annotation context actions / Pages context actions / Pages apply catalogs / Settings General content.

**Product:** min-viable-diff in `HubShell.jsx` — Settings / Sign out / mobile Archive `type="button"` + `role="menuitem"`. Sign out confirm Cancel / Sign out stay buttons. Isolated 8448 standing. Cap **8448** / 75/250 not loosened.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** replay Pages context actions, dismiss, or rail-toggle E2E. Did **not** invent leftover-18 auth/billing panes.

## Hunt (why this leftover)

Axis this turn: hub Account menu after Pages menuitem (named last hunt).

| Candidate | Verdict |
|---|---|
| X-01 / leftover-18 hosts | **Parked.** `.env.local` names PRESENT; process env absent; no coordinator `scripts/test-account-lease.mjs` token; no real `file.id`. |
| Official leftover besides spaces / overlay / 8448 | **No stale fail** this pass (not replayed; prior align still holds). Isolated 8448 standing. |
| Rail-toggle / dismiss-family / Home tab / Home `?` / annotation context / Pages context actions | **Exhausted / do not replay.** |
| Fit options items | Live buttons Fit page / width / height. `getByRole('menuitem')` **0** by design. Not this leftover. |
| Style / Width items | `role="option"` **4**. Menuitem **0**. Already the listbox contract. |
| Survey / Spaces export items | Spaces export trigger **0** (no space). CSV menuitem **0**. Apply stays leftover-18. |
| Settings General / delete / connect / trial | Already dedicated content. Not this leftover. |
| **Hub Account menu *actions*** | **This pass.** Menu open **1**; before fix `getByRole('menuitem')` **0**. After fix: desktop Settings + Sign out; 390 Archive + Settings + Sign out. |

## Live-proved

Playwright `e2e-hub-account-menuitem.spec.mjs` **2 / 2** + hunt `e2e-after-pages-menuitem-independent-hunt.spec.mjs` **1 / 1**. Pair **3 / 3 (8.1s)** on Playwright Vite `http://localhost:5173`. Focused Node `hubAccountMenuitem` + hunt + leftover18 **15 / 15**.

| Slice | Intended / break / edge |
|---|---|
| Intended desktop | `?hubPreview=1`. Menu `role="menu"` name Account menu. Menuitems Settings / Sign out. Enter on Settings opens dialog on General + Profile information. Sign out confirm copy then Cancel keeps the menu. |
| Break | Extract / Group / Archive menuitem **0** on desktop. Editor `?testPdf=` Draw live; Account menu / Settings menuitem / Rotate menuitem **0**. leftover-18 auth/billing panes **0**. Official leftover files not replayed. Isolated 8448 standing. |
| Edge | 390 Archive + Settings + Sign out menuitems **1**. Fit items stay buttons. Style options **4**. Spaces CSV menuitem **0** (leftover-18). `file.id` null. viewBox **`0 0 612 792`**. |
| Lease | Process auto-login / service-role **absent**. No lease token. `file.id` not invented. |

No high-risk file edit. Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. Official `npm test` not required this pass. Cap **8448** / 75/250 not loosened. Isolated 8448 standing. `graphify` CLI absent.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

After this fix, the nameless-menu class is exhausted except leftover-18 Spaces CSV apply. Unique leftover of that class does **not** remain compile-visible. Goal stays open.

## Files

- `src/home/HubShell.jsx`
- `debug/scenarios/e2e-hub-account-menuitem.spec.mjs`
- `debug/scenarios/e2e-after-pages-menuitem-independent-hunt.spec.mjs`
- `tests/hubAccountMenuitem.test.mjs`
- `tests/afterPagesMenuitemIndependentHunt.test.mjs`
- existing Account-menu Settings locators updated to `menuitem` so dedicated Settings specs still resolve
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.
