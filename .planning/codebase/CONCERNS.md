# Codebase Concerns

**Analysis Date:** 2026-03-04

## Tech Debt

**God File: `src/App.jsx` (30,985 lines / 1.3MB)**
- Issue: The entire application logic -- Dashboard, PDFViewer, App component, plus ~100 helper functions, 40+ magic constants, and extensive inline styles -- lives in a single file. It contains 227 `useState`, 155 `useRef`, 144 `useEffect`, 225 `useCallback`, and 27 `useMemo` calls. Three major components (`Dashboard` at line 2251, `PDFViewer` at line 8961, `App` at line 30562) are defined here, each with hundreds of state variables and deeply nested render logic.
- Files: `src/App.jsx`
- Impact: Extremely difficult to navigate, modify, or review. Merge conflicts are near-guaranteed on any parallel work. IDE performance degrades. New developers cannot onboard efficiently. Any change risks unintended side effects due to shared closures and state.
- Fix approach: Incrementally extract components and logic. Start by extracting `Dashboard` (~6700 lines) and `PDFViewer` (~21600 lines) into their own files. Extract shared constants, helper functions (`hexToRgba`, `ensureRgbaOpacity`, `generateUniqueId`, etc.), and performance-related constants into `src/utils/` or `src/constants/`. Extract the inline style objects into CSS modules or a dedicated styles file.

**God File: `src/PageAnnotationLayer.jsx` (9,425 lines)**
- Issue: The annotation layer handling Fabric.js canvas interactions, drawing tools, eraser logic, context menus, callout management, and undo/redo history is a single massive component. It patches `HTMLCanvasElement.prototype.getContext` at the module level (lines 8-29) as a global side effect.
- Files: `src/PageAnnotationLayer.jsx`
- Impact: Same maintainability issues as App.jsx. The global `getContext` patch can cause subtle bugs if module load order changes. Difficult to test individual drawing tools in isolation.
- Fix approach: Extract tool-specific logic (eraser, drawing, text, callout) into separate hook files under `src/hooks/`. Move the `getContext` patch to a dedicated initialization module. Extract context menu logic into its own component.

**Massive Inline Styling (676 `style={{` in App.jsx alone)**
- Issue: Almost all UI styling is done via inline style objects. Only 801 total lines of CSS exist across three files (`src/styles.css`, `src/App.css`, `src/index.css`), while thousands of style objects are scattered through JSX.
- Files: `src/App.jsx`, `src/PageAnnotationLayer.jsx`, `src/components/ErrorBoundary.jsx`, and most component files
- Impact: Styles are not reusable, cannot be cached by the browser, inflate component render cost (new object per render unless memoized), and make global design changes require touching hundreds of locations.
- Fix approach: Adopt CSS modules or a CSS-in-JS solution with a theme system. The existing `src/theme.js` provides design tokens (`COLORS`, `BORDERS`, `SHADOWS`, `TYPOGRAPHY`) but these are consumed as inline style values rather than through a proper styling layer.

**Duplicate/Divergent Components**
- Issue: Two different `TextLayer` implementations exist -- `src/TextLayer.jsx` (192 lines, manually creates text spans) and `src/components/TextLayer.jsx` (67 lines, uses `pdfjsLib.renderTextLayer`). Two different `PageAnnotationLayer` files exist -- `src/PageAnnotationLayer.jsx` (9,425 lines, full Fabric.js annotation system) and `src/components/PageAnnotationLayer.jsx` (41 lines, simple SVG polygon overlay). The root-level versions are the active ones; the `components/` versions appear to be earlier/simpler implementations that were never removed.
- Files: `src/TextLayer.jsx`, `src/components/TextLayer.jsx`, `src/PageAnnotationLayer.jsx`, `src/components/PageAnnotationLayer.jsx`
- Impact: Confusing imports. A developer could accidentally import the wrong version. Dead code increases bundle size.
- Fix approach: Delete the unused `src/components/TextLayer.jsx` and `src/components/PageAnnotationLayer.jsx` (or rename and consolidate if both are needed).

**Backup and Log Files Tracked in Git**
- Issue: `src/App.jsx.backup` (22,019 lines), `1.log`, `2.log` (19,401 lines), and `3.log` are tracked by git. The `.gitignore` does not exclude `.backup` files or root-level log files.
- Files: `src/App.jsx.backup`, `1.log`, `2.log`, `3.log`, `.gitignore`
- Impact: Repository bloat. Log files may contain sensitive debug information. Backup files cause confusion about which version is authoritative.
- Fix approach: Add `*.backup`, `*.log` (root-level) patterns to `.gitignore`. Remove tracked files with `git rm --cached`.

