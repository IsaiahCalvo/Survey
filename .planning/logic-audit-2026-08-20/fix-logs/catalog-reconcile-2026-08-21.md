# Catalog reconcile — 2026-08-21

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Base:** `main`  
**Vite:** reused `http://localhost:5173` (`npm run dev:ui`, HTTP 200). Not killed.  
**Goal:** stays open. Did **not** mark `/goal` complete.

Did **not** replay waves 5–13, flatten, survey-marker, pages insert/rotate/move, History restore, PDF-link ftp, thin leftovers (cross-page paste / Duplicate / imported sticky), or the callout clipboard last-writer fix.

Did **not** invent captcha / Stripe / MSAL / Capacitor / plus-aliases / prod SQL / `file.id` on `?testPdf=` / Extract Pages / Note or Link create.

Leftover **18** stay parked. Cap **8448 MiB** / **75/250** not loosened.

## Method

Independent catalog from source + live routes, not from the prior “no unique unblocked cluster remains” claim.

| Source | What it contributed |
|---|---|
| `src/AppShell.jsx` | Desktop chrome: Export, Undo/Redo, Pan/Select + mode menu, Draw/Shapes/Text/Forms, fill/stroke/font pickers, B/I/U/S, 3×3 align, Style, Cloud bump, Width/Size, Eraser mode, Counter series, Edit text, zoom % / Fit / page # |
| `src/PDFViewer.jsx` draw/shape/review dropdowns | Armed tools: Pen, Highlighter, Eraser, Rect, Ellipse, Line, Arrow, Counter, Text, Callout. `showTextMarkupHighlightMenu = false`. Note / Underline / Strike / Squiggly commented out |
| `src/viewerShared.js` | `NATIVE_TEXT_MARKUP_TOOLS`, `REVIEW_TOOL_IDS`, `REGION_EDIT_TOOL` |
| `src/mobile/MobilePdfViewerChrome.jsx` | Same tool groups (no Forms / no text-highlight). Font/size/color/style/arrowhead sheets |
| `src/components/KeyboardShortcutsOverlay.jsx` | Nav / Actions / Tools / Interface list |
| `src/hooks/useAnnotationContextMenu.jsx` | Cut / Copy / Paste / Delete / z-order / Continue pin / empty-page Paste |
| `src/sidebar/PagesPanel.jsx` | Thumb jump + context: Cut/Copy/Paste/Duplicate/Insert blank/Rotate/Rotate CCW/Mirror H+V/Reset/Delete |
| `src/sidebar/BookmarksPanel.jsx` | Add / rename / page / folder / group / delete / reorder |
| `src/sidebar/SearchTextPanel.jsx` | Query / clear / Previous / Next |
| `src/sidebar/SpacesPanel.jsx` | Create / rename / delete / on-off / add pages / overlay / region rename |
| `src/PDFSidebar.jsx` | Pages / Search / Bookmarks / Spaces / History / close |
| `src/home/DocumentsLedger.jsx` + `HubPreview.jsx` | Search / More / Select / sort / preview / Open / Upload / Share / Lock |
| `src/home/ProjectsFolderTree.jsx` | Rename / delete / create / Manage team / file Copy-Paste / Move/Copy |
| `src/home/TemplatesEditor.jsx` | Create / rename / delete / archive-with-markers |
| `src/components/AccountSettings.jsx` / `ShareModal.jsx` / `AuthModal.jsx` | Account + share chrome |
| `src/utils/annotationStyleCatalog.js` | 16 swatches / 6 fonts / 18 sizes |
| Prior receipts | `E2E-STATUS.md`, `E2E-UNLISTED.md`, `FEATURE-MATRIX.md`, `COMPLETION-AUDIT.md`, `fix-logs/e2e-catalog-completeness.md` |

Live routes used: `/?testPdf=clickable-link-test.pdf`, `/?hubPreview=1&tab=documents`.

## Verdict this pass

The prior “remaining unblocked-unproven **0**” claim was **unproven** until this reconcile. Source hunt found a unique unblocked cluster that catalog-completeness never executed:

**Hub documents extras** (More Copy/Paste, Select Duplicate, Select Move/Copy, column Sort, Preview & details / Close preview). Search / rename / delete were already live (`e2e-catalog-completeness.spec.mjs`). These extras were not.

Live-proven this pass: `debug/scenarios/e2e-hub-docs-extras.spec.mjs` **1 / 1 (1.7s)**. No product bug. Lock menu is enabled for SE-011 (`user_id` matches preview user) but `HubPreview` does not pass `onLockDocument` — click is a no-op (persist stays leftover-18 / Dashboard). Share Send not clicked.

**Unique unblocked GAP remaining after this pass: 0.**

## Newly proven GAP (intended + break + edge)

