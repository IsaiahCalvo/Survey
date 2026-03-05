# Codebase Structure

**Analysis Date:** 2026-03-04

## Directory Layout

```
Survey-BetaSafeS2/
├── build/                      # Electron app icons (icns, png, svg)
├── dist/                       # Vite build output (generated, gitignored partially)
├── docs/                       # Project documentation (guides, audits)
├── landing/                    # Separate landing page site (HTML/CSS, Vercel deploy)
├── public/                     # Static assets served by Vite
│   ├── ej2-pdfviewer-lib/      # Syncfusion pdfium WASM runtime
│   ├── pdf.worker.min.js       # PDF.js web worker
│   ├── paintWorker.js          # Canvas paint worker
│   └── *.png, *.ico            # Favicons and app icons
├── scripts/                    # Shell scripts for backup/restore automation
├── src/                        # Application source code
│   ├── assets/                 # SVG icons (lightbulb, rotate)
│   ├── components/             # React UI components
│   │   ├── Callout/            # Callout annotation subsystem
│   │   │   ├── CalloutCanvas.jsx
│   │   │   ├── CalloutComponent.jsx
│   │   │   ├── CalloutContextMenu.jsx
│   │   │   ├── CalloutEditModal.jsx
│   │   │   ├── index.jsx
│   │   │   └── types.js
│   │   └── *.jsx               # Feature components and modals
│   ├── contexts/               # React Context providers
│   ├── hooks/                  # Custom React hooks
│   ├── services/               # External API service modules
│   ├── shims/                  # Module shims for unused Syncfusion dependencies
│   ├── sidebar/                # PDF sidebar panel components
│   ├── types/                  # TypeScript type definitions
│   ├── utils/                  # Utility/helper modules
│   ├── workers/                # Web workers
│   ├── App.jsx                 # Main application (Dashboard + PDFViewer + App)
│   ├── App.css                 # App-level styles
│   ├── main.jsx                # React entry point
│   ├── electron-main.js        # Electron main process
│   ├── preload.js              # Electron preload script (contextBridge)
│   ├── supabaseClient.js       # Supabase client initialization
│   ├── authConfig.js           # Microsoft MSAL/Azure auth configuration
│   ├── theme.js                # Design system tokens
│   ├── Icons.jsx               # SVG icon components
│   ├── PageAnnotationLayer.jsx # Fabric.js annotation canvas system (~9.4K lines)
│   ├── PDFSidebar.jsx          # Sidebar container with tab navigation
│   ├── RegionSelectionTool.jsx # Region/space selection tool
│   ├── SpaceRegionOverlay.jsx  # Visual overlay for space regions
│   ├── TabBar.jsx              # Multi-document tab bar
│   ├── TextLayer.jsx           # PDF text layer overlay
│   ├── styles.css              # Global styles
│   └── index.css               # Base CSS reset/styles
├── supabase/                   # Supabase project configuration
│   ├── config.toml             # Supabase CLI configuration
│   ├── functions/              # Deno edge functions
│   │   ├── create-checkout-session/index.ts
│   │   ├── create-portal-session/index.ts
│   │   ├── send-email/index.ts
│   │   ├── send-profile-change-notification/index.ts
│   │   └── stripe-webhook/index.ts
│   └── migrations/             # SQL migration files (22 files)
├── tests/                      # Test files
│   ├── excelSyncDirtyState.test.mjs
│   └── pdfAnnotationImporter.test.mjs
├── index.html                  # Vite HTML entry point
├── package.json                # Project manifest
├── vite.config.js              # Vite build configuration
└── README.md                   # Project README
```

## Directory Purposes

**`src/`:**
- Purpose: All application source code
- Contains: React components, contexts, hooks, services, utilities, Electron entry points
- Key files: `App.jsx` (30,985 lines -- the core of the application), `PageAnnotationLayer.jsx` (9,425 lines -- Fabric.js annotation engine)

**`src/components/`:**
- Purpose: Reusable React UI components and feature-specific modals
- Contains: ~35 JSX files covering PDF rendering, authentication, settings, modals, overlays
- Key files:
  - `SyncfusionPDFContainer.jsx` (1,489 lines) -- Syncfusion PDF viewer wrapper
  - `AccountSettings.jsx` (974 lines) -- User account/subscription settings
  - `OneDriveFolderBrowser.jsx` (801 lines) -- OneDrive/SharePoint folder picker
  - `AuthModal.jsx` (322 lines) -- Sign in/up modal
  - `LightweightAnnotationOverlay.jsx` (342 lines) -- SVG proxy for annotations during interactions

**`src/components/Callout/`:**
- Purpose: Self-contained callout annotation subsystem
- Contains: Canvas rendering, component display, context menu, edit modal, type definitions
- Key files: `CalloutCanvas.jsx` (main canvas), `types.js` (callout data types and defaults)

**`src/contexts/`:**
- Purpose: React Context providers for shared state
- Contains: Auth, MSGraph, Annotation, Search, SurveySession (stub)
- Key files:
  - `AuthContext.jsx` (289 lines) -- Supabase auth + subscription tier
  - `MSGraphContext.jsx` (703 lines) -- Microsoft Graph OAuth + token management
  - `AnnotationContext.jsx` (340 lines) -- Performance-optimized annotation store
  - `SearchContext.jsx` (399 lines) -- PDF text search engine

