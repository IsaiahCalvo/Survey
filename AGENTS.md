# AGENTS.md

Project overview, architecture, standard commands, and hard invariants live in
`README.md` and `CLAUDE.md` — read those first. This file only adds guidance for
automated/cloud agents.

## Cursor Cloud specific instructions

Survey is an Electron + React + Vite desktop app for PDF annotation, backed by
Supabase (auth + database). Standard commands are in `README.md` / `package.json`
(`npm install`, `npm test`, `npm run build`). There is no lint script; the closest
checks are the optional Fallow audits (`npm run audit:code|dead|dupes|health`).

Environment setup (`npm install`) is handled by the startup update script. `npm install`
runs `scripts/bootstrap-dev-env.mjs` (via `postinstall`), which auto-creates a gitignored
`.env` holding the public Supabase URL + anon key. You do not need to create `.env` yourself.

### Running the app in a headless VM
- Use `npm run dev:ui` (plain Vite on http://localhost:5173) — NOT `npm run dev`.
  `npm run dev` (`find-port.js`) also spawns Electron, which needs a display and will
  not run cleanly headless. The web dev server exposes the full app on port 5173.
- The Vite port can shift if 5173 is taken; confirm the actual port from Vite's output.

### Auth is captcha-gated — use the no-auth dev route to exercise core features
- The core PDF upload/annotation flows require a signed-in Supabase user. Both sign-up
  and sign-in are protected by a Cloudflare Turnstile CAPTCHA that Supabase enforces
  **server-side** (verified: the `/auth/v1/signup` endpoint returns
  `captcha_failed: no captcha_token found`). The Turnstile widget cannot produce a valid
  token in the cloud VM browser, so account creation and password login are blocked here.
  "Continue without an account" (guest mode) loads the app shell but blocks PDF uploads.
- To exercise the core PDF/annotation engine WITHOUT auth, use the dev-only test route:
  `http://localhost:5173/?testPdf=<fixture.pdf>` — e.g. `?testPdf=clickable-link-test.pdf`.
  It loads a fixture from `debug/fixtures/` straight into the full editor with mock auth
  (`tier: 'developer'`, all annotation tools unlocked) and no Supabase. Fixtures are served
  by a dev Vite middleware at `/debug-fixtures/`. Other dev routes: `?hubPreview=1` (home
  redesign with mock data) and `?spike=renderer|perfgate|features` (throwaway PDF-render
  prototypes). These routes only exist when running the Vite dev server (`import.meta.env.DEV`).
- To drive the REAL auth-gated flows in dev, the intended bypass is the dev auto-login in
  `src/contexts/AuthContext.jsx`: set `VITE_DEV_AUTO_LOGIN_EMAIL` (an existing user),
  `VITE_DEV_AUTO_LOGIN_PASSWORD`, and `SUPABASE_SERVICE_ROLE_KEY` in a gitignored
  `.env.local`. On captcha failure the app falls back to the Vite `/__dev-auth/session`
  plugin, which mints a service-role magic link and verifies it (captcha-free). Without the
  service-role key this fallback is disabled and auth-gated flows cannot run in the VM.

### Tests
- `npm test` runs the Node built-in test runner over `tests/**` and `src/**/__tests__/**`
  (`.test.mjs`). It needs no network or Supabase and passes offline.
- `npm run test:integration` / `test:privacy` need a Supabase service key in `.env.test`
  (see `.env.test.example`) and will not run without it.

### Claude Code hook paths
- `.claude/settings.json` runs PreToolUse/PostToolUse hooks. The hook commands invoke
  `.claude/hooks/*.py` via a path relative to the project root (Claude Code / the agent
  harness runs hooks with the repo root as cwd), so they resolve on any machine. If a hook
  ever fails with "can't open file ... .claude/hooks/...", it means the invocation path
  drifted from the repo root — fix the path in `.claude/settings.json`, don't disable the guard.