**Non-Portable Syncfusion Dependencies**
- Issue: 31 Syncfusion packages are referenced via `file:../Syncfusion/32.1.19/PDF Viewer SDK/JavaScript/Packages/...` paths in `package.json`. These are relative paths to a directory outside the repository.
- Files: `package.json` (lines 22-52)
- Impact: The project cannot be cloned and built on any machine without the exact same Syncfusion SDK directory structure at the sibling path. CI/CD is impossible without manual setup. `npm install` will fail on fresh clones.
- Fix approach: Publish Syncfusion packages to a private npm registry, use a `.tgz` vendored approach within the repo, or use the official `@syncfusion` npm packages if licensing permits.

**Weak ID Generation**
- Issue: Unique IDs are generated with `Date.now() + Math.random()` throughout the codebase (found at lines 1040, 1605, 2640, 2740, 3511, 3521, 3522, 3539, 3554, 3555, 3572, 3654, 3669, 3724, 3985, 4398, 4758, 10507, etc. in `src/App.jsx`). This pattern can produce collisions under rapid successive calls and is not cryptographically suitable for any security context.
- Files: `src/App.jsx` (numerous locations)
- Impact: Potential ID collisions in batch operations. Not suitable if IDs are ever used for authorization checks.
- Fix approach: Use `crypto.randomUUID()` (available in modern browsers and Node.js) for all ID generation. Create a centralized `generateId()` utility in `src/utils/`.

## Known Bugs

**Unimplemented Features Behind TODO Comments**
- Symptoms: "TODO: Actually create categories in template with cloned checklists" (line 29623 in `src/App.jsx`), "TODO: Implement actual page copying using PDF.js or a PDF manipulation library" (line 30846). These indicate user-facing features that silently do nothing or partially work.
- Files: `src/App.jsx` (lines 29623, 30846)
- Trigger: User attempts to clone template categories or copy PDF pages.
- Workaround: None -- the operations likely fail silently or produce incomplete results.

**Hardcoded localhost Redirect URIs**
- Symptoms: Microsoft OAuth redirect URIs are hardcoded to `http://localhost:5173` in `src/authConfig.js` (lines 19-20) and `src/contexts/MSGraphContext.jsx` (line 13). Production Electron builds will fail Microsoft OAuth flows because the redirect URI won't match.
- Files: `src/authConfig.js`, `src/contexts/MSGraphContext.jsx`
- Trigger: Any Microsoft authentication attempt in a production/packaged Electron build.
- Workaround: Manually override in Azure Portal, but the code itself needs environment-aware redirect URIs.

## Security Considerations

**executeJavaScript with User-Influenced Input**
- Risk: In `src/electron-main.js` line 80, `executeJavaScript` is called with an OAuth hash that is only escaped for double quotes: `const hash = parsedUrl.hash.replace(/"/g, '\\"');`. A crafted OAuth redirect could potentially inject JavaScript through other means (backticks, string concatenation exploits).
- Files: `src/electron-main.js` (line 80)
- Current mitigation: Basic double-quote escaping, `contextIsolation: true` in webPreferences.
- Recommendations: Pass the hash value through IPC instead of `executeJavaScript`. Use `win.webContents.send('set-oauth-hash', hash)` and handle it in the preload/renderer.

