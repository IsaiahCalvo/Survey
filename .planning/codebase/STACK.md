# Technology Stack

**Analysis Date:** 2026-03-04

## Languages

**Primary:**
- JavaScript (ES2022+) - All application code (`.jsx`, `.js`)
- TypeScript - Supabase Edge Functions only (`supabase/functions/*/index.ts`), database types (`src/types/database.ts`)

**Secondary:**
- SQL - Database migrations (`supabase/migrations/*.sql`)
- HTML/CSS - Landing page (`landing/index.html`, `landing/styles.css`), app styles (`src/styles.css`, `src/App.css`)

## Runtime

**Environment:**
- Node.js v22+ (v22.17.0 detected on dev machine)
- Electron v25 - Desktop shell wrapping the Vite-built React app
- Deno v2 - Supabase Edge Functions runtime (`supabase/config.toml` edge_runtime)

**Package Manager:**
- npm v11.5.1
- Lockfile: `package-lock.json` (lockfileVersion 3, present)

## Frameworks

**Core:**
- React 18.2 - UI framework (JSX, functional components, hooks)
- Electron 25 - Desktop application wrapper (`src/electron-main.js`, `src/preload.js`)
- Vite 5.2 - Dev server and bundler (`vite.config.js`)

**PDF Processing:**
- Syncfusion EJ2 PDF Viewer 32.1.19 - Primary PDF rendering and annotation engine (local file: packages from `../Syncfusion/32.1.19/`)
- pdfjs-dist 3.11.174 - PDF parsing, text extraction, and worker-based rendering (`src/workers/pdfRender.worker.js`)
- pdf-lib 1.17.1 - PDF modification and annotation export (`src/utils/pdfAnnotationsPdfLib.js`)
- annotpdf 1.0.15 - Additional PDF annotation support

**Testing:**
- Node.js built-in test runner (`node --experimental-default-type=module --test`)
- Tests: `tests/*.test.mjs`

**Build/Dev:**
- @vitejs/plugin-react 4.2.1 - React JSX transform for Vite
- vite-plugin-node-polyfills 0.24.0 - Node.js API polyfills for browser (`buffer`, `stream`, etc.)
- electron-builder 24.8.0 - Electron packaging and distribution
- concurrently 8.2.0 - Run Vite dev server + Electron concurrently
- wait-on 7.0.1 - Wait for Vite dev server before launching Electron
- sharp 0.34.5 - Image processing (icon conversion)

## Key Dependencies

**Critical:**
- `@supabase/supabase-js` ^2.81.1 - Database, auth, storage, realtime, and edge function invocation (`src/supabaseClient.js`)
- `@azure/msal-browser` ^4.26.2 - Microsoft OAuth (PKCE flow) for OneDrive integration (`src/contexts/MSGraphContext.jsx`)
- `@microsoft/microsoft-graph-client` ^3.0.7 - OneDrive/SharePoint file operations (`src/services/excelGraphService.js`, `src/services/excelSessionService.js`)
- `@stripe/stripe-js` ^8.5.3 - Client-side Stripe checkout (`src/components/StripeCheckout.jsx`)
- `@syncfusion/ej2-react-pdfviewer` (local) - React wrapper for Syncfusion PDF viewer (`src/components/SyncfusionPDFContainer.jsx`)

**Data & Export:**
- `exceljs` ^4.4.0 - Excel workbook generation and manipulation
- `xlsx` ^0.18.5 - Spreadsheet parsing
- `xlsx-js-style` ^1.2.0 - Styled Excel export

**UI & Interaction:**
- `fabric` ^5.5.2 - Canvas-based drawing and annotation overlays (`src/utils/fabricCustomization.js`)
- `@dnd-kit/core` ^6.3.1 - Drag-and-drop framework
- `@dnd-kit/sortable` ^10.0.0 - Sortable lists (bookmarks, sidebar items)
- `react-window` ^2.2.1 - Virtualized list rendering for large PDFs

**Geometry & Math:**
- `polygon-clipping` ^0.15.7 - Boolean polygon operations
- `martinez-polygon-clipping` ^0.7.4 - Alternative polygon clipping algorithm

**Infrastructure:**
- `chokidar` ^5.0.0 - File system watching in Electron main process
- `isomorphic-fetch` ^3.0.0 - Cross-environment fetch API

## Configuration

**Environment:**
- `.env` file present (contains secrets - do not read)
- `.env.example` documents required variables
- Required env vars (VITE_ prefix for client-side):
  - `VITE_SUPABASE_URL` - Supabase project URL
  - `VITE_SUPABASE_ANON_KEY` - Supabase anonymous key
  - `VITE_STRIPE_PUBLISHABLE_KEY` - Stripe publishable key
  - `VITE_SYNCFUSION_LICENSE_KEY` - Syncfusion license (has fallback in `src/main.jsx`)
- Server-side secrets (Supabase Edge Function Secrets, NOT in .env):
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `STRIPE_PRO_MONTHLY_PRICE_ID`
  - `STRIPE_PRO_ANNUAL_PRICE_ID`
  - `STRIPE_ENTERPRISE_PRICE_ID`
  - `RESEND_API_KEY`
  - `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY`

**Build:**
- `vite.config.js` - Vite configuration with React plugin, node polyfills, symlink preservation for Syncfusion local packages, module shims for `ej2-interactive-chat` and `ej2-markdown-converter`
- `package.json` `"build"` section - electron-builder config for macOS (DMG), Windows (NSIS), Linux
- Output: `dist/` directory for Vite build, app packaged via `electron-builder`

**Vite Aliases:**
- `@syncfusion/ej2-interactive-chat` -> `src/shims/ej2-interactive-chat.js` (empty shim)
- `@syncfusion/ej2-markdown-converter` -> `src/shims/ej2-markdown-converter.js` (empty shim)

## Scripts

```bash
npm run dev           # Start Vite + Electron concurrently
npm run dev:ui        # Vite dev server only (port 5173)
npm run dev:electron  # Electron only (waits for Vite)
npm run build         # Vite production build -> dist/
npm run dist          # Build + electron-builder package
npm run test          # Node.js built-in test runner
```

## Platform Requirements

**Development:**
- Node.js 22+
- npm 11+
- Syncfusion local packages at `../Syncfusion/32.1.19/PDF Viewer SDK/JavaScript/Packages/` (relative to project root)
- macOS, Windows, or Linux

**Production:**
- Electron desktop app (cross-platform: macOS DMG, Windows NSIS, Linux)
- Supabase hosted backend (PostgreSQL, Edge Functions, Storage, Realtime, Auth)
- Landing page: Static HTML deployed to Vercel (`landing/vercel.json`)

---

*Stack analysis: 2026-03-04*
