# Hunt after Archive Select — A-04 Account menu — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Does **not** re-claim unblocked GAP = 0.

Last hunt (`fix-logs/archive-select-hunt-2026-08-22.md`) parked **A-04 account menu** as if hubPreview `onSettings` were a `console.log` no-op. That parking is **wrong**. A-04 is **not** leftover-18. This pass independently hunted live chrome vs E2E-STATUS / FEATURE-MATRIX / E2E-UNLISTED and classified A-04.

## A-04 classification

Live on `/?hubPreview=1` + `?testPdf=clickable-link-test.pdf` (Home). SurveyHub wraps the observer `onSettings` and **opens AccountSettings** (`setSettingsOpen(true)`). Dedicated slice already live-proven: `e2e-helper-only-live.spec.mjs`, `e2e-hubpreview-noop-hunt.spec.mjs`, `e2e-silent-stub-hunt.spec.mjs`. **Do not replay.**

| Item | Live | Class |
|---|---|---|
| Open / close (chip, Escape; Cancel leaves menu open) | Yes | Local chrome. Entry path for the dedicated A-04 slice. |
| Profile display | `Isaiah Calvo` / `Synced · Developer` / `dev-hubpreview@example.invalid` | Local chrome. Display only. Already used by A-04 proofs. |
| Settings | Opens `.account-settings-modal` + heading Settings | **Dedicated A-04 slice.** Not leftover-18. Last hunt’s “console.log only” is false. |
| Settings panes | General / Connected services / Subscription | Dedicated A-04 / UL-12–22 chrome. Do not replay. |
| Sign out → confirm / Cancel | Confirm copy `Sign out of Survey?`; Cancel keeps chip | Local chrome. Fail-closed Sign out already proven (Preview / Test PDF cannot sign out). |
| Guest Sign in | `.profile-signin` + AuthModal Welcome back | **A-01 leftover-18** Turnstile. Not invented. |
| Desktop Archive in menu | **0** | Archive stays on the rail. |
| 390 Archive in menu | Present; click lands Archive heading | Nav to the already-proven Archive tab. Not a new leftover. |
| `?testPdf=` editor | Chip **mounted** under Home (`editorAccountMounted: 1`) but **not reachable** (`editorAccountReachable: false`) | Dashboard stays mounted under the PDF overlay. Same A-04 menu on Home. |
| Stripe / MSAL / Turnstile / wipe persist / roster / inbox | Not clicked | leftover-18. Fail-closed. Not invented. |

## Hunt (what was actually opened / clicked)

Playwright `HUNT_INVENTORY` on `debug/scenarios/e2e-a04-account-menu-hunt.spec.mjs` **1 / 1 (4.9s)**. Vite reused `http://localhost:5173`.

| Surface | Opened / clicked | Class |
|---|---|---|
| `/?hubPreview=1&tab=documents` | Documents / Projects / Templates / Archive nav; account chip | Families **already proven**. Upload stays leftover-18 / UL-03. Open navigation proven mobile. |
| Account menu (desktop) | Chip; Settings; close; Sign out → Cancel; Escape | A-04 dedicated slice + local open/close. |
| Settings modal | Tabs visible: General / Connected services / Subscription; close | Dedicated slice. Did **not** replay Edit profile / password / DELETE / Stripe / Connect. |
| `/?hubPreview=1&guest=1` | Sign in chip + AuthModal | A-01 leftover-18. |
| `?testPdf=clickable-link-test.pdf` | Draw visible; account chip not hit-testable; Home → same Settings / Sign out menu | Same A-04 slice. |
| `/?hubPreview=1&tab=archive` @ 390×844 | Mobile account menu Archive / Settings / Sign out; Archive nav | Same menu + proven Archive destination. |
| Archive Search / Preview / Select; TabBar Close tab; Documents extras + Lock persist + Open file; Projects family; Templates family; Spaces; Survey-rail; PDF waves | **Not reopened** as the GAP | Do not replay. |

## Other chrome in the inventory (not a new leftover)

| Candidate | Class | Why |
|---|---|---|
| leftover-18 (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`) | **Parked** | Host / captcha / Stripe / MSAL / second account. Do not invent `.env.local`. |
| Print / stamp / measure / Group / Extract / Note-Link / Forms / text-markup create | **Compile-hidden** | Flags / `false &&` / omitted. Not invented. |
| Templates category / module / entity Move/Copy | **Dead stub** | Not invented. |
| Copy-to-Spaces / survey checklist Y/N/N-A | **Stub / parked** | No compiled-in items. |
| `mobileProjectLayout` rail/teams/drive/browse/recent/grid/cards/compact/focus/files/team | **Unreachable** | `setMobileProjectLayout` has zero callers. |
| Documents Upload / Projects Upload | **leftover-18 / UL-03** | Host picker. |
| Documents / Projects Select / More / Last edited / New template / Archive Show documents | **Proven** | Do not replay. |

## What is not claimed

This hunt does **not** say unique unblocked GAP = 0. A prior “0” was falsified by Fit height; later exhausted hunts missed Projects extras, TabBar Close tab, Archive Search / Preview / Select.

After this independent hunt, **A-04 is already a dedicated slice** (not leftover-18, not a new GAP). No other unique unblocked leftover was named. That is an exhausted *this-catalog* hunt, not a goal-complete claim.

Leftover-18 still blocks `/goal` complete.
