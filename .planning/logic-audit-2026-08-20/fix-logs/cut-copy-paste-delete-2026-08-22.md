# Live UL-27–29 + E-04 Cut / Copy / Paste / Delete intended+break+edge — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named next leftover after Lock / hide / flatten chrome absence. Distinct from UL-27–29 same-page smoke (`e2e-context-menu-spaces.spec.mjs`), callout last-writer (`e2e-callout-paste.spec.mjs`), thin-leftovers cross-page paste, keyboard Delete, survey-marker Delete, UL-32 page ops, and UL-30 arrange. Not leftover-18. Not a style catalog.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright reused Vite `localhost:5173` (`npm run dev:ui` already up) with process auto-login names absent.

## Why this was incomplete

| Prior claim | What was actually asserted |
|---|---|
| UL-27 Cut **pass** (live) | Owned rect removed; empty-page Paste restored a clone. **One-shot clipboard clear unproven.** |
| UL-28 Copy **pass** (live) | Original stayed; one Paste added a new id. **Second paste / repeatable copy unproven.** |
| UL-29 Paste **pass** (live) | Empty page Paste-only; gray while empty. **Gray click no-op unproven.** |
| E-04 Delete | Keyboard Delete + survey-marker overlay. **Context-menu Delete unused.** |
| Callout vs counter | Comment / arrange omit. Clip catalog vs Continue-pin-only unproven. |

## Product

No product bug. Menu Cut stashes `mode: 'cut'` then splices; first paste restores a new id and clears the clipboard. Copy stays `mode: 'copy'` (repeatable). Delete splices without `setClipboardAnnotation`. Counter menu is Continue pin only. Callout lists Cut/Copy/Paste/Delete (last-writer paste not replayed). CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. High-risk files not edited.

Harness only: retry stroke points after a pasted-clone miss; Cut/Delete click created originals.

## Live-proved

Playwright `e2e-cut-copy-paste-delete.spec.mjs` **2 / 2 (12.9s)** on Vite `http://localhost:5173`. Focused Node `cutCopyPasteDelete` + leftover18 **16 / 16**.

`viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop owned rect lists **Cut / Copy / Paste / Delete**. Copy keeps A; first Paste new id; second Paste unique id (repeatable). Cut removes A; first Paste restores a clone; second Paste stays gray (one-shot). Context-menu Delete removes C and does **not** populate clipboard (Paste stays gray). Isolation: Copy clones survive Cut/Delete.

390: same four-item catalog; Delete A leaves C; Copy C + Paste new id; callout catalog.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty page | right-click | Paste only; Cut/Copy/Delete **0** |
| Empty clipboard | click gray Paste | invents 0 |
| One-shot Cut | second Paste | gray; invents 0 |
| Delete | after cut-cleared clipboard | Paste stays gray |
| Counter | right-click | Continue pin only; clip items **0** |
| Callout | right-click | Cut/Copy/Paste/Delete (no last-writer paste) |
| Pen-armed | empty-page | Paste only; rects held |

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Isolation | C / Copy clones held across Cut + Delete |
| Undo | context-menu Delete of C restored |
| Select empty | invents 0 |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | annotation context menu **0** / Draw **0** |
| 390 | Paste-only empty; catalog; Delete; Copy/Paste; callout catalog |

## Official / focused Node

Focused `cutCopyPasteDelete` + leftover18 **16 / 16**. Official `npm test` not run (8448 not reached / not loosened). Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.
