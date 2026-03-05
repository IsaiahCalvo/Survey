# Coding Conventions

**Analysis Date:** 2026-03-04

## Naming Patterns

**Files:**
- React components: PascalCase with `.jsx` extension (e.g., `LoadingSpinner.jsx`, `ErrorBoundary.jsx`, `PDFPageCanvas.jsx`)
- Utility modules: camelCase with `.js` extension (e.g., `regionMath.js`, `zoomController.js`, `pdfAnnotationImporter.js`)
- Hooks: camelCase prefixed with `use` and `.js` extension (e.g., `useDatabase.js`, `useVisiblePages.js`, `useZoomState.js`)
- Contexts: PascalCase with `Context` suffix and `.jsx` extension (e.g., `AuthContext.jsx`, `MSGraphContext.jsx`, `AnnotationContext.jsx`)
- Services: camelCase with `Service` suffix and `.js` extension (e.g., `excelGraphService.js`, `documentAnnotationService.js`, `excelSessionService.js`)
- Types: camelCase with `.ts` extension (only one file: `src/types/database.ts`)
- Sidebar panels: PascalCase with `Panel` suffix (e.g., `BookmarksPanel.jsx`, `SpacesPanel.jsx`, `PagesPanel.jsx`)

**Functions:**
- Use camelCase for all functions: `fetchProjects`, `createDocument`, `handleMouseEnter`
- Event handlers: prefix with `handle` (e.g., `handleReset`, `handleConfirm`, `handleClickOutside`)
- Boolean helpers: prefix with `is` or `has` (e.g., `isSupabaseAvailable`, `isServiceConnected`, `hasDuplicateName`)
- Async data fetchers: prefix with `fetch` (e.g., `fetchSettings`, `fetchTemplates`, `fetchSubscriptionTier`)
- CRUD operations: use verb prefixes `create`, `update`, `delete` (e.g., `createProject`, `updateTemplate`, `deleteDocument`)

**Variables:**
- Use camelCase for variables and state: `subscriptionTier`, `highlightAnnotations`, `visiblePages`
- React state: `[value, setValue]` convention (e.g., `[loading, setLoading]`, `[error, setError]`)
- Refs: suffix with `Ref` (e.g., `observerRef`, `svRef`, `containerRef`, `timeoutRef`)
- Constants: UPPER_SNAKE_CASE for module-level constants (e.g., `SUPPORTED_SUBTYPES`, `ZOOM_MODES`, `MAX_CONCURRENT_RENDERS`, `CONTEXT_MENU_Z_INDEX`)

**Types (TypeScript, used in `src/types/database.ts`):**
- Interfaces use PascalCase: `UserSettings`, `Project`, `Template`, `Document`, `Space`
- Properties use snake_case matching Supabase column names: `user_id`, `created_at`, `file_path`

## Code Style

**Formatting:**
- No formatter tool configured (no .prettierrc, .eslintrc, biome.json, or eslint.config found)
- Indentation: 2 spaces throughout
- Semicolons: used consistently
- Quotes: single quotes for JavaScript strings (e.g., `'free'`, `'pro'`), double quotes only in JSX attributes
- Trailing commas: used in multi-line objects and arrays
- Line length: no enforced limit; some lines exceed 200 characters particularly in JSX inline styles

**Linting:**
- No linting tool configured. No ESLint, Biome, or similar.

**Styling approach:**
- **Primary: inline styles via `style={{}}` props** - the dominant pattern across all components
- Theme tokens from `src/theme.js` are used extensively: `COLORS`, `TYPOGRAPHY`, `BORDERS`, `SHADOWS`, `TRANSITIONS`, `Z_INDEX`, `LAYOUT`
- A few CSS files exist for specific cases: `src/styles.css` (global resets, scrollbar, animations), `src/App.css`, `src/components/AuthModal.css`, `src/components/UserMenu.css`, `src/components/AccountSettings.css`
- No CSS-in-JS library (no styled-components, emotion, etc.)
- Animations defined either in CSS files (`@keyframes`) or inline `<style>` tags within components (see `LoadingSpinner.jsx`)

## Import Organization

**Order:**
1. React and React DOM imports (`import React, { useState, useEffect } from 'react'`)
2. Third-party libraries (`pdfjs-dist`, `pdf-lib`, `xlsx-js-style`, `@dnd-kit/*`, `fabric`, etc.)
3. Local contexts and hooks (`./contexts/AuthContext`, `./hooks/useDatabase`)
4. Local services (`./services/excelGraphService`, `./services/documentAnnotationService`)
5. Local components (`./components/PDFPageCanvas`, `./components/ErrorBoundary`)
6. Local utilities (`./utils/regionMath`, `./utils/zoomController`)
7. Theme and constants (`./theme`)
8. CSS imports (`./styles.css`, component-specific CSS)

**Path Aliases:**
- No path aliases configured in `vite.config.js`. All imports use relative paths (`../`, `./`).
- Two resolve aliases exist only for shimming missing Syncfusion packages:
  - `@syncfusion/ej2-interactive-chat` -> `src/shims/ej2-interactive-chat.js`
  - `@syncfusion/ej2-markdown-converter` -> `src/shims/ej2-markdown-converter.js`

## Error Handling

**Patterns:**
- **try/catch with console.error**: The primary error handling pattern across services and hooks. Errors are caught, logged via `console.error()`, and either re-thrown or stored in component state.
- **Supabase error pattern**: Check `error` from destructured response, `throw error` if present. Use `error.code` for specific handling (e.g., `PGRST116` for "no rows found").
  ```javascript
  const { data, error } = await supabase.from('projects').select('*');
  if (error) throw error;
  ```
