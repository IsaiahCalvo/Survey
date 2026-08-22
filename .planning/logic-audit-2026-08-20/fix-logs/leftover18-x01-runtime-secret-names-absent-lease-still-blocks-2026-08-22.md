# Leftover-18 X-01 — runtime-secret names absent; lease still blocks — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Did **not** invent `.env.local`. Did **not** write secret values. Did **not** prove X-01 live.  
Did **not** invent a lease, `file.id`, plus-alias, or second account.  
Did **not** read `.bot-credentials.json`. Did **not** touch leftover-18 Stripe / MSAL / Turnstile slices.  
Did **not** stamp `file.id` on `?testPdf=`. Did **not** loosen official `npm test` **8448** MiB or 75/250.  
Did **not** redo FEATURE-MATRIX / 96-ID hunts.

Followed `/home/ubuntu/.cursor/skills-cursor/env-setup/SKILL.md` + repo `AGENTS.md` auto-login notes. Wired **only** the three named keys if present. Scope check: `github.com/kal-voe/survey`. This run has **no linked Cursor cloud environment** (`environment: null`).

## Three names (values never printed)

Attempted to copy these **names** from process env into gitignored `.env.local`:

- `VITE_DEV_AUTO_LOGIN_EMAIL`
- `VITE_DEV_AUTO_LOGIN_PASSWORD`
- `SUPABASE_SERVICE_ROLE_KEY`

| Check | Result |
|---|---|
| Process env (this tool shell) | All three **ABSENT** (unset, not empty) |
| Login `bash -lc` | All three **ABSENT** |
| `/proc/*/environ` scan | **0** processes hold any of the three names |
| `__CURSOR_SANDBOX_ENV_RESTORE` | Does **not** mention any of the three names |
| `.env.local` | **Not written** (cannot invent values) |
| `.env.local` gitignored | **yes** (`gitignore:26:.env.local`) |
| Auto-login **names** present | **no** |
| Stripe / MSAL / Turnstile / Google / Vercel / migration secrets | **not used** |
| Official lease tuple | None supplied |
| `.survey-test-account.json` | **Missing** |
| Real saved `file.id` | None supplied |

## Vite / fresh load

| Check | Result |
|---|---|
| Vite restarted | **no** — `.env.local` was not created/edited, so a restart would not re-read new auto-login keys. Existing `npm run dev:ui` on **127.0.0.1:5173** left running (do not fight a sibling E2E-fidelity agent). Did **not** spawn `npm run dev` (Electron). |
| Fresh load attempted | **yes** — full navigation to `http://127.0.0.1:5173/` (no query, not HMR) |
| Observed chrome (no identity text) | Guest / auth-prompt: Auth modal open; Continue without an account; Sign in; Create account. Sign out / Settings **0**. No `@` in body text. Class: **guest-or-auth-prompt**. |

X-01 **still parked:** **yes**. Did not perform cloud writes, profile changes, sends, billing, deletion, or identity-churn.

## Exact remaining blocker

X-01 live proof may run only after the coordinator supplies and reserves:

1. an exact safe account tuple (`email|userId|tier|status`, identify by email **and** Supabase user ID) plus a lease token via `scripts/test-account-lease.mjs`, **and**
2. a real saved `file.id` (do not stamp `file.id` on `?testPdf=`).

This message supplied neither. This run also cannot write `.env.local` until the three Runtime Secret **names** are actually injected into the agent process (they are not in this pod; Cursor environment is **null**).

## This turn

- Tests run: none (X-01 stays parked; no product change).
- Bugs found/fixed: none.
- Product: unchanged.
- `E2E-STATUS.md`: not updated (sibling E2E-fidelity receipt may still be landing).

**Next leftover-18 live host remains X-01.** Goal stays open.
