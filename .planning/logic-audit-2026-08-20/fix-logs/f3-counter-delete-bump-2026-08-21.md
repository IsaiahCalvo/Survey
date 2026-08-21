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
| **F3 / Ctrl+G find aliases** | **This pass.** `SearchTextPanel` document listener: F3 and Ctrl/Cmd+G → Next; Shift+F3 and Ctrl/Cmd+Shift+G → Previous. Overlay lists Ctrl+F only. Group `Cmd+G` stays compile-hidden. |
| **Counter-series Delete execute** | **This pass.** Keyboard Delete on a selected pin. Pin context menu is Continue pin only (no Delete invented). Series-list context menu Delete wipes the whole series via confirm. `renumberCounters` fills gaps by `createdAt`. |
| **Cloud bump every integer 1–20** | **This pass.** Local UL-34 `Cloud bump size` field. Not leftover-18 persist / `file.id`. Numeric clamp 1–20. |
| leftover-18 (18 hosts) | Parked. `.env.local` / `.bot-credentials.json` / Docker still missing. |
| Custom Print / stamp / measure / Group / Extract / Note-Link create | Compile-hidden or absent. **Not invented.** |

## 1. F3 / Ctrl+G

| Check | Result |
|---|---|
| Overlay | Lists Search text. **No** F3 / Ctrl+G rows. Not invented. |
| Bindings | F3 = Next. Shift+F3 = Previous. Ctrl+G = Next. Ctrl+Shift+G = Previous. Same `navigateToMatch` wrap as the find buttons. |
| Break closed | F3 / Shift+F3 with Pages tab (find never opened) does not open Search or invent hits. |
| Break 0 hits | Empty / `zzzz…` : F3 and Ctrl+G no-op. |
| Break typing | F3 inside a text annotation does not insert `F3`. Listener still owns the chord. |
| Edge wrap | Shift+F3 first→last; F3 last→first. |
| Hidden tab | Search panel stays mounted (`display:none`). F3 can still walk a live query after switching to Pages. |

## 2. Counter-series Delete

| Check | Result |
|---|---|
| Product rule | Remaining pins **renumber**. `displayNumber = seriesStart + index` after `createdAt` sort. |
| Intended keyboard | Selected pin gone. Sibling series stays. |
| Pin context menu | **Continue pin only.** No pin-level Delete. Not invented. |
| Series context menu | Delete → confirm `Delete count` → all pins in that series gone. Undo restores 1,2,3. |
| Break none selected | Delete no-op. |
| Break Pen armed | Delete on a selected counter still removes it (tool does not own Delete). Undo restores. |
| Edge first / middle / last | 3-pin series: delete first → 2,3 become 1,2; middle → 1,3 become 1,2; last → 1,2 stay. Undo after each. |

## 3. Cloud bump 1–20

Local toolbar control. **Not leftover-18.** No `file.id` required.

| Check | Result |
|---|---|
| Intended | Style → Cloud reveals `Cloud bump size`. Every integer **1…20** stores `data.pdfCloudIntensity`. |
| Edge path | Bump 1 vs 20 changes the SVG cloud `path` `d`. |
| Break letters | `abc` rejected; value stays. |
| Break 0 / 99 | Clamp to 1 / 20. |
| Edge empty | Commits 1. Solid hides the field. |

## Live-proved

Playwright (pending this commit's run):

- `debug/scenarios/e2e-f3-find-aliases.spec.mjs`
- `debug/scenarios/e2e-counter-series-delete.spec.mjs`
- `debug/scenarios/e2e-cloud-bump-1-20.spec.mjs`

Node contracts:

- `tests/f3FindAliases.test.mjs`
- `tests/counterSeriesDeleteExecute.test.mjs`
- `tests/cloudBumpEveryInteger.test.mjs`

## Product

No min-viable product diff. No high-risk files edited.

Invariants unchanged: container-aware canvas sizing, SVG `viewBox` zoom, `zoomGeneration`, single-name `fontFamily`, CORS `*`.

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
- this receipt

Goal stays open.