| Control | Intended | Break | Edge | Result |
|---|---|---|---|---|
| Column sort File / Size | Size click changed row order | File click restored a named row | Not a picker | **pass** |
| More → Paste | Copy `test.pdf` then Paste minted `test-copy.pdf`; original stayed | Paste disabled on empty clipboard | Paste onto a different row (`Package 2`) | **pass** |
| More → Preview & details | Opens preview aside | Close preview removes the close control | Row click also opens preview | **pass** |
| Select → Duplicate | `Package 2 — Rev 4 — IC-copy.pdf` appeared; original stayed | Duplicate/Move/Copy disabled with no selection | Duplicate leaves Select mode (Done) | **pass** |
| Select → Move/Copy | Copy mode → MEP Phase 2 → Copy here; desktop ledger has **2** RFI rows | Confirm disabled until dest; Cancel closes | Move tab not required (Copy path is the extra) | **pass** |
| More → Lock document | Item enabled for SE-011 | Click no-ops (no `onLockDocument` on HubPreview) | Still says Lock (not Unlock) | **pass** (chrome). Persist leftover-18 |

`file.id` stayed null. No invented Note/Link/Extract Pages.

## Classification legend

- **live-proven** — intended + break + edge cited in a fix-log / matrix row / this spec
- **compile-hidden** — `false &&` / commented / flag off; do not invent
- **leftover-18** — remaining intended path needs host that is parked
- **GAP** — reachable on this VM and unproven (none remain after this pass)

---

## Full classification table

### Viewer / toolbar / overflow

| Control | Class | Evidence |
|---|---|---|
| Pan | live-proven | V-01 `E2E-STATUS.md` overflow + narrow |
| Select annotations | live-proven | V-02 click / Shift / marquee |
| Select text ⇧V + caret menu | live-proven | V-03 + P-04 |
| Draw / Shapes / Text category buttons | live-proven | P-04 arm + dropdowns |
| More / overflow (narrow) | live-proven | V-01 narrow More → Zoom in; P-01 sheets |
| Export annotated PDF | live-proven | X-02 |
| Undo / Redo | live-proven | E-05 |
| Zoom in / out / % field | live-proven | V-04 + UL-06 |
| Fit page / width / height / manual | live-proven | V-04 + UL-05 Fit options live click |
| Page # / prev / next | live-proven | V-05 + UL-07 |
| Close document / collapse rail | live-proven | UL-11 |
| Survey rail toggle | live-proven | U-01 |
| Tab Home / close PDF tab | live-proven | hub + `?testPdf=` shell; UL-01/UL-11 family |

### Draw tools

| Control | Class | Evidence |
|---|---|---|
| Pen / 1-dot tap | live-proven | D-01; hub leftovers tap |
| Highlighter freehand | live-proven | D-02 + print exclusion |
| Eraser partial / entire + mode select | live-proven | D-03 / D-04 + UL eraser select |
| Stroke / eraser width presets + clamp | live-proven | D-05 all 12 + 1–100 |
| Text-highlight split menu | compile-hidden | KAL-240 `showTextMarkupHighlightMenu = false` |
| Underline / Squiggly / Strike tools | compile-hidden | Review dropdown commented (`TODO: Revisit native PDF text markup`) |
| Measure / dimension / stamp / image | compile-hidden | No toolbar button (`e2e-wave-remaining.md`, `pdf-links-2026-08-21.md`) |

### Shapes

| Control | Class | Evidence |
|---|---|---|
| Rectangle + Cloud | live-proven | S-01 + UL-33 / UL-34 |
| Ellipse | live-proven | S-02 |
| Line | live-proven | S-03 |
| Arrow + 6 heads (armed + selected) | live-proven | S-04 |
| Counter pin + series New/Continue/start # | live-proven | S-05 + UL-35 |
| Style Solid / Dashed / Dotted / Cloud | live-proven | UL-33 completeness Dashed `6,4` / Dotted `2,4` |
| Polygon / polyline create | compile-hidden | Import-only types; no create tool |

### Text / callout / fonts / format

| Control | Class | Evidence |
|---|---|---|
| Textbox create/edit | live-proven | T-01 |
| Callout create/edit + leader | live-proven | T-02; do not replay clipboard fix |
| Font family all 6 (single name) | live-proven | T-03 `FONT_FAMILIES` |
| Font size all 18 + mobile clamp | live-proven | T-04 |
| Bold / italic / underline / strike | live-proven | T-05 |
| Align 3×3 | live-proven | T-06 |
| Font color (opaque, no transparent) | live-proven | T-07 + E2E-W2-01 |
| Edit text (Aa) | live-proven | UL-36 |
| Note create | compile-hidden | `TODO: Revisit the user-created Note tool` |
| Link create/edit | compile-hidden | No writer; native links are X-04 / E2E-LINK-01 |
| Imported sticky chrome | live-proven | thin leftovers fixture `e2e-sticky-note.pdf` |

