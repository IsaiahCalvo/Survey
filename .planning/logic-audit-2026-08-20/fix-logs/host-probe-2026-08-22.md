# Host probe — 2026-08-22 (X-01 / leftover-18)

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Does **not** re-claim unblocked GAP = 0.  
Did **not** invent `.env.local`. Did **not** read `.bot-credentials.json`. Did **not** create accounts, plus-aliases, or SQL.

Last completion audit named **X-01** identity-churn / signed-in cloud save as the next leftover-18 live host. This pass inspected the current environment as authoritative.

## What existed

| Check | Result |
|---|---|
| `.env` | Present. Key names only: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Public bootstrap values. |
| Vite `http://localhost:5173` | Listening (reuse; do not spawn `npm run dev`). |
| Cursor cloud run | `bc-500fe4ab-e5ed-56de-8db4-5dc2f20d9d96` (“Probe hosts then prove X-01”). Repo `github.com/kal-voe/survey`. |
| Cursor cloud environment | **null** — this run has no linked environment / no `environment.json` secrets. Egress policy unknown. Build **null**. |

## What was absent (no invented hosts)

| Check | Result |
|---|---|
| `.env.local` | **Missing** — no `VITE_DEV_AUTO_LOGIN_EMAIL` / `VITE_DEV_AUTO_LOGIN_PASSWORD` / `SUPABASE_SERVICE_ROLE_KEY`. |
| `.env.test` / `.env.test.local` | **Missing** — `npm run test:integration` / `test:privacy` cannot run. |
| Process env auto-login | `VITE_DEV_AUTO_LOGIN_EMAIL` **ABSENT**. `VITE_DEV_AUTO_LOGIN_PASSWORD` **ABSENT**. `SUPABASE_SERVICE_ROLE_KEY` **ABSENT**. Quote-wrap check N/A. |
| Process env Stripe / MSAL / Turnstile | All **ABSENT** (`STRIPE_*`, `VITE_STRIPE_*`, `VITE_MSAL_CLIENT_ID`, `MSAL_CLIENT_ID`, `VITE_AZURE_CLIENT_ID`, `VITE_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`). |
| Process env `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | **ABSENT** in process (file `.env` only). |
| `.bot-credentials.json` | **Missing** (existence check only; not read). |
| `.survey-test-account.json` | **Missing**. |
| Docker / `supabase` CLI | **Absent**. Five in-tree `20260820*.sql` files remain unapplied. Not applied. |
| Official lease tuple | No human `email\|userId\|tier\|status` supplied. |

**X-01 hosts:** **absent**. Signed-in cloud save / identity-churn cannot be live-proved. Leftover-18 still needs hosts.

## Classification after the probe

Unblocked leftover that is **not** leftover-18 / compile-hidden / stub: compile-hidden Print’s **reachable fail-closed** blob/OS path (`PRINT_PANEL_ENABLED = false` still intercepts Cmd/Ctrl+P). See `print-panel-failclosed-2026-08-22.md`. Custom panel UI stays compile-hidden. No Print backend invented. Flag not flipped.

Next leftover-18 live host remains **X-01**.
