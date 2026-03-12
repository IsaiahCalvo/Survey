# Phase 5: Pipeline Foundation - Research

**Researched:** 2026-03-12
**Domain:** Playwright test harness, Vite dev route bypass, Fabric.js canvas capture, session folder infrastructure
**Confidence:** HIGH

## Summary

Phase 5 builds the foundational automation pipeline: a dev-only test route that bypasses Supabase authentication, a Playwright harness that launches Chromium against the Vite dev server, and session folder infrastructure that captures artifacts with metadata. The critical validation gate is proving that Fabric.js canvas content appears in Playwright screenshots (not blank canvases).

The existing codebase provides strong integration points. The `AuthContext` and `useOptionalAuth` hook manage authentication -- both gracefully handle the case where Supabase is unavailable (user stays null, auth modal shown). The dev route must intercept before these systems engage. The `PDFViewer` component accepts a `pdfFile` (File object) prop and converts it to `Uint8Array` for Syncfusion. The existing `ralph-test/zoom-test.mjs` provides proven Playwright patterns for page navigation, CDP session creation, and canvas-container monitoring that can be extracted.

**Primary recommendation:** Use `@playwright/test` (v1.50+) with `webServer` config pointing to Vite dev, `channel: 'chromium'` for new headless mode, and serve test PDFs via a Vite dev-only static plugin from `debug/fixtures/`. The dev route bypass should be implemented in `main.jsx` using `import.meta.env.DEV` guards to short-circuit the entire provider tree, rendering only the PDF viewer with the test PDF loaded.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- Use existing "Package 2 - Rev 4 -- IC.pdf" as primary test fixture (has real annotations on page 6)
- Store test PDFs in `debug/fixtures/`
- `?testPdf=<name>` skips dashboard and auth entirely -- renders only the PDF viewer with the test PDF loaded
- Bypass all Supabase services (no auth, no real-time sync, no presence, no cloud save) -- fully offline/local
- Include the annotation toolbar (pen, shapes, etc.) so scenarios can test annotation creation, not just rendering
- Start at page 1 by default -- scenario scripts handle navigation via Playwright actions
- Compile-time guarded with `import.meta.env.DEV` -- zero code in production builds
- New `debug/` directory at project root -- separate from `src/` (app code)
- Flat structure: `debug/{playwright.config.mjs, fixtures/, scenarios/, lib/, debug-sessions/}`
- Session output folders go in `debug/debug-sessions/` (gitignored)
- Always launch fresh Chromium -- no CDP connect-to-existing mode
- Headless by default with `--headed` flag for visual debugging
- Normal speed even in headed mode -- no slowMo
- Auto-start Vite dev server via Playwright `webServer` config if port 5173 isn't responding
- `channel: 'chromium'` for consistent canvas rendering

### Claude's Discretion
- PDF loading mechanism (how dev route fetches the test PDF from debug/fixtures/)
- Viewport size (1400x900 or 1920x1080)
- What to migrate from ralph-test/ vs rebuild from scratch
- Manifest.json schema details (timestamp format, field names)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FOUN-01 | Dev-only test route loads a bundled test PDF at `localhost:5173?testPdf=<name>` without requiring Supabase authentication | Vite `import.meta.env.DEV` compile-time guard, Vite dev-only static plugin for serving fixtures, main.jsx provider bypass pattern |
| FOUN-02 | Dev-only test route is compile-time guarded and produces zero code in production builds | Vite replaces `import.meta.env.DEV` with `false` at build time; esbuild dead-code elimination removes the entire branch. Verified via `vite build` + grep |
| FOUN-03 | Playwright test harness launches Chromium with `channel: 'chromium'` for consistent canvas rendering | `@playwright/test` v1.50+ with `channel: 'chromium'` (new headless mode = real Chrome rendering engine). Canvas screenshots work with timing-aware waits |
| FOUN-04 | Playwright harness auto-starts the Vite dev server via `webServer` config if not already running | Playwright `webServer: { command, url, reuseExistingServer }` built-in feature |
| FOUN-05 | Each test run creates a session folder at `debug-sessions/<timestamp>_<scenario>/` containing all artifacts | Node.js `fs.mkdirSync` with ISO timestamp naming. Git SHA via `child_process.execSync('git rev-parse HEAD')` |
| FOUN-06 | Each session folder contains a `manifest.json` with scenario name, git SHA, start/end time, pass/fail result, and artifact file paths | Simple JSON schema written at session end. All fields derivable at runtime |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @playwright/test | ^1.50.0 | Browser automation and test harness | Industry standard for E2E testing, built-in webServer config, video/trace support, new headless mode |
| Vite | 5.4.21 (existing) | Dev server and build tool | Already in project. `import.meta.env.DEV` provides compile-time dead code elimination |
| Node.js | 22.17.0 (existing) | Runtime for test scripts and session management | Already in project. Built-in `node:fs`, `node:path`, `node:child_process` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| playwright (core) | (bundled with @playwright/test) | Browser launch and page control | Used internally by @playwright/test |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @playwright/test | playwright (library-only) | @playwright/test includes webServer config, test runner, and built-in assertions. Library mode would require manual orchestration. Use @playwright/test |
| Custom Vite plugin for fixtures | publicDir config change | publicDir would serve fixtures in production too. Custom plugin with `configureServer` is dev-only, safer |

