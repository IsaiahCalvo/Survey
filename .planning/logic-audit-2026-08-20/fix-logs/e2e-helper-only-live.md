# E2E leftovers — helper-only → live chrome

**Date:** 2026-08-21  
**Worktree:** `nifty-elion-773074`  
**Vite:** reused `http://localhost:5173` (`npm run dev:ui`, not killed)  
**Harness:** `debug/scenarios/e2e-helper-only-live.spec.mjs` + `debug/playwright.reuse-5173.config.mjs`  
**Result:** 5 / 5 passed. Did not stamp `file.id`. Did not invent captcha / Stripe Checkout / MSAL / Capacitor / test-account lease.

Does **not** mark the audit goal complete.

## Product fixes (min-diff)

1. **HubPreview Settings never mounted** — `AccountSettings` returns `null` without `useAuth().user`, but the preview mock had `user: null`. Added a DevTestRoute-shaped mock user plus `linkGoogleIdentity` / `unlinkProvider` / `deleteAccount` fail-closed helpers. `?guest=1` keeps the hub user null, opens AuthModal, and shows Sign in.
2. **AccountSettings subscription fetch** — skip `user_subscriptions` when `auth.isSupabaseAvailable === false` (preview / `?testPdf=`). No invented Stripe customer.
3. **ShareModal mint hang** — Copy/Send no longer call RPCs without a session. Validate emails first; then require `currentUser.id` and `isSupabaseAvailable`. Preview Copy link now errors `Sharing needs a signed-in cloud account.` instead of spinning.

`zoomGeneration` / SVG viewBox / container-aware canvas / single-name fonts / CORS `*` untouched.

## Newly live-pass

| ID | Spec | Intended + break + edge |
|---|---|---|
| A-01 | `e2e-helper-only-live.spec.mjs` | `/?hubPreview=1&guest=1` Sign in + AuthModal; human-gate without a token; signup mismatch; Continue without an account |
| A-02 / UL-21 | same | Microsoft Connect fail-closed |
| A-03 / UL-24 | same | Viewer/Editor/Owner (no Commenter); invalid email; Copy link fail-closed |
| A-04 / UL-13 / UL-15–18 | same | Edit profile required; password mismatch; `delete` vs `DELETE`; Sign out; Usage tab |
| A-05 / UL-20 | same | Pro/Enterprise catalog; Start trial visible **not clicked**; Contact sales |
| UL-22 | same | Google Connect fail-closed |
| X-06 | same | Survey → KAL-436 → Walls → EXPORT downloaded `.xlsx` (no host workbook, no `file.id`) |
| UL-46 | same | 390×844 Eraser-mode select + Text color picker backdrop close |

## Still blocked (one sentence each)

| ID | Blocker |
|---|---|
| X-01 | Live identity-churn needs a signed-in cloud user whose session identity changes; the sync chip is correctly hidden on `?testPdf=`. |
| A-06 / UL-45 | Live two-client presence roster needs a second signed-in collab client. |
| UL-15 leftover | Completing Turnstile and a real password change still needs a captcha token + real user. |
| UL-16 leftover | Permanently deleting an account is still a destructive signed-in wipe. |
| UL-20 leftover | Clicking Start trial would invoke live Stripe Checkout. |
| UL-21 / UL-22 leftover | Live MSAL login and Google OAuth still need those host apps. |
| UL-24 leftover | A successful Copy-link mint still needs a paid cloud user and a real item id. |
| UL-44 | Live Retry flush needs a cloud outbox; the chip is correctly hidden on `?testPdf=`. |
| UL-46 leftover | Native Capacitor device chrome is still untested. |

## New issues

None filed. ShareModal hang-without-session was a real preview bug and is fail-closed above.

## Files

- `src/home/HubPreview.jsx` — mock user, guest AuthModal
- `src/components/AccountSettings.jsx` — skip billing fetch without supabase
- `src/home/ShareModal.jsx` — fail-closed mint
- `debug/scenarios/e2e-helper-only-live.spec.mjs`
- `E2E-STATUS.md` / `E2E-UNLISTED.md` / `COMPLETION-AUDIT.md`

No commit.
