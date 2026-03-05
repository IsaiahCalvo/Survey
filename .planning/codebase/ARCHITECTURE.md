# Architecture

**Analysis Date:** 2026-03-04

## Pattern Overview

**Overall:** Monolithic Single-Page Application with Electron wrapper

**Key Characteristics:**
- React 18 SPA with a massive single-file App.jsx (~31K lines) containing the Dashboard and PDFViewer as inner components
- Electron shell for desktop distribution with a Vite-based web build
- Supabase backend for auth, database, real-time sync, and edge functions
- Microsoft Graph API integration for OneDrive/SharePoint Excel co-authoring
- Syncfusion EJ2 PDF Viewer SDK for PDF rendering with a custom annotation overlay system using Fabric.js
- Context-based state management (no Redux/Zustand) with a custom subscription-based AnnotationStore

## Layers

**Electron Shell:**
- Purpose: Desktop app wrapper providing native file system access, OAuth windows, and file watchers
- Location: `src/electron-main.js`, `src/preload.js`
- Contains: Window management, IPC handlers for file dialogs, file read/write, file watchers, OAuth popup windows
- Depends on: Nothing in React layer
- Used by: React layer via `window.electronAPI` (contextBridge)

**React UI (Presentation + Logic):**
- Purpose: The entire client-side application -- PDF viewing, annotation, survey, template management, dashboard
- Location: `src/App.jsx` (primary), `src/components/`, `src/sidebar/`
- Contains: Two mega-components defined inside `src/App.jsx`:
  - `Dashboard` (line ~2251) -- project/template management, document list, settings
  - `PDFViewer` (line ~8961) -- PDF rendering, annotation tools, survey mode, Excel sync, undo/redo, zoom, spaces/regions
  - `App()` (line ~30562) -- top-level router/tab manager
- Depends on: Contexts, hooks, services, utils
- Used by: Entry point `src/main.jsx`

**Contexts (State Providers):**
- Purpose: Shared application state via React Context API
- Location: `src/contexts/`
- Contains:
  - `AuthContext.jsx` -- Supabase auth, subscription tier, sign-in/out/up methods, Google OAuth, SSO
  - `MSGraphContext.jsx` -- Microsoft Graph API auth, OAuth PKCE flow, token refresh, graph client management
  - `AnnotationContext.jsx` -- High-performance annotation store using subscription model (class-based `AnnotationStore` with page-level subscriptions via `useSyncExternalStore`)
  - `SearchContext.jsx` -- PDF text search with progressive results, page data caching, result navigation
  - `SurveySessionContext.jsx` -- Empty/stub file (1 line)
- Depends on: `src/supabaseClient.js`, `src/authConfig.js`
- Used by: All UI components

**Custom Hooks:**
- Purpose: Reusable stateful logic for database operations, subscriptions, zoom, and visible page tracking
- Location: `src/hooks/`
- Contains:
  - `useDatabase.js` (949 lines) -- CRUD hooks for projects, documents, templates, storage, tool preferences via Supabase
  - `useSubscriptionLimits.js` -- Tier-based feature gating (free/pro/enterprise limits)
  - `useZoomState.js` -- Zoom level management with persistence
  - `useVisiblePages.js` -- IntersectionObserver-based visible page tracking
  - `useSurveySync.js` -- Empty/stub file (1 line)
- Depends on: Contexts, supabaseClient
- Used by: App.jsx, components

**Services:**
- Purpose: External API interaction layer
- Location: `src/services/`
- Contains:
  - `documentAnnotationService.js` (896 lines) -- Supabase CRUD for annotations, real-time subscriptions (postgres_changes), presence tracking, collaborator management (document + project level)
  - `excelGraphService.js` (607 lines) -- Microsoft Graph API calls for OneDrive/SharePoint file operations (upload, download, list, metadata, ETag tracking)
  - `excelSessionService.js` (335 lines) -- Excel workbook session management for real-time co-authoring via Graph API
- Depends on: `src/supabaseClient.js`, Microsoft Graph client
- Used by: App.jsx (PDFViewer)

**Utilities:**
- Purpose: Pure functions and helper modules
- Location: `src/utils/`
- Contains:
  - PDF utilities: `pdfAnnotationImporter.js`, `pdfAnnotations.js`, `pdfAnnotationsPdfLib.js`, `pdfCache.js`, `pdfDebug.js`, `PDFWorkerManager.js`
  - Geometry: `calloutGeometry.js`, `geometryEraser.js`, `geometryHitTest.js`, `lineGeometry.js`, `regionMath.js`
  - UI helpers: `fabricCustomization.js`, `menuPositioning.js`, `zoomController.js`, `renderQueue.js`, `layerPerformance.js`
  - Data helpers: `excelSyncDirtyState.js`, `oneDriveUtils.js`, `pageRangeParser.js`, `validation.js`, `hooks.js`
  - Performance: `performanceLogger.js`