**`src/hooks/`:**
- Purpose: Custom React hooks for database operations and UI state
- Contains: Database CRUD, subscription limits, zoom state, visible page tracking
- Key files:
  - `useDatabase.js` (949 lines) -- Supabase CRUD hooks: `useProjects`, `useDocuments`, `useTemplates`, `useStorage`, `useDocumentToolPreferences`
  - `useSubscriptionLimits.js` (253 lines) -- Feature limits by tier
  - `useZoomState.js` (110 lines) -- Zoom persistence
  - `useVisiblePages.js` (113 lines) -- IntersectionObserver page visibility

**`src/services/`:**
- Purpose: External API communication
- Contains: Supabase annotation sync, Microsoft Graph file operations, Excel session management
- Key files:
  - `documentAnnotationService.js` (896 lines) -- Full annotation CRUD + real-time + presence + collaborators
  - `excelGraphService.js` (607 lines) -- OneDrive/SharePoint file operations
  - `excelSessionService.js` (335 lines) -- Excel co-authoring sessions

**`src/utils/`:**
- Purpose: Pure utility functions and helper modules
- Contains: PDF processing, geometry calculations, performance tools, UI helpers
- Key files:
  - `pdfAnnotationImporter.js` (2,130 lines) -- Import annotations from existing PDFs
  - `geometryHitTest.js` (2,063 lines) -- Geometric hit testing for annotations
  - `regionMath.js` (587 lines) -- Region containment/intersection math
  - `calloutGeometry.js` (592 lines) -- Callout arrow/knee/textbox geometry
  - `geometryEraser.js` (507 lines) -- Path-based eraser operations
  - `pdfAnnotationsPdfLib.js` (506 lines) -- Save annotations into PDF via pdf-lib
  - `pdfCache.js` (315 lines) -- Page render caching
  - `fabricCustomization.js` (283 lines) -- Fabric.js control overrides

**`src/sidebar/`:**
- Purpose: PDF sidebar panel components
- Contains: Pages thumbnail panel, search panel, bookmarks panel, spaces panel
- Key files:
  - `BookmarksPanel.jsx` (2,158 lines) -- Bookmark management with drag-and-drop folders
  - `SpacesPanel.jsx` (1,401 lines) -- Spaces/regions management
  - `PagesPanel.jsx` (1,125 lines) -- Page thumbnails with reordering
  - `SearchTextPanel.jsx` (763 lines) -- Text search UI with results list
  - `DraggableBookmark.jsx`, `DraggableBookmarkFolder.jsx`, `DropSlot.jsx` -- DnD primitives

**`src/shims/`:**
- Purpose: Empty module shims for unused Syncfusion transitive dependencies
- Contains: `ej2-interactive-chat.js`, `ej2-markdown-converter.js`
- Key files: Both export empty objects to prevent import errors

**`src/types/`:**
- Purpose: TypeScript type definitions for database entities
- Contains: `database.ts` -- interfaces for UserSettings, Project, Template, Document, Space

**`src/workers/`:**
- Purpose: Web worker scripts
- Contains: `pdfRender.worker.js` -- Off-main-thread PDF page rendering

**`supabase/functions/`:**
- Purpose: Deno-based serverless edge functions
- Contains: Stripe integration (checkout, portal, webhooks), email notifications (Resend)
- Key files: `stripe-webhook/index.ts` (handles subscription lifecycle events)

**`supabase/migrations/`:**
- Purpose: PostgreSQL schema migrations
- Contains: 22 migration files defining tables, indexes, RLS policies, triggers
- Key tables: `user_subscriptions`, `usage_metrics`, `projects`, `documents`, `templates`, `document_annotations`, `document_collaborators`, `document_presence`, `survey_sessions`, `survey_items`, `connected_services`

**`scripts/`:**
- Purpose: Shell scripts for automated git backups
- Contains: `auto-backup.sh`, `backup-control.sh`, `backup-daemon.sh`, `protect-backups.sh`, `restore-backup.sh`
- Generated: No
- Committed: Yes

**`landing/`:**
- Purpose: Separate static landing page for the product
- Contains: HTML, CSS, Vercel deployment config
- Deployed independently via Vercel

## Key File Locations

**Entry Points:**
- `index.html`: Vite HTML shell, loads `src/main.jsx`
- `src/main.jsx`: React root mount, provider setup, Syncfusion license registration
- `src/electron-main.js`: Electron main process, BrowserWindow creation, IPC handlers
- `src/preload.js`: Electron preload script, `window.electronAPI` bridge

**Configuration:**
- `package.json`: Dependencies, scripts, Electron builder config
- `vite.config.js`: Vite plugins (React, nodePolyfills), path aliases for Syncfusion shims, dev server COOP headers
- `src/authConfig.js`: Azure AD/MSAL configuration (client ID, scopes, redirect URIs)
- `src/supabaseClient.js`: Supabase client initialization from env vars
- `src/theme.js`: Design system tokens (colors, typography, spacing, borders, shadows)
- `supabase/config.toml`: Supabase CLI project configuration

