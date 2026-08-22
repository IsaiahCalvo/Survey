# Counter Fill + Number every-swatch — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named next leftover after Callout dash + arrowhead. Distinct from pickers-every-swatch (single selected pin, no isolation / next-draw / 390), Size/Start, series Delete, nubbin, Continue pin, and Continue Count. Not leftover-18.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle.

## Why this was incomplete

| Prior claim | What was actually asserted |
|---|---|
| Pickers every-swatch C-counter | Desktop CompactColorPicker 16 on **one selected pin**. No sibling series-wide, no New Count isolation, no armed next-draw, no 390, no undo/Pen/Select. |
| C-05 smoke | Fill `#FF0000` then Number `#0000FF` / `#FFFFFF` without clobbering fill. Not every-value. |
| Size / Start / Delete / nubbin / Continue pin / Continue Count | Other chrome. Color pickers never intended+break+edge. |

FEATURE-MATRIX C-05 / S-05 leftover: Counter Fill vs Number on the same picker, series-wide.

## Live-proved

Playwright `e2e-counter-colors.spec.mjs` **pending live**. Focused Node `counterColors` **pending**.

`viewBox="0 0 612 792"`. `file.id` null.

### Intended — pending live

Desktop CompactColorPicker Fill + Number (no Border / Match Fill). Every catalog swatch including transparent. Series-wide sibling. New Count isolation. Armed next-draw Fill `#80FF00` / Number `#FF8000`. 390 Fill + Stroke chips every 9.

### Break — pending live

Select / empty page invents 0. Pen-armed Color `#00FF00` must not clobber Counter fill/number. hubPreview Preset colors **0**.

### Edge — pending live

Undo drops next-draw pin. Zoom `viewBox="0 0 612 792"`. `file.id` null.

## Product

No product change planned unless live proof finds a blocker. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched.

## Official / focused Node

Pending. Cap **8448** not loosened. Did **not** invent a lease.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Reachable unblocked next: remaining Counter chrome if still incomplete after this slice (Size continuum already catalog-proved). Leftover **18** stay parked. Goal stays open.
