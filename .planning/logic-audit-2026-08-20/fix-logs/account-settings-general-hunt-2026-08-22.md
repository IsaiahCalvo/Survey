# Hunt after Account Settings General — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Does **not** re-claim unblocked GAP = 0.

Last slice live-proved Account Settings **General** pane contents. This pass independently hunted remaining reachable chrome vs E2E-STATUS / FEATURE-MATRIX / E2E-UNLISTED + live hubPreview + `?testPdf=`.

## Hunt (what was actually opened / clicked)

Playwright `debug/scenarios/e2e-account-settings-general-hunt.spec.mjs` **1 / 1 (3.0s)**. Vite reused `http://localhost:5173`.

| Surface | Opened / clicked | Class |
|---|---|---|
| `/?hubPreview=1&tab=documents` Settings tabs | General / Connected services / Subscription only | No Theme / Appearance / Notifications pane. |
| General buttons | Close, Edit profile, Delete account, Sign out | **Just proven.** Do not replay. |
| Connected services | Microsoft + Google; two Connect | leftover-18 A-02 / UL-21 / UL-22. Host-gated. Not invented. |
| Subscription Manage | Start 7-day trial, Contact sales; Monthly/Annual **0** | leftover-18 A-05 / UL-20. Developer hides UL-19 toggle. Start trial not clicked. |
| Subscription Usage | Tab opens; content is only `Manage subscription Usage` | leftover-18 UL-18. `UsageIndicator` stayed empty (host meter / `isSupabaseAvailable()` from `supabaseClient`). Not invented. |
| Documents rail | Upload / Select / Last edited / More | Upload leftover-18 UL-03. Select / More already proven. |
| `?testPdf=` editor rest | Draw / Shapes / Text / Pages / Search / Bookmarks / Spaces / History / Export | Families already proven. Font menu **0** / color buttons **0** at rest (pickers appear when a tool is armed). Every-swatch already `e2e-pickers-every-swatch.spec.mjs` **5 / 5**. Not a new GAP. |
| Archive / TabBar / Documents extras / Projects / Templates / Spaces / Survey-rail / PDF waves | **Not reopened** | Do not replay. |

## Other chrome in the inventory (not a new leftover)

| Candidate | Class | Why |
|---|---|---|
| leftover-18 (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13` cloud persist, `UL-15` Turnstile, `UL-16` wipe, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`) | **Parked** | Host / captcha / Stripe / MSAL / second account. Do not invent `.env.local`. |
| Print / stamp / measure / Group / Extract / Note-Link / Forms / text-markup create | **Compile-hidden** | Flags / `false &&` / omitted. Not invented. |
| Templates category / module / entity Move/Copy | **Dead stub** | Not invented. |
| Copy-to-Spaces / survey checklist Y/N/N-A | **Stub / parked** | No compiled-in items. |
| Viewer every swatch / 6 fonts / 18 sizes / B/I/U/S / align | **Already proven** | `e2e-pickers-every-swatch.spec.mjs`. Not a color/font GAP vs the original catalog. |
| `mobileProjectLayout` rail/teams/drive/browse | **Unreachable** | `setMobileProjectLayout` has zero callers. |
| Password-requirements `i` tooltip | Same General pane | Invalid-copy already proven this slice. Not a new leftover. |

## What is not claimed

This hunt does **not** say unique unblocked GAP = 0. A prior “0” was falsified by Fit height; later exhausted hunts missed Projects extras, TabBar Close tab, Archive Search / Preview / Select.

After this independent hunt, **no other unique unblocked leftover was named** in this catalog (thinner Settings panes are leftover-18 host-gated; color/font already every-swatch). That is an exhausted *this-catalog* hunt, not a goal-complete claim.

Leftover-18 still blocks `/goal` complete.
