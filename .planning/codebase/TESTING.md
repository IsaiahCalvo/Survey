# Testing Patterns

**Analysis Date:** 2026-03-04

## Test Framework

**Runner:**
- Node.js built-in test runner (`node:test`) - no external test framework
- Requires Node.js with `--experimental-default-type=module` flag
- No test config file (no jest.config, vitest.config, etc.)

**Assertion Library:**
- `node:assert/strict` (Node.js built-in strict assertions)

**Run Commands:**
```bash
npm test                    # Run all tests: node --experimental-default-type=module --test tests/*.test.mjs
```
No watch mode, coverage, or other test scripts are configured.

## Test File Organization

**Location:**
- Separate `tests/` directory at project root (not co-located with source files)

**Naming:**
- `{moduleName}.test.mjs` - ESM module extension required for Node.js test runner
- Test file names match the source module being tested

**Current test files (2 total):**
```
tests/
  pdfAnnotationImporter.test.mjs    # Tests for src/utils/pdfAnnotationImporter.js
  excelSyncDirtyState.test.mjs      # Tests for src/utils/excelSyncDirtyState.js
```

## Test Structure

**Suite Organization:**
- Flat structure using `test()` from `node:test` - no `describe()` nesting
- Each `test()` call is a standalone, self-contained test case
- Test names are descriptive sentences starting with the function name being tested

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { functionUnderTest } from '../src/utils/moduleUnderTest.js';

test('functionUnderTest does specific thing when given specific input', () => {
  const input = { /* setup */ };
  const result = functionUnderTest(input);
  assert.equal(result.property, expectedValue);
});
```

**Setup pattern:**
- Inline test data setup within each test - no shared `beforeEach`/`afterEach`
- Factory functions defined at module level for creating test fixtures (e.g., `makeViewport()`)

**Teardown pattern:**
- Not used. Tests are stateless and do not require cleanup.

**Assertion pattern:**
- `assert.equal()` for primitive value comparison
- `assert.deepEqual()` for object/array deep comparison
- `assert.ok()` for truthiness checks
- `assert.ok(Math.abs(actual - expected) < epsilon)` for floating-point comparison

## Mocking

**Framework:** Manual mocking (no mocking library)

**Patterns:**
- Create plain JavaScript objects that mimic the interface of real dependencies
- Mock objects are defined inline within test cases or via factory functions

```javascript
// Factory function for creating mock viewport objects
const makeViewport = ({ xOffset = 0, yOffset = 0, pageHeight = 100 } = {}) => {
  const convertToViewportPoint = (x, y) => [x + xOffset, (pageHeight - y) + yOffset];
  return {
    height: pageHeight,
    convertToViewportPoint,
    convertToViewportRectangle(rect) {
      const [x1, y1] = convertToViewportPoint(rect[0], rect[1]);
      const [x2, y2] = convertToViewportPoint(rect[2], rect[3]);
      return [x1, y1, x2, y2];
    }
  };
};

// Inline mock for PDF document with async methods
const pdfDoc = {
  numPages: 1,
  async getPage(pageNum) {
    assert.equal(pageNum, 1);
    return page;
  }
};

const page = {
  getViewport() { return viewport; },
  async getAnnotations() {
    return [/* mock annotation objects */];
  }
};
```

**What to Mock:**
- External library interfaces (PDF.js page/document objects)
- Viewport transformation functions
- Any object whose real implementation requires browser/DOM APIs

**What NOT to Mock:**
- The function under test itself
- Pure utility functions (like `computeExcelSyncFingerprint` - tested with real implementation)
- Data structures / plain objects

## Fixtures and Factories

**Test Data:**
```javascript
// Factory with defaults for creating test fixtures
const makeViewport = ({ xOffset = 0, yOffset = 0, pageHeight = 100 } = {}) => ({
  height: pageHeight,
  convertToViewportPoint: (x, y) => [x + xOffset, (pageHeight - y) + yOffset],
  // ...
});

// Inline fixtures with descriptive structure
const linkedTemplate = {
  id: 'template-1',
  supabaseId: 'supabase-template-1',
  linkedExcelPath: '/tmp/survey.xlsx',
  oneDriveApiPath: '/Documents/survey.xlsx',
  oneDriveFileId: 'onedrive-file-1'
};