**Broad File System Access via IPC**
- Risk: The preload script exposes `readFile`, `writeFile`, `writeFileAtomic`, `listDir`, `fileExists`, and `getFileStats` without path validation. A compromised renderer process could read/write arbitrary files on the user's system.
- Files: `src/preload.js` (lines 8-15), `src/electron-main.js` (lines 327-384)
- Current mitigation: `contextIsolation: true` and `nodeIntegration: false`.
- Recommendations: Add allowlist-based path validation in IPC handlers. Restrict file operations to specific directories (e.g., app data directory, user's Documents folder). Validate file extensions.

**Azure Client ID Hardcoded in Source**
- Risk: The Azure AD Client ID `0da81a9e-2b05-46ee-b826-5efc5114c765` is hardcoded in `src/authConfig.js` (line 16). While client IDs for public apps are not strictly secret, hardcoding makes it difficult to use different values per environment and exposes the app registration publicly.
- Files: `src/authConfig.js` (line 16)
- Current mitigation: None.
- Recommendations: Move to environment variables (`VITE_AZURE_CLIENT_ID`). The Supabase credentials already follow this pattern via `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

**Broad Microsoft Graph Scopes**
- Risk: The app requests `Files.ReadWrite.All` and `Sites.ReadWrite.All` scopes (in `src/authConfig.js` line 69), which grant read/write access to all files in the user's OneDrive and all SharePoint sites. This is far broader than necessary for Excel sync functionality.
- Files: `src/authConfig.js` (line 69)
- Current mitigation: None.
- Recommendations: Use more restrictive scopes like `Files.ReadWrite.AppFolder` or request specific file permissions via incremental consent.

## Performance Bottlenecks

**Single-Component Re-render Cascade**
- Problem: The `PDFViewer` component (~21,600 lines within `src/App.jsx`) holds all viewer state in a single function scope. Any state change triggers re-evaluation of the entire component body, including all 225 `useCallback` closures and inline style objects.
- Files: `src/App.jsx` (lines 8961-30560)
- Cause: No component decomposition. All state is co-located in one function. Inline styles create new objects every render.
- Improvement path: Extract sub-components (toolbar, sidebar, survey panel, annotation controls) with their own state. Use `React.memo` on child components with stable props. Extract frequently-changing state (cursor position, tooltip, eraser position) into separate contexts or refs.

**676 Inline Style Objects in App.jsx**
- Problem: Each `style={{...}}` creates a new JavaScript object on every render. With 676 occurrences in a component that re-renders frequently (on scroll, zoom, mouse move), this creates significant GC pressure.
- Files: `src/App.jsx`
- Cause: No style extraction or memoization.
- Improvement path: Move static styles to CSS modules. For dynamic styles, use `useMemo` or extract to `const` outside the component.

**Canvas `willReadFrequently` Global Patch**
- Problem: `src/PageAnnotationLayer.jsx` (lines 8-29) monkey-patches `HTMLCanvasElement.prototype.getContext` globally to inject `willReadFrequently: true` for Fabric.js canvases. While the heuristic tries to target only Fabric canvases, false positives would disable GPU acceleration on PDF rendering canvases.
- Files: `src/PageAnnotationLayer.jsx` (lines 8-29)
- Cause: Fabric.js frequently reads pixel data, which is slow without `willReadFrequently`. But the patch is global.
- Improvement path: Apply `willReadFrequently` directly when creating Fabric canvas instances rather than patching the prototype.

## Fragile Areas

**Annotation Undo/Redo System**
- Files: `src/PageAnnotationLayer.jsx` (history-related code throughout), `src/App.jsx` (lines 177-263 for history debug helpers)
- Why fragile: The undo/redo system serializes entire Fabric.js canvas state as JSON. Text objects require a `sanitizeTextStyles` workaround (lines 150-200 in `src/PageAnnotationLayer.jsx`) to prevent "Cannot read properties of undefined" errors during serialization. The history system has its own debug console (`HISTORY_DEBUG_CONSOLE_KEY`), suggesting ongoing reliability issues.
- Safe modification: Always test undo/redo after changing any canvas object manipulation code. The `sanitizeTextObject` and `sanitizeTextStyles` functions must be called before any canvas serialization.
- Test coverage: No automated tests for undo/redo.

**Excel Sync Pipeline**
- Files: `src/services/excelGraphService.js`, `src/services/excelSessionService.js`, `src/utils/excelSyncDirtyState.js`, `src/App.jsx` (Excel-related state and handlers)
- Why fragile: The Excel sync involves Microsoft Graph API sessions, file locking detection, dirty-state fingerprinting, OneDrive file watchers, and multiple modal flows (locked file, new columns, sync confirm). State is spread across the PDFViewer component in `src/App.jsx` with refs like `lastExcelSyncFingerprintRef` and multiple modal visibility flags.
- Safe modification: Only `src/utils/excelSyncDirtyState.js` has tests (`tests/excelSyncDirtyState.test.mjs`). Any change to the sync flow should verify the full cycle: local edit -> dirty detection -> sync -> OneDrive upload -> file watcher notification.
- Test coverage: Only fingerprint/dirty-state utilities are tested. No integration tests for the full sync flow.

**Real-time Annotation Collaboration**
- Files: `src/services/documentAnnotationService.js`, `src/App.jsx` (subscription setup around line 18173)
- Why fragile: Real-time sync uses Supabase Postgres changes subscriptions with per-document channels. The service handles RLS errors, schema-missing errors, and connection failures, but the error recovery paths in `src/App.jsx` are complex and interleaved with the annotation state management. Presence tracking has its own error classification system duplicated from the annotation sync classifier.
- Safe modification: The `classifyAnnotationSyncError` and `classifyPresenceError` functions in `src/services/documentAnnotationService.js` are nearly identical (lines 9-47 and 383-421) -- keep them in sync or consolidate.
- Test coverage: No tests for real-time sync or error recovery.

## Scaling Limits

**App.jsx File Size**
- Current capacity: 30,985 lines / 1.3MB
- Limit: IDE features (autocomplete, go-to-definition, syntax highlighting) degrade noticeably. The file already exceeds the 256KB read limit of many code analysis tools.
- Scaling path: Component decomposition (see Tech Debt section).

**In-Memory Annotation Storage**
- Current capacity: All annotations for all pages are held in React state (`annotationsByPage`, `highlightAnnotations`, `callouts`, etc.)
- Limit: Documents with thousands of annotations across hundreds of pages will consume significant memory and cause slow state updates.
- Scaling path: Virtualize annotation storage -- only hydrate annotations for visible/nearby pages. Use a ref-based store for non-reactive annotation data.

## Dependencies at Risk

**Fabric.js v5.5.2**
- Risk: Fabric.js v5 is legacy; v6 has breaking changes (ESM-only, renamed APIs). The codebase extensively monkey-patches Fabric internals (`src/utils/fabricCustomization.js`, the `getContext` prototype patch in `src/PageAnnotationLayer.jsx`).
- Impact: Security patches and bug fixes for v5 will eventually stop. Migration to v6 will be a large effort due to deep integration.
- Migration plan: Audit all Fabric.js API usage and prototype patches. Test with Fabric v6 alpha. Plan for renamed/removed APIs.

**pdfjs-dist v3.11.174**
- Risk: PDF.js v3 is behind the current major version (v4+). The worker setup at `src/App.jsx` line 98 uses v3-specific import patterns.
- Impact: Missing PDF rendering improvements, security fixes, and API enhancements from v4.
- Migration plan: Update worker import pattern, test with sample PDFs for rendering regressions.

**Syncfusion v32.1.19 (Local File References)**
- Risk: 31 Syncfusion packages are referenced from a local filesystem path outside the repository. If the local SDK directory is moved, renamed, or updated, all builds break.
- Impact: Cannot build on CI. Cannot onboard new developers without manual SDK setup.
- Migration plan: Vendor the packages into the repo (e.g., as `.tgz` files) or use a private npm registry.

## Missing Critical Features

**No Linting or Formatting Enforcement**
- Problem: No `.eslintrc`, `.prettierrc`, `biome.json`, or equivalent configuration files exist. No pre-commit hooks.
- Blocks: Consistent code style, automated code quality checks, preventing common bugs (unused variables, missing dependencies in hooks, etc.).

**No TypeScript**
- Problem: The codebase is entirely JavaScript (`.jsx`, `.js`) except for `src/types/database.ts` (which appears to be a standalone type definition). No `tsconfig.json` exists.
- Blocks: Type safety, refactoring confidence, IDE autocompletion accuracy, catching prop mismatches at build time.

## Test Coverage Gaps

**Minimal Test Suite (2 test files)**
- What's not tested: The entire UI layer (30,985 lines of App.jsx), all React components, all React hooks, all context providers, the Electron main process, the annotation layer, real-time sync, authentication flows, Excel sync end-to-end, PDF rendering, and all user interactions.
- Files: Only `tests/excelSyncDirtyState.test.mjs` (fingerprint utilities) and `tests/pdfAnnotationImporter.test.mjs` (PDF annotation import conversion) exist.
- Risk: Any refactoring or feature addition has no safety net. Regressions are discovered only through manual testing.
- Priority: High. The two existing test files cover pure utility functions. No component tests, no integration tests, no E2E tests exist.

**No Component or Integration Tests**
- What's not tested: React component rendering, user interaction flows (document upload, annotation creation, template management, Excel export), Supabase hook behavior, authentication state transitions.
- Files: All files under `src/components/`, `src/hooks/`, `src/contexts/`, `src/services/`
- Risk: UI regressions, broken user flows, state management bugs go undetected.
- Priority: High. Consider adding React Testing Library for component tests and Playwright/Cypress for E2E flows.

---

*Concerns audit: 2026-03-04*
