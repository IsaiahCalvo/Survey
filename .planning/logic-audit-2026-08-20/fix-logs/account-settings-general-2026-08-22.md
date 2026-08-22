# Account Settings General local chrome — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Does **not** re-claim unblocked GAP = 0.

## Why this leftover

Last hunt (`fix-logs/a04-account-menu-hunt-2026-08-22.md`) only **opened + closed** Account Settings tabs. It did not live-prove pane contents. A-04 menu open/close / Sign out confirm-Cancel stays a dedicated slice — this pass is **inside Settings**, on **General**.

| Control | Class |
|---|---|
| Name / email display | Real local chrome. hubPreview: `Isaiah` / `Calvo` / `dev-hubpreview@example.invalid`. |
| Theme / appearance / toggles | **Absent.** No Theme, Appearance, Dark mode, checkbox, or switch in General. Not invented. |
| Edit profile / Cancel | Real. Cancel restores seeded names. Chip stays `Isaiah Calvo`. |
| Save unchanged | Real. `No changes detected`. |
| Save name change | Host-blocked leftover-18 persist. `previewBlocked('save profile changes')`. Error shown; chip unchanged. |
| Empty / partial required | Real HTML validity gate. |
| Set a password / mismatch / weak | Real local chrome. Preview user has no email identity. |
| Reset-link / Turnstile | leftover-18 A-01. Fail-closed (`Preview cannot send password reset` / human). Not invented. |
| Delete account confirm | Real local gate (`delete` disabled; `DELETE` enables; Cancel). Wipe persist leftover-18 UL-16. |
| Settings Sign out | Fail-closed `Preview cannot sign out`. Modal stays. Distinct from A-04 menu Sign out confirm. |
| Escape / overlay / × | Real. Reopen always lands on General (KAL-68). |
| Guest | No Settings. AuthModal A-01 leftover-18. |
| `?testPdf=` Home | Same General chrome, **isolated** DevTestRoute profile `Dev` / `Test User` / `dev-test-user@example.invalid`. |
| Connected services | leftover-18 A-02 / UL-21 / UL-22. Host-gated Connect UI. Not clicked. |
| Subscription / Start trial / Usage | leftover-18 A-05 / UL-18 / UL-20. Host-gated. Start trial not clicked. |

Did **not** replay A-04 menu hunt; Archive family; TabBar Close tab; Documents extras + Lock persist + Open file; Projects family; Templates family; Spaces; Survey-rail; PDF waves.

## Live proof

**Intended**

- Seeded `/?hubPreview=1&tab=documents`: Settings opens on General. Displays Isaiah / Calvo / locked email. No theme toggles.
- Edit → Pat/Lee → Cancel restores Isaiah/Calvo. Chip unchanged.
- Unchanged Save → `No changes detected`.
- Name Save → `Preview cannot save profile changes.`; still editing; chip still Isaiah Calvo.
- Set a password (no Current password). Weak copy `Password does not meet requirements`.
- Delete: `delete` disabled; `DELETE` enables; Cancel hides confirm.
- Escape / overlay / × close. Reopen after Subscription still lands on General.
- Documents isolation: Package 2 still visible after close.

**Break**

- Empty first+last and first-only blocked by `required`.
- Password mismatch `New passwords do not match`.
- Reset link fail-closed (Turnstile / previewBlocked).
- Settings Sign out fail-closed; modal stays.
- Guest `/?hubPreview=1&guest=1`: Sign in chip + AuthModal; Settings **0**. A-01 leftover-18.
- Connected / Subscription classified leftover-18. Start trial / Connect not clicked.

**Edge**

- 390×844: same display, Cancel restore, Save fail-closed, Escape close. Overlay is full-bleed (no scrim click).
- `?testPdf=clickable-link-test.pdf` Home: Dev Test User, not Isaiah Calvo. Cancel restores Dev / Test User.

## Product

No product bug. `zoomGeneration` / SVG `viewBox` / container-aware canvas / single-name `fontFamily` / CORS `*` untouched. Official `npm test` 8448 not loosened. No high-risk file.

## Evidence

- Playwright `debug/scenarios/e2e-account-settings-general.spec.mjs` **1 / 1 (7.5s)**
- Node `tests/accountSettingsGeneral.test.mjs` **3 / 3**
- Vite reused `http://localhost:5173` (`npm run dev:ui`)
- Proof log `ACCOUNT_SETTINGS_GENERAL_PROOF` `seededProfile: ["Isaiah","Calvo","dev-hubpreview@example.invalid"]`, `noThemeToggles: true`, `cancelRestores: true`, `emptyRequiredBlocked: true`, `noopSave: true`, `nameSaveFailClosed: true`, `passwordMismatch: true`, `resetLinkFailClosed: true`, `deleteConfirmLocal: true`, `settingsSignOutFailClosed: true`, `connectedSubscriptionLeftover18: true`, `stripeNotClicked: true`, `msalNotClicked: true`, `escapeClose: true`, `reopenLandsGeneral: true`, `overlayClose: true`, `documentsIsolation: true`, `guestNoSettings: true`, `testPdfHomeGeneral: ["Dev","Test User","dev-test-user@example.invalid"]`, `testPdfIsolatedFromHubPreview: true`, `mobileGeneral: true`, `chipNameUnchanged: true`

## What is not claimed

This is **not** unblocked GAP = 0. Hunt after this slice: `fix-logs/account-settings-general-hunt-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.
