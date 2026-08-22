# Live UL-30 z-order / arrange intended+break+edge — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named next leftover after Poly / Cloud Style every discrete dash. Distinct from UL-30 front/back smoke (`e2e-context-menu-spaces.spec.mjs`) and keyboard-shortcut-matrix Ctrl+]/[ / Shift+] / Shift+[ hotkeys. Not leftover-18. Not a color/opacity/width/dash/font catalog.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright used Vite `127.0.0.1:5173` (`npm run dev:ui`) with process auto-login names absent.

## Why this was incomplete

| Prior claim | What was actually asserted |
|---|---|
| UL-30 **pass** (live) | Bring to front → last SVG sibling; Send to back → first. **Bring forward / Send backward unused.** |
| Keyboard shortcut matrix | Ctrl+] / Ctrl+[ / Shift+] / Shift+[ hotkeys. Context-menu items unused. |
| Overlap-aware skip | Two overlapping rects only. Non-overlapping neighbor between them unproven. |
| Callout omit | Comment / design note. Menu labels not hard-asserted. |

FEATURE-MATRIX leftover: E-06 context menu still listed Cut/Copy/Paste/z-order as cluster-pass. Four arrange items + Figma-style skip were smoke-only.

## Product

No product bug. `handleReorderAnnotation` already resolves overlap for `forward`/`backward` and absolute `front`/`back`, then `stampZOrderAfterMove`. Callout menu still omits the four items (own SVG layer + id-sort). CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. High-risk files not edited.

Harness only: 390 empty-page menu title is `Page`; stroke-edge click (transparent fill); skip covered `mobile-header-select-button`.

## Live-proved

Playwright `e2e-z-order-arrange.spec.mjs` **2 / 2 (11.7s)** on Vite `http://127.0.0.1:5173` (`npm run dev:ui`). Focused Node `zOrderArrange` + leftover18 + `annotationZOrder` **30 / 30**.

`viewBox="0 0 612 792"`. `file.id` null. Stack A (overlap) / C (far) / B (overlap A).

### Intended — **pass**

Desktop context menu on owned rect lists **Bring to front / Bring forward / Send backward / Send to back**. Bring forward on A skips non-overlapping C and lands past overlapping B (`[C, B, A]`, `data.zOrder` stamped). Send backward lands A behind B (`[C, A, B]`). Bring to front → last sibling / last user. Send to back → first sibling / first user.

| Action | user order |
|---|---|
| seed | `[A, C, B]` |
| Bring forward A | `[C, B, A]` (skipped C) |
| Send backward A | `[C, A, B]` |
| Bring to front A | `[C, B, A]` |
| Send to back A | `[A, C, B]` |

390: same four-item catalog + absolute front/back + already-front no-op (overlap skip stays desktop).

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty page | right-click | Paste only; all four arrange items **0** |
| Already-back A | Send backward | no-op |
| Already-front A | Bring forward | no-op |
| Non-overlapping C | Bring forward | no-op (no overlapping neighbor above) |
| Callout | right-click | Cut/Copy/Paste/Delete; arrange **0** |
| Pen-armed | empty-page | Paste only; rect stack held |

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Isolation | far C stays first after A/B front; callout create does not rewrite stack |
| Undo | three rect ids held |
| Select empty | invents 0 |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Bring forward **0** / context menu **0** / Draw **0** |
| 390 | Paste-only empty (title filtered); catalog; front/back; already-front no-op; callout omit |

## Official / focused Node

Focused `zOrderArrange` + leftover18 + `annotationZOrder` **30 / 30**. Official `npm test` not run (8448 not reached / not loosened). Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Duplicate / copy-paste annotations already have UL-27–29 + callout paste. Lock/hide/flatten annotation chrome not opened this pass. Leftover **18** stay parked. Goal stays open.
