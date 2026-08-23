# Keep-mounted hub inert under the viewer — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `051fb77d` hub nav type=button after `83177e9b`.  
**Product SHA:** `2dca006d`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

First candidate after hub nav type=button was keep-mounted unnamed editor text + checkbox on `?testPdf=`. Live probe showed those are PDF AcroForm widgets on `clickable-link-test.pdf` (`input[name="name"]` / `input[name="agree"]`) sitting on the page — not leftover hub chrome. Forms editor / X-05 persist stay leftover-18. Do not invent form labels.

Unique leftover: Tab from Draw leaked into keep-mounted Documents / Projects / Templates / Archive / Open account menu because AppShell leaves Dashboard mounted under the viewer overlay with no `inert`. Distinct from leftover-18 / X-01 / nameless-menu / rail-toggle / dismiss / Home `?` / Home tab click / remapped-after-CW / Sync chip / hub Account menuitem / hub nav type=button. Hub `Search documents...` stays named via placeholder.

**Product:** min-viable-diff in `AppShell.jsx` — wrap keep-mounted `<Dashboard>` with `data-hub-keep-mount` and `inert` + `aria-hidden` while `isViewerVisible`. Home / Back lift both. Isolated 8448 standing. Cap **8448** / 75/250 not loosened.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** replay hub nav type / nameless-menu / rail-toggle / dismiss / Home `?`. Did **not** take leftover-18 A-06 Presence “1 active user”.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| X-01 / leftover-18 hosts | **Parked.** `.env.local` names PRESENT; process env absent; no coordinator `scripts/test-account-lease.mjs` token; no real `file.id`. |
| Unnamed editor text + checkbox | **PDF AcroForm** `name` / `agree` on the page (`inHub: false`). Forms / X-05 persist stay leftover-18. Not leftover hub chrome. |
| Hub `Search documents...` | Named via placeholder. Already dedicated. |
| Hub nav type=button / nameless-menu / rail-toggle / dismiss / Home `?` / remapped-after-CW / Sync chip | **Exhausted / do not replay.** |
| 390 Presence “1 active user” | leftover-18 A-06 — not unique. |
| **Keep-mounted hub in Tab order** | **This pass.** Tab from Draw landed on Documents / Projects / Templates / Archive / Open account menu. Wrapper had no `inert`. |

## Live-proved

Playwright `e2e-hub-keep-mount-inert.spec.mjs` **2 / 2** + hunt `e2e-after-hub-keep-mount-independent-hunt.spec.mjs` **1 / 1** (**3 / 3**, 7.7s) on Playwright Vite `http://127.0.0.1:5317`. Focused Node `hubKeepMountInert` + hunt + leftover18 **15 / 15**.

| Slice | Intended / break / edge |
|---|---|
| Intended desktop | `?testPdf=`. Keep-mount `inert` + `aria-hidden="true"`. Tab from Draw does **not** land in hub. PDF `name` / `agree` stay page widgets. Home lifts inert; Documents Search + Projects/Documents nav work. PDF tab re-inerts. viewBox **`0 0 612 792`**. |
| Break | Hidden tools **0**. Sync **0**. Start trial / Connect Microsoft / Turnstile **0**. `file.id` null. Nameless-menu not replayed. Isolated 8448 standing. |
| Edge | `?hubPreview=1` is **not** AppShell keep-mount; Search + Templates live. empty=1 still No documents yet. 390 `?testPdf=` keep-mount inert; Tap to sync **0**. |
| Lease | Process auto-login / service-role **absent**. No lease token. `file.id` not invented. |

No high-risk file edit. Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. Official `npm test` not required this pass. Cap **8448** / 75/250 not loosened. Isolated 8448 standing. `graphify` CLI absent.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

After this fix, PDF AcroForm `name` / `agree` stay unnamed page widgets (Forms / X-05 parked). Hunt after inert found no other unique compile-visible leftover. Goal stays open.

## Files

- `src/AppShell.jsx`
- `debug/scenarios/e2e-hub-keep-mount-inert.spec.mjs`
- `debug/scenarios/e2e-after-hub-keep-mount-independent-hunt.spec.mjs`
- `tests/hubKeepMountInert.test.mjs`
- `tests/afterHubKeepMountIndependentHunt.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.
