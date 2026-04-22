# Codebase Structure

**Analysis Date:** 2026-03-17

## Directory Layout

```
Survey-BetaSafeS2/
├── src/                       # React + Electron frontend source
│   ├── App.jsx                # Main orchestrator (~1.4MB, handles zoom, page mounting, sync)
│   ├── main.jsx               # React root entry, context providers
│   ├── electron-main.js       # Electron process entry point
│   ├── PageAnnotationLayer.jsx # Fabric.js canvas overlay for PDF annotations (~389KB)
│   ├── TextLayer.jsx          # Text selection overlay
│   ├── RegionSelectionTool.jsx # Region/space selection tool (~81KB)
│   ├── SpaceRegionOverlay.jsx # Space region visualization
│   ├── PDFSidebar.jsx         # Left sidebar UI
│   ├── TabBar.jsx             # Top tab navigation
│   ├── Icons.jsx              # Icon definitions (~67KB)
│   ├── preload.js             # Electron preload script for IPC
│   ├── supabaseClient.js      # Supabase client initialization
│   ├── authConfig.js          # Azure MSAL configuration
│   ├── theme.js               # Color/typography constants
│   ├── DevTestRoute.jsx       # Dev-only rapid test route (bypass auth)
│   ├── styles.css             # Global styles
│   ├── App.css                # App component styles
│   ├── index.css              # Reset styles
│   ├── components/            # React component library (42 components)
│   │   ├── SyncfusionPDFContainer.jsx  # Syncfusion viewer + zoom orchestration (~50KB)
│   │   ├── PageAnnotationLayer.jsx     # Alias to top-level PAL (component-level wrapper)
│   │   ├── LightweightAnnotationOverlay.jsx # Performance-optimized annotation display
│   │   ├── PDFPageCanvas.jsx   # Single page render with caching
│   │   ├── SearchHighlightLayer.jsx    # Highlights for search results
│   │   ├── AuthModal.jsx       # Login dialog
│   │   ├── UserMenu.jsx        # User profile dropdown
│   │   ├── AccountSettings.jsx # Account/subscription management
│   │   ├── NewColumnsModal.jsx # Excel column creation dialog
│   │   ├── ExcelLockedModal.jsx # Conflict resolution for locked Excel
│   │   ├── OneDriveFileSaveModal.jsx   # File save location picker
│   │   ├── OneDriveFolderBrowser.jsx   # Folder navigation for OneDrive
│   │   ├── TemplateOverwriteWarningModal.jsx
│   │   ├── ExcelSyncConfirmModal.jsx
│   │   ├── ConfirmDialog.jsx   # Generic confirmation dialog
│   │   ├── LocateModal.jsx     # Find annotation in document
│   │   ├── CompactColorPicker.jsx # Color selection for tools
│   │   ├── KeyboardShortcutsOverlay.jsx # Help overlay
│   │   ├── BallInCourtIndicator.jsx # Status indicator for shared documents
│   │   ├── UsageIndicator.jsx  # Subscription limits display
│   │   ├── LoadingSpinner.jsx  # Generic loading UI
│   │   ├── ErrorBoundary.jsx   # React error boundary
│   │   ├── OptionalAuthPrompt.jsx # Soft auth requirement
│   │   └── Callout/            # Callout annotation components (8 files)
│   ├── contexts/              # React Context providers (5 files)
│   │   ├── AuthContext.jsx     # User authentication + token management
│   │   ├── AnnotationContext.jsx # Page-specific annotation store (pub-sub model)
│   │   ├── MSGraphContext.jsx  # Microsoft Graph API integration
│   │   ├── SearchContext.jsx   # PDF text search state
│   │   └── SurveySessionContext.jsx # (empty)
│   ├── hooks/                 # Custom React hooks (5 files)
│   │   ├── useDatabase.js      # Supabase CRUD for projects, documents, templates, storage
│   │   ├── useSubscriptionLimits.js # Check feature access based on subscription tier
│   │   ├── useZoomState.js     # Zoom mode + scale state management
│   │   ├── useVisiblePages.js  # Track which pages are currently in viewport
│   │   └── useSurveySync.js    # (empty)
│   ├── services/              # Backend service integrations (3 files)
│   │   ├── documentAnnotationService.js # Supabase annotation CRUD, real-time sync, presence
│   │   ├── excelGraphService.js        # Microsoft Graph API for Excel/OneDrive
│   │   └── excelSessionService.js      # Office cloud session management
│   ├── sidebar/               # Sidebar panel components (7 files)
│   │   ├── PagesPanel.jsx      # Page navigator with thumbnails
│   │   ├── BookmarksPanel.jsx  # Bookmark management
│   │   ├── SpacesPanel.jsx     # Space (region) management
│   │   ├── SearchTextPanel.jsx # Full-text search UI
│   │   ├── DraggableBookmark.jsx # Individual bookmark item
│   │   ├── DraggableBookmarkFolder.jsx # Folder for organizing bookmarks
│   │   └── DropSlot.jsx        # Drag-and-drop target placeholder
│   ├── utils/                 # Utility modules (24 files)
│   │   ├── zoomController.js   # Zoom logic (fit-page, fit-width, manual)
│   │   ├── pdfCache.js         # PageRenderCache for rendered pages
│   │   ├── PDFWorkerManager.js # pdf.js worker pool management
│   │   ├── pdfAnnotations.js   # Annotation serialization
│   │   ├── pdfAnnotationsPdfLib.js # Embed annotations into PDF using pdf-lib
│   │   ├── pdfAnnotationImporter.js # Load annotations from existing PDFs
│   │   ├── pdfDebug.js         # Debug log buffer for annotation events
│   │   ├── performanceLogger.js # Timing metrics (upload, load, render, zoom)
│   │   ├── geometryHitTest.js  # Collision detection, point-on-object tests
│   │   ├── geometryEraser.js   # Eraser tool path clipping
│   │   ├── lineGeometry.js     # Line/curve calculations for connectors
│   │   ├── calloutGeometry.js  # Callout box positioning logic
│   │   ├── regionMath.js       # Region containment checks
│   │   ├── fabricCustomization.js # Fabric.js control overrides
│   │   ├── renderQueue.js      # Batch canvas render operations
│   │   ├── layerPerformance.js # Timing & profiling for canvas operations
│   │   ├── menuPositioning.js  # Context menu viewport-safe placement
│   │   ├── excelSyncDirtyState.js # Compute dirty flag for Excel sync
│   │   ├── oneDriveUtils.js    # OneDrive path parsing
│   │   ├── pageRangeParser.js  # Parse page range strings (e.g., "1-5, 10")
│   │   ├── validation.js       # Common validators (email, etc.)
│   │   ├── hooks.js            # Utility hooks
│   │   ├── useDragToReorder.js # Drag-to-reorder hook
│   │   └── debugBridge.js      # Performance mark injection
│   ├── types/                 # TypeScript type definitions
│   │   └── database.ts        # Supabase table schemas (TypeScript)
│   ├── workers/               # Web worker scripts
│   └── shims/                 # Module shims for Syncfusion
│       ├── ej2-interactive-chat.js
│       └── ej2-markdown-converter.js
├── supabase/                  # Supabase backend (migrations, functions)
│   ├── migrations/            # SQL schema migrations
│   └── functions/             # Edge functions
│       ├── stripe-webhook/    # Stripe payment events
│       ├── create-checkout-session/
│       ├── create-portal-session/
│       ├── send-email/
│       └── send-profile-change-notification/
├── public/                    # Static assets served in dev/prod
│   ├── ej2-pdfviewer-lib/     # Syncfusion PDF viewer library (external)
│   └── [other assets]
├── tests/                     # Testing
│   └── *.test.mjs             # Node.js test files (native ESM)
├── debug/                     # Development & debugging
│   ├── fixtures/              # Test PDF files
│   ├── debug-sessions/        # Recorded test runs with diffs
│   ├── lib/                   # Test utilities
│   └── playwright.config.mjs  # Playwright test configuration
├── docs/                      # Documentation
│   └── superpowers/specs/     # Design specifications
├── .planning/codebase/        # GSD codebase analysis documents
├── .agent/                    # Agent skills and context
├── .claude/                   # Claude-specific configs
├── .vscode/                   # VS Code workspace settings
├── build/                     # Build artifacts
│   ├── icon.icns             # macOS app icon
│   └── icon.png              # Windows/Linux app icon
├── dist/                      # Built Vite output (dist/index.html)
├── vite.config.js            # Vite build configuration
├── package.json              # Dependencies and scripts
├── tsconfig.json             # TypeScript config (minimal)
├── index.html                # Electron app entry HTML
└── .gitignore
```