**Installation:**
```bash
npm install -D @playwright/test
npx playwright install chromium
```

Note: Only install `chromium` browser, not all three -- the project only targets Chromium (Electron app).

## Architecture Patterns

### Recommended Project Structure
```
debug/
  playwright.config.mjs        # Playwright config with webServer
  fixtures/
    Package 2 - Rev 4 -- IC.pdf # Test PDF (copied from ralph-test/)
  scenarios/
    smoke.spec.mjs              # Basic Playwright test: open, navigate, screenshot
  lib/
    session.mjs                 # Session folder creation, manifest writing
    capture.mjs                 # Screenshot helpers with timing-aware waits
  debug-sessions/               # Gitignored output directory
    20260312T143022_smoke/
      manifest.json
      page6-annotated.png
src/
  main.jsx                      # Modified: dev route detection before provider tree
  DevTestRoute.jsx              # New: minimal component that fetches + renders test PDF
  App.jsx                       # Unchanged in Phase 5
```

### Pattern 1: Dev Route Bypass in main.jsx
**What:** Detect `?testPdf=<name>` query parameter at the entry point level and render a stripped-down component tree that skips AuthProvider, MSGraphProvider, Dashboard, and all Supabase services.
**When to use:** Always for the dev test route.
**Example:**
```jsx
// src/main.jsx - BEFORE the existing createRoot call
import React from 'react';
import { createRoot } from 'react-dom/client';
import { registerLicense } from '@syncfusion/ej2-base';
// ... existing imports ...

registerLicense(/* existing key */);

// DEV-ONLY: Test route bypass
if (import.meta.env.DEV) {
  const params = new URLSearchParams(window.location.search);
  const testPdf = params.get('testPdf');
  if (testPdf) {
    // Dynamic import so the module is never bundled in production
    import('./DevTestRoute').then(({ DevTestRoute }) => {
      createRoot(document.getElementById('root')).render(
        <DevTestRoute pdfName={testPdf} />
      );
    });
    // Stop execution -- don't render the normal app
    throw new Error('DEV_TEST_ROUTE_ACTIVE'); // Won't be seen; dynamic import already took over
  }
}

// ... existing normal app rendering ...
```

**Key insight:** The dynamic `import()` inside the `if (import.meta.env.DEV)` block is eliminated by Vite in production builds. The entire DevTestRoute module and its dependencies are tree-shaken out.

**Alternative approach (simpler):** Instead of throwing, use a module-level flag and wrap the normal `createRoot` call in a conditional. The dynamic import approach is cleaner because it avoids race conditions with the module-level `createRoot`.

