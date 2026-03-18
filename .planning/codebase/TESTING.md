# Testing Patterns

**Analysis Date:** 2026-03-17

## Test Framework

**Runner:**
- Node.js native test runner (`node:test`)
- Playwright for end-to-end/integration testing (`@playwright/test` v1.58.2)

**Assertion Library:**
- Node.js native `assert/strict` module for unit tests
- Playwright assertions (`expect()`) for e2e tests

**Run Commands:**
```bash
npm test                    # Run all unit tests in tests/ directory
npm run test:debug          # Run Playwright tests with debug config
npm run debug:scenario      # Run specific Playwright scenario with --grep
npm run debug:process       # Post-process debug artifacts
```

## Test File Organization

**Location:**
- Unit tests: `/tests/` directory (separate from source)
- Integration/e2e tests: `/debug/scenarios/` directory
- Both patterns: co-located helpers and fixtures in same directory as tests

**Naming:**
- Unit tests: `*.test.mjs` extension (e.g., `excelSyncDirtyState.test.mjs`)
- E2E/scenario tests: `*.spec.mjs` extension (e.g., `smoke.spec.mjs`)
- Helper modules: lowercase `.mjs` extension (e.g., `session.mjs`, `timeline-writer.mjs`)

**Structure:**
```
tests/
├── anomaly-detector.test.mjs
├── excelSyncDirtyState.test.mjs
├── pdfAnnotationImporter.test.mjs
├── timeline-merger.test.mjs
├── timeline-writer.test.mjs
└── visual-diff.test.mjs

debug/
├── lib/
│   ├── session.mjs          # Session management helpers
│   ├── timeline-writer.mjs   # Narrative writing utilities
│   └── post-process.mjs      # Artifact processing
├── scenarios/
│   ├── smoke.spec.mjs
│   ├── zoom-flicker.spec.mjs
│   ├── readiness-signals.spec.mjs
│   └── bridge-snapshot.spec.mjs
└── playwright.config.mjs
```

## Test Structure

**Suite Organization (Node.js test runner):**
```javascript
import test from 'node:test';
import assert from 'node:assert/strict';

test('description of what is being tested', () => {
  // Arrange
  const input = { id: 'template-1', linkedExcelPath: '/tmp/survey.xlsx' };

  // Act
  const result = computeHasPendingExcelSyncChanges(input);

  // Assert
  assert.equal(result, false);
});
```

**Suite Organization (Playwright):**
```javascript
import { test, expect } from '@playwright/test';
import { createSession, finalizeSession, getSessionBaseDir } from '../lib/session.mjs';

let sessionDir;
let manifest;

test.beforeEach(async () => {
  const baseDir = getSessionBaseDir();
  const session = createSession('smoke', baseDir);
  sessionDir = session.sessionDir;
  manifest = session.manifest;
});

test.afterEach(async () => {
  finalizeSession(sessionDir, manifest, 'fail', []);
});

test('smoke test - loads PDF and captures content', async ({ page }) => {
  await page.goto('/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf');
  await page.locator('.e-pv-viewer-container').waitFor({ state: 'visible' });
  // ... test steps
});
```

**Patterns:**
- Setup via `test.beforeEach()` / `test.afterEach()` or `describe()/before/after`
- Teardown ensures cleanup even on failure
- Fixtures created fresh for each test
- Async operations awaited explicitly

## Mocking

**Framework:** Manual mocking via factory functions and test doubles

**Patterns:**
Creating mock viewport objects for PDF annotation testing:
```javascript
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
```

Creating mock PDF page and document objects:
```javascript
const page = {
  getViewport() { return viewport; },
  async getAnnotations() {
    return [
      { id: 'square-1', subtype: 'Square', rect: [10, 30, 50, 70], color: [0, 0, 0] }
    ];
  }
};

const pdfDoc = {
  numPages: 1,
  async getPage(pageNum) {
    return page;
  }
};
```

**What to Mock:**
- External API responses (Supabase queries return `{ data, error }` objects)
- PDF.js viewport transformations
- File system operations in tests (use temp directories)
- Browser/DOM APIs in Playwright tests (use `page.evaluate()` and `page.locator()`)

**What NOT to Mock:**
- Core business logic (test the actual implementation)
- Fabric.js canvas operations (test real canvas rendering)
- Annotation transformation logic (test with real PDF.js viewports)
- Time-sensitive operations (use real `await` and timeouts)

## Fixtures and Factories

**Test Data:**
Template fixture used across Excel sync tests:
```javascript
const linkedTemplate = {
  id: 'template-1',
  supabaseId: 'supabase-template-1',
  linkedExcelPath: '/tmp/survey.xlsx',
  oneDriveApiPath: '/Documents/survey.xlsx',
  oneDriveFileId: 'onedrive-file-1'
};
```

Timeline fixture for narrative writing tests:
```javascript
function buildTimeline() {
  return [
    { sessionMs: 1000, step: 0, action: 'baseline', zoomLevel: 50, ... },
    { sessionMs: 2000, step: 1, action: 'zoom-to-100', zoomLevel: 100, ... },
  ];
}
```

