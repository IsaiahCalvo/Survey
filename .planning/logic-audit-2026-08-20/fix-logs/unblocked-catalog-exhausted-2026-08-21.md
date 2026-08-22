# Unblocked catalog exhausted — 2026-08-21

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 still blocks `/goal` complete.

Independent source catalog vs `E2E-STATUS.md` + 2026-08-21 fix-logs. This pass live-proved the last unique unblocked cluster found (**mobile Bookmarks**). After that proof, remaining reachable chrome is proven, leftover-18, or compile-hidden.

Did **not** invent `.env.local`. Did **not** run a 768 Playwright pass. Did **not** invent Print / stamp / measure / Group / Extract / Note / Link create.

## Method

Sources inspected this pass (not a copy of catalog-reconcile’s “0 GAP” claim):

- `src/AppShell.jsx` — `isNarrowShell` = `matchMedia('(max-width: 720px)')` only
- `src/mobile/MobilePdfViewerChrome.jsx` + `MobilePdfViewerDock`
- `src/PDFSidebar.jsx` hub tabs
- `src/sidebar/BookmarksPanel.jsx` mobile list vs desktop dnd-kit
- `src/components/AnnotationSizeControl.jsx` width / counter / eraser catalogs
- `src/utils/annotationStyleCatalog.js`
- `src/hooks/useAnnotationContextMenu.jsx` Group/Ungroup omit
- `src/PDFViewer.jsx` `PRINT_PANEL_ENABLED`, `showTextMarkupHighlightMenu`, Note TODO
- `src/components/KeyboardShortcutsOverlay.jsx`
- `E2E-STATUS.md`, `E2E-UNLISTED.md`, `COMPLETION-AUDIT.md`, 2026-08-21 fix-logs

## Classification legend

- **proven** — intended + break + edge cited in a matrix row / UL row / 2026-08-21 fix-log / this pass
- **leftover-18** — remaining intended path needs a parked host
- **compile-hidden** — `false &&` / flag off / commented / omitted; not invented
- **GAP** — reachable on this VM and still thinner than intended+break+edge

**GAP remaining: 0.**

## This-pass unique cluster (now proven)

| Control | Class | Evidence |
|---|---|---|
| Mobile Bookmarks create / up-down / Open / page clamp | **proven** | `e2e-mobile-bookmarks.spec.mjs` **1 / 1 (3.7s)**; Node **2 / 2**. Receipt `mobile-bookmarks-2026-08-21.md`. Not V-07 dnd-kit. Not 390 header/dock. |

## Tablet 768

**Not a distinct layout.** Chrome switch is only `max-width: 720px` (`AppShell.jsx` `isNarrowShell` → `MobilePdfViewerChrome`). At 768, desktop `AppShell` toolbar mounts. No `isTablet`, no `TabletPdfViewerChrome`, no 768 media query. Redundant 768 Playwright was not run.

## Compile-hidden (parked, not invented)

| Control | Flag / site |
|---|---|
| Custom Print panel | `PRINT_PANEL_ENABLED = false` (`PDFViewer.jsx`) |
| Forms category + 4 designer tools | `{false && (` (`AppShell.jsx`) |
| Text-highlight split menu | `showTextMarkupHighlightMenu = false` (KAL-240) |
| Note create | Commented `TODO: Revisit the user-created Note tool` |
| Underline / Strike / Squiggly create | Commented `TODO: Revisit native PDF text markup` |
| Group / Ungroup as user tools | Omitted in `useAnnotationContextMenu.jsx` until matrix-per-shape rewrite |
| Stamp / image create | No `?testPdf=` toolbar tool (import preserve only) |
| Measurement / dimension | Internal Electron-factor calibration only; no user tool |
| Extract Pages | Does not exist |
| Link create/edit | No writer; native links are E2E-LINK-01 |

## Leftover-18 still parked (unchanged)

`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

Legal slices already in `leftover18-unblock-2026-08-21.md`. **0** newly fully proven. No `.env.local` invented.

## Proven (do not replay) — matrix + later 2026-08-21 leftovers

| Cluster | Class | Evidence |
|---|---|---|
| V-01…V-09 viewer | proven | `E2E-STATUS.md` |
| D-01…D-05 draw | proven | incl. Eraser Size every preset `eraser-size-presets-2026-08-21.md` |
| S-01…S-05 shapes | proven | incl. Cloud bump 1–20 + Counter Size/Start |
| T-01…T-07 text | proven | pickers-every-swatch |
| C-01…C-06 color | proven | pickers-every-swatch |
| E-01…E-06 edit | proven | + callout paste / thin leftovers |
| X-02…X-04 export/print/import | proven | flatten waves; hub web import leftover-18 |
| U-01…U-03 survey/spaces/templates | proven | do not replay |
| A-04 / A-07 | proven | History local + named restore; do not replay |
| P-01 / P-02 / P-04 | proven | 390 header/dock + text format; this pass adds Bookmarks sheet |
| P-03 Electron menus | proven (IPC) / leftover-18 native pick | UL-03 |
| UL-01…UL-46 | proven chrome or leftover-18 host | `E2E-UNLISTED.md` |
| Hub documents extras | proven | `catalog-reconcile-2026-08-21.md` |
| Keyboard matrix | proven | `keyboard-shortcut-matrix-2026-08-21.md` |
| Search Previous + result-row + F3/Ctrl+G | proven | do not replay |
| PDF links | proven | do not replay |
| Original 96 audit IDs | proven | `COMPLETION-AUDIT.md` |

## Counts

| Class | Count |
|---|---|
| **GAP** | **0** |
| **proven** (this independent catalog) | all reachable user chrome above |
| **compile-hidden** | 10 named controls / flags |
| **leftover-18** | **18** (still parked) |

## Goal

Leftover-18 still blocks `/goal` complete. This file is a receipt that **unblocked** unique clusters are exhausted — not that the standing save/export/import/recursive-E2E objective is done.
