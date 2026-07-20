# Technology Stack

**Analysis Date:** 2026-07-19 (rewritten from `package.json`; prior 2026-03-17 sheet was Syncfusion-era and is obsolete)

## Languages

**Primary:**
- JavaScript (ES6+) — React components, Electron main, utilities
- JSX — React component templates
- Node.js — Electron main process, build tools, CLI utilities, test runner

**Secondary:**
- CSS — custom stylesheets (no Syncfusion CSS)
- SQL — Supabase migrations under `supabase/migrations/`

## Runtime

**Environment:**
- Node.js (project does not pin an engines field; use a current LTS)
- Electron **43.0.0** — desktop application runtime

**Package Manager:**
- npm with `package-lock.json`

## Frameworks

**Core UI:**
- React **18.2.0** + react-dom
- Owned PDF viewer via **pdfjs-dist ^6.1.200** (`PdfjsViewerContainer.jsx`)
- Fabric.js **7.4.0** — eraser canvas only on the live path
- Capacitor (`@capacitor/core`, `ios`, `android`) for mobile shells

**Build/Dev:**
- Vite **8.1.3** + `@vitejs/plugin-react`
- electron-builder **26.15.3**
- wait-on (Electron waits for Vite in `dev:electron`)

**Testing:**
- Node built-in test runner (`npm test` → `scripts/run-node-tests.mjs`)
- Playwright **^1.58.2** — `debug/playwright.config.mjs` (scenario e2e)

## Key Dependencies

**PDF & Document Processing:**
- `pdfjs-dist` — page render + text/link layers
- `pdf-lib` — PDF manipulation / export
- `exceljs` — Excel read/write (Excel sync)

**Canvas & Graphics:**
- `fabric` 7.4.0 — `FabricEraserCanvas` (+ legacy PAL path)
- `martinez-polygon-clipping` — geometry

**CRDT / sync:**
- `yjs`, `y-protocols`, `y-indexeddb` — annotation CRDT dual-write

**Auth & External Services:**
- `@supabase/supabase-js` — auth + database
- `@azure/msal-browser`, `@azure/msal-node`, `@microsoft/microsoft-graph-client` — Microsoft / OneDrive
- Stripe via Supabase edge functions (`create-checkout-session`, `create-portal-session`, `stripe-webhook`) — **no** `@stripe/stripe-js` client dependency

**UI utilities:**
- `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`

**Removed (do not reintroduce):**
- All `@syncfusion/ej2-*` packages and `public/ej2-pdfviewer-lib`
- `annotpdf`, `FabricDrawingCanvas`, `FabricEditCanvas`, `AnnotationContext`

## Configuration

**Environment:**
- Vite `VITE_*` vars from `.env` / `.env.local`
- `npm install` / `postinstall` runs `scripts/bootstrap-dev-env.mjs` to seed public Supabase keys into `.env`
- `.env.example` documents Supabase + Stripe server keys
- Dev auto-login needs `.env.local`: `VITE_DEV_AUTO_LOGIN_EMAIL`, `VITE_DEV_AUTO_LOGIN_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY` (see `AGENTS.md`)

**Build Configuration:**
- `vite.config.js` — relative base for Electron `file://`, debug-fixtures middleware, MSAL CORS headers
- Electron main: `src/electron-main.js`, preload: `src/preload.js`

## Platform Requirements

**Development:**
- Vite on port 5173 (`npm run dev:ui` or `npm run dev` with Electron)
- No Syncfusion license key required

**Production:**
- Electron installers via `npm run dist`
- Web `dist/` also feeds Capacitor (`npm run mobile:sync`)
- One bundle serves web, Electron (`file://`), and Capacitor origins — edge CORS `*` is intentional

---

*Stack analysis: 2026-07-19*
