# Lock / hide / flatten annotation chrome absent — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named next leftover after UL-30 z-order / arrange. Not leftover-18. Not UL-27–29 / UL-30 arrange / region Hide/Show / Documents Lock persist / X-03 print flatten. Did **not** invent flatten-to-PDF export.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright used Vite `localhost:5173` (`npm run dev:ui` already up) with process auto-login names absent.

## Why this was incomplete

Last arrange receipt named Lock / hide / flatten annotation chrome as unopened. Fit-height hunt had already classified “no local user control; import lock flags only.” This pass opened the live chrome and hard-asserted absence.

## Classification

| Surface | Class | Why |
|---|---|---|
| Context menu Lock / Hide / Flatten | **Absent** | `useAnnotationContextMenu` items are Cut/Copy/Paste/Delete + arrange + Continue pin. Group/Ungroup stay compile-hidden. |
| Toolbar / overlay / 390 | **Absent** | No Lock / Unlock / Hide / Show / Flatten buttons or `?` rows. |
| Import `lockMovement*` | **Flags-only** | Importer + `isSelectDeleteOnlyPdfTextMarkupObject`. No user toggle. |
| Flatten-to-PDF | **Not invented** | Print flatten is X-03 (`savePDFWithFlattenedRegularAnnotationsForPrint`). Custom panel compile-hidden. Did not press Ctrl+P / Ctrl+Shift+P. |

## Live-proved

Playwright `e2e-lock-hide-flatten-chrome.spec.mjs` **2 / 2 (8.8s)** on Vite `http://localhost:5173`. Focused Node `lockHideFlattenChrome` + leftover18 **16 / 16**.

`viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop owned rect menu is Cut / Copy / Paste / Delete / four arrange items. Lock / Hide / Flatten **0**. Toolbar buttons **0**. `?` overlay lists Select / Pen / … / Counter; no Lock / Hide / Flatten.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty page | right-click | Paste only; Lock/Hide/Flatten **0** |
| Callout | right-click | Cut/Copy/Paste/Delete; Lock/Hide/Flatten **0** |
| Pen-armed | toolbar + empty-page | Paste only; invents 0 |
| Select empty | right-click | invents 0 |

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Isolation | Callout create does not invent lock chrome |
| Undo | Ctrl+Z keeps the rect id |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Lock / Hide / Flatten **0**; Draw **0** |
| 390 | Same absence + owned catalog without Lock/Hide/Flatten |

No product bug. No high-risk file. Cap **8448** / **75/250** not loosened. Official `npm test` not run. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). No further unblocked annotation Lock/Hide/Flatten chrome on `?testPdf=`. Leftover **18** stay parked. Goal stays open.
