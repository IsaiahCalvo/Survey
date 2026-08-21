# Search Previous remainder — 2026-08-21

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Did **not** replay waves 5–13 / flatten / survey-marker / pages menu / History restore / PDF-link ftp / thin leftovers / callout last-writer / hub extras / every-swatch pickers / leftover-18 fail-closed save/export / mobile 390×844 chrome / keyboard-shortcut matrix.  
No secrets. Did not invent `.env.local`. Did not stamp `file.id`. Cap **8448** / **75/250** not loosened.

## Candidate pick

Keyboard-matrix receipt named **Search Previous** as the thinner leftover after wave6 Next wrap. Wave6 `e2e-adversarial-wave6.spec.mjs` hard-asserts Next wrap / no-match / Esc-clear only — it never clicks `Previous match (Shift+Enter)`.

| Check | Result |
|---|---|
| Wave6 Next wrap | Quoted, not replayed as the only coverage. `next.click()` until last, then wrap to `1 of N`. No Previous click. |
| Keyboard matrix Ctrl+F | Opens the field. Does not walk matches. |
| Case toggle | **Compile-hidden.** Search always `toLowerCase()` + `indexOf`. No Match case / Aa control. Not invented. |
| Fixture | `?testPdf=text-search-glyph-lab.pdf` (3 pages). `Helvetica` = **12** hits. |

## Live-proved

Playwright `debug/scenarios/e2e-search-previous.spec.mjs` **1 / 1 (1.1m)** on reused Vite `http://localhost:5173`. Node `tests/searchPrevious.test.mjs` **2 / 2**.

| Slice | Intended / break / edge |
|---|---|
| Intended walk | `Helvetica` starts `1 of 12` with 12 highlight rects. Next `1→2→3`. Previous `3→2→1`. Count stays 12. |
| Intended wrap | Previous from first → `12 of 12`. Next from last → `1 of 12`. Active highlight id changes (`…-1` → `…-12`). |
| Intended dismiss | X (clear) and Esc empty the query, hide Previous/Next, and drop `data-search-highlight-count` to 0. |
| Break 0 hits | `zzzz-no-such-glyph`: “No results found”; Previous count 0; Shift+Enter no-ops. |
| Break 1 hit | `in` is `1 of 1`. Previous stays `1 of 1`. |
| Break empty | Clearing the field hides Previous and clears highlights. |
| Break literal | `.*(` is `indexOf`, not RegExp. No results / no crash. |
| Break armed tool | Draw → Pen `btn-active`; query stays `Helvetica`; Previous still wraps to 12. |
| Break focus | Shift+Enter while the field is focused wraps. Previous button still wraps after a page click (input not focused). |
| Edge case | No case-toggle. `HELVETICA` / `helvetica` / `Helvetica` all **12**. |
| Edge hyphen / diacritic | `-` = 6 hits, Previous wraps to 6. `é` = 5 hits, Previous wraps to 5. |
| Edge reset | Change `Helvetica` → `glyph` resets to `1 of 4`. |
| Edge jump | Next page (or scroll) then Previous from first still wraps to `12 of 12`. |
| Identity | `window.__devTestPdf.id` stays `null`. No error boundary. |

## Product

No min-viable product diff. No high-risk files edited.

Harness notes (not product bugs):

- Changing the query must wait for the prior match set to clear. A `total >= 1` poll otherwise reads a stale Helvetica `12`.
- Letter `P` while the find field is focused types into the query. Arm Pen from the Draw toolbar.

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

- `debug/scenarios/e2e-search-previous.spec.mjs`
- `tests/searchPrevious.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- this receipt

Goal stays open.
