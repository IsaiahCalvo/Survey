# E2E silent-success stub hunt — outside HubPreview

**Date:** 2026-08-21  
**Worktree:** `nifty-elion-773074`  
**Vite:** reused `http://localhost:5173` (`npm run dev:ui`, not killed; HTTP 200)  
**Harness:** `debug/scenarios/e2e-silent-stub-hunt.spec.mjs` + `debug/playwright.reuse-5173.config.mjs`  
**Routes:** `/?testPdf=clickable-link-test.pdf` (Home tab → Settings) and `/?spike=features`  
**Live:** **10 / 10 passed** (17.3s).  
**Does not mark the audit goal complete.** No commit. Did not invent a backend. Did not invent a Turnstile token. Did not start live Google / Microsoft OAuth. Did not click Stripe. Did not retry the 18 host leftovers. HubPreview auth stubs were already fail-closed — not re-edited.

## Stubs found (`src/` hunt)

Searched `asyncNoop`, `noop`, `hubPreview`, `DevTestRoute`, `?testPdf`, `?spike=`, mock auth, success copy (“sent”, “saved”, “upgraded”, “link sent”), and `console.log`-only user actions.

| Location | Was | Live user-facing? | Claim if left as noop |
|---|---|---|---|
| `DevTestRoute` `updateProfile` | `asyncNoop` | **Yes** — Home → Settings → Edit profile → Save name | "Your name has been updated successfully." |
| `DevTestRoute` `updatePassword` | `asyncNoop` | **Yes** — mock user has no email identity → **Set a password** | "Your password has been updated successfully." |
| `DevTestRoute` `signOut` | `asyncNoop` | **Yes** — Settings Sign out closed the modal as if signed out | Settings close; hub stayed "signed in" |
| Dashboard `onSignOut` | fire-and-forget `signOut` | **Yes** — profile-menu confirm Sign out (HubShell does not catch) | Menu closed; no error; still signed in |
| `DevTestRoute` `resetPassword` | `asyncNoop` | **Yes** — Email me a link | "A password reset link has been sent to …" |
| `DevTestRoute` `signIn` / `signUp` / Google / SSO | `asyncNoop` | AuthModal mounted; auto-open skipped while `__devTestPdf` is set | Sign-in would close the modal as success |
| `DevTestRoute` `refreshSubscriptionTier` | `asyncNoop` | Destructured in AccountSettings; **not called** from UI | Would silently resolve if called |
| `DevTestRoute` `resendConfirmation` / `deleteAccount` / `linkGoogleIdentity` / `unlinkProvider` | **missing** | Delete / Google Connect reachable; resend not (signup never opens confirm) | Delete closed Settings as if deleted; Google claimed connect |
| `DevTestRoute` `logout` (MS Graph) | `asyncNoop` | Disconnect hidden (`isAuthenticated: false`) | Would silently "disconnect" if shown |
| `DevTestRoute` `ensureFreshToken` | `async () => true` | Not a hub control; boolean probe | Lied that a Microsoft token was valid |
| `DevTestRoute` `updateLastUsed` / `handleOAuthCallback` | `asyncNoop` | Internal MS lifecycle only | No toast / success copy |
| `HubPreview.jsx` | already `previewBlocked` | Already fail-closed this session | — |
| `?spike=features` | no auth/billing stubs | Bookmark / find / draw / Save log are real | No "sent/saved/upgraded" copy |
| `ReSignInModal` Forgot password | honest banner | "Password reset is not wired up yet" | Not silent-success |
| `ShareModal` | already gated | `isSupabaseAvailable === false` → "Sharing needs a signed-in cloud account." | No `Sent N …` |

## Stubs changed (min-diff)

`src/DevTestRoute.jsx` only for the mock provider (same pattern as HubPreview):

