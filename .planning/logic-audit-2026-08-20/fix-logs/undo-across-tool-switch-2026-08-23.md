# Undo after tool-switch (create/transform A → B, undo A) — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

E-05 dedicated the create-A-then-B stack (`Ctrl+Z` drops B). This path is the switch with **no B commit**: create + `br` resize with Rectangle, arm Pen, undo restores create-time size. Distinct from leftover-18 / X-01 / pointercancel / tool-switch draft discard / paste-after-zoom / 103-ID audit. Did **not** invent flatten / stamp / Forms.

## X-01 glance (names only)

| Check | Result |
|---|---|
| Process `VITE_DEV_AUTO_LOGIN_EMAIL` / `PASSWORD` / `SUPABASE_SERVICE_ROLE_KEY` | **absent** |
| `.env.local` those three names | **PRESENT** (gitignored; values not printed) |
| `FILE_ID` / `VITE_DEV_AUTO_LOGIN_FILE_ID` / `LEASE_TOKEN` | **absent** |
| Coordinator lease (`scripts/test-account-lease.mjs assign`) | **none** |
| `.bot-credentials.json` | **none** |

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** cloud-write on the personal-like `.env.local` identity. Did **not** write another X-01 receipt.

## Product

No min-viable product diff. `setActiveToolLogged` does not checkpoint or wipe stacks. Mid-drag tool-switch still commits in-flight create (P1-21); a finished transform does not. History wipes stay document-change / page-mutation only. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. 8448 / 75/250 not loosened.

## Live-proved

Playwright `e2e-undo-across-tool-switch.spec.mjs` **2 / 2 (8.7s)** on Vite `http://127.0.0.1:5173` (`npm run dev:ui`). Focused Node `undoAcrossToolSwitch` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

Desktop rect `46b9e454-…` **120.4 → 135.4**. Switch to Pen invents **0** ink. Ctrl+Z restores **120.4**. Ctrl+Y restores **135.4**. 390 `eb352a3d-…` **206.1 → 275.4**; toolbar Undo restores **206.1**; Ctrl+Y restores **275.4**.

### Intended — **pass**

| Slice | Evidence |
|---|---|
| Create + `br` resize (tool A) | Desktop Δ **+15.0**. 390 Δ **+69.3**. |
| Switch to Pen (tool B) | Same id; resized vw held; pen **0**. Undo stays armed. |
| Undo after switch | Desktop **135.4 → 120.4**. 390 **275.4 → 206.1**. Same id. |
| Redo after switch | Desktop Ctrl+Y **120.4 → 135.4**. 390 Ctrl+Y **206.1 → 275.4**. Pen **0**. |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty stack | Ctrl+Z / Shift+Z / Y + disabled toolbar | invents **0**; imported natives held |
| Redo after tool-switch | Ctrl+Y / Shift+Z with empty redo | invents **0** pen; transform held |
| 390 empty stack | Ctrl+Z | invents **0** |

### Edge

| Slice | Evidence |
|---|---|
| viewBox | `0 0 612 792` throughout |
| `file.id` | `?testPdf=` **null** |
| 390 | toolbar Undo + Ctrl+Y after Pen |
| hubPreview | Draw **0**; annotation layer **0** |

## Official / focused Node

Focused `undoAcrossToolSwitch` + leftover18 **15 / 15**. Cap **8448** not loosened. Official `npm test` not re-run (no product / high-risk edit).

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.
