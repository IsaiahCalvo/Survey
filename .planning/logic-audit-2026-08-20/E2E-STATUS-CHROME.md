# E2E status — chrome cluster (non-canvas)

**Date:** 2026-08-20  
**Worktree:** `nifty-elion-773074`  
**Owner:** chrome / non-canvas worker  
Did not edit `PDFViewer.jsx`, `PageAnnotationLayer.jsx`, `FabricEraserCanvas.jsx`, `SVGAnnotationLayer.jsx`.

Main table rows also patched in `E2E-STATUS.md`. This file is the chrome-cluster receipt.

## Rows covered

| ID | Feature | Status | Node checks | Still needs a window |
|---|---|---|---|---|
| S-05 | Counter | **pass** (numbering) | seriesStart + createdAt; fill/numberColor; last-in-series; empty/legacy | live pin stamp |
| U-01 | Survey rail | **pass** (contracts) | category `dismissSurveySheet`; no `setPdfDoc` | empty-template live stamp |
| U-02 | Spaces / regions | **pass** (entitlement) | Advanced Survey + editor/owner; viewer blocked | overlay / last-space stamp |
| U-03 | Templates | **pass** (contracts) | `sanitizeTemplateConfig`; overwrite modal | live editor |
| V-06 | Pages panel | **pass** (live thumbs) | jump page 3; 1-page next disabled; IO upgrade 91×118→306×396; long-doc scroll thumbs 75–78 + page 120 | — |
| V-07 | Bookmarks | **pass** (live drag) | empty copy; create Alpha/Bravo/Charlie; dnd-kit Alpha→bottom; clash toast; page 99 clamps to 1; self-drop no-op | — |
| A-03 | Invites + roles | **pass** | 6 statuses; expired stops fall-through; last-owner | live email delivery |
| A-04 | Account settings | **pass** | linkIdentity; DELETE; Google-only set-password | live OAuth popup |
| A-05 | Billing | **pass** (contracts) | return URL; trial; CORS `*`; replay noop | live Stripe Checkout |
| A-02 | Microsoft / OneDrive | **pass** (contracts) | file:// redirect; system browser; no-token IPC | live MSAL |
| X-06 | Excel | **pass** (identity) | fingerprints; bad row/seq → null; import vs export | live workbook |
| P-01 | Mobile sheets | **pass** (finger-follow) | 390×844 proxy (no Capacitor webview). Handle tracks 10/20/30/40px then spring-back; 90px dismisses. **touchcancel** leaves `translateY` stranded — E2E-CHROME-04 | native Capacitor still untested |
| P-03 | Electron menus | **pass** (File menu) | File shows Open / Export / Print / Print+annot, all enabled. Print click logged `targetWindow alive: true` | native print/save dialogs not fully driven |
| A-06 | Collab banners | **pass** | revoke > expiry; same-user re-sign-in | live roster |
| X-01 | Outbox retry | **pass** | 30s stuck; missing queuedAt; quarantine | live identity-churn |

## New tests this wave

- `tests/chromeE2EContracts.test.mjs` — **31** intended + break + edge cases across the rows above

Reused (not rewritten): account settings / billing persist, invite KAL-31, bookmark reorder, counter series, thumbnail store, MSAL contracts, excel identity, mobile sheet motion, collab banners, outbox retry.

## Window pass 2026-08-20 (Playwright + Electron)

Vite was free; started `npm run dev:ui` at `http://localhost:5173/`. Playwright Chrome against the no-auth route. No Capacitor webview / booted iOS sim / adb device — used 390×844 as the mobile proxy. Launched unpackaged `NODE_ENV=development npx electron .` against that Vite; quit after File-menu checks. Did not edit `PDFViewer.jsx`.

| Check | Viewport / URL | Result |
|---|---|---|
| V-06 live thumbs | 1440×900 `?testPdf=spike-120-pages.pdf` then `?testPdf=clickable-link-test.pdf` | **pass** |
| V-07 live drag | 1440×900 `?testPdf=clickable-link-test.pdf` | **pass** |
| P-01 finger-follow | 390×844 same 1-page fixture (narrow-shell sheet) | **pass** motion; **fail** touchcancel (E2E-CHROME-04) |
| P-03 File Open/Export/Print | unpackaged Electron → Vite hub (`http://localhost:5173/`) | **pass** display + Print IPC |

No chrome-side min-diff in BookmarksPanel / PagesPanel / Electron menus — those paths behaved. The touchcancel gap is in the sheet hosts (`PDFSidebar.jsx`, `MobilePdfViewerChrome.jsx`, `SurveySpacesRail.jsx`), outside that allowlist.

## Fixes landed (min-diff)

1. Bookmark **create** now uses the same name-clash / page-range gate as rename (`prepareBookmarkCreate`).
2. Last-owner demote/remove extracted to `lastOwnerGuard.js` and wired in Access Management.
3. Invite accept copy + fall-through extracted so expired/revoked stop at that kind.
4. Pages-panel click ignores out-of-range pages; mobile select does not navigate.
5. Electron **single-instance** lock + focus-existing-window (`quitPolicy.cjs`). Packaged in `package.json` `build.files`.
6. Stripe webhook trial/payment portal `return_url` no longer `https://www.google.com` — uses `https://surveytool.app/`.

## New issues

See `E2E-NEW-ISSUES-CHROME.md`.
