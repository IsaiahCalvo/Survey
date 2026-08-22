# Account Settings Usage local empty chrome — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.**

Independent hunt after General found Subscription **Usage** local meters. Last hunt called this leftover-18 UL-18 and empty — **false**. UL-18 is not in leftover-18. Live billing-API counts stay uninvented (U-04 / host meter).

## Slice

Account Settings **Usage** sub-tab (`<UsageIndicator/>` / `useSubscriptionLimits`). Local fail-closed zeros when the host meter is unavailable (`!isSupabaseAvailable()` early-return, or failed fetch leaves `{0,0,0}`). Developer tier: projects/documents `∞`, storage `100.0 GB`.

Distinct from General display/Edit/Save, leftover-18 A-05 Stripe / Start trial, leftover-18 U-04 checklist usage, and Documents More Share / Document Access (named leftover, not this slice).

## Live

Playwright `debug/scenarios/e2e-account-settings-usage.spec.mjs` **1 / 1 (7.1s)** on reused Vite `http://localhost:5173`.

| Check | Result |
|---|---|
| empty=1 hub | Usage still `Projects 0 / ∞`, `Documents 0 / ∞`, `Storage 0 B / 100.0 GB`. No Retry. No upgrade nudge. |
| Intended (seeded hub) | Same meters + DEVELOPER. Start trial **0** on Usage. |
| Break: General / Connected | No meters. |
| Break: Manage | Meters `display:none` (`toBeHidden`). Monthly/Annual **0**. Start trial **not** clicked. |
| Break: guest | Settings **0**. No `0 B / 100.0 GB`. AuthModal stays A-01. |
| Edge: reopen | Lands General, not Usage. Documents isolated. |
| Edge: `?testPdf=` Home | Same local zeros (route forces `isSupabaseAvailable() === false`). Not Isaiah Calvo. |
| Edge: 390 | Same meters. Escape closes. |

Node `tests/accountSettingsUsage.test.mjs` **3 / 3**.

## Product

No product bug. UsageIndicator has no Retry / error chrome — empty meters are the fail-closed UI. No high-risk file. 8448 not loosened.

## Not claimed

Documents More **Share** → Document Access is a remaining unique leftover. Leftover-18 stay parked. Goal stays open.
