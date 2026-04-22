# Technology Stack

**Analysis Date:** 2026-03-17

## Languages

**Primary:**
- JavaScript (ES6+) - React components, frontend logic, and utilities
- JSX - React component templates
- Node.js - Electron main process, build tools, CLI utilities

**Secondary:**
- CSS - Styling via Syncfusion and custom stylesheets

## Runtime

**Environment:**
- Node.js (no specific version constraint in project, typically 16+)
- Electron 25.2.1 - Desktop application runtime

**Package Manager:**
- npm (implicit from package.json)
- Lockfile: `package-lock.json` (expected, not verified)

## Frameworks

**Core UI:**
- React 18.2.0 - Frontend framework for UI components
- Syncfusion EJ2 32.1.19 - PDF Viewer and UI components
  - @syncfusion/ej2-react-pdfviewer - PDF rendering and annotation
  - 30+ Syncfusion packages for base, buttons, inputs, popups, etc.
  - Local file references: `/Syncfusion/32.1.19/PDF Viewer SDK/JavaScript/Packages/`

**Build/Dev:**
- Vite 5.2.0 - Frontend build tool and dev server (port 5173)
- @vitejs/plugin-react 4.2.1 - React support for Vite
- vite-plugin-node-polyfills 0.24.0 - Node polyfills for browser

**Desktop/Electron:**
- electron 25.2.1 - Desktop application framework
- electron-builder 24.8.0 - Packaging and distribution

**Testing:**
- Playwright 1.58.2 - End-to-end testing
  - Config: `debug/playwright.config.mjs`
  - Headless Chromium testing with 1400x900 viewport
  - 2-minute timeout per test (due to Syncfusion cold start overhead)

## Key Dependencies

**PDF & Document Processing:**
- pdfjs-dist 3.11.174 - PDF.js for text extraction and rendering
- pdf-lib 1.17.1 - PDF manipulation library
- annotpdf 1.0.15 - PDF annotation support
- exceljs 4.4.0 - Excel file reading/writing
- xlsx 0.18.5 - Excel spreadsheet library
- xlsx-js-style 1.2.0 - Excel styling

**Canvas & Graphics:**
- fabric 5.5.2 - Fabric.js for canvas annotation rendering
- martinez-polygon-clipping 0.7.4 - Polygon clipping for geometry
- polygon-clipping 0.15.7 - Polygon manipulation library

**State & Drag-and-Drop:**
- react-window 2.2.1 - Windowed list rendering for performance
- @dnd-kit/core 6.3.1 - Drag-and-drop functionality
- @dnd-kit/sortable 10.0.0 - Sortable drag-and-drop

**Authentication & External Services:**
- @azure/msal-browser 4.26.2 - Azure AD authentication for browser
- @azure/msal-node 3.8.3 - Azure AD authentication for Node (Electron main)
- @microsoft/microsoft-graph-client 3.0.7 - Microsoft Graph API client
- @supabase/supabase-js 2.81.1 - Supabase client for auth and database
- @stripe/stripe-js 8.5.3 - Stripe payment library (client-side)

**Development & Build:**
- concurrently 8.2.0 - Run dev:ui and dev:electron in parallel
- wait-on 7.0.1 - Wait for server startup during build
- chokidar 5.0.0 - File system watching
- cross-env 7.0.3 - Cross-platform environment variables
- sharp 0.34.5 - Image processing
- to-ico 1.1.5 - Icon conversion
- buffer 6.0.3 - Node buffer polyfill for browser
- stream-browserify 3.0.0 - Node stream polyfill
- events 3.3.0 - Node events polyfill
- util 0.12.5 - Node util polyfill
- ws 8.18.3 - WebSocket library
- isomorphic-fetch 3.0.0 - Cross-platform fetch

## Configuration

**Environment:**
- Uses Vite environment variables with `VITE_` prefix
- `.env` file present (not committed) - contains `VITE_SUPABASE_*` and `VITE_STRIPE_*` keys
- `.env.example` provides template for Supabase and Stripe configuration

**Build Configuration:**
- Vite: `vite.config.js`
  - Base: relative paths for Electron file:// protocol
  - Custom debug fixtures plugin serves PDFs from `debug/fixtures/`
  - Node polyfills enabled for `node:` protocol imports
  - CORS headers configured for MSAL popup authentication
  - Path aliases for Syncfusion shims

**Electron Configuration:**
- Main entry: `src/electron-main.js`
- Preload script: `src/preload.js`
- Build config in `package.json` build section
  - Platform targets: macOS (dmg), Windows (NSIS), Linux (.png)
  - ASAR packaging enabled
  - Icon: `build/icon.icns` (macOS), `build/icon.png` (Windows/Linux)

## Platform Requirements

**Development:**
- Vite dev server runs on port 5173
- Node.js (version not strictly specified)
- Platform-specific icons in `build/` directory

**Production:**
- Electron desktop application
- Distributed as platform-specific installers (dmg, NSIS, or Linux package)
- Built output: `dist/` directory
- Requires Syncfusion license key (via `VITE_SYNCFUSION_LICENSE_KEY`)

## Dependency Notes

**Syncfusion packages:** Installed as local file references from `../Syncfusion/32.1.19/` directory, not from npm registry. This is a local SDK installation with version 32.1.19.

**License Key:** Syncfusion PDF Viewer requires a valid license key registered in `src/main.jsx` via `registerLicense()`. Falls back to embedded key if `VITE_SYNCFUSION_LICENSE_KEY` not provided.

**Electron Security:** Context isolation enabled, node integration disabled. Preload script used for IPC communication.

---

*Stack analysis: 2026-03-17*