## Directory Purposes

**src/:**
- Purpose: All source code for React UI and Electron main process
- Contains: Components, contexts, hooks, services, utilities, workers, styles
- Key files: `App.jsx` (main orchestrator), `main.jsx` (React root), `electron-main.js` (app startup)

**src/components/:**
- Purpose: Reusable React components
- Contains: UI modals, dialogs, page render components, overlays, buttons, menus
- Naming: PascalCase.jsx (e.g., `AuthModal.jsx`)
- Dependencies: Other components, contexts, services, utilities

**src/contexts/:**
- Purpose: React Context API providers for shared state
- Contains: `AuthContext` (user login), `AnnotationContext` (page annotations), `MSGraphContext` (Office API), `SearchContext` (PDF search)
- Pattern: Each context exports `[Name]Provider` component and `use[Name]` hook
- File naming: `[Feature]Context.jsx`

**src/hooks/:**
- Purpose: Custom React hooks for reusable stateful logic
- Contains: Database access (`useDatabase`), zoom state (`useZoomState`), visible pages, subscription limits
- File naming: `use[Feature].js`
- Pattern: Hooks call `useContext()` to access providers or `useSupabase` to access DB

**src/services/:**
- Purpose: Backend service integrations (no UI logic)
- Contains: Supabase annotation sync, Microsoft Graph API, Excel session management
- File naming: `[Service]Service.js`
- Pattern: Export named functions (no React dependencies)

