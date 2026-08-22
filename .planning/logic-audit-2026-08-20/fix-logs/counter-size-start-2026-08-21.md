# Counter Size catalog + Start number — 2026-08-21

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Did **not** replay F3/Ctrl+G find aliases, counter-series Delete + renumber, Rectangle Style Cloud Bump 1–20, Search Previous, Search result-row click, keyboard matrix, every-swatch, callout paste, thin leftovers, PDF links, History restore, pages menu, flatten, mobile chrome, leftover-18 fail-closed, hub extras, waves 5–13.  
No secrets. Did not invent `.env.local`. Did not stamp `file.id`. Cap **8448** / **75/250** not loosened.  
Did **not** invent compile-hidden Print panel / stamp renderer / measurement / Group-Ungroup / Extract Pages / Note-Link create.

## Independent catalog (this pass)

Source + E2E-STATUS + 2026-08-21 fix-logs. Pickers-every-swatch listed Width as “already D-05” and never opened Counter **Size**. UL-35 start # was “wired + live start #” only.

| Candidate | Verdict |
|---|---|
| **Counter Size catalog** | **This pass.** `ANNOTATION_SIZE_PRESETS.counter = [5,8,12,16,24,32,48,64]`. Clamp **4–76** (`COUNTER_SIZE_MIN/MAX`). Not D-05 Width (`[1,2,3,4,6,8,10,12,16,20,32,50]`, 1–50) and not leftover-18 persist. |
| **Counter Start number** | **This pass.** Editable only while the series has **1** pin. Letters strip; 0 / empty → 1; second pin locks the field and continues `start + index`. |
| leftover-18 (18 hosts) | Parked. `.env.local` / `.bot-credentials.json` / Docker still missing. |
| Custom Print / stamp / measure / Group / Extract / Note-Link create | Compile-hidden or absent. **Not invented.** |
| Tablet 768×1024 | No tablet-specific chrome (keyboard-matrix already classified). |
| Eraser Size every preset | Thinner leftover after this pass (D-05 mixed Width + 1–100 clamp; eraser catalog `[1,4,8,…,100]` not every-value live). |
| F3 / series Delete / cloud bump 1–20 | Already proven this wave. Not replayed. |

## 1. Counter Size — **pass**

Playwright `e2e-counter-size-start.spec.mjs` **1 / 1 (7.5s)** on reused Vite `http://localhost:5173` + `?testPdf=clickable-link-test.pdf`. Node `counterSizeStartNumber.test.mjs` **2 / 2**.

Live radius is the SVG path `A r,r` from `renderCounter` (`__phase35GetAnnotationById` matches `obj.id` only; counters stamp `data.id`).

| Check | Result |
|---|---|
| Intended arm | Counter reveals **Size**, not Width. |
| Intended drop | Armed Size **5** drops pin radius 5 (`e64df481-…`). |
| Intended presets | Every **5 / 8 / 12 / 16 / 24 / 32 / 48 / 64** stored. SVG r 5 → 64. |
| Break letters | `abc` rejected; radius stays 16. |
| Break 3 / 0 | Clamp to **4**. |
| Break 77 / 999 | Clamp to **76**. |
| Edge empty | Commits **4**. |
| Edge Pen | Size / Start hide (not a Width field). |

No product bug.

## 2. Counter Start number — **pass**

| Check | Result |
|---|---|
| Intended | Start **10** renumbers the lone pin label to 10. |
| Break letters | `abc` strips; commit **1**. |
| Break 0 / empty | Commit **1**. |
| Edge second pin | After Start **7**, next pin is **8** (same series). |
| Break lock | Start **disabled** after the second pin. |

No product bug. `file.id` stayed null. Not leftover-18 persist.

## Live-proved

Playwright **1 / 1 (7.5s)** on reused Vite `http://localhost:5173`. Node contracts **2 / 2**.

- `debug/scenarios/e2e-counter-size-start.spec.mjs`
- `tests/counterSizeStartNumber.test.mjs`

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

Thinner leftovers still open after this pass: Eraser Size every preset, custom Print panel (flag off), stamp/image edit, measurement, tablet chrome, Group/Ungroup as user tools.

## Files

- `debug/scenarios/e2e-counter-size-start.spec.mjs`
- `tests/counterSizeStartNumber.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- this receipt

Goal stays open.
