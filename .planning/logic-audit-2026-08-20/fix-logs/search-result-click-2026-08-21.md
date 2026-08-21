# Search result-row click — 2026-08-21

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Did **not** replay waves 5–13 / flatten / survey-marker / pages menu / History restore / PDF-link ftp / thin leftovers / callout last-writer / hub extras / every-swatch pickers / leftover-18 fail-closed save/export / mobile 390×844 chrome / pageInputRef / keyboard-shortcut matrix / Search Previous (Next/Prev wrap, X/Esc, literal, hyphen, diacritic).  
No secrets. Did not invent `.env.local`. Did not stamp `file.id`. Cap **8448** / **75/250** not loosened.

## Independent catalog (this pass)

Grep of live chrome (`AppShell` aria-labels, `BookmarksPanel` / `SpacesPanel` / `SearchTextPanel` / `PagesPanel`, `KeyboardShortcutsOverlay`, hub docs extras) vs `E2E-STATUS.md` + 2026-08-21 receipts.

| Candidate | Verdict |
|---|---|
| Search Previous / Next wrap / X / Esc / literal / hyphen / diacritic | Already proven this date. **Not replayed.** |
| **Search result-row click** (`[data-result-index]`) | **This pass.** Visible list; no spec grepped `handleResultClick` / `SearchResultRow` / `data-result-index` click. |
| F3 / Ctrl+G next-prev | Same `navigateToMatch` as Previous/Next. Overlay does not list them. Thinner leftover after this list-click, not first. |
| Cloud bump 1–20 every integer | UL-34 field + clamp live; discrete 1…20 not every-swatch. Numeric field, not a new toolbar. |
| Counter series Delete (context menu) | UL-35 live New Count / start #. Delete wired (`onDeleteCounterSeries`). Thinner, not first. |
| Edit text Aa enabled | UL-36 disabled-path live; pickers / wave specs click Aa. Not unique. |
| Fit height | UL-05 Fit options live click. |
| Tablet 768×1024 | No `isTablet` chrome (keyboard-matrix). 390 mobile proven. |
| Custom Print panel | Compile-gated `PRINT_PANEL_ENABLED=false`. |
| Stamp / image / measurement / Note / Link create / Extract Pages | Compile-hidden or absent. **Not invented.** |
| Group / Ungroup | Compile-hidden (`Cmd+G` early-return). |
| Bookmarks folder / group / page 99 | V-07 + P1-44/45 + wave4 / stomp-nine live. |
| leftover-18 (18 hosts) | Parked. `.env.local` / `.bot-credentials.json` / Docker still missing. |

## Candidate pick

Search Previous proved the find-bar buttons. The result **list** is a separate user-facing control: each row calls `handleResultClick` → `navigateToMatch(index)` → `onNavigateToMatch(result, index)`.

| Check | Result |
|---|---|
| Wave6 / Search Previous | Next/Prev wrap, X, Esc. Never clicks `[data-result-index]`. |
| Fixture | `?testPdf=text-search-glyph-lab.pdf`. `Helvetica` = **12** rows across 3 pages. |

## Live-proved

Playwright `debug/scenarios/e2e-search-result-click.spec.mjs` **1 / 1 (33.4s)** on reused Vite `http://localhost:5173`. Node `searchResultClick.test.mjs` **2 / 2**.

| Slice | Intended / break / edge |
|---|---|
| Intended list | `Helvetica` starts `1 of 12` with **12** rows and 12 highlight rects. |
| Intended mid click | Row index 6 → `7 of 12`. Active highlight `…-1` → `…-7`. |
| Intended last / first | Last row → `12 of 12` + **Page 3**. First row → `1 of 12` + Page 1. |
| Break same-row | Click already-active row 0 stays `1 of 12` / same active id. |
| Break 0 / empty / literal | `zzzz…` / empty / `.*(` : no rows. No error boundary. |
| Break 1-hit | `in` is one row; click stays `1 of 1`. |
| Break armed | Draw → Pen `btn-active`; click last row still `12 of 12`. |
| Edge Next after click | Mid click then Next walks to `8 of 12`. |
| Edge later page | First `Page ≥2` row is index 6 / **Page 2**; that page div is visible. |
| Identity | `window.__devTestPdf.id` stays `null`. |

## Product

No min-viable product diff. No high-risk files edited.

Viewer `isNavigatingToMatchRef` busy window (~320–760ms on the zoom-to-1.5 path) is still the in-flight guard. This spec waits ~850ms after a fresh query before the first list click so the intended jump is not that guard. Index still updates via `handleCurrentMatchIndexChange` even if a same-flight nav is ignored.

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

Thinner leftovers still open after this pass: F3 / Ctrl+G (unlisted find keys), cloud bump every integer 1–20, counter-series Delete execute, custom Print panel (flag off), stamp/image edit, measurement, tablet chrome, Group/Ungroup as user tools.

## Files

- `debug/scenarios/e2e-search-result-click.spec.mjs`
- `tests/searchResultClick.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- this receipt

Goal stays open.