### Pattern 2: DevTestRoute Component
**What:** A minimal React component that fetches the test PDF from `/debug-fixtures/<name>`, creates a `File` object, and renders only the PDFViewer.
**When to use:** Only rendered when `?testPdf=<name>` is detected in dev mode.
**Example:**
```jsx
// src/DevTestRoute.jsx
import React, { useState, useEffect } from 'react';
import { registerLicense } from '@syncfusion/ej2-base';

export function DevTestRoute({ pdfName }) {
  const [pdfFile, setPdfFile] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadTestPdf = async () => {
      try {
        const url = `/debug-fixtures/${encodeURIComponent(pdfName)}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to load test PDF: ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        const file = new File([arrayBuffer], pdfName, { type: 'application/pdf' });
        setPdfFile(file);
      } catch (err) {
        setError(err.message);
      }
    };
    loadTestPdf();
  }, [pdfName]);

  if (error) return <div style={{ color: 'red', padding: 20 }}>Test PDF Error: {error}</div>;
  if (!pdfFile) return <div style={{ padding: 20 }}>Loading test PDF: {pdfName}...</div>;

  // Render PDFViewer directly with null user (no auth)
  // Import PDFViewer or the relevant portion of App
  // Implementation detail: may need to extract PDFViewer or render App in test mode
  return <PDFViewerWrapper pdfFile={pdfFile} />;
}
```

### Pattern 3: Vite Dev-Only Static File Plugin
**What:** A Vite plugin that serves files from `debug/fixtures/` at the URL path `/debug-fixtures/` during development only. Not included in production builds.
**When to use:** Always needed for the dev route to load test PDFs.
**Example:**
```javascript
// In vite.config.js
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function debugFixturesPlugin() {
  return {
    name: 'serve-debug-fixtures',
    configureServer(server) {
      server.middlewares.use('/debug-fixtures', (req, res, next) => {
        const filePath = path.join(__dirname, 'debug', 'fixtures', decodeURIComponent(req.url));
        if (fs.existsSync(filePath)) {
          const stream = fs.createReadStream(filePath);
          res.setHeader('Content-Type', 'application/pdf');
          stream.pipe(res);
        } else {
          res.statusCode = 404;
          res.end('Test fixture not found');
        }
      });
    }
  };
}

// Add to plugins array: debugFixturesPlugin()
```

### Pattern 4: Playwright Config with webServer
**What:** Playwright configuration that auto-starts Vite dev server and launches Chromium with the new headless mode.
**When to use:** All test runs.
**Example:**
```javascript
// debug/playwright.config.mjs
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './scenarios',
  outputDir: './debug-sessions',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5173',
    channel: 'chromium',
    viewport: { width: 1400, height: 900 },
    headless: true,
    video: 'off', // Phase 5 doesn't need video yet
    screenshot: 'off', // We take manual screenshots
  },
  webServer: {
    command: 'npm run dev:ui',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'chromium',
      use: { channel: 'chromium' },
    },
  ],
});
```

### Pattern 5: Session Folder and Manifest
**What:** Each test run creates a timestamped folder with a `manifest.json` containing metadata.
**When to use:** Every scenario execution.
**Example:**
```javascript
// debug/lib/session.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

export function createSession(scenarioName, baseDir) {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '').slice(0, 15); // 20260312T143022
  const folderName = `${timestamp}_${scenarioName}`;
  const sessionDir = join(baseDir, folderName);
  mkdirSync(sessionDir, { recursive: true });

  const gitSha = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();

  const manifest = {
    scenario: scenarioName,
    gitSha,
    startTime: now.toISOString(),
    endTime: null,
    result: null,
    artifacts: [],
  };

  return { sessionDir, manifest, folderName };
}

