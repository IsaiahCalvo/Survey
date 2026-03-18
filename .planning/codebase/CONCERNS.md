# Codebase Concerns

**Analysis Date:** 2026-03-17

## Tech Debt

**App.jsx monolithic component:**
- Issue: Main component is 32,262 lines with 227 useState calls, excessive complexity and tight coupling
- Files: `src/App.jsx`
- Impact: Difficult to test, maintain, and modify; every state change requires navigation through massive file; high risk of unintended side effects
- Fix approach: Break into domain-specific feature modules (AnnotationManager, PDFDocumentManager, ExcelSyncManager, etc.); extract state management into custom hooks or context providers; consider extracting each major feature area into separate components

**PageAnnotationLayer complexity:**
- Issue: 9,757 lines with Fabric.js canvas management, annotation rendering, and input handling tightly coupled
- Files: `src/PageAnnotationLayer.jsx`
- Impact: Hard to debug, test, or extend annotation features; performance optimizations hidden within massive component
- Fix approach: Separate canvas initialization, event handlers, and annotation rendering into utility modules; create dedicated managers for each annotation type (highlights, shapes, callouts, eraser)

**Hardcoded Azure credentials in authConfig:**
- Issue: Client ID explicitly visible in source code at `src/authConfig.js:16`
- Files: `src/authConfig.js`
- Impact: Credentials are committed to repository; easy to expose in builds and distributions; should use environment variables
- Fix approach: Move `clientId` and `authority` to `.env` variables; load from `import.meta.env.VITE_*`; ensure `.env` is in `.gitignore`

**localStorage/sessionStorage used without error handling:**
- Issue: Scattered JSON.parse/stringify calls without try-catch; storage quota not checked; usage pattern inconsistent
- Files: `src/App.jsx` (lines 1623, 1638, 1648, 1658, 1687, 1699, 1711, 1724, 4069 and more), `src/supabaseClient.js`
- Impact: Can crash on corrupted data or full storage quota; silent failures when storage disabled in private mode; data loss without visibility
- Fix approach: Create `useLocalStorage` hook with serialization error handling; add quota check before writes; provide user feedback on storage issues; prefer Supabase for persistent data

**Excessive conditional renders with refs:**
- Issue: 615+ hook uses (ref/useCallback/useMemo/useEffect) in App.jsx with many ref mutations (`.current = ...`) creating implicit dependencies
- Files: `src/App.jsx` (lines 2063, 2194, 5250-5253, 9122, 9223, 9249-9271 and more)
- Impact: Fragile state synchronization; easy to miss dependency array updates; refs can become stale unexpectedly; debug nightmare for render issues
- Fix approach: Audit all refs for necessary mutations; convert to proper state where possible; ensure all refs have documented lifetime and dependencies

**No ESLint or Prettier configuration:**
- Issue: No `.eslintrc`, `.prettierrc`, or format/lint config found in project root
- Files: Project root
- Impact: Code style inconsistent across contributors; no type safety enforcement; linting rules undefined; unused variables and imports can accumulate
- Fix approach: Set up ESLint with React plugin (`@eslint/js`, `eslint-plugin-react`); add Prettier for formatting; create `.prettierrc` and `.eslintrc.json`; add pre-commit hook

## Known Bugs

**Zoom flicker on Syncfusion PDF viewer:**
- Symptoms: Brief visual glitch when zooming, overlay/annotation layer disconnects momentarily
- Files: `src/App.jsx` (zoom logic ~11685, ~9013), `src/components/SyncfusionPDFContainer.jsx`
- Trigger: All 6 zoom methods (zoom-in, zoom-out, zoom to fit, zoom to page, zoom to width, zoom to height)
- Workaround: Three fixes in place but fragile: first-zoom defer reorder, cached page list fallback, filter bypass during freeze; breaks if Syncfusion DOM structure changes

**Unhandled JSON parse errors:**
- Symptoms: App crashes or silently fails when corrupted annotation data loaded from localStorage
- Files: `src/App.jsx` (lines 1623, 1687, 1699, 1724), `src/utils/pdfAnnotationImporter.js`
- Trigger: Corrupted localStorage data, manual editing of localStorage, storage quota exceeded
- Workaround: None; relies on data validity assumption

**OAuth hash injection vulnerability in Electron:**
- Symptoms: Potential for XSS if attacker controls OAuth redirect
- Files: `src/electron-main.js` (line 80: `win.webContents.executeJavaScript`)
- Trigger: Malicious OAuth callback with injected JavaScript in hash
- Workaround: Currently uses string interpolation without escaping; `Escape quotes` is insufficient for complex payloads

## Security Considerations

**Electron security weakened by development flags:**
- Risk: `ELECTRON_DISABLE_SECURITY_WARNINGS` suppresses important warnings in development and production
- Files: `src/electron-main.js:10-12`
- Current mitigation: Only applied in NODE_ENV=development, but easily changed
- Recommendations: Remove flag entirely; address warnings instead of suppressing; use security best practices (CSP headers, subresource integrity); validate all IPC messages