### Color pickers

| Control | Class | Evidence |
|---|---|---|
| 16-swatch grid | live-proven | C-01 + adversarial 15-solid spam |
| Hex field + invalid | live-proven | C-02 / P1-39 |
| Opacity % + slider | live-proven | C-03 |
| Spectrum HSV + leave/re-enter | live-proven | C-04 |
| Fill vs stroke vs font vs counter number | live-proven | C-05 |
| Match Fill | live-proven | C-06 / P1-38 |

### Transform / clipboard / context

| Control | Class | Evidence |
|---|---|---|
| Resize 8 handles | live-proven | E-01 |
| Rotate handle + Shift 45° + numeric | live-proven | E-02 |
| Move + page clamp | live-proven | E-03 |
| Delete / Backspace | live-proven | E-04 |
| Context Cut/Copy/Paste | live-proven | UL-27–29; do not replay callout last-writer |
| Cross-page paste (shape + callout) | live-proven | thin leftovers + `e2e-callout-paste.spec.mjs` |
| Bring to front / forward / back / backward | live-proven | UL-30 |
| Continue pin | live-proven | UL-31 |
| Chrome right-click suppressed | live-proven | UL-27–31 |
| Group / Ungroup | compile-hidden | Omitted until matrix-per-shape rewrite (`E2E-UNLISTED.md`) |
| Callout z-order | compile-hidden | Own SVG layer; omitted by design |

### Pages / History / Search / Bookmarks / Spaces

| Control | Class | Evidence |
|---|---|---|
| Pages thumbs jump / long-doc | live-proven | V-06 |
| Pages Duplicate execute | live-proven | UL-32 thin leftovers — do not replay |
| Pages Insert / Rotate / Move | live-proven | Do not replay this pass (`e2e-pages-move-up-down` + wave receipts) |
| Pages Cut/Copy/Paste/Mirror H+V/Reset/Delete/Rotate CCW | live-proven | UL-32 item + pages insert/rotate/move wave |
| Bookmarks add / reorder / clash / delete+undo | live-proven | V-07 + P1-45 |
| Search query / Next wrap / special chars | live-proven | V-08 |
| Search Previous / clear | live-proven | V-08 wrap pair + UL-09 |
| History jump + delete-restore + named restore | live-proven | A-07 — do not replay |
| Spaces Create / rename / pages / delete last | live-proven | U-02 + completeness + adversarial |
| Spaces overlay toggle | live-proven | Completeness U-02 extras clicked overlay |
| Spaces on/off | live-proven | U-02 family / P1-51 empty-space gate |
| Extract Pages | compile-hidden | Do not invent |

### Keyboard

| Control | Class | Evidence |
|---|---|---|
| Overlay `?` + Close/Esc | live-proven | V-09 + UL-01 |
| Tool keys V ⇧V P H E T Q L A C | live-proven | P-04 |
| B sidebar | live-proven | UL-02 / P2-34(b) |
| ← → Home End | live-proven | V-05 / P2-34(a) |
| Ctrl+0 Fit page | live-proven | UL-04 |
| Ctrl++/− zoom | live-proven | V-04 |
| Ctrl/⌘F search | live-proven | V-08 |
| Ctrl/⌘O Open | leftover-18 | UL-03 native pick/cancel |
| Cmd+Z / Shift+Z / Y | live-proven | E-05 |
| Cmd+C/X/V | live-proven | UL-27–29 + P1-34 |
| Cmd+P / Cmd+Shift+P | live-proven | X-03 / D-02 flatten |
| Cmd+Shift+D | live-proven | P1-20 DEV-only |

### Save / export / import / forms / Excel / print

| Control | Class | Evidence |
|---|---|---|
| Cloud save / identity-churn | leftover-18 | X-01 |
| Outbox Retry | live-proven | UL-44 |
| Export PDF | live-proven | X-02 + wave9 flatten |
| Import `?testPdf=` / kal412 | live-proven | X-04 — do not replay |
| Hub web file-control import | leftover-18 | A-01 / X-05 (`e2e-import-roundtrip.md`) |
| Form widgets fill | live-proven | X-05 widgets |
| Form cloud persist | leftover-18 | X-05 persist |
| Forms category + 4 designer tools | compile-hidden | `{false && (` AppShell; UL-37 |
| Excel xlsx export | live-proven | X-06 export |
| Excel host writeback | leftover-18 | X-06 writeback |
| Custom Print panel | compile-hidden | `PRINT_PANEL_ENABLED=false`; UL-39–43 proven once with DEV flip |
| Native print dialog | leftover-18 | X-03 leftover |

### Survey

