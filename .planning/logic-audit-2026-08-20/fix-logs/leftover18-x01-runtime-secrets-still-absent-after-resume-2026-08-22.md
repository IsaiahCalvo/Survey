# Leftover-18 X-01 — runtime-secret names still absent after resume — 2026-08-22

Does not mark `/goal` complete. Does not claim GAP = 0. Did not invent values. Did not write a partial `.env.local`. Did not run X-01 writes. Did not read `.bot-credentials.json`. Did not create accounts or plus-aliases.

Followed `/home/ubuntu/.cursor/skills-cursor/env-setup/SKILL.md` + repo `AGENTS.md` auto-login notes. Presence-only checks (no values printed). This run has no linked Cursor cloud environment (`environment: null`).

## Three names

| Name | Process env | `/proc/*/environ` (47 procs) | `__CURSOR_SANDBOX_ENV_RESTORE` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | 0 | not-mentioned |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | 0 | not-mentioned |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | 0 | not-mentioned |

Documented injection paths checked (existence only): `/tmp/cursor/secrets`, `/tmp/cursor/runtime-secrets`, `/tmp/cursor/env`, `/run/secrets`, `/etc/cursor/secrets`, `$HOME/.cursor/secrets`, `/workspace/.env.local`, `/workspace/.env.secrets` — all missing. `/workspace/.env` exists and holds none of the three names.

## Receipt fields

- `.env.local` written: **no**
- `.env.local` gitignored: **yes** (`gitignore:26:.env.local`)
- Vite restarted + port: **no** / n/a (no `.env.local` written, so no Vite re-read)
- Fresh load: **not performed** (no auto-login env; chrome observation would be guest-only and is not a new proof)
- X-01 still parked: **yes**

## Exact remaining blocker

1. The three Runtime Secret **names** are still not injected into this agent process. Do not invent values. Do not write a partial `.env.local`.
2. Coordinator has not supplied a safe leased account tuple (`email|userId|tier|status` via `scripts/test-account-lease.mjs`) **and** a real saved `file.id`. Keep X-01 parked until both arrive. Do not stamp `file.id` on `?testPdf=`.

Goal stays open.
