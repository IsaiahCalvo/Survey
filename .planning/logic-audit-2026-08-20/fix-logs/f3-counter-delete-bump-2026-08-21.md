# F3 / counter-series Delete / cloud bump 1–20 — 2026-08-21

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Did **not** replay Search Previous, Search result-row click, keyboard matrix (except the NEW F3/G chords), every-swatch, callout paste, thin leftovers, PDF links, History, pages menu, flatten, mobile chrome, leftover-18 fail-closed.  
No secrets. Did not invent `.env.local`. Did not stamp `file.id`. Cap **8448** / **75/250** not loosened.  
Did **not** invent compile-hidden print panel / stamp renderer / measurement / Group-Ungroup / Extract Pages / Note-Link create.

## Independent catalog (this pass)

The last catalog leftover after result-row click named three unblocked items. Source first.

| Candidate | Verdict |
|---|---|
| **F3 / Ctrl+G find aliases** | **Pass.** `SearchTextPanel` document listener: F3 and Ctrl/Cmd+G → Next; Shift+F3 and Ctrl/Cmd+Shift+G → Previous. Overlay lists Ctrl+F only. Group `Cmd+G` stays compile-hidden. |
| **Counter-series Delete execute** | **Pass.** Keyboard Delete on a selected pin **renumbers**. Select + right-click is the shape menu (Delete). Overlay Continue pin is UL-31 (not replayed). Series-list context menu Delete + confirm wipes the series. |
| **Cloud bump every integer 1–20** | **Pass.** Local UL-34 `Cloud bump size` field. Not leftover-18 persist / `file.id`. Every integer 1…20 stored. |
| leftover-18 (18 hosts) | Parked. `.env.local` / `.bot-credentials.json` / Docker still missing. |
| Custom Print / stamp / measure / Group / Extract / Note-Link create | Compile-hidden or absent. **Not invented.** |

## 1. F3 / Ctrl+G — **pass**

Playwright `e2e-f3-find-aliases.spec.mjs` **1 / 1 (20.7s)** on `?testPdf=text-search-glyph-lab.pdf`. Node `f3FindAliases.test.mjs` **2 / 2**.

| Check | Result |
|---|---|
| Overlay | Lists Search text. **No** F3 / Ctrl+G rows. Not invented. |
| Bindings | F3 = Next. Shift+F3 = Previous. **Ctrl+G is bound as find Next** (not Group). Ctrl+Shift+G = Previous. |
| Intended walk | Helvetica 12 hits. F3 `1→2→3`. Shift+F3 `3→2→1`. |
| Edge wrap | Shift+F3 first→last (`1→12`). F3 last→first (`12→1`). |
| Break closed | F3 / Shift+F3 with Pages tab (find never opened) does not open Search. Index stays `0 of 0`. |
| Break 0 hits | Empty / `zzzz…` : F3 and Ctrl+G no-op. |
| Break typing | F3 inside a text annotation leaves `hello-alias` (does not insert). Match still walked `1→2`. |
| Hidden Search tab | Panel stays mounted (`display:none`). Sidebar index readout is Pages-tab text (`0 of 0`); walk is not visible there. Listener still live per source. |

No product bug.

## 2. Counter-series Delete — **pass**

Playwright `e2e-counter-series-delete.spec.mjs` **1 / 1 (5.2s)** on `?testPdf=clickable-link-test.pdf`. Node `counterSeriesDeleteExecute.test.mjs` **2 / 2**.

**Product rule:** remaining pins **renumber**. `displayNumber = seriesStart + index` after `createdAt` sort.

| Check | Result |
|---|---|
| Intended 3-pin | Overlay drop (wave8 path) numbers **1,2,3**. |
| Keyboard Delete | Selected pin gone. Undo restores 1,2,3. |
| Context menu | **Select + right-click** is the shape menu: Cut / Copy / Paste / **Delete** / z-order. Delete there removes the pin and remaining renumber. |
| Overlay Continue pin | UL-31 already live. Not replayed. `ctx.kind === 'counter'` is Continue pin only (source). |
| Series-list Delete | Right-click series row → Delete → confirm `Delete count` → 0 pins. Undo restores 1,2,3. |
| Break none selected | Delete no-op. |
| Break Pen armed | Delete on a selected counter still removes it. Undo restores. |
| Edge first / middle / last | Delete first → 2,3 become 1,2. Delete middle → 1,3 become 1,2. Delete last → 1,2 stay. |

No product bug.

## 3. Cloud bump 1–20 — **pass** (local, not leftover-18)

Playwright `e2e-cloud-bump-1-20.spec.mjs` **1 / 1 (5.4s)**. Node `cloudBumpEveryInteger.test.mjs` **2 / 2**.

Toolbar field only appears for Rectangle + Style Cloud. Patch runs when the rect is selected. `file.id` stayed null.

| Check | Result |
|---|---|
| Intended | Every integer **1…20** stores `data.pdfCloudIntensity`. |
| Edge path | Bump 1 vs 20 **did** change the SVG `path` `d` (len 2899 → 289). |
| Break letters | `abc` rejected; intensity stays 5. |
| Break 0 / 99 | Clamp to 1 / 20. |
| Edge empty | Commits 1. Solid hides the field. |

No product bug. **Not** leftover-18 cloud persist.

## Live-proved

Combined Playwright **3 / 3 (32.3s)** on Playwright's own Vite `http://127.0.0.1:5173`. Node contracts **6 / 6**.

- `debug/scenarios/e2e-f3-find-aliases.spec.mjs`
- `debug/scenarios/e2e-counter-series-delete.spec.mjs`
- `debug/scenarios/e2e-cloud-bump-1-20.spec.mjs`
- `tests/f3FindAliases.test.mjs`
- `tests/counterSeriesDeleteExecute.test.mjs`
- `tests/cloudBumpEveryInteger.test.mjs`

## Product

No min-viable product diff. No high-risk files edited.

Invariants unchanged: container-aware canvas sizing, SVG `viewBox` zoom, `zoomGeneration`, single-name `fontFamily`, CORS `*`.

Official `npm test` 8448 leftover not loosened (no high-risk edit).

## Still parked / leftover-18

None of these moved. Legal slices already in `leftover18-unblock-2026-08-21.md`.

| ID | Still-parked host |
|---|---|
| X-01 | identity-churn (`.env.local` missing) |
| X-05 persist | saved `file.id` cloud persist |
| X-06 writeback | live sheet host |
| U-04 cloud | Dashboard + Supabase meter |
| A-01 Turnstile | live captcha completion |
| A-02 MSAL | live MSAL / Graph |
| A-03 / UL-24 inbox | live email delivery |
| A-05 / UL-20 Stripe | live Checkout |
| A-06 / UL-45 roster | second-account lease tuple |
| UL-03 | native Electron pick/cancel |
| UL-13 / UL-15 / UL-16 | persist / captcha / wipe |
| UL-21 / UL-22 | live MSAL / Google OAuth |

Thinner leftovers still open after this pass: custom Print panel (flag off), stamp/image edit, measurement, tablet chrome, Group/Ungroup as user tools.

## Files

- `debug/scenarios/e2e-f3-find-aliases.spec.mjs`
- `debug/scenarios/e2e-counter-series-delete.spec.mjs`
- `debug/scenarios/e2e-cloud-bump-1-20.spec.mjs`
- `tests/f3FindAliases.test.mjs`
- `tests/counterSeriesDeleteExecute.test.mjs`
- `tests/cloudBumpEveryInteger.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- this receipt

Goal stays open.