- `signUp` / `signIn` / Google / SSO / `signOut` / `resetPassword` / `updatePassword` / `updateProfile` / `refreshSubscriptionTier` → `previewBlocked(...)`
- Added missing `resendConfirmation` / `linkGoogleIdentity` / `unlinkProvider` / `deleteAccount` as `previewBlocked`
- MS `login` / `logout` → `previewBlocked`
- `ensureFreshToken` → `async () => false`
- Left `updateLastUsed` / `handleOAuthCallback` as `asyncNoop` (internal, no user copy)

`src/Dashboard.jsx` — HubShell does not catch `onSignOut`. Wrap now toasts the thrown message so profile-menu Sign out cannot look like it worked. Production `signOut` success is unchanged; a real failure now toasts instead of an unhandled rejection.

High-risk files not touched. Invariants untouched: container-aware canvas sizing, SVG `viewBox` zoom, `zoomGeneration`, single-name `fontFamily`, CORS `*`.

## Live-pass list

| Case | Result | Proof |
|---|---|---|
| **Intended** — Save name `Preview` | **pass** | `.account-error` = `Test PDF cannot save profile changes.` No `.account-message` / "updated successfully". Modal stays. |
| **Break** — Save with no name change | **pass** | `.account-error` = `No changes detected`. No success copy. |
| **Edge** — Set password mismatch, then matching | **pass** | Mismatch → `do not match`. Matching `PreviewPass12!` → `Test PDF cannot update passwords.` No success copy. |
| **Intended** — Settings Sign out | **pass** | `.account-error` = `Test PDF cannot sign out.` Settings stay. After close, account menu still present; no `.profile-signin`. |
| **Break** — Settings Sign out double-click | **pass** | One error. Modal stays. |
| **Edge** — profile-menu Sign out | **pass** | Toast `Test PDF cannot sign out.` Still signed in. Still `testPdf=`. |
| **Edge** — Settings reset-link + delete | **pass** | Reset: `Test PDF cannot send password reset emails.` Delete `DELETE` → `Test PDF cannot delete accounts.` No reset "sent" copy. |
| **Edge** — Microsoft / Google Connect | **pass** | MS: `Failed to connect Microsoft account` (UI wraps the blocked login). Google: `Test PDF cannot start Google OAuth.` No disconnect-success copy. |
| **Edge** — Share copy / send | **pass** (N/A UI) | Empty `?testPdf=` hub has no Share button. ShareModal already fail-closed when a doc exists. No `Sent N …` copy. |
| **Spike sanity** | **pass** | `?spike=features` has no AuthModal / AccountSettings and no sent/saved/upgraded copy. |

HubPreview (`?hubPreview=1`) not re-run; prior hunt already **10 / 10**.

## Intentional leftovers (not silent-success claims)

- **`?testPdf=` mock developer editor** — annotation / history / survey tools are real. Only account/auth mutations were fail-closed.
- **In-memory hub demos** on HubPreview (rename / delete / duplicate / move / copy) and `workflowE2E` create — local state, not a backend claim.
- **`?spike=features`** — throwaway renderer spike; zoom / find / bookmarks / Save log actually do that work.
- **`updateLastUsed` / `handleOAuthCallback`** — internal, no user copy. Left `asyncNoop` on both preview providers.
- **`ReSignInModal` Forgot password** — honest "not wired up yet". Did not invent a reset backend.
- **New project / upload / new template** on HubPreview when `workflowE2E` is off: `console.log` only, no "saved" toast.
- **Stripe Checkout** when a real subscription row exists — real `StripeCheckout` (A-05 host leftover). Did not click. `?testPdf=` / HubPreview set `isSupabaseAvailable === false` so Settings does not invent a subscription row.

## Host-blocked leftovers (unchanged — do not retry)

`X-01`, `X-05` cloud persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile completion, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe click, `A-06` two-client roster, `UL-03` native pick, `UL-13` profile persist, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

SQL apply leftovers unchanged. P-01 / UL-46 native Capacitor already proven on Simulator — not re-run.

## Goal

Stays **open**.