- Depends on: External libraries (pdf-lib, pdfjs-dist, fabric)
- Used by: App.jsx, PageAnnotationLayer, components

**Annotation Layer:**
- Purpose: Canvas-based annotation system for PDF pages using Fabric.js
- Location: `src/PageAnnotationLayer.jsx` (9425 lines), `src/components/Callout/` (callout subsystem)
- Contains: Fabric.js canvas management, drawing tools (rectangle, circle, line, polyline, pencil, eraser, text, callout), object selection, context menus, arrowheads, undo/redo integration
- Depends on: Fabric.js, geometry utils, callout geometry
- Used by: PDFViewer in App.jsx

**Supabase Backend:**
- Purpose: Serverless backend -- auth, database, real-time, edge functions
- Location: `supabase/`
- Contains:
  - `migrations/` -- 22 SQL migration files defining schema (users, subscriptions, projects, documents, templates, annotations, collaborators, presence, survey sessions/items, connected services)
  - `functions/` -- 5 Deno-based edge functions:
    - `create-checkout-session/` -- Stripe checkout session creation
    - `create-portal-session/` -- Stripe customer portal
    - `stripe-webhook/` -- Stripe webhook handler for subscription events
    - `send-email/` -- Email notifications via Resend API
    - `send-profile-change-notification/` -- Profile change email alerts
- Depends on: Stripe SDK, Resend SDK, Supabase service role
- Used by: Client via Supabase JS SDK, Stripe via webhooks

**Design System:**
- Purpose: Centralized design tokens
- Location: `src/theme.js` (247 lines)
- Contains: COLORS, TYPOGRAPHY, SPACING, BORDERS, SHADOWS, TRANSITIONS, Z_INDEX, LAYOUT constants
- Depends on: Nothing
- Used by: App.jsx, components (via imports)

## Data Flow

**PDF Document Lifecycle:**

1. User selects PDF via file dialog (Electron) or drag-and-drop (browser)
2. `App.handleDocumentSelect()` creates a tab and sets the active PDF file
3. `PDFViewer` component receives the file, loads it via `pdfjs-dist`
4. Syncfusion `PdfViewerComponent` renders pages in `SyncfusionPDFContainer`
5. `PageAnnotationLayer` overlays Fabric.js canvases on each visible page for annotation drawing
6. `LightweightAnnotationOverlay` provides a lightweight SVG-based proxy during interactions (zoom/scroll) for performance
7. Annotations are stored in component state and optionally synced to Supabase via `documentAnnotationService`
8. PDF can be saved with annotations embedded via `pdfAnnotationsPdfLib.js` (using pdf-lib)

**Survey/Excel Sync Flow:**

1. User creates a survey template with modules, categories, and checklist items (Dashboard)
2. User opens a PDF in survey mode, linking it to a template
3. User creates highlight annotations on PDF pages, assigning them to categories
4. Annotations are exported to Excel format using ExcelJS
5. Excel file is uploaded to OneDrive via `excelGraphService`
6. Live sync is attempted via `excelSessionService` (workbook sessions, requires M365 Business)
7. Changes in the app are pushed to OneDrive; ETag-based change detection tracks external modifications

**Authentication Flow:**

1. `AuthProvider` wraps entire app, manages Supabase auth state
2. `MSGraphProvider` wraps app below auth, manages Microsoft Graph tokens
3. Supabase auth: email/password, Google OAuth, SSO -- session stored in localStorage
4. Microsoft auth: PKCE OAuth flow via popup (Electron) or redirect (browser)
5. MS tokens stored in Supabase `connected_services` table, refreshed every 10 minutes
6. Subscription tier fetched from `user_subscriptions` table, gates features

**Real-time Collaboration:**

1. When a document is opened, presence is updated via `updateDocumentPresence()`
2. Annotation changes are synced to `document_annotations` table
3. Supabase Realtime subscriptions (`postgres_changes`) push updates to other clients
4. `subscribeToDocumentAnnotations()` receives INSERT/UPDATE/DELETE events
5. Local state is reconciled with remote changes

**State Management:**
- Primary state: React useState/useRef inside App.jsx (monolithic)
- Annotation state: `AnnotationStore` class with page-level subscriptions (`useSyncExternalStore`)
- Auth state: React Context (`AuthContext`, `MSGraphContext`)
- Search state: React Context (`SearchContext`)
- Database state: Custom hooks (`useDatabase.js`) with local useState + Supabase queries
- Preferences/settings: localStorage for zoom, view mode, debug flags

## Key Abstractions

