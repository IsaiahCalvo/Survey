# E2E hubPreview silent-success hunt — fail-closed stubs

**Date:** 2026-08-21  
**Worktree:** `nifty-elion-773074`  
**Vite:** reused `http://localhost:5173` (`npm run dev:ui`, not killed; HTTP 200)  
**Harness:** `debug/scenarios/e2e-hubpreview-noop-hunt.spec.mjs` + `debug/playwright.reuse-5173.config.mjs`  
**Route:** `/?hubPreview=1&tab=documents` (+ guest sanity on `/?hubPreview=1&guest=1&tab=documents`)  
**Live:** **10 / 10 passed** (15.6s).  
**Does not mark the audit goal complete.** No commit. Did not invent a preview backend. Did not invent a Turnstile token. Did not start live Google / Microsoft OAuth. Did not click Stripe. Did not retry the 18 host leftovers.

## Stubs found (`src/home/HubPreview.jsx` + consumers)

A-01 already fail-closed `signIn` / `signUp` / Google / SSO / `resetPassword`. Remaining silent-success stubs:

| Stub | Was | Live user-facing? | Claim if left as noop |
|---|---|---|---|
| `updateProfile` | `asyncNoop` | **Yes** — Settings → Edit profile → Save name | "Your name has been updated successfully." |
| `updatePassword` | `asyncNoop` | **Yes** — mock user has no email identity, so Settings is **Set a password** (no re-auth `signIn`) | "Your password has been updated successfully." |
| `signOut` | `asyncNoop` | **Yes** — Settings → Sign out closed the modal as if signed out | Settings close; hub stayed "signed in" |
| Hub `onSignOut` | `console.log` | **Yes** — profile-menu confirm Sign out | Menu closed; no error; still signed in |
| `refreshSubscriptionTier` | `asyncNoop` | Destructured in AccountSettings; **not called** from UI | Would silently resolve if called |
| `resendConfirmation` | **missing** | Not reachable (signup already blocked, confirm panel never opens) | AuthModal would claim "Confirmation email sent!" if reached |
| `logout` (MS Graph) | `asyncNoop` | Disconnect hidden (`isAuthenticated: false`) | Would silently "disconnect" if shown |
| `ensureFreshToken` | `async () => true` | Not a hub control; boolean probe | Lied that a Microsoft token was valid |
| `updateLastUsed` / `handleOAuthCallback` | `asyncNoop` | Internal MS lifecycle only | No toast / success copy |

Already honest (not changed):

- Share copy/send — `isSupabaseAvailable === false` → "Sharing needs a signed-in cloud account."
- Settings subscription fetch — same flag; no fake subscription row.
- Delete / Google link / Google unlink / MS login — already `previewBlocked`.
- Local hub demo (duplicate / move / copy / delete / rename) — local state, not a backend claim.

## Stubs changed (min-diff, `HubPreview.jsx` only)

- `signOut` → `previewBlocked('sign out')`
- `updatePassword` → `previewBlocked('update passwords')`
- `updateProfile` → `previewBlocked('save profile changes')`
- `refreshSubscriptionTier` → `previewBlocked('refresh subscription status')`
- `resendConfirmation` → `previewBlocked('resend confirmation emails')` (was missing)
- MS `logout` → `previewBlocked('disconnect Microsoft')`
- `ensureFreshToken` → `async () => false` (fail-closed probe, no throw)
- Profile-menu `onSignOut` now calls the blocked `signOut` and toasts the error (HubShell does not catch)

High-risk files not touched. Invariants untouched: container-aware canvas sizing, SVG `viewBox` zoom, `zoomGeneration`, single-name `fontFamily`, CORS `*`.

## Live-pass list

| Case | Result | Proof |
|---|---|---|
| **Sanity** — guest Sign in | **pass** | `.auth-error` still `Preview cannot sign in.` Modal stays. |
| **Intended** — Save name `Preview` | **pass** | `.account-error` = `Preview cannot save profile changes.` No `.account-message` / "updated successfully". Modal stays. |
| **Break** — Save with no name change | **pass** | `.account-error` = `No changes detected`. No success copy. |
| **Break + edge** — Set password mismatch, then matching | **pass** | Mismatch → `do not match`. Matching `PreviewPass12!` → `Preview cannot update passwords.` No success copy. |
| **Intended** — Settings Sign out | **pass** | `.account-error` = `Preview cannot sign out.` Settings stay. After close, account menu still present; no `.profile-signin`. |
| **Break** — Settings Sign out double-click | **pass** | One error. Modal stays. |
| **Edge** — profile-menu Sign out | **pass** | Toast `Preview cannot sign out.` Still signed in. Still `hubPreview=1`. |
| **Edge** — Settings reset-link + delete | **pass** | Reset: `Preview cannot send password reset emails.` Delete `DELETE` → `Preview cannot delete accounts.` No reset "sent" copy. |
| **Edge** — Microsoft / Google Connect | **pass** | MS: `Failed to connect Microsoft account` (UI wraps the blocked login). Google: `Preview cannot start Google OAuth.` No disconnect-success copy. |
| **Edge** — Share copy / send | **pass** | `Sharing needs a signed-in cloud account.` No `Sent N …` copy. |

## Intentional leftovers (not silent-success claims)

- **Local-state hub actions** (duplicate / move / copy / delete / rename / workflowE2E upload+create). Header contract: demonstrable on local state. Not a fake email/save/upgrade.
- **New project / upload / new template** when `workflowE2E` is off: `console.log` only. Nothing happens; no "saved" toast. Design-review hooks. `workflowE2E=1` implements them locally.
- **`onSettings` console.log** — observer only. SurveyHub still opens AccountSettings.
- **`updateLastUsed` / `handleOAuthCallback`** — internal, no user copy. Left `asyncNoop`.
- **`resendConfirmation` / `refreshSubscriptionTier` / MS Disconnect** — now fail-closed, but not live-reachable on this route (signup blocked / unused / MS not connected).
- **`DevTestRoute.jsx` `asyncNoop`s** — `?testPdf=` mock, not `?hubPreview=1`. Out of scope.
- **Stripe Checkout button** when subscription is null — real `StripeCheckout` (A-05 host leftover). Did not click.

## Host-blocked leftovers (unchanged — do not retry)

`X-01`, `X-05` cloud persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile completion, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe click, `A-06` two-client roster, `UL-03` native pick, `UL-13` profile persist, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

SQL apply leftovers unchanged. P-01 / UL-46 native Capacitor already proven on Simulator — not re-run.

## Goal

Stays **open**.