- **Guard clauses**: Functions check preconditions early and return or throw. Common guards: `if (!user || !isSupabaseAvailable()) return;`
- **Error classification**: `src/services/documentAnnotationService.js` uses `classifyAnnotationSyncError()` to categorize errors as RLS, schema, not-found, or unknown with retryability metadata.
- **Error state in hooks**: Hooks expose `error` state and set `setError(err.message)` in catch blocks. Pattern: `{ data, loading, error, refetch }`.
- **ErrorBoundary**: `src/components/ErrorBoundary.jsx` is a class component wrapping the entire app. Catches render errors and shows a styled fallback UI with reload/retry buttons.
- **Validation utilities**: `src/utils/validation.js` provides structured validation returning `{ isValid, value, error }` objects for zoom, page numbers, file names, emails, and text.

## Logging

**Framework:** `console` (no external logging library)

**Patterns:**
- `console.error('Failed to <action>:', error)` for service-level errors in `src/services/`
- `console.error('[ComponentName] Error <action>:', error)` with bracketed prefix for contextual logging in services (e.g., `[AnnotationSync]`, `[useConnectedServices]`)
- `console.warn()` for non-fatal issues (e.g., Supabase not configured, session expired)
- Performance logging via `src/utils/performanceLogger.js` - a custom `PerformanceLogger` class with `start()/mark()/end()` API, toggled at runtime via `DEBUG_ENABLED` flag
- Debug logging via `src/utils/pdfDebug.js` with `debugLog()`, `debugWarn()` functions that respect a debug-enabled flag
- PDF.js console warnings are globally suppressed in `src/main.jsx` by patching `console.warn`

## Comments

**When to Comment:**
- **JSDoc on exported functions**: Used consistently in services and utilities. Include `@param` and `@returns` tags. See `src/services/excelGraphService.js`, `src/utils/validation.js`, `src/utils/pdfAnnotationImporter.js`.
- **JSDoc on React components**: Used on reusable components with prop documentation. See `src/components/ConfirmDialog.jsx`, `src/components/LoadingSpinner.jsx`, `src/components/BallInCourtIndicator.jsx`.
- **Section dividers**: `// ============================================` with section labels in large files. Used in `src/hooks/useDatabase.js` to separate hook groups (USER SETTINGS, PROJECTS, DOCUMENTS, etc.).
- **Inline comments**: Explain non-obvious logic, workarounds, or "why" decisions. Examples: canvas context patching in `PageAnnotationLayer.jsx`, binary format handling in `excelGraphService.js`.
- **Module-level docstrings**: Multi-line `/** ... */` blocks at top of files describing purpose and supported features. See `src/utils/pdfAnnotationImporter.js`, `src/contexts/AnnotationContext.jsx`.

## Function Design

**Size:** No enforced limit. `src/App.jsx` is a single ~31,000-line file containing the main application component with extensive inline logic. Most other files are under 1,000 lines.

**Parameters:**
- React components use destructured props with defaults: `({ size = 'md', message, overlay = false })`
- Hooks accept configuration objects: `useVisiblePages(options = {})`
- Service functions accept explicit parameters, not config objects: `uploadExcelFile(graphClient, filePath, fileContent)`

**Return Values:**
- Hooks return objects with named properties: `{ data, loading, error, refetch, create, update, delete }`
- Service functions return `{ data, error }` matching Supabase patterns
- Validation functions return structured objects: `{ isValid, value, error }` or `{ isValid, sanitized, error }`

## Module Design

**Exports:**
- Components: `export default ComponentName` (default export) for React components
- Hooks: `export const useHookName` or `export function useHookName` (named exports), multiple hooks per file in `src/hooks/useDatabase.js`
- Services: `export async function serviceName` (named exports), grouped by domain
- Utilities: `export const` or `export function` (named exports)
- Constants: `export const CONSTANT_NAME` (named exports alongside functions)
- Contexts: Export both `Provider` component and `useContext` hook from the same file (e.g., `AuthProvider` and `useAuth` from `AuthContext.jsx`)

**Barrel Files:**
- Not used. Components are imported directly from their file paths.
- Exception: `src/components/Callout/index.jsx` acts as the barrel for the Callout sub-module.

## Component Patterns

**Functional components with hooks:**
- All new components are function components. Only `ErrorBoundary` uses a class component (required by React for error boundaries).
- Use `memo()` for performance-sensitive components: `PDFPageCanvas`, `TextLayer`
- Use `forwardRef` with `useImperativeHandle` when parent needs to call child methods (referenced in `App.jsx` imports)

**State management:**
- React Context for global state: `AuthContext`, `MSGraphContext`, `AnnotationContext`, `SearchContext`
- `useState` + `useCallback` + `useMemo` for component-local state
- `AnnotationContext` uses a custom subscription store pattern (similar to Redux) for high-performance page-level updates
- localStorage for persistence: tool preferences, zoom preferences

**Inline styles with theme tokens:**
- Use theme constants from `src/theme.js` for all colors, typography, borders, shadows
  ```javascript
  style={{
    background: COLORS.background.primary,
    color: COLORS.text.secondary,
    fontSize: TYPOGRAPHY.fontSize.md,
    borderRadius: BORDERS.radius.lg,
  }}
  ```
- Hover effects handled via `onMouseEnter`/`onMouseLeave` setting `e.currentTarget.style`
- Transitions via `TRANSITIONS` constants from theme

## Environment Variable Access

- Use `import.meta.env.VITE_*` for client-side env vars (Vite convention)
- Use `Deno.env.get()` in Supabase edge functions
- Always guard with availability checks: `isSupabaseAvailable()` pattern

---

*Convention analysis: 2026-03-04*
