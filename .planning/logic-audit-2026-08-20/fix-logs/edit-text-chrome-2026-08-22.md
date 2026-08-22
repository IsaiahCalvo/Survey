# Live UL-36 Edit text (Aa) — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named leftover after the V-09 overlay INPUT-guard proof (`a4bbd871`). Prior UL-36 was “wired + live disabled” smoke only. Not leftover-18. Not a V-09 / style / V-0x replay. Did **not** replay the 96 proved IDs. Did **not** invent flatten / stamp / Forms.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright spawned Vite `127.0.0.1:5247` (`npm run dev:ui`) with process auto-login names cleared.

## Product

No product change. Desktop Aa (`aria-label="Edit text"`) calls `handleEnterTextEditFromStrip` on a selected textbox or callout — same path as double-click. Armed Text/Callout with no selection shows Aa disabled. Pen / selected rect hide Aa. 390 `aria-label="Text formatting"` enters edit when selected; otherwise opens Text settings. A direct click on a textbox re-enters the overlay (Aa pressed+disabled); window marquee keeps selection so Aa can enter. V leaves the Text draw overlay (`data-text-overlay`).

CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. No `file.id` stamp.

## Live-proved

Playwright `e2e-edit-text-chrome.spec.mjs` **2 / 2 (10.9s)** on Vite `http://127.0.0.1:5247`. Focused Node `editTextChrome` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop: marquee-selected textbox Aa opens `[data-text-edit-overlay]`; type `aa-1` → `aa-1+`. Selected Callout Aa opens the same overlay (`aa-q`). `aria-pressed` true while editing.

390: selected textbox **Text formatting** enters overlay; `m-aa` → `m-aa+`.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Text armed, no selection | Aa | visible + **disabled**; force-click overlay **0** |
| Callout armed, no selection | Aa | visible + **disabled** |
| Pen armed | Aa | **0** |
| Selected rect | Aa | **0** |
| Second Aa while editing | click | stays in edit; invents **0** extra marks |
| Select / empty click | V + page | invents **0** extra marks |
| 390 Text armed, no selection | Text formatting | overlay **0**; opens Text settings; Close annotation settings dismisses |
| 390 Pen armed | Text formatting | **0** |

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Isolation | Second textbox `aa-2x` does not rewrite first `aa-1+` |
| Undo | Undo drops the last text commit; first stays |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Edit text **0**; Text formatting **0**; Draw **0** |
| 390 | same enter + defaults + Pen hide; `file.id` null |

## Official / focused Node

Focused `editTextChrome` + leftover18 **15 / 15**. Official `npm test` not run (8448 not reached / not loosened). Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.