**src/sidebar/:**
- Purpose: Left-side panel components
- Contains: Page navigator, bookmarks, spaces, search
- Naming: `[Feature]Panel.jsx` or `Draggable[Item].jsx`
- Dependencies: Drag-and-drop kit (@dnd-kit), sidebar state

**src/utils/:**
- Purpose: Non-React utility functions (geometry, PDF, rendering, etc.)
- Contains: Zoom logic, PDF caching, Fabric customization, geometry math, performance logging
- File naming: `[area][Feature].js` (e.g., `geometryHitTest.js`, `pdfAnnotations.js`)
- Pattern: Pure functions, no React imports (except where unavoidable)

**src/types/:**
- Purpose: TypeScript type definitions
- Contains: Supabase table schemas exported as TypeScript interfaces
- File naming: `[schema].ts`

**supabase/:**
- Purpose: Backend infrastructure as code
- Contains: SQL migrations defining tables, RLS policies, functions, webhooks
- Subdirectories: `migrations/` (numbered SQL files), `functions/` (Edge Functions)

**public/:**
- Purpose: Static assets served by Vite dev server and included in production build
- Contains: Images, fonts, PDF viewer library, licenses
- Served at: `/` in development and production

**tests/:**
- Purpose: Automated testing
- Contains: `.test.mjs` files using Node.js native test runner
- Pattern: One test file per feature (e.g., `pdf-render.test.mjs`, `zoom-flicker.test.mjs`)

**debug/:**
- Purpose: Development and debugging tooling
- Contains: Playwright config, test fixtures (sample PDFs), recorded debug sessions with visual diffs
- Subdirectories: `fixtures/` (test PDFs), `debug-sessions/` (timestamped test runs), `lib/` (helper utilities)

**docs/:**
- Purpose: Project documentation and specifications
- Contains: Design specs, architecture notes, user guides
- File naming: Markdown or plain text

## Key File Locations

**Entry Points:**
- `src/main.jsx`: React root initialization, context provider setup
- `src/electron-main.js`: Electron process startup, window creation, IPC handlers
- `src/App.jsx`: Main UI orchestration, PDF viewer control, page annotation mounting
- `src/DevTestRoute.jsx`: Dev-only route for testing without auth (triggered by `?testPdf=<name>`)

**Configuration:**
- `vite.config.js`: Build config, dev server settings, debug fixtures plugin
- `tsconfig.json`: TypeScript compiler options (minimal)
- `package.json`: Dependencies, scripts (dev, build, test, debug)
- `index.html`: HTML template for Electron app
- `src/authConfig.js`: Azure MSAL configuration
- `src/supabaseClient.js`: Supabase client initialization
- `src/theme.js`: Color/typography constants

