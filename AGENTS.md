# AGENTS.md

Project-level rules, invariants, and gotchas live in `CLAUDE.md` and `README.md`.
Read those first for code conventions and the load-bearing-file boundaries.

## Cursor Cloud specific instructions

Survey is an Electron + Vite + React desktop PDF-annotation app. In the cloud VM
there is no desktop display, so develop/test against the **web UI only**.

### Running the app (headless cloud VM)

- Use `npm run dev:ui` (Vite dev server, port 5173) and open it in a browser.
  Do **not** use `npm run dev` / `npm run dev:legacy` here — those also spawn
  Electron (`find-port.js`), which needs a display and will hang/fail.
- `.env` (Supabase URL + anon key) is created automatically by
  `scripts/bootstrap-dev-env.mjs` on `postinstall`/`predev`; no manual env setup
  is needed to boot the dev UI.

### Testing PDF rendering + annotation without auth (important)

- Uploading documents and creating projects are **hard-gated behind Supabase
  auth** — "Continue without an account" dismisses the prompt but does NOT enable
  upload. Do not sign up against the shared/production Supabase project just to
  test (it pollutes real data).
- Instead use the dev-only route that auto-opens a bundled fixture and bypasses
  auth + Supabase entirely:
  `http://localhost:5173/?testPdf=<fixture>.pdf`
  Fixtures live in `debug/fixtures/` and are served by a Vite plugin at
  `/debug-fixtures/`. Example: `http://localhost:5173/?testPdf=clickable-link-test.pdf`
  (small/fast). The PDF viewer is heavy — allow ~10-30s to render.

### Lint / test / build

- There is **no ESLint config or lint script**. The correctness gates (matching
  CI in `.github/workflows/ci.yml`) are `npm test` then `npm run build`.
- `npm test` runs the Node test runner over `tests/**` and `src/**/__tests__/**`
  (see `scripts/run-node-tests.mjs`).
- Heavier `build` (and large installs) may need more heap:
  `NODE_OPTIONS=--max-old-space-size=8192` (CI sets this for build).
- Supabase integration / privacy tests (`npm run test:integration`,
  `npm run test:privacy`) require `SUPABASE_INTEGRATION=1` and a `.env.test`; skip
  unless specifically working on those.
- Optional dead-code/dup audits: `npm run audit:code|dead|dupes|health` (fallow).
  Per `CLAUDE.md`, treat fallow findings as mostly false positives — never
  auto-delete.
