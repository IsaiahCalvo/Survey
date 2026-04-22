# Architecture

**Analysis Date:** 2026-03-17

## Pattern Overview

**Overall:** Hybrid layered architecture combining React component tree with Fabric.js canvas annotation system, Syncfusion PDF viewer integration, and Supabase backend services. Desktop-first Electron app with web UI.

**Key Characteristics:**
- Canvas-overlay pattern: Syncfusion PDF viewer renders pages, custom Fabric.js canvas overlays provide interactive annotations
- Portal-based isolation: React portals decouple annotation layer from main React tree to prevent cascading re-renders
- Service-oriented backend: Supabase for persistence, Microsoft Graph for Office integration, Stripe for billing
- State subscription model: AnnotationContext uses pub-sub to notify only affected pages, reducing re-render costs
- Render queue system: Queues Fabric canvas renders to batch operations and prevent frame blocking

## Layers

**UI Layer (React Components):**
- Purpose: React component tree providing UI shells, dialogs, and page management
- Location: `src/components/`, `src/sidebar/`
- Contains: Modal dialogs, sidebar panels, toolbar components, menus
- Depends on: Contexts, hooks, services
- Used by: App.jsx orchestrates all components

**Annotation Canvas Layer:**
- Purpose: Fabric.js-based drawing and annotation system overlaid on PDF pages
- Location: `src/PageAnnotationLayer.jsx`, `src/TextLayer.jsx`, `src/RegionSelectionTool.jsx`
- Contains: Interactive tools (pen, shapes, callouts, regions), selection logic, geometry helpers
- Depends on: Fabric.js, geometry utilities, Fabric customization
- Used by: App.jsx mounts one per visible PDF page via React portals

**PDF Viewer Layer:**
- Purpose: Syncfusion React PDF Viewer for page rendering and zoom control
- Location: `src/components/SyncfusionPDFContainer.jsx`
- Contains: Syncfusion component, zoom state, page caching, viewport management
- Depends on: pdfjs-dist, PDF.js worker, zoom controller
- Used by: App.jsx top-level container

**Data Persistence Layer:**
- Purpose: Supabase backend integration for annotations, projects, documents
- Location: `src/services/documentAnnotationService.js`, hooks in `src/hooks/useDatabase.js`
- Contains: Annotation sync, CRUD operations, real-time subscriptions, RLS error handling
- Depends on: Supabase client
- Used by: App.jsx, components trigger sync operations

**Office Integration Layer:**
- Purpose: Microsoft Graph and Excel Services for workbook sync
- Location: `src/services/excelGraphService.js`, `src/services/excelSessionService.js`
- Contains: OneDrive file operations, Excel cell updates, session management
- Depends on: @microsoft/microsoft-graph-client, MSAL authentication
- Used by: App.jsx handles Excel sync workflow

**Authentication Layer:**
- Purpose: Auth provider and context for Supabase + Azure MSAL
- Location: `src/contexts/AuthContext.jsx`, `src/authConfig.js`
- Contains: Login/logout, token management, user state
- Depends on: @azure/msal-browser, Supabase auth
- Used by: Main.jsx wraps app tree

**State Management:**
- Purpose: Decentralized state using React Context and custom hooks
- Location: `src/contexts/`, `src/hooks/`
- Contains: AnnotationContext (page-specific annotations), AuthContext, MSGraphContext, SearchContext, database hooks
- Pattern: Page-based subscription model + memoized selectors to prevent broad re-renders
- Used by: Components subscribe to specific page or global state

## Data Flow

**PDF Annotation Workflow:**

1. User loads PDF → `App.jsx` fetches document metadata from Supabase
2. Syncfusion PDF viewer renders pages → triggers `onPageLoaded` callback
3. For each visible page, `App.jsx` mounts `PageAnnotationLayer` via React portal
4. Fabric canvas initializes on PAL mount → user can draw/annotate
5. User modifies annotation → `PageAnnotationLayer` updates Fabric objects
6. On save: `App.jsx` serializes Fabric canvas → `savePDFWithAnnotationsPdfLib()` embeds in PDF
7. Concurrent: `syncAnnotationsToSupabase()` pushes to database
8. Real-time: `subscribeToDocumentAnnotations()` receives remote changes via Supabase realtime

**Excel Sync Workflow:**

1. User selects Excel file from OneDrive → `excelGraphService.getFileId()` resolves path
2. `createWorkbookSession()` opens Excel workbook in Office cloud session
3. App parses annotations into column data → `updateCellRange()` pushes to Excel
4. On reload, `getCellRange()` pulls latest data back from Excel
5. Dirty state tracked via `computeExcelSyncFingerprint()` to prevent unnecessary uploads

**Zoom Workflow:**

1. User triggers zoom (fit page, fit width, manual) → `zoomController.createZoomController()`
2. Controller computes scale → Syncfusion PDF viewer receives scale and re-renders
3. **Critical:** During zoom, Syncfusion destroys/recreates page DOM → portal hosts must be preserved
4. Fix: `shouldFreezePortalHost` flag disables host filtering during zoom confirm window
5. After zoom confirm (3000ms): `zoomOverlayTransformActiveRef` set true, page list reordered
6. Cached fallback `syncfusionLastNonEmptyOverlayPagesRef` prevents PAL unmount when page list momentarily empty

