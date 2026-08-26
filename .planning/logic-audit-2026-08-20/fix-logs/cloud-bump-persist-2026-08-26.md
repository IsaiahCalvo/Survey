# Cloud Bump persist after remount — 2026-08-26

## Leftover taken

Session-only Cloud Bump on the live Bump field. Live toolbar writes Style Cloud as `lineBorderStyle` (already persisted) and Bump as session `cloudIntensity` (1–20). Rect prefs omitted `cloudIntensity`, `handleCloudIntensityChange` did not persist it, and the tool-switch sync restored Style / Width / Color / Opacity / Arrowhead but not Bump. After remount, Style restored Cloud and first-create stamped default bump 2 until Bump was touched again. Distinct from leftover-18, session-shared Style dash (`c082fc76`), filled paper-ink flatten (`4877404f`), and the every-integer Cloud bump catalog (UL-34).

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree).

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live create-path / persist / export / flatten bug after filled paper-ink flatten (`0b3981d1` / product `4877404f`):

| Key | Toolbar | Verdict |
|---|---|---|
| **Cloud Bump persist** | Bump (Rect + Style Cloud) | **LIVE leftover** — Style Cloud restored; Bump dropped to 2 |
| Width / Opacity / Color / Style / Arrowhead sibling pairs | Width / Opacity / Color / Style / Arrowhead | **aligned** — last hunter + paper-ink receipt |
| Line Fill after Rect | Color | **no Fill chrome** on Line / Arrow / Pen |
| text first-create Fill | Color Fill | **intentional empty** — do not invent first-create Fill |
| Font color / Bold / Italic | richTextEditor | stay 0 — do not invent that editor |

Did **not** invent envelope extras. Did **not** take C-01 (no swatch / hex / Transparent). Did **not** stamp `file.id`. Did **not** invent first-create Fill. Did **not** invent a Font picker / richTextEditor. Did **not** invent a polygon tool. Did **not** invent Cloud/Bump UI — Bump is live Rect + Cloud chrome.

## Product

`src/hooks/useDatabase.js`:

- Rect defaults now `cloudIntensity: 2`
- Existing `getToolPreference` per-key merge so a saved row that predates Bump still picks up 2 instead of dropping after remount
- Ellipse stays bump-less (no Cloud chrome)

`src/PDFViewer.jsx` (HIGH-RISK, min-viable):

- Tool-switch / remount sync restores `cloudIntensity` from that tool's prefs
- Bump field persists `cloudIntensity` per tool the same way Style already persists `lineBorderStyle`

`file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** replay paper-ink flatten / Text Fill / Arrowhead / Style dash.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-cloud-bump-persist.spec.mjs` **2 / 2 (9.2s)**.

- Intended: Rect Style Cloud → Bump **8** → Ellipse omits Bump → Rect keeps **8** → remount restores Style **Cloud** + Bump **8** + first rect **without touching Bump** writes `pdfCloudIntensity` **8**; Export annotated PDF writes Square `/BE` `/I` **8**; `?testPdf=` reimport keeps Bump 8; `file.id` null; viewBox `0 0 612 792`
- Break: empty export invents 0; hubPreview Cloud bump **0**
- Edge: 390 viewBox / `file.id` / no invent

Node `pdfCloudBumpPersist` proves Rect default Bump 2, prefs merge per key, tool switch restores + persists Bump, default compose is 2, leaked Bump 8 writes `/BE` `/I` 8.

Focused Node `pdfCloudBumpPersist` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` fail-stops on pre-existing `annotationContextMenuitem` spec (`keyboard.press('Enter')` vs live spec — not taken; not aligned down). Isolated 8448 not reached because official fail-stops first. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Cloud Bump now persists per tool after remount — not a leftover
- Filled paper-ink flatten now fills the blob at live Opacity — not a leftover
- Session-shared Text Fill chrome now resets empty after Callout / Counter — not a leftover
- Session-shared Arrowhead now resets per tool after Callout / Arrow — not a leftover
- Session-shared Style dash now resets per tool after Callout / Rect — not a leftover
- Text first-create now resets Width to 1 after Callout / Highlighter — not a leftover
- Textbox first-create now stamps next-draw Style / Border Opacity / Border / Width — not a leftover
- Textbox first-create empty background is intentional — do not invent a first-create Fill
- Width after remaining pairs (Pen ↔ Highlighter, Line ↔ Arrow, Text ↔ Callout) — confirmed aligned
- Opacity / Color hue / Eraser type sibling pairs — confirmed aligned
- Callout / Rect / Counter Fill after sibling — confirmed aligned (defaults present)
- Counter first-pin now loads badge Fill `#ef4444` / 100 — not a leftover
- Callout first-create already stamps borderColor / lineThickness / borderOpacity / lineStyle / arrowheadStyle — not a leftover
- Rect / ellipse / line / arrow first-draw already stamp dash + Width — not a leftover
- Pen / highlighter first-stroke Width + opacity already aligned — not a leftover
- Partial erase first-swipe Size / Type already aligned — not a leftover
- Font color / Bold / Italic / fontFamily / fontSize / textAlign stay 0 without richTextEditor
- Polygon `/IC` without alpha — live toolbar is Counter/rect/ellipse, no polygon tool
- Projects desktop file rows (Open file)
- Activity File / Edited (need View activity)
- MoveCopy Close / Cancel / Confirm type-null (behind Select apply)
- AccessManagement row Resend/Revoke type-null (empty SE-011)
- Select-gated All / None / Duplicate / Move/Copy / Restore / Delete forever
- Templates move-modal Close; Edit-modules New module type-null
- Documents More menuitem type-null; Templates MoreMenu menuitem type-null
- Subscription Manage / Usage tabs
- Spaces expand / delete (Create space)
- Survey item Notes (needs a placed marker)
- C-01 swatch / hex / Transparent apply; Send viewer invite apply
- Highlighter caret compile-hidden; Counter caret 0
- Pages unnamed cards (tab-as-switcher)
- Idle editor unnamed text+checkbox (Forms / X-05 host-proved)
- Activity Close (A-06); Manage Team role trigger 0; History Version history trigger 0
- Desktop archived Permanently delete; dirty Cancel / Save
- Module-tab rename; ResetPassword success Back to Survey
- Hub Search `⌘K` (display-only; classified 2026-08-22)

Leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45.
Leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24.

Goal stays OPEN. Parent owns PR 800.
