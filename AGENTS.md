# Survey BetaSafeS2 — Agent Instructions (Codex / non-Claude agents)

Distilled from CLAUDE.md 2026-07-10 (Claude-specific hook/memory sections omitted — do not
assume `~/.claude` loads for you). Full history and gotchas live in CLAUDE.md if you need depth.

## Correctness invariants — DO NOT BREAK

- **Canvas sizing uses container-aware measurement, never `pageSize * scale`.** Measure
  `containerEl.offsetWidth / pageSize.width` for `effectiveScale` (Electron/browser zoom factor
  mismatch). Applies to FabricEraserCanvas and any future canvas component.
  (FabricDrawingCanvas / FabricEditCanvas were deleted in 2026-07 — do not recreate them.)
- **SVG viewBox owns all zoom scaling.** Never reintroduce JavaScript zoom coordination in
  `src/components/SVGAnnotationLayer.jsx`.
- **Never remove or rename the `zoomGeneration` signal** — all mounted canvas components watch
  it to auto-commit in-progress work at zoom start.
- **Fabric.js Textbox `fontFamily` must be a single font name** (e.g. `"Helvetica"`), never a
  CSS fallback stack — stacks cause progressive cursor drift.
- **Edge-function CORS `Access-Control-Allow-Origin: '*'` is INTENTIONAL — do not tighten.**
  One bundle serves web, Electron (`file://`), and Capacitor origins; auth is Bearer-JWT, so
  the wildcard is non-exploitable. Investigated + closed 2026-07-05.

## High-risk files (minimum viable diff; never refactor in passing)

- `src/PDFViewer.jsx` (~34k lines — viewer lifecycle, save/sync, history engine; highest risk)
- `src/PageAnnotationLayer.jsx` (~10k lines — per-page Fabric.js overlay; legacy/`?renderer=canvas` path)
- `src/components/FabricEraserCanvas.jsx` (uses `zoomGeneration`; Drawing/Edit canvases deleted)
- `src/components/SVGAnnotationLayer.jsx` / `PdfjsViewerContainer.jsx` (view truth + pdf.js engine)
- `src/viewerShared.js` (imported by both big files — run build + tests after any change)
- `package.json` / `vite.config.js` (infra — document the why)

## Required verification

- Run `npm test` after touching any high-risk file; report baseline state before declaring done.
- Gate deletions and risky changes behind `npx vite build` + `node scripts/run-node-tests.mjs`.
- Verify user-visible changes in the running app before calling them done.

## Shared test-account leases

- The monitoring/coordinator task must atomically reserve every exact existing account a task
  needs before any real-auth test. Identify each by both email and Supabase user ID, never by
  array position. Example:
  `node scripts/test-account-lease.mjs assign --task KAL-500 --account
  'bot-a@example.test|<USER_ID>|free|active' --account
  'bot-b@example.test|<USER_ID>|developer|active'`.
- Workers must not create accounts, use Gmail plus-aliases, read `.bot-credentials.json`, or
  select/switch accounts themselves. Account provisioning is disabled unless the coordinator
  supplies the script's exact explicit opt-in.
- Run real-auth test commands through
  `node scripts/test-account-lease.mjs run --task <TASK> --lease-token <TOKEN> -- <COMMAND>`.
  Official real-auth harnesses fail closed unless this verifies the complete shared bundle.
- Only one leased test command may run per task. An interrupted command leaves a process lock;
  only the coordinator may recover it after verifying the recorded PID is dead.
- Before release, remove the task's exact documents, shares, invites, collaborators, storage
  objects, and temporary users; restore every leased account's recorded baseline tier/status.
  The monitor must attest the exact restored email/user ID/tier/status bundle with
  `attest-cleanup` before `release` will work.
- The monitoring/coordinator task owns assignment, interrupted-run recovery, cleanup attestation,
  and release. Workers must stop if any lease check or exact identity differs.
- These locks make every official test entry point fail closed. Because all agents run as the
  same unrestricted macOS user, OS-level protection against a deliberately malicious direct
  file/cloud access bypass is not possible; such a bypass is forbidden and must be reported.

## Codebase navigation (graphify)

- For codebase questions run `graphify query "<question>"` first (graphify-out/graph.json
  exists); `graphify path "<A>" "<B>"` for relationships, `graphify explain "<concept>"` for
  concepts. Read graphify-out/GRAPH_REPORT.md only for broad architecture review.
- After modifying code, run `graphify update .` (AST-only, no API cost).

## Cloud agent setup

Project overview, architecture, standard commands, and hard invariants live in
`README.md` and `CLAUDE.md` — read those first. The guidance below is for
automated/cloud agents.

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
  redesign with mock data) and `?spike=features` (throwaway FeatureSpike prototype).
  These routes only exist when running the Vite dev server (`import.meta.env.DEV`).
- To drive the REAL auth-gated flows in dev, use the dev auto-login in
  `src/contexts/AuthContext.jsx`. It needs `VITE_DEV_AUTO_LOGIN_EMAIL` (an existing user),
  `VITE_DEV_AUTO_LOGIN_PASSWORD`, and (for the captcha fallback) `SUPABASE_SERVICE_ROLE_KEY`.
  On boot it calls `signInWithPassword`; on a captcha error it falls back to the Vite
  `/__dev-auth/session` plugin, which mints a service-role magic link and verifies it
  (captcha-free). Verified working: this signs in as the real user and loads documents
  from Supabase.
  - **These must live in a gitignored `.env.local`, NOT just as process env vars.** Vite
    only exposes `VITE_*` vars to the browser (`import.meta.env`) when they come from a
    `.env` file, so the injected process-env secrets alone do not reach the client and
    auto-login silently no-ops (profile stays guest "You"). Write them to `.env.local`:
    `VITE_DEV_AUTO_LOGIN_EMAIL`, `VITE_DEV_AUTO_LOGIN_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY`.
  - **Gotcha:** if a secret value arrives wrapped in literal quotes (e.g. the service-role
    key came through as `"eyJ..."`), strip the surrounding quotes. `.env.local` values are
    fine quoted (dotenv strips them), but a quoted value left in process env is passed
    through verbatim by the dev-auth plugin and Supabase rejects it as "Invalid API key".
  - After creating/editing `.env.local`, restart the Vite dev server so it re-reads env.
    Do this from a stable shell and then do a FRESH full page load — restarting Vite while a
    tab is open can leave a stale module graph ("Failed to fetch dynamically imported module
    .../PDFViewer.jsx"); a clean reload fixes it.

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