**State Management:**

- **Annotations:** `AnnotationStore` in `AnnotationContext` maintains per-page annotation maps and subscribers
- **Presence:** `updateDocumentPresence()` sends user cursor/annotation updates to Supabase presence
- **Zoom:** `useZoomState` hook stores mode (fit-page/fit-width/manual) + scale in localStorage
- **UI state:** React useState for modals, selections, tool active states in `App.jsx`

## Key Abstractions

**Fabric Canvas Layer (PageAnnotationLayer.jsx):**
- Purpose: Wraps Fabric.js canvas with annotation-specific logic
- Pattern: Canvas initialized on mount, disposed on unmount; toolbar controls state via props
- Exports: Canvas object handles selection, serialization, undo/redo
- Key methods: `getCanvasState()`, `setCanvasState()`, `updateDrawingTool()`

**PDF Page Cache (PageRenderCache):**
- Purpose: Caches rendered PDF page canvases to avoid re-rendering on zoom/pan
- Pattern: Keyed by page number + zoom level
- Used by: `PDFPageCanvas` checks cache before calling pdf.js render

**Annotation Store (AnnotationContext):**
- Purpose: Decoupled store allowing components to subscribe to specific pages
- Pattern: Pub-sub model — pages only re-render if their annotations changed
- Methods: `getPageAnnotations(pageNum)`, `setAnnotations()`, `deleteAnnotations()`

**Zoom Controller:**
- Purpose: Encapsulates zoom logic (scale computation, mode tracking)
- Pattern: Functional factory returning `{ getScale(), setMode(), computeNewScale() }`
- Used by: App.jsx + SyncfusionPDFContainer coordinate zoom events

**Geometry Utilities:**
- Purpose: Hit testing, intersection detection, geometry operations for tools
- Location: `src/utils/geometryHitTest.js`, `src/utils/lineGeometry.js`, `src/utils/calloutGeometry.js`
- Examples: `isPointOnObject()`, `getCurvedPath()`, `calculateCalloutConnection()`

## Entry Points

**Electron Main (electron-main.js):**
- Location: `src/electron-main.js`
- Triggers: Application startup
- Responsibilities: Create BrowserWindow, handle OAuth redirects, manage app lifecycle, IPC handlers

**React Root (main.jsx):**
- Location: `src/main.jsx`
- Triggers: Vite loads index.html → renders React root
- Responsibilities: Register Syncfusion license, wrap App in AuthProvider/MSGraphProvider, suppress PDF.js warnings

**Main App Component (App.jsx):**
- Location: `src/App.jsx` (~1.4MB)
- Triggers: Mounted by main.jsx
- Responsibilities: PDF viewer orchestration, zoom logic, page annotation layer mounting, Excel sync, annotation persistence, UI state management

**Dev Test Route (DevTestRoute.jsx):**
- Location: `src/DevTestRoute.jsx`
- Triggers: `?testPdf=<name>` query param in dev environment
- Responsibilities: Bypass auth and load test PDF directly (for rapid iteration)

## Error Handling

**Strategy:** Layered error classification and graceful degradation

**Patterns:**

- **Annotation sync errors:** `classifyAnnotationSyncError()` in `documentAnnotationService.js` distinguishes RLS, schema, network, and retry-able errors
- **Portal mounting:** Try/catch in App.jsx around `createPortal()` catches portal host resolution failures, falls back to warning log
- **Fabric canvas:** Error handler on canvas events logs to `pdfDebug` system instead of crashing
- **PDF loading:** Syncfusion `onLoadFailed` callback handles corrupted/missing PDFs, shows user-friendly modal
- **Excel operations:** Try/catch around Graph API calls returns `{ data: null, error }` tuples

## Cross-Cutting Concerns

**Logging:**
- Development: `debugLog()` in `src/utils/pdfDebug.js` writes to in-memory buffer and console
- Production: Performance metrics via `src/utils/performanceLogger.js` tracks upload, load, render, zoom timings
- Electron: `console.log/error` goes to Electron main process logs

**Validation:**
- URL validation in `electron-main.js` OAuth redirect handler
- Annotation schema validation in `documentAnnotationService.js` before upsert
- Excel range validation in `excelSessionService.js` before cell updates
- Utility: `src/utils/validation.js` exports common validators

**Authentication:**
- Azure MSAL handled in `AuthContext.jsx` — acquires tokens, handles popup consent
- Supabase auth via MSAL token exchange
- Preload script (`preload.js`) exposes safe IPC methods to renderer

**Performance:**
- Render queue in `src/utils/renderQueue.js` batches canvas renders
- Layer performance tracking in `src/utils/layerPerformance.js` monitors Fabric re-renders
- React.memo used throughout component tree to prevent cascading re-renders
- Page virtualization via react-window for large PDFs

---

*Architecture analysis: 2026-03-17*
