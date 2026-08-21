# E2E A-01 hubPreview fail-closed — adversarial

**Date:** 2026-08-21  
**Worktree:** `nifty-elion-773074`  
**Vite:** reused `http://localhost:5173` (`npm run dev:ui`, not killed; HTTP 200)  
**Harness:** `debug/scenarios/e2e-a01-hubpreview-adversarial.spec.mjs` + `debug/playwright.reuse-5173.config.mjs`  
**Route:** `/?hubPreview=1&guest=1&tab=documents`  
**Live:** **5 / 5 passed** (8.0s) after one extra product fix.  
**Does not mark the audit goal complete.** No commit. Did not invent a Turnstile token. Did not start live Google / Microsoft OAuth. Did not retry the 18 host leftovers.

## Cases

| Case | Result | Proof |
|---|---|---|
| **Intended** — Sign in without a captcha token | **pass** | `.auth-error` = `Preview cannot sign in.` Modal stays. Guest `Sign in` chrome stays. No URL leave. |
| **Break** — empty email | **pass** | Native `#email` `checkValidity() === false`. No submit. Modal stays. |
| **Break** — empty password | **pass** | Native `#password` `checkValidity() === false`. Modal stays. |
| **Break** — garbage email `not-an-email` | **pass** | `type="email"` invalid. No `.auth-error` (never submitted). Modal stays. |
| **Break** — double-submit | **pass** | Two clicks → one `.auth-error`. Submit re-enables. Modal stays. |
| **Edge** — Sign up (matching policy-passing password) | **pass** | `Preview cannot create an account.` No `Check your email` panel. Modal stays. |
| **Edge** — Continue without an account | **pass** | Modal count 0. `.profile-signin` still visible. Still on `hubPreview=1`. |
| **Edge** — Google | **pass** | `Preview cannot start Google sign-in.` No popup. URL unchanged. |
| **Edge** — Microsoft | **pass** | Guest AuthModal has **no** Microsoft button (by design). SSO is the OAuth-adjacent control: `Preview cannot start SSO.` No redirect. |
| **Extra** — Forgot password | **fail then pass** | `resetPassword` was still `asyncNoop` → silent “Password reset link sent!” with no error. |

## Extra product fix

- **File:** `src/home/HubPreview.jsx`
- **Change:** `resetPassword: previewBlocked('send password reset emails')` (was `asyncNoop`). Same fail-closed contract as `signIn` / `signUp` / Google / SSO.
- **Proof:** extra case **1 / 1** in the 5 / 5 re-run. Error is `Preview cannot send password reset emails.` No `.auth-message`. Modal stays.

High-risk files not touched. Invariants untouched: container-aware canvas sizing, SVG `viewBox` zoom, `zoomGeneration`, single-name `fontFamily`, CORS `*`.

## Host-blocked leftovers (unchanged — do not retry)

`X-01`, `X-05` cloud persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile completion, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe click, `A-06` two-client roster, `UL-03` native pick, `UL-13` profile persist, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

SQL apply leftovers unchanged. P-01 / UL-46 native Capacitor already proven on Simulator — not re-run.

## Goal

Stays **open**.