Session manifest fixture:
```javascript
const MANIFEST = {
  scenario: 'zoom-flicker',
  result: 'pass',
  startTime: '2026-03-13T04:07:42.432Z',
  endTime: '2026-03-13T04:07:46.901Z',
  captureStartMs: 900,
  criteriaResults: { ... },
  artifacts: [ ... ]
};
```

**Location:**
- Fixtures defined at top of test file as constants
- Shared factory functions defined as helper functions in test file
- Temporary directories created in `beforeEach` using Node.js `fs` module

## Coverage

**Requirements:** Not enforced (no coverage config detected)

**View Coverage:**
```bash
# No native coverage command configured
# Coverage could be added via --experimental-coverage flag:
node --experimental-test-coverage --test tests/*.test.mjs
```

## Test Types

**Unit Tests:**
- Scope: Pure functions (computation, validation, transformation)
- Approach: Synchronous execution, mocked external dependencies
- Location: `/tests/` directory with `.test.mjs` files
- Examples: `excelSyncDirtyState.test.mjs`, `pdfAnnotationImporter.test.mjs`, `validation.js` utilities
- Run with: `npm test`

**Integration Tests:**
- Scope: Cross-module interactions (e.g., PDF annotation importing with viewport transformations)
- Approach: Real objects, mock only external services (Supabase)
- Async operations fully executed
- Example: `importAnnotationsFromPdf()` tests multiple annotation types across page transformations

**E2E/Scenario Tests:**
- Scope: Full browser workflow (PDF loading, zoom, canvas rendering, UI interactions)
- Approach: Real Playwright browser, real dev server, real Syncfusion PDF viewer
- Location: `/debug/scenarios/` with `.spec.mjs` files
- Examples: `smoke.spec.mjs` (basic load), `zoom-flicker.spec.mjs` (zoom stability)
- Config: `/debug/playwright.config.mjs`
- Run with: `npm run test:debug` or `npm run debug:scenario "test-name"`

## Common Patterns

**Async Testing (Node.js):**
```javascript
test('importAnnotationsFromPdf imports annotations async', async () => {
  const pdfDoc = {
    numPages: 1,
    async getPage(pageNum) {
      return page; // page has async getAnnotations()
    }
  };

  const result = await importAnnotationsFromPdf(pdfDoc);
  assert.ok(result.annotationsByPage[1]);
});
```

**Async Testing (Playwright):**
```javascript
test('navigates to page and waits for canvas', async ({ page }) => {
  await page.goto('/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf');

  // Wait for specific UI state
  const pageInput = page.getByRole('textbox', { name: 'Current page' });
  await expect(pageInput).toBeVisible({ timeout: 15_000 });

  // Perform action and wait for effect
  await pageInput.click();
  await pageInput.fill('6');
  await pageInput.press('Enter');
  await page.waitForTimeout(5000);
});
```

**Error Testing:**
```javascript
test('convertPdfAnnotationToFabric ignores fully invisible annotations', () => {
  const annotation = {
    id: 'square-invisible-1',
    subtype: 'Square',
    rect: [10, 20, 30, 40],
    borderStyle: { width: 0 }
  };

  const obj = convertPdfAnnotationToFabric(annotation, viewport);
  assert.equal(obj, null); // Should return null for invisible annotations
});
```

**Assertion Patterns:**
```javascript
// Unit test assertions
assert.equal(actual, expected);           // Strict equality
assert.deepEqual(obj1, obj2);             // Deep object comparison
assert.ok(value);                         // Truthy check
assert.throws(() => fn(), Error);         // Exception testing

// Playwright assertions
await expect(locator).toBeVisible();
await expect(locator).toHaveCount(n);
await expect(page.evaluate(...)).resolves.toBe(value);
```

## Playwright Configuration

**File:** `/debug/playwright.config.mjs`

**Key Settings:**
```javascript
{
  testDir: './scenarios',
  timeout: 120_000,         // 2 minutes per test (Syncfusion cold start slow)
  expect: { timeout: 30_000 },
  use: {
    baseURL: 'http://localhost:5173',
    channel: 'chromium',
    viewport: { width: 1400, height: 900 },
    headless: true,
    video: { mode: 'on', size: { width: 1400, height: 900 } },
    screenshot: 'off'
  },
  webServer: {
    command: 'npm run dev:ui',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000
  }
}
```

**Timeout Strategy:**
- Conservative timeouts: test timeouts 120s, expect() 30s due to Syncfusion initialization overhead
- Manual `waitForTimeout()` calls for Fabric.js render completion (2-5 seconds)
- Locator waits with explicit timeout overrides for slow elements

## Test Scenarios

**Smoke Test (`smoke.spec.mjs`):**
- Validates end-to-end pipeline works
- Opens PDF, navigates to page with annotations
- Confirms Fabric.js canvas has non-blank pixel content
- Creates session folder with manifest and artifacts

**Zoom Flicker Test (`zoom-flicker.spec.mjs`):**
- Tests PDF zoom stability across 6 zoom methods
- Captures zoom state before/after transitions
- Validates Syncfusion overlay page persistence
- Checks React portal host reconnection

---

*Testing analysis: 2026-03-17*
