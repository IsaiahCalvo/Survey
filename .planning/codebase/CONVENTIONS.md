# Coding Conventions

**Analysis Date:** 2026-07-19 (light refresh; naming/style patterns still hold)

## Naming Patterns

**Files:**
- React components: PascalCase with `.jsx` extension (e.g., `ErrorBoundary.jsx`, `PageAnnotationLayer.jsx`)
- Utilities and services: camelCase with `.js` extension (e.g., `excelSyncDirtyState.js`, `pdfAnnotationImporter.js`)
- Hooks: camelCase starting with `use` (e.g., `useDatabase.js`, `useAuth.jsx`)
- Contexts: PascalCase ending with `Context.jsx` (live: `AuthContext.jsx`, `MSGraphContext.jsx` — do not recreate `AnnotationContext.jsx`)
- Test files: `.test.mjs` or `.spec.mjs` suffix (e.g., `excelSyncDirtyState.test.mjs`)

**Functions:**
- Regular functions and helpers: camelCase (e.g., `validateZoom()`, `computeExcelSyncFingerprint()`)
- React hook functions: camelCase starting with `use` (e.g., `useAuth()`, `useDatabase()`)
- Constructor/class methods: camelCase (e.g., `handleReset()`, `getDerivedStateFromError()`)
- Private/internal utilities: camelCase with leading underscore for truly internal functions (e.g., `_willReadFrequentlyPatched`)

**Variables:**
- Component state and props: camelCase (e.g., `isLoading`, `hasError`, `setUser`)
- Constants in module scope: camelCase or UPPER_SNAKE_CASE for actual constants (e.g., `CONTEXT_MENU_Z_INDEX`, `sessionDir`, `linkedTemplate`)
- Refs and internal state: camelCase with descriptive suffix (e.g., `baselineHash`, `zoomGeneration`)
- Event parameters: descriptive names (e.g., `annotation`, `session`, `error`)

**Types:**
- TypeScript types/interfaces: PascalCase (e.g., `database.ts` exports types like database schema objects)
- Enum-like constants: UPPER_SNAKE_CASE (e.g., `ZOOM_MODES`, `TOOLS_WITH_STROKE_WIDTH`)
- Object property names: camelCase (e.g., `highlightAnnotations`, `linkedExcelPath`, `oneDriveFileId`)

## Code Style

**Formatting:**
- No ESLint or Prettier config detected in root
- Code shows consistent 2-space indentation
- Long import statements broken into multiple lines
- Comments use `//` for single-line, `/** */` for JSDoc blocks
- Inline styles in React components use camelCase object properties with string values

**Linting:**
- No active linting configuration detected
- Error handling follows try-catch-finally patterns
- Null/undefined checks use truthiness operators (`if (value)`) and optional chaining (`?.`)

## Import Organization

**Order:**
1. React imports (React, hooks, createContext, etc.)
2. External libraries (pdfjs-dist, pdf-lib, fabric, exceljs, etc.)
3. Context and hook imports from project
4. Component imports from project
5. Utility imports (services, helpers, state management)
6. Theme/configuration imports
7. Type imports

**Example shape (from viewer / shell modules):**
```javascript
import React, { useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { PDFDocument } from 'pdf-lib';
import { useMSGraph } from './contexts/MSGraphContext';
import PdfjsViewerContainer from './components/PdfjsViewerContainer';
import { savePDFWithAnnotationsPdfLib } from './utils/pdfAnnotationsPdfLib';
import { COLORS, TYPOGRAPHY } from './theme';
```

**Path Aliases:**
- Prefer relative imports as used elsewhere in `src/`
- Do not reintroduce Syncfusion path aliases / shims

## Error Handling

**Patterns:**
- Try-catch-finally blocks are standard
- Error objects logged via `console.error()` with descriptive labels (e.g., `[AnnotationSync] Error fetching annotations`)
- Functions return `{ data, error }` tuple pattern for Supabase operations
- Validation functions return objects with `{ isValid, value, error }` structure
- Error classification via helper functions (e.g., `classifyAnnotationSyncError()` checks error codes, messages, status)

