# Phase 5: Pipeline Foundation - Context

**Gathered:** 2026-03-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Dev-only test route, Playwright harness, session folder infrastructure, and canvas capture validation. A working pipeline can open the app without authentication, navigate to a test page, and produce a session folder with a screenshot proving Fabric.js canvas content is captured. No capture modules, no debug bridge, no post-processing — those are Phases 6-9.

</domain>

<decisions>
## Implementation Decisions

### Test PDF strategy
- Use existing "Package 2 - Rev 4 -- IC.pdf" as primary test fixture (has real annotations on page 6)
- Store test PDFs in `debug/fixtures/`
- Purpose-built minimal test PDFs can be added later for targeted scenarios, but not in Phase 5 scope
- Annotations are pre-baked into the PDF itself — no Supabase annotation records needed, no seeding mechanism

### Dev route behavior
- `?testPdf=<name>` skips dashboard and auth entirely — renders only the PDF viewer with the test PDF loaded
- Bypass all Supabase services (no auth, no real-time sync, no presence, no cloud save) — fully offline/local
- Include the annotation toolbar (pen, shapes, etc.) so scenarios can test annotation creation, not just rendering
- Start at page 1 by default — scenario scripts handle navigation via Playwright actions
- Compile-time guarded with `import.meta.env.DEV` — zero code in production builds

### Debug infrastructure layout
- New `debug/` directory at project root — separate from `src/` (app code)
- Flat structure with clear names:
  ```
  debug/
  ├── playwright.config.mjs
  ├── fixtures/
  │   └── Package 2 - Rev 4 -- IC.pdf
  ├── scenarios/
  │   └── zoom-flicker.mjs
  ├── lib/
  │   ├── session.mjs
  │   └── capture.mjs
  └── debug-sessions/  (gitignored output)
  ```
- Session output folders go in `debug/debug-sessions/` (gitignored)
- `ralph-test/` — Claude's discretion on what to migrate vs rebuild; remove when no longer needed

### Browser launch strategy
- Always launch fresh Chromium — no CDP connect-to-existing mode (deterministic, enables Playwright video/trace)
- Headless by default with `--headed` flag for visual debugging
- Normal speed even in headed mode — video captures everything, no slowMo (preserves timing fidelity)
- Auto-start Vite dev server via Playwright `webServer` config if port 5173 isn't responding
- `channel: 'chromium'` for consistent canvas rendering

### Claude's Discretion
- PDF loading mechanism (how dev route fetches the test PDF from debug/fixtures/ — Vite dev server serving, inline import, or other approach)
- Viewport size (1400x900 or 1920x1080 — pick what shows annotations clearly)
- What to migrate from ralph-test/ vs rebuild from scratch
- Manifest.json schema details (timestamp format, field names)

</decisions>

<specifics>
## Specific Ideas

- The existing zoom-test.mjs has proven patterns for CDP-based zoom input, canvas-container monitoring (`window.__rm`), and page navigation — worth extracting even if the CDP connect mode is dropped
- Canvas capture validation is the Phase 5 gate: if Fabric.js content appears blank in Playwright screenshots, the entire artifact strategy needs revision before proceeding to Phase 6
- Session folders follow `<timestamp>_<scenario>/` naming with a `manifest.json` containing scenario name, git SHA, start/end time, pass/fail result, and artifact file paths

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ralph-test/zoom-test.mjs`: Working Playwright prototype with zoom scenario scripts, canvas-container monitoring, and CDP input dispatch — patterns can be extracted
- `src/utils/pdfDebug.js`: Existing debug logging utilities with `debugLog()`, `debugWarn()` functions
- `src/utils/performanceLogger.js`: Custom `PerformanceLogger` class with `start()/mark()/end()` API
- Existing debug APIs on window: `pdfPerf`, `__pdfHistoryDebug`

### Established Patterns
- `import.meta.env.DEV` is the Vite compile-time guard pattern — research confirms this for dead-code elimination
- PDF loading: App currently downloads PDFs from Supabase as Uint8Array blobs passed to Syncfusion
- All React components use functional components with hooks and inline styles from theme.js tokens
- Node.js built-in test runner used for existing tests (`tests/*.test.mjs`)

### Integration Points
- `src/App.jsx`: Main app component where dev route bypass would be added (line ~30562 App component)
- `src/main.jsx`: React entry point where dev route detection could short-circuit auth providers
- `src/supabaseClient.js`: Supabase client initialization — dev route needs to bypass or mock this
- `vite.config.js`: May need dev-only static file serving for test PDF fixtures
- `package.json`: New `debug:scenario` script entry point (FOUN-08, but that's Phase 7 — Phase 5 just needs basic harness)

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-pipeline-foundation*
*Context gathered: 2026-03-12*