export function finalizeSession(sessionDir, manifest, result, artifacts) {
  manifest.endTime = new Date().toISOString();
  manifest.result = result; // 'pass' or 'fail'
  manifest.artifacts = artifacts;
  writeFileSync(
    join(sessionDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
}
```

### Anti-Patterns to Avoid
- **CDP connect-to-existing mode:** User explicitly prohibited this. Always launch fresh Chromium for determinism and Playwright video/trace compatibility.
- **Modifying App.jsx for the dev route:** App.jsx is a 1.3MB monolith. The dev route bypass should happen in `main.jsx` before App.jsx is even imported. This avoids adding complexity to an already massive file.
- **Serving test PDFs from `public/`:** Files in `public/` are included in production builds. Use a dev-only Vite plugin instead.
- **Using `slowMo` in headed mode:** User explicitly chose normal speed to preserve timing fidelity. Video captures everything.
- **Mocking Supabase instead of bypassing it:** The dev route should render a component tree that never imports Supabase services, rather than mocking them. Cleaner and less fragile.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Browser automation | Custom CDP client | @playwright/test | Robust API, built-in waits, webServer config, screenshot/video/trace |
| Dev server lifecycle | Manual port checking + spawn | Playwright webServer config | Handles startup, readiness detection, shutdown automatically |
| Timestamped folder naming | Complex date formatting | `new Date().toISOString().replace(/[:.]/g, '')` | ISO 8601 is sortable, universally understood |
| Git SHA retrieval | Parsing .git/HEAD manually | `execSync('git rev-parse HEAD')` | One-liner, always correct, handles detached HEAD |
| PDF serving in dev | Custom Express server alongside Vite | Vite `configureServer` plugin | Runs inside existing dev server, no extra process |

**Key insight:** Phase 5 is intentionally minimal infrastructure. Resist the urge to build framework-level abstractions for scenarios, reporters, or capture pipelines -- those belong to Phases 6-9.

## Common Pitfalls

### Pitfall 1: Blank Canvas Screenshots (CRITICAL)
**What goes wrong:** Playwright takes a screenshot before Fabric.js has finished rendering canvas content. The screenshot shows blank white canvases.
**Why it happens:** Fabric.js `renderAll()` is asynchronous and takes 200-800ms per page. Syncfusion also rebuilds `e-pv-page-div` containers during initial load and zoom, temporarily disconnecting React portals that host the Fabric canvases.
**How to avoid:** Wait for canvas content after page navigation:
1. Wait for the `.canvas-container` elements to exist: `await page.locator('.canvas-container').first().waitFor({ state: 'visible' })`
2. Wait for Fabric.js to finish painting by evaluating `document.querySelectorAll('.canvas-container canvas').length > 0` and checking canvas has non-zero pixel data
3. Add a conservative `waitForTimeout(2000)` after navigation to page 6 to allow Syncfusion + Fabric.js rendering to complete
4. Verify the screenshot has non-white pixels in the canvas region (can be checked programmatically in Phase 8, but visual verification suffices for Phase 5)
**Warning signs:** Screenshots that show the PDF page background but blank white rectangles where annotations should be.

### Pitfall 2: Auth Modal Blocking Test Route
**What goes wrong:** Even with the dev route query parameter, the OptionalAuthPrompt component fires and shows the auth modal overlay, blocking the PDF viewer.
**Why it happens:** `OptionalAuthPrompt` runs an effect that shows the auth modal when `!isAuthenticated && !authPromptDismissed`. If the dev route still renders within the normal `AuthProvider` tree, this fires.
**How to avoid:** The dev route bypass MUST happen before `AuthProvider` in the component tree. Implementing it in `main.jsx` with a separate `createRoot` call that does not include `AuthProvider` or `MSGraphProvider` is the correct approach.
**Warning signs:** Playwright sees the auth modal overlay in screenshots instead of the PDF viewer.

### Pitfall 3: PDFViewer Props Dependency on Auth Context
**What goes wrong:** The `PDFViewer` component internally calls `useAuth()` (line 9089 of App.jsx), which requires being wrapped in `AuthProvider`. Rendering PDFViewer outside the provider tree crashes with "useAuth must be used within an AuthProvider."
**Why it happens:** PDFViewer uses `features` from useAuth for feature-gating, and various save/upload functions depend on authenticated Supabase hooks.
**How to avoid:** Two approaches:
1. **Wrap with a minimal AuthProvider that returns mock values** -- an AuthProvider with no Supabase connection returns `user: null, isAuthenticated: false, features: {}`. Since `supabaseClient.js` already handles `!supabaseUrl` gracefully (returns `supabase = null`), this may work out of the box.
2. **Create a DevPDFViewer wrapper** that provides mock context values for auth, storage, and MSGraph hooks via context providers that return no-op functions.
**Warning signs:** React error boundary catches "useAuth must be used within an AuthProvider" or similar context errors.

### Pitfall 4: Vite webServer Timeout
**What goes wrong:** Playwright's webServer times out waiting for Vite to start because the app has many Syncfusion dependencies that slow down initial module resolution.
**Why it happens:** Vite cold start with 30+ Syncfusion packages from local `file:` links can take 15-30 seconds. Default Playwright webServer timeout is 60s, which may be tight.
**How to avoid:** Set `timeout: 120_000` (2 minutes) in the webServer config. Also set `reuseExistingServer: true` so manual `npm run dev:ui` sessions are reused (faster iteration).
**Warning signs:** Playwright test fails with "Timed out waiting for web server" before any browser launches.

### Pitfall 5: File Object Size Mismatch
**What goes wrong:** The test PDF (~6MB) fetched via HTTP doesn't round-trip correctly through `fetch -> arrayBuffer -> File -> arrayBuffer` and Syncfusion fails to load it.
**Why it happens:** Incorrect Content-Type header or chunked encoding can corrupt binary data if the Vite plugin doesn't handle it correctly.
**How to avoid:** Ensure the Vite plugin sets `Content-Type: application/pdf` and `Content-Length` headers. Verify by comparing file sizes: `stat debug/fixtures/*.pdf` vs the `File.size` property in the browser.
**Warning signs:** Syncfusion `documentLoadFailed` event fires with corruption errors.

### Pitfall 6: Production Build Includes Dev Code
**What goes wrong:** The `DevTestRoute` component or debug fixtures appear in the production build.
**Why it happens:** Static imports of DevTestRoute in main.jsx would be bundled regardless of the `if (import.meta.env.DEV)` guard. Only dynamic `import()` inside the guarded block gets tree-shaken.
**How to avoid:** Use dynamic `import('./DevTestRoute')` inside the `if (import.meta.env.DEV)` block, never a static import. Verify with `npm run build` and check that `DevTestRoute` does not appear in `dist/assets/*.js`.
**Warning signs:** `grep -r "DevTestRoute" dist/` returns matches.

## Code Examples

### Canvas Content Verification Pattern
```javascript
// Verify Fabric.js canvas has rendered content (not blank)
// Use in Playwright test after navigating to an annotated page
async function waitForCanvasContent(page, timeout = 10000) {
  // Wait for canvas-container elements to appear
  await page.locator('.canvas-container').first().waitFor({
    state: 'visible',
    timeout
  });

  // Wait for canvas to have non-transparent pixels
  const hasContent = await page.evaluate(() => {
    const canvases = document.querySelectorAll('.canvas-container canvas');
    if (canvases.length === 0) return false;

    // Check the upper canvas (Fabric.js interactive layer)
    const canvas = canvases[canvases.length - 1]; // upper-canvas
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Count non-transparent, non-white pixels
    let nonBlankPixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
      if (a > 0 && !(r === 255 && g === 255 && b === 255)) {
        nonBlankPixels++;
      }
    }
    return nonBlankPixels > 100; // Threshold: at least 100 colored pixels
  });

  return hasContent;
}
```

### Page Navigation Pattern (from ralph-test/zoom-test.mjs)
```javascript
// Navigate to a specific page in the Syncfusion PDF viewer
async function navigateToPage(page, pageNumber) {
  const pageInput = page.getByRole('textbox', { name: 'Current page' });
  await pageInput.click();
  await pageInput.fill(String(pageNumber));
  await pageInput.press('Enter');
  // Wait for Syncfusion page change + Fabric.js render
  await page.waitForTimeout(4000);
}
```

### Manifest JSON Schema
```json
{
  "scenario": "smoke",
  "gitSha": "e3d763752436d4358d31043ea18d0ac8dbbb5dcd",
  "startTime": "2026-03-12T14:30:22.000Z",
  "endTime": "2026-03-12T14:31:05.123Z",
  "result": "pass",
  "artifacts": [
    { "type": "screenshot", "path": "page6-annotated.png", "description": "Page 6 with Fabric.js annotations visible" }
  ]
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Playwright headless shell | `channel: 'chromium'` new headless mode | Playwright 1.45+ (2024) | Real Chrome rendering engine, better canvas/WebGL support |
| `port` in webServer config | `url` in webServer config | Playwright 1.40+ | `port` is deprecated, `url` supports health check paths |
| CDP connect-to-existing (ralph-test) | Fresh Chromium launch | Phase 5 decision | Deterministic, enables video/trace, no manual browser setup |
| `Vite.publicDir` for test fixtures | Custom `configureServer` plugin | Best practice | Keeps test fixtures out of production builds |

**Deprecated/outdated:**
- `webServer.port` -- use `webServer.url` instead
- Playwright headless shell (default without channel) -- `channel: 'chromium'` provides more accurate rendering

## Open Questions

1. **PDFViewer extraction from App.jsx**
   - What we know: PDFViewer is a function defined inside App.jsx (not exported separately). It depends on several hooks (`useAuth`, `useStorage`, `useDocuments`) that require provider context.
   - What's unclear: Whether rendering a mock provider tree that satisfies all PDFViewer dependencies is feasible without significant refactoring.
   - Recommendation: Start with the simplest approach: render the full normal App component tree but with Supabase env vars unset (triggering `supabase = null` path) and programmatically dismiss the auth modal via URL parameter detection. If PDFViewer crashes without auth context, fall back to creating a minimal mock provider wrapper. Test this during implementation.

2. **Viewport Size Selection**
   - What we know: ralph-test uses 1400x900 successfully. 1920x1080 would show more of the page.
   - What's unclear: Whether annotations on page 6 are visible in both viewport sizes.
   - Recommendation: Use 1400x900 (proven in ralph-test). This viewport matches common laptop screens and the existing test screenshots confirm annotations are visible at this size.

3. **What to Migrate from ralph-test/**
   - What we know: `zoom-test.mjs` contains useful patterns (page navigation, canvas-container monitoring, CDP input dispatch). The test PDF is needed.
   - What's unclear: How much of the monitoring script (`window.__rm`) is needed in Phase 5 vs Phase 6.
   - Recommendation: Copy the test PDF to `debug/fixtures/`. Extract the page navigation pattern. Leave the monitoring script for Phase 6 (instrumentation). Delete ralph-test/ after Phase 5 is verified working.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | @playwright/test ^1.50.0 |
| Config file | `debug/playwright.config.mjs` (Wave 0 -- must be created) |
| Quick run command | `npx playwright test --config debug/playwright.config.mjs` |
| Full suite command | `npx playwright test --config debug/playwright.config.mjs` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FOUN-01 | Dev route loads test PDF without auth | e2e | `npx playwright test --config debug/playwright.config.mjs -g "loads test PDF"` | Wave 0 |
| FOUN-02 | Zero dev code in production build | smoke | `npm run build && ! grep -r "DevTestRoute\|testPdf\|debug-fixtures" dist/assets/` | Wave 0 |
| FOUN-03 | Playwright launches Chromium with channel:chromium | e2e | `npx playwright test --config debug/playwright.config.mjs -g "chromium"` | Wave 0 |
| FOUN-04 | webServer auto-starts Vite | e2e | Verified implicitly by any Playwright test passing when Vite is not manually running | Wave 0 |
| FOUN-05 | Session folder created with timestamp naming | e2e | `npx playwright test --config debug/playwright.config.mjs -g "session folder"` | Wave 0 |
| FOUN-06 | manifest.json with required fields | e2e | `npx playwright test --config debug/playwright.config.mjs -g "manifest"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx playwright test --config debug/playwright.config.mjs`
- **Per wave merge:** Same (single test suite in Phase 5)
- **Phase gate:** All scenarios pass + production build verification (FOUN-02)

### Wave 0 Gaps
- [ ] `debug/playwright.config.mjs` -- Playwright configuration file
- [ ] `debug/scenarios/smoke.spec.mjs` -- Basic smoke test covering FOUN-01 through FOUN-06
- [ ] `debug/lib/session.mjs` -- Session folder creation utility
- [ ] `debug/fixtures/Package 2 - Rev 4 -- IC.pdf` -- Test PDF fixture (copy from ralph-test/)
- [ ] `src/DevTestRoute.jsx` -- Dev-only test route component
- [ ] Framework install: `npm install -D @playwright/test && npx playwright install chromium`

## Sources

### Primary (HIGH confidence)
- [Playwright webServer docs](https://playwright.dev/docs/test-webserver) -- webServer config options, reuseExistingServer, timeout
- [Playwright screenshots docs](https://playwright.dev/docs/screenshots) -- page.screenshot() API, fullPage, path options
- [Playwright configuration docs](https://playwright.dev/docs/test-configuration) -- outputDir, use options, projects
- [Playwright browsers docs](https://playwright.dev/docs/browsers) -- channel: 'chromium' new headless mode explanation
- [Vite env and mode docs](https://vite.dev/guide/env-and-mode) -- import.meta.env.DEV dead-code elimination
- [Playwright canvas issue #19225](https://github.com/microsoft/playwright/issues/19225) -- Canvas screenshot timing (closed: not a bug, timing issue)

### Secondary (MEDIUM confidence)
- [Playwright use options](https://playwright.dev/docs/test-use-options) -- viewport, headless, video, channel config
- [Vite static asset handling](https://vite.dev/guide/assets) -- publicDir, custom middleware alternatives
- Existing codebase analysis: main.jsx, App.jsx, AuthContext.jsx, supabaseClient.js, SyncfusionPDFContainer.jsx, ralph-test/zoom-test.mjs

### Tertiary (LOW confidence)
- Canvas pixel verification pattern -- derived from general canvas testing practices, not from a specific authoritative source. Should be validated during implementation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Playwright is the clear choice, already used in ralph-test prototype. Vite is the existing build tool.
- Architecture: HIGH -- Dev route bypass pattern is well-understood. Vite plugin pattern is documented. Session folder is trivial Node.js.
- Pitfalls: HIGH -- Blank canvas issue is well-documented and the root cause (timing) is understood. Auth bypass is confirmed by reading AuthContext source. Production build verification is straightforward.
- Canvas capture: MEDIUM -- While canvas screenshots work in Chromium with proper timing, Fabric.js specifically has not been tested in this headless configuration. This is the Phase 5 gate.

**Research date:** 2026-03-12
**Valid until:** 2026-04-12 (stable domain -- Playwright and Vite APIs change slowly)