| Control | Class | Evidence |
|---|---|---|
| Rail / modules / stamp | live-proven | U-01 — do not replay survey-marker |
| Templates editor | live-proven | U-03 + E2E-HUB-01 |
| Checklist archive-with-markers (hubPreview) | live-proven | U-04 `e2e-u04-archive.spec.mjs` |
| Checklist cloud usage | leftover-18 | U-04 cloud |
| Region-edit tool | live-proven | U-02 region path (Spaces add-pages / overlay) |
| Survey note / photo / video dialog | leftover-18 | Needs saved survey + media host; no `file.id` on `?testPdf=` |

### Hub (`?hubPreview=1`)

| Control | Class | Evidence |
|---|---|---|
| Documents search / rename / delete | live-proven | catalog-completeness |
| Documents **Copy / Paste / Select Duplicate / Move/Copy / Sort / Preview** | **live-proven (this pass)** | `e2e-hub-docs-extras.spec.mjs` **1 / 1** |
| Documents Open file | live-proven | signed-in `OPEN_DOC`; hubPreview assigns `?testPdf=` |
| Documents Upload (preview) | compile-hidden / leftover | no-op unless `workflowE2E=1`; native picker leftover UL-03 |
| Documents Lock persist | leftover-18 | Chrome no-op on HubPreview; Dashboard `lockDocument` needs real id |
| Documents Share Send | leftover-18 | A-03 / UL-24 inbox |
| Projects rename / delete / create | live-proven | catalog-completeness |
| Projects Manage team chrome | live-proven | completeness opened dialog; P2-06/07 |
| Archive empty + Select disabled | live-proven | completeness |
| Archive restore / delete forever | leftover-18 | needs `user.id` + Supabase |
| Templates create/rename/delete | live-proven | U-03 |
| Settings / Sign in guest | live-proven | A-01 / A-04 chrome |

### Auth / account / billing / collab

| Control | Class | Evidence |
|---|---|---|
| Sign in guest + AuthModal | live-proven | A-01 chrome |
| Turnstile password login | leftover-18 | A-01 / UL-15 |
| Microsoft Connect chrome | live-proven | A-02 fail-closed |
| Live MSAL | leftover-18 | A-02 / UL-21 |
| Google OAuth | leftover-18 | UL-22 |
| Invite mint + roles | live-proven | A-03 mint |
| Invite email inbox | leftover-18 | A-03 / UL-24 |
| Account settings tabs / profile empty | live-proven | A-04 / UL-12–14 |
| Profile persist | leftover-18 | UL-13 |
| Password mismatch | live-proven | UL-15 chrome |
| Delete DELETE confirm | live-proven | UL-16 chrome |
| Account wipe | leftover-18 | UL-16 |
| Sign out preview | live-proven | UL-17 chrome |
| Usage tab | live-proven | UL-18 chrome |
| Billing cards / Start trial visible | live-proven | A-05 catalog |
| Stripe Checkout click | leftover-18 | A-05 / UL-20 |
| Presence self / two-tab | live-proven | A-06 just you |
| Two-client roster | leftover-18 | A-06 / UL-45 |
| Share permission Viewer/Editor/Owner | live-proven | UL-23 |
| Monthly/Annual toggle | live-proven | UL-19 Node |

### Mobile / Electron / native PDF links

| Control | Class | Evidence |
|---|---|---|
| Mobile sheets + touchcancel | live-proven | P-01 / E2E-CHROME-04 |
| Mobile text formatting + styled selects | live-proven | P-02 / UL-46 |
| Electron File menu | live-proven | P-03 IPC |
| Native File→Open pick/cancel | leftover-18 | UL-03 |
| Native PDF http/https/mailto + GoTo | live-proven | E2E-LINK-01 — do not replay |
| ftp / javascript / data / file links | live-proven | E2E-LINK-01 blocked |

### Discrete catalogs (every value)

| Catalog | Class | Evidence |
|---|---|---|
| 16 color swatches | live-proven | C-01 + `COLOR_PICKER_PRESETS` |
| 6 fonts | live-proven | T-03 |
| 18 font sizes | live-proven | T-04 |
| 4 format toggles | live-proven | T-05 |
| 9 align cells | live-proven | T-06 |
| 6 arrowheads | live-proven | S-04 |
| 12 width presets | live-proven | D-05 |

---

## Leftover-18 still parked (unchanged)

`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

Compile-hidden Note / Link create: not invented.

## Remaining unique unblocked GAP

**0** after this reconcile. The one unique unblocked cluster found (hub documents extras) is now live-proven. Everything else is live-proven (cited), compile-hidden, leftover-18, or a do-not-replay already-proven cluster.

## Files

- `debug/scenarios/e2e-hub-docs-extras.spec.mjs` — live proof
- `E2E-STATUS.md` — this-pass blurb
- this receipt

No product diff. No high-risk files touched.
