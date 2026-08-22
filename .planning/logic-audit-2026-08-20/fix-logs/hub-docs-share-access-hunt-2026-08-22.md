# Hunt after Documents Share / Document Access — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Does **not** re-claim unblocked GAP = 0.

Last slice live-proved Documents More → Share → Document Access (Invite + Done on SE-011; Invite/Copy-link/Send fail-closed). This pass independently hunted remaining reachable chrome vs E2E-STATUS / FEATURE-MATRIX / E2E-UNLISTED + live hubPreview + `?testPdf=`.

## Hunt (what was actually opened / clicked)

Playwright `debug/scenarios/e2e-after-docs-share-access-hunt.spec.mjs` **1 / 1 (4.0s)**. Vite reused `http://localhost:5173`.

| Surface | Opened / clicked | Class |
|---|---|---|
| `/?hubPreview=1` every tab | Documents / Projects / Templates / Archive buttons + More counts | Families already dedicated-sliced. Not replayed as the GAP. |
| Documents rest | Search documents **2**; Upload **1**; Select **1** | Search / Select already extras + catalog. Upload leftover-18 UL-03. |
| Documents Preview SE-011 | Team **1**; Open file **1**; Share **1**; Collaborators **0**; Recent activity **0** | Open file already proven. Preview Share is the same `shareDocuments` just proven. Team is display-only (owner avatar). Collaborators / Recent activity are comment-only — not compiled. |
| Documents Preview Package 2 (shared) | Team **1**; Collaborators **0** | Same display-only Team. No extra shared roster chrome. |
| Settings tabs | General / Connected / Subscription | No Theme / Appearance / Notifications. |
| Connected services | Microsoft + Google `Not connected…`; Connect **2**; Disconnect **0** | leftover-18 A-02 / UL-21 / UL-22. Connect **not** clicked. |
| Subscription Manage | Start trial **1**; Usage **1**; Monthly/Annual **0** | leftover-18 A-05 / UL-20. Start trial **not** clicked. Usage just proven. |
| `?testPdf=` editor rest | Close tab / Draw / Shapes / Text / Pages / Search / Bookmarks / Spaces / History / Export / Fit options / Survey | Families already proven. Font **0** at rest. Export leftover-18. |

## Other chrome in the inventory (not a new leftover)

| Candidate | Class | Why |
|---|---|---|
| leftover-18 (`X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`) | **Parked** | Host / captcha / Stripe / MSAL / second account. Do not invent `.env.local`. |
| Documents Preview / Select Share | **Just proven** | Same `shareDocuments` / Document Access as More → Share. |
| Viewer every swatch / 6 fonts / 18 sizes / B/I/U/S / align | **Already proven** | `e2e-pickers-every-swatch.spec.mjs`. |
| Export / import / save | **Already dedicated** | leftover-18 save/export inventory. Cloud save stays X-01. |
| Print / stamp / measure / Group / Extract / Note-Link / Forms | **Compile-hidden** | Flags / `false &&` / omitted. |
| Templates category Move/Copy / Copy-to-Spaces / checklist Y/N/N-A | **Stub / parked** | Not invented. |
| Settings General / Usage | **Just proven** | Do not replay. |
| Preview Team | **Display-only** | Owner avatar + name. No control. |

## What is not claimed

This hunt does **not** say unique unblocked GAP = 0. A prior “0” was falsified by Fit height; the General hunt missed Usage local meters; the Usage hunt correctly named this Share leftover.

After this independent hunt, **no other unique unblocked leftover was named** in this catalog (remaining reachable set is leftover-18 + compile-hidden / stubs + already-proven families). That is an exhausted *this-catalog* hunt, not a goal-complete claim.

Leftover-18 still blocks `/goal` complete.