**Core Logic:**
- `src/PageAnnotationLayer.jsx`: Fabric.js canvas management, annotation tools, history
- `src/components/SyncfusionPDFContainer.jsx`: Syncfusion PDF viewer, zoom orchestration
- `src/utils/zoomController.js`: Zoom logic (fit-page, fit-width, manual scaling)
- `src/contexts/AnnotationContext.jsx`: Page annotation storage and subscription model
- `src/hooks/useDatabase.js`: Supabase CRUD for projects, documents, annotations

**Testing:**
- `tests/`: Test files (.test.mjs)
- `debug/playwright.config.mjs`: Playwright configuration
- `debug/fixtures/`: Sample PDF files for testing

## Naming Conventions

**Files:**

- **React Components:** PascalCase + `.jsx` (e.g., `AuthModal.jsx`, `UserMenu.jsx`)
- **Hooks:** `use` prefix + camelCase (e.g., `useDatabase.js`, `useZoomState.js`)
- **Services:** camelCase + `Service` suffix (e.g., `documentAnnotationService.js`)
- **Utilities:** camelCase (e.g., `zoomController.js`, `geometryHitTest.js`)
- **Contexts:** PascalCase + `Context` suffix (e.g., `AuthContext.jsx`)
- **Tests:** feature name + `.test.mjs` (e.g., `zoom-flicker.test.mjs`)

**Directories:**

- **Components:** PascalCase plural (e.g., `components/`)
- **Logic grouping:** camelCase plural (e.g., `contexts/`, `hooks/`, `services/`, `utils/`)
- **Feature subdirs:** camelCase (e.g., `sidebar/`, `Callout/`)
- **Build output:** `dist/` (Vite convention)
- **Supabase:** `supabase/` containing `migrations/` and `functions/`

## Where to Add New Code

**New Feature (e.g., annotation tool, sidebar panel):**
- UI Component: `src/components/[Feature].jsx`
- Logic/hooks: `src/hooks/use[Feature].js` if stateful
- Utilities: `src/utils/[feature]*.js` for helper functions
- Tests: `tests/[feature].test.mjs`
- Styles: Co-locate in component folder or in `src/styles.css`

**New Component/Module:**
- If UI: Place in `src/components/`
- If service integration: Place in `src/services/` as `[service]Service.js`
- If state management: Place in `src/contexts/` or export hook from `src/hooks/`
- If geometry/math: Place in `src/utils/` with descriptive name

**Utilities:**
- Shared helpers: `src/utils/[category][Feature].js` (e.g., `geometryHitTest.js`)
- Geometry/math: `src/utils/` (e.g., `lineGeometry.js`, `regionMath.js`)
- PDF operations: `src/utils/pdf*.js` (e.g., `pdfAnnotations.js`, `pdfCache.js`)
- Performance: `src/utils/performanceLogger.js` or `layerPerformance.js`

**Tests:**
- Place in `tests/` directory
- Naming: `[feature].test.mjs`
- Use Playwright for browser automation, Node.js native test runner for unit tests

**Database Schema Changes:**
- Create numbered SQL migration file in `supabase/migrations/`
- Apply via Supabase CLI: `supabase migration up`
- Update TypeScript types in `src/types/database.ts`

## Special Directories

**public/:**
- Purpose: Static assets included in build
- Generated: No (hand-curated)
- Committed: Yes
- Contents: Images, fonts, external library files (Syncfusion)

**dist/:**
- Purpose: Built React app (Vite output)
- Generated: Yes (via `npm run build`)
- Committed: No (.gitignore)
- Contents: `index.html`, `index-*.js`, `index-*.css` (hashed chunks)

**node_modules/:**
- Purpose: Installed dependencies
- Generated: Yes (via `npm install`)
- Committed: No (.gitignore)
- Size: Large (includes all Syncfusion packages, dev tools)

**debug/debug-sessions/:**
- Purpose: Timestamped test run artifacts
- Generated: Yes (by test runner, `debug/lib/post-process.mjs`)
- Committed: No (gitignore)
- Contents: Video recordings, screenshots, visual diffs, console logs

**build/:**
- Purpose: App icon assets for Electron packaging
- Generated: No (hand-curated)
- Committed: Yes
- Contents: `icon.icns` (macOS), `icon.png` (cross-platform)

---

*Structure analysis: 2026-03-17*