// Annotation fixtures matching PDF.js annotation structure
const annotation = {
  id: 'a1',
  subtype: 'Square',
  rect: [10, 20, 30, 40],
  color: [0, 0, 0]
};
```

**Location:**
- Fixtures are defined inline within test files (no separate fixtures directory)
- Module-level constants for shared fixtures (e.g., `linkedTemplate`)
- Factory functions at module level for configurable fixtures (e.g., `makeViewport()`)

## Coverage

**Requirements:** None enforced. No coverage tool is configured.

**View Coverage:**
```bash
# Not configured. Would need to add --experimental-test-coverage flag:
# node --experimental-default-type=module --test --experimental-test-coverage tests/*.test.mjs
```

## Test Types

**Unit Tests:**
- The only test type present. Tests pure utility functions in isolation.
- `tests/pdfAnnotationImporter.test.mjs` (10 tests): Tests PDF annotation to Fabric.js object conversion - rectangle mapping, line endpoints, opacity handling, ink path smoothing, polygon import, AutoCAD SHX text import, callout metadata preservation
- `tests/excelSyncDirtyState.test.mjs` (5 tests): Tests Excel sync fingerprint computation and dirty state detection - linked path checks, baseline comparison, hash change detection

**Integration Tests:**
- Not present. No tests that exercise multiple modules together, hit databases, or test API routes.

**E2E Tests:**
- Not present. No Playwright, Cypress, or similar framework configured.

**Component Tests:**
- Not present. No React Testing Library, Enzyme, or component test setup. React components are untested.

## Common Patterns

**Async Testing:**
```javascript
test('importAnnotationsFromPdf imports polygon and square annotations', async () => {
  const pdfDoc = {
    numPages: 1,
    async getPage(pageNum) { return page; }
  };

  const result = await importAnnotationsFromPdf(pdfDoc);

  assert.deepEqual(result.unsupportedTypes, []);
  assert.ok(result.annotationsByPage[1]);
  assert.equal(result.annotationsByPage[1].objects.length, 2);
});
```

**Error Testing:**
- No explicit error/exception testing patterns observed. Tests focus on happy-path behavior.

**Null/Edge Case Testing:**
```javascript
test('convertPdfAnnotationToFabric ignores fully invisible square annotations', () => {
  const annotation = {
    id: 'square-invisible-1',
    subtype: 'Square',
    rect: [10, 20, 30, 40],
    borderStyle: { width: 0 }
  };

  const obj = convertPdfAnnotationToFabric(annotation, viewport);
  assert.equal(obj, null);
});

test('computeHasPendingExcelSyncChanges returns false when no linked Excel path exists', () => {
  const pending = computeHasPendingExcelSyncChanges({
    template: { id: 'template-1', linkedExcelPath: null },
    highlightAnnotations: { a: { name: 'Item A' } },
    baselineHash: null
  });
  assert.equal(pending, false);
});
```

## What Is Testable (Untested)

The following modules are pure utility functions well-suited for unit testing but currently have no tests:

- `src/utils/regionMath.js` - Polygon/rectangle containment, region merge/subtract operations
- `src/utils/geometryHitTest.js` - Point-on-object and rect-intersection geometry
- `src/utils/geometryEraser.js` - Path splitting and boolean erasing operations
- `src/utils/lineGeometry.js` - Midpoint, distance, projection, curve calculations
- `src/utils/calloutGeometry.js` - Callout connection/positioning calculations
- `src/utils/validation.js` - Zoom, page number, file name, email validation
- `src/utils/zoomController.js` - Scale clamping, preference load/save
- `src/utils/pageRangeParser.js` - Page range string parsing
- `src/utils/pdfAnnotationsPdfLib.js` - Annotation export to PDF
- `src/utils/menuPositioning.js` - Viewport-safe menu position calculation

## Adding New Tests

**To add a new test file:**
1. Create `tests/{moduleName}.test.mjs` in the `tests/` directory
2. Import from `node:test` and `node:assert/strict`
3. Import the module under test using relative path from `tests/` to `src/`
4. Write flat `test()` calls with descriptive names
5. Run with `npm test`

**Template:**
```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { functionToTest } from '../src/utils/moduleToTest.js';

test('functionToTest returns expected result for normal input', () => {
  const result = functionToTest(normalInput);
  assert.equal(result, expectedOutput);
});

test('functionToTest handles edge case correctly', () => {
  const result = functionToTest(edgeCaseInput);
  assert.equal(result, edgeCaseExpected);
});
```

---

*Testing analysis: 2026-03-04*