**Core Logic:**
- `src/App.jsx`: Dashboard (line ~2251), PDFViewer (line ~8961), App (line ~30562) -- the entire application UI and logic
- `src/PageAnnotationLayer.jsx`: Fabric.js canvas annotation engine (drawing, selection, undo/redo, context menus)
- `src/services/documentAnnotationService.js`: Supabase annotation CRUD, real-time sync, presence, collaborators
- `src/hooks/useDatabase.js`: All Supabase database hooks
- `src/contexts/AnnotationContext.jsx`: High-performance annotation store with page-level subscriptions

**Testing:**
- `tests/excelSyncDirtyState.test.mjs`: Tests for Excel sync fingerprint/dirty detection
- `tests/pdfAnnotationImporter.test.mjs`: Tests for PDF annotation import

## Naming Conventions

**Files:**
- React components: PascalCase `.jsx` (e.g., `AccountSettings.jsx`, `PDFPageCanvas.jsx`)
- Hooks: camelCase with `use` prefix `.js` (e.g., `useDatabase.js`, `useZoomState.js`)
- Services: camelCase `.js` (e.g., `excelGraphService.js`, `documentAnnotationService.js`)
- Utilities: camelCase `.js` (e.g., `calloutGeometry.js`, `regionMath.js`)
- Contexts: PascalCase with `Context` suffix `.jsx` (e.g., `AuthContext.jsx`, `SearchContext.jsx`)
- CSS: Matches component name (e.g., `App.css`, `AccountSettings.css`, `AuthModal.css`)
- Supabase functions: kebab-case directories with `index.ts` inside
- Migrations: timestamp-prefixed snake_case `.sql` (e.g., `20241230000001_create_survey_realtime_tables.sql`)

**Directories:**
- Lowercase for category directories: `components/`, `contexts/`, `hooks/`, `services/`, `utils/`, `sidebar/`
- PascalCase for feature directories: `Callout/`

**Exports:**
- Components: Default export (e.g., `export default function App()`)
- Hooks: Named exports (e.g., `export const useProjects = () => ...`)
- Services: Named exports of async functions (e.g., `export async function uploadExcelFile(...)`)
- Contexts: Named exports for providers and hooks (e.g., `export const AuthProvider`, `export const useAuth`)
- Types: Named exports of TypeScript interfaces

## Where to Add New Code

**New Feature (full feature with UI + data):**
- Primary component: `src/components/FeatureName.jsx`
- If it needs shared state: `src/contexts/FeatureContext.jsx`
- If it needs database operations: Add hooks to `src/hooks/useDatabase.js` or create `src/hooks/useFeature.js`
- If it needs external API calls: `src/services/featureService.js`
- Wire into App.jsx (which handles routing between Dashboard and PDFViewer views)

**New React Component:**
- Small/reusable UI component: `src/components/ComponentName.jsx`
- Sidebar panel: `src/sidebar/PanelName.jsx`
- Feature subsystem: `src/components/FeatureName/index.jsx` (with directory for related files)
- Associated CSS: `src/components/ComponentName.css` (co-located with component)

**New Utility Function:**
- Geometry/math: `src/utils/geometryXxx.js`
- PDF processing: `src/utils/pdfXxx.js`
- General helpers: `src/utils/helperName.js`

**New Supabase Edge Function:**
- Create directory: `supabase/functions/function-name/index.ts`
- Uses Deno runtime with ESM imports from `esm.sh`

**New Database Table:**
- Create migration: `supabase/migrations/YYYYMMDDHHMMSS_description.sql`
- Add TypeScript types: `src/types/database.ts`
- Add CRUD hooks: `src/hooks/useDatabase.js`

**New Test:**
- Location: `tests/moduleName.test.mjs`
- Uses Node.js built-in test runner (`node:test`)

## Special Directories

**`dist/`:**
- Purpose: Vite production build output
- Generated: Yes (by `npm run build`)
- Committed: Partially (some files tracked per git status)

**`node_modules/`:**
- Purpose: npm dependencies
- Generated: Yes (by `npm install`)
- Committed: No

**`supabase/.temp/`:**
- Purpose: Supabase CLI temporary state (project ref, versions)
- Generated: Yes
- Committed: Partially

**`public/ej2-pdfviewer-lib/`:**
- Purpose: Syncfusion pdfium WebAssembly runtime (pdfium.js + pdfium.wasm)
- Generated: No (vendored from Syncfusion SDK)
- Committed: Yes

**`.agent/`:**
- Purpose: AI agent skills/plans
- Generated: By AI tools
- Committed: Yes

**Important Note on Syncfusion Dependencies:**
The `@syncfusion/*` packages are linked via `file:` references to a local directory (`../Syncfusion/32.1.19/PDF Viewer SDK/JavaScript/Packages/`). This directory must exist at the sibling level of the project root for `npm install` to work. These are not published npm packages.

---

*Structure analysis: 2026-03-04*