**Example from `documentAnnotationService.js`:**
```javascript
export async function getDocumentAnnotations(documentId) {
  if (!documentId) return { data: [], error: null };

  const { data, error } = await supabase
    .from('document_annotations')
    .select('*')
    .eq('document_id', documentId);

  if (error) {
    console.error('[AnnotationSync] Error fetching annotations:', error);
    return { data: [], error };
  }

  return { data: data || [], error: null };
}
```

## Logging

**Framework:** Native `console` object

**Patterns:**
- `console.error()` for exceptions and failures, labeled with module prefix (e.g., `[AnnotationSync]`, `[ErrorBoundary]`)
- `console.log()` rarely used in production code
- Debug logging via `debugLog()` from `./utils/pdfDebug.js` for structured debug output
- Performance logging via `perfUpload()`, `perfLoad()`, `perfRender()`, `perfZoom()` from `./utils/performanceLogger.js`
- Conditional debug output controlled by `setDebugEnabled()` flag

**Example:**
```javascript
console.error('ErrorBoundary caught an error:', error, errorInfo);
console.error('[AnnotationSync] Error fetching annotations:', error);
debugLog('Component mounted with page:', pageNumber);
```

## Comments

**When to Comment:**
- JSDoc blocks for exported functions and React components (required)
- Inline comments for non-obvious logic (e.g., viewport coordinate transformations, Fabric.js quirks)
- Section headers for major logical groups (e.g., `// ============ ANNOTATION CRUD OPERATIONS ============`)
- Complex mathematical calculations get explanatory comments

**JSDoc/TSDoc:**
Used consistently for function exports and component props. Examples from `validation.js`:

```javascript
/**
 * Validate zoom percentage input
 * @param {string|number} value - The zoom value to validate
 * @param {number} min - Minimum allowed value (default: 10)
 * @param {number} max - Maximum allowed value (default: 500)
 * @returns {object} - { isValid: boolean, value: number|null, error: string|null }
 */
export function validateZoom(value, min = 10, max = 500) {
```

## Function Design

**Size:** Functions typically 20-80 lines; larger functions like `PageAnnotationLayer` component exceed this for complex canvas rendering logic

**Parameters:**
- Use destructuring for object parameters in modern code (e.g., `const fetchSettings = async ()`)
- Callback parameters with clear names (e.g., `getName = (item) => item?.name`)
- Default parameters used for optional values (e.g., `min = 10, max = 500`)

**Return Values:**
- Async functions return objects with `{ data, error }` structure for Supabase operations
- Validation functions return `{ isValid, value, error }` objects
- React components return JSX or null
- Utility functions return single values or objects as appropriate

**Example from `excelSyncDirtyState.js`:**
```javascript
export const computeHasPendingExcelSyncChanges = ({
  template,
  highlightAnnotations,
  baselineHash
}) => {
  if (!template?.linkedExcelPath) {
    return false;
  }

  if (!baselineHash) {
    return true;
  }

  const current = computeExcelSyncFingerprint(template, highlightAnnotations);
  return current.hash !== baselineHash;
};
```

## Module Design

**Exports:**
- Named exports used exclusively (no default exports)
- Each utility file exports single-purpose functions
- Services export async CRUD functions and subscription utilities
- Hooks export custom React hooks

**Barrel Files:**
- Not used extensively
- Components import utilities directly by path
- No `index.js` re-export files detected in utilities or components

**Module Organization:**
- Each module has single responsibility (e.g., `excelSyncDirtyState.js` only handles dirty state computation)
- Related utilities grouped in directories (e.g., `utils/`, `services/`, `hooks/`, `components/`)
- Context providers and hooks in `contexts/` and `hooks/` directories

## React Component Patterns

**Functional vs Class Components:**
- Functional components with hooks are standard
- Error boundary implemented as class component (`ErrorBoundary.jsx`)
- Hooks use standard patterns: `useState`, `useEffect`, `useContext`, `useCallback`, `useRef`

**Props and State:**
- State managed via `useState` hook
- Context used for global state (`AuthContext`, `MSGraphContext`); annotation state lives in `PDFViewer.jsx`
- Props passed explicitly, no prop spreading except for HTML attributes
- Inline styles use theme constants imported from `./theme.js`
- App root components (`AppShell`, many panels) use default exports; utility modules prefer named exports

---

*Convention analysis: 2026-07-19*