**Tab System:**
- Purpose: Multi-document interface with Home tab + PDF tabs
- Examples: `src/App.jsx` (App function, lines 30562+)
- Pattern: Array of `{ id, name, file, isHome }` objects, with `activeTabId` controlling which view is rendered. `TabBar` component at `src/TabBar.jsx`.

**Template System:**
- Purpose: Reusable survey configurations with modules (sheets), categories (groups), and checklist items
- Examples: `src/App.jsx` (Dashboard component), `src/hooks/useDatabase.js` (useTemplates hook)
- Pattern: Templates are stored in Supabase and cached locally. Each template has modules containing categories with checklist items. Templates drive Excel export structure.

**Spaces & Regions:**
- Purpose: Named page groupings with optional rectangular regions for spatial organization
- Examples: `src/SpaceRegionOverlay.jsx`, `src/RegionSelectionTool.jsx`, `src/sidebar/SpacesPanel.jsx`
- Pattern: Spaces group pages and optionally define sub-regions on pages. Used for organizing survey work by area of a construction document.

**Dual-Layer Rendering:**
- Purpose: Performance optimization for PDF annotation display during interactions
- Examples: `src/components/LightweightAnnotationOverlay.jsx`, `src/components/SyncfusionPDFContainer.jsx`
- Pattern: Full Fabric.js canvases are used for editing. During scroll/zoom interactions, a lightweight SVG proxy replaces them to prevent jank. Pages outside the visible window are proxied to limit DOM weight.

**Callout System:**
- Purpose: Arrow-with-textbox annotation tool
- Examples: `src/components/Callout/` (CalloutCanvas, CalloutComponent, CalloutContextMenu, CalloutEditModal, types)
- Pattern: React-based rendering (not Fabric.js). Each callout has arrowTip, knee, and textBox positions stored as percentages of page dimensions. Connection geometry calculated by `src/utils/calloutGeometry.js`.

## Entry Points

**Web (Vite Dev Server / Production Build):**
- Location: `index.html` -> `src/main.jsx`
- Triggers: Browser navigation / Electron `loadURL`
- Responsibilities: Registers Syncfusion license, sets up provider hierarchy (ErrorBoundary > AuthProvider > MSGraphProvider > App + KeyboardShortcutsOverlay), mounts React root

**Electron Main Process:**
- Location: `src/electron-main.js`
- Triggers: `electron .` or packaged app launch
- Responsibilities: Creates BrowserWindow, sets up IPC handlers for file system operations, handles OAuth redirect interception, manages file watchers, before-quit save hooks

**Electron Preload:**
- Location: `src/preload.js`
- Triggers: Loaded by Electron before renderer
- Responsibilities: Exposes safe IPC bridge via `window.electronAPI` (contextBridge). Provides: openFile, saveFile, readFile, writeFile, fileExists, getFileStats, startFileWatcher, openOAuthWindow, etc.

**Supabase Edge Functions:**
- Location: `supabase/functions/*/index.ts`
- Triggers: HTTP requests (Supabase function invocations, Stripe webhooks)
- Responsibilities: Stripe checkout/portal session creation, webhook event processing, email sending via Resend

## Error Handling

**Strategy:** Defensive try/catch with console logging. No centralized error reporting service.

**Patterns:**
- `ErrorBoundary` component wraps entire app (`src/components/ErrorBoundary.jsx`)
- Supabase operations return `{ data, error }` tuples; errors are logged and state falls back to defaults
- Microsoft Graph operations throw errors that are caught by callers with user-facing error messages
- Annotation sync errors are classified (`classifyAnnotationSyncError`) into retryable vs non-retryable categories (RLS, schema missing, not found)
- Token refresh failures are tracked with cooldown/block timers to prevent infinite retry loops

## Cross-Cutting Concerns

**Logging:** Console-based (`console.log`, `console.error`, `console.warn`). Custom debug utilities at `src/utils/pdfDebug.js` and `src/utils/performanceLogger.js` with toggleable debug mode via localStorage/sessionStorage flags.

**Validation:** `src/utils/validation.js` (277 lines) provides input validation helpers. No schema-level validation library (no Zod/Yup). Supabase RLS policies enforce row-level security on all tables.

**Authentication:** Supabase Auth (email/password, Google OAuth, SSO) via `AuthContext`. Microsoft Graph OAuth PKCE via `MSGraphContext`. Feature gating by subscription tier (`free`, `pro`, `enterprise`, `developer`).

**Offline Support:** Graceful degradation -- `supabaseClient.js` exports `isSupabaseAvailable()` which returns false when env vars are missing. All auth/database hooks check this before making requests. The app works locally without Supabase for basic PDF viewing/annotation.

---

*Architecture analysis: 2026-03-04*