**Missing CORS and CSP headers:**
- Risk: No Content-Security-Policy header enforced; CORS not configured; Electron app loads from localhost with full access
- Files: Project-wide (no security header configuration found)
- Current mitigation: contextIsolation enabled in Electron, but preload.js is not reviewed
- Recommendations: Add CSP headers for web mode; review preload.js (`src/preload.js`) for exposed APIs; restrict IPC to only necessary channels

**Azure credentials hardcoded in authConfig:**
- Risk: Client ID visible in source; if app is distributed, credentials are exposed and could be misused
- Files: `src/authConfig.js:16-18`
- Current mitigation: Standard OAuth flow (not a secret), but could still be abused
- Recommendations: Use environment variables; implement proper authorization scopes; add request signing where applicable

**No input validation on file uploads:**
- Risk: PDF files accepted without validation; could contain malicious content or crash renderer
- Files: `src/App.jsx` (handleUploadClick ~2595), `src/utils/pdfAnnotationImporter.js`
- Current mitigation: None visible
- Recommendations: Validate PDF headers before processing; implement file size limits; use Web Worker for parsing to prevent main thread crashes

## Performance Bottlenecks

**App.jsx render loop with 227 state variables:**
- Problem: Every state update triggers re-evaluation of entire component tree; no memoization of expensive calculations
- Files: `src/App.jsx`
- Cause: All state lives in single component; no separation of concerns; every zoom, pan, or annotation change re-renders entire tree
- Improvement path: Split into smaller components with proper memoization; use React.memo for pure components; move frequently-changing state to context; implement virtual scrolling for pages

**Fabric.js canvas operations on large PDFs:**
- Problem: Canvas operations (hit testing, clipping, transformation) scale poorly with annotation count (100+ annotations cause clipPath creation delays of 2-7ms)
- Files: `src/PageAnnotationLayer.jsx` (lines 2862, 2960)
- Cause: Expensive geometry operations on every interaction; no spatial indexing; bruteforce hit-testing
- Improvement path: Implement quadtree or spatial hashing for hit testing; batch geometry operations; use WebWorkers for heavy calculations; implement lazy rendering for off-screen annotations

**Eraser path calculation with dense point sets:**
- Problem: Eraser circle overlap calculation scales as O(n*m); checking every sample point against all eraser circles creates bottleneck
- Files: `src/PageAnnotationLayer.jsx` (lines 2352, 2395, 2862-2960)
- Cause: Sample point checking is exhaustive without spatial optimization
- Improvement path: Use spatial hashing for eraser circles; implement grid-based point lookup; consider SMAA or edge-based erasing instead of circle-based

**PDF rendering synchronization delays:**
- Problem: Large PDFs with many pages cause cumulative delays in page rendering; no parallel processing of page renders
- Files: `src/workers/pdfRender.worker.js`, `src/App.jsx` (render loop)
- Cause: Pages rendered sequentially; heavy PDF.js operations block main thread
- Improvement path: Implement Worker pool for parallel page rendering; add priority queue (visible pages first); implement timeout on stale render requests

## Fragile Areas

**Syncfusion-React portal synchronization:**
- Files: `src/App.jsx` (portal host logic ~9000-10000), `src/PageAnnotationLayer.jsx` (portal render)
- Why fragile: Syncfusion destroys/recreates `e-pv-page-div` during zoom; React portals disconnect when target removed; custom fixes use ref mutations to detect stale state
- Safe modification: Do NOT add re-attachment callbacks in container change or zoom handlers; never change `shouldFreezePortalHost` logic without regression testing all 6 zoom methods
- Test coverage: Only manual Playwright tests exist; no unit tests for zoom recovery; high risk of future regressions

**History timeline tracking with circular dependencies:**
- Files: `src/App.jsx` (timeline logic ~14388)
- Why fragile: History snapshots include reference to canvas objects; serialization/deserialization can break circular references; undo/redo can corrupt annotation state
- Safe modification: Never serialize canvas objects directly; only store serializable snapshots; test undo/redo after every annotation operation
- Test coverage: No automated tests for undo/redo with complex annotation chains

**Supabase schema assumptions:**
- Files: `src/hooks/useDatabase.js`, `src/services/documentAnnotationService.js`
- Why fragile: Hardcoded table names and column names; schema errors return 406 silently and are ignored
- Safe modification: Use constants for table names; add schema validation on first connection; implement table migration check
- Test coverage: No schema versioning; no tests for missing tables or columns

**localStorage/sessionStorage persistence:**
- Files: `src/App.jsx` (throughout)
- Why fragile: Data shape not validated on read; corrupted data causes silent failures; storage quota can be exceeded without warning
- Safe modification: Wrap all localStorage access in utility function with error handling; add data migration logic for schema changes
- Test coverage: No tests for corrupted data scenarios; only assumes valid JSON

## Scaling Limits

**Single localStorage JSON blob for all annotations:**
- Current capacity: ~5-10MB depending on browser (localStorage limit 5-50MB)
- Limit: Single large PDF with thousands of annotations will exceed quota quickly
- Scaling path: Migrate to Supabase (unlimited storage); implement pagination for annotations; store only modified annotations locally, sync on save

**Page rendering cache unbounded:**
- Current capacity: All rendered pages cached in memory indefinitely
- Limit: Large PDFs (500+ pages) cause memory pressure; no eviction policy
- Scaling path: Implement LRU cache with configurable max size; evict non-visible pages after N seconds; implement memory pressure monitoring

**React component tree depth:**
- Current capacity: App > multiple nested contexts > components; no virtualization of page list
- Limit: Hundreds of pages cause render tree explosion; large DOMNodeCache
- Scaling path: Implement react-window for page list virtualization; lazy-load context consumers; implement component memoization boundaries

## Dependencies at Risk

**Syncfusion SDK local file paths:**
- Risk: Dependencies installed from local filesystem paths (`file:../Syncfusion/...`); version pinned to 32.1.19; upgrades require manual file system updates
- Impact: Cannot use npm version updates; tied to specific local installation; breaking changes require rebuilding entire SDK locally
- Migration plan: Evaluate open-source PDF viewers (PDFKit, Mupdf); consider hosted PDF.js solution with community annotation libraries

**Fabric.js 5.5.2:**
- Risk: Major version (5.x) with API changes; community issues with canvas rendering on high-DPI displays
- Impact: Custom patching for `getContext()` to handle `willReadFrequently`; tight coupling to Fabric internals (Control, util, Path)
- Migration plan: Monitor v6.0 release; consider alternative canvas library (PixiJS, Babylon.js) if performance requirements grow

**PDF.js 3.11.174:**
- Risk: Widely used, but updates often include rendering behavior changes; worker thread setup fragile
- Impact: Custom worker manager required (`src/utils/PDFWorkerManager.js`); workerSrc path must be explicitly configured
- Migration plan: Implement version compatibility tests; add fallback for worker loading failures

**Stripe.js 8.5.3:**
- Risk: Version pinned without bounds; integration not visible in code (may be disabled)
- Impact: Outdated version could have security fixes in newer releases
- Migration plan: Remove if unused; otherwise update to latest and test payment flow

## Missing Critical Features

**No automated testing for PDF annotation workflows:**
- Problem: Only manual Playwright tests exist; no regression detection for annotation operations
- Blocks: Confidence in refactoring; impossible to verify zoom fixes don't regress
- Recommendation: Implement Jest unit tests for annotation layer; add visual regression tests for rendering; create end-to-end tests for full workflows

**No error reporting/observability:**
- Problem: Errors logged to console only; no centralized error tracking in production
- Blocks: Production issues invisible until user reports; performance issues undetected
- Recommendation: Integrate Sentry or similar for error tracking; add performance monitoring with Web Vitals; implement session recording for user support

**No data backup mechanism:**
- Problem: All annotations stored in Supabase with no backup; accidental deletion unrecoverable
- Blocks: Enterprise/compliance use cases; data loss risk
- Recommendation: Implement nightly backup to external storage; add soft-delete for annotations with restore window; audit log for all changes

**No offline-first sync strategy:**
- Problem: Application requires connection to Supabase for most operations
- Blocks: Offline annotation work; unreliable network scenarios
- Recommendation: Implement local-first sync using SQLite or IndexedDB; queue changes locally; sync when online; implement conflict resolution

## Test Coverage Gaps

**Annotation import/export roundtrip:**
- What's not tested: PDF annotation import followed by re-export to ensure fidelity
- Files: `src/utils/pdfAnnotationImporter.js`, `src/utils/pdfAnnotationsPdfLib.js`, `tests/pdfAnnotationImporter.test.mjs`
- Risk: Silent data loss during import/export cycles; specific annotation types may not roundtrip correctly
- Priority: High - affects data integrity for users migrating from other tools

**Syncfusion zoom interaction edge cases:**
- What's not tested: Rapid zoom changes, zoom during drag, zoom with selection active
- Files: `src/App.jsx` (zoom logic), `src/components/SyncfusionPDFContainer.jsx`
- Risk: Undetected regressions in fragile zoom recovery logic; edge cases cause portal desync
- Priority: High - zoom is core feature and current implementation is known to be fragile

**Excel sync with concurrent edits:**
- What's not tested: Multiple users editing same Excel template simultaneously
- Files: `src/App.jsx` (Excel sync ~15000+), `src/utils/excelSyncDirtyState.js`
- Risk: Data corruption, lost changes, formula overwrites
- Priority: High - if multi-user editing supported, this is critical

**localStorage corruption recovery:**
- What's not tested: Invalid JSON in localStorage, quota exceeded, storage disabled
- Files: `src/App.jsx` (storage access throughout)
- Risk: Silent failures, lost state, unexplained behavior
- Priority: Medium - graceful degradation important for UX

**Authentication and token refresh:**
- What's not tested: Token expiry during long sessions, Supabase connection loss, OAuth token revocation
- Files: `src/contexts/AuthContext.jsx`, `src/services/excelGraphService.js`
- Risk: Stale tokens cause silent failures; users can't recover without page reload
- Priority: Medium - auth failures should be explicit to user

---

*Concerns audit: 2026-03-17*
