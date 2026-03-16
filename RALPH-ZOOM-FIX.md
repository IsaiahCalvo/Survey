# Zoom Annotation Fix - Ralph Loop Prompt

Read this ENTIRE file at the start of every iteration. Then read .planning/debug/zoom-fix-progress.md and .planning/debug/ralph-test-log.md (create it if missing).

## App Access & Login

- Dev server: http://localhost:5173/
- Login credentials: Read from /Users/isaiahcalvo/.claude/projects/-Users-isaiahcalvo-Desktop-Survey-BetaSafeS2/memory/credentials.md
- If you see a login screen, enter the email and password from that file
- After login, you should see a file list / dashboard
- Open document: "Package 2 - Rev 4 -- IC.pdf"
- Navigate to page 6 (first page with annotations) via the page number input field

## What You're Testing

You are fixing and testing a **zoom bug in a PDF annotation tool**. When users zoom in/out on the PDF:
- Annotations (shapes, text, drawings on the PDF) should stay visible at ALL times
- Annotations should scale smoothly with the page during zoom
- After zoom ends, annotations should re-render crisply at the new zoom level
- Annotations should NOT: disappear, flicker, jump to wrong positions, resize incorrectly

## Test Log

Maintain a test log at `.planning/debug/ralph-test-log.md`. Each iteration, append:

```markdown
## Iteration N — [timestamp]
### What I Did
[code changes made, or "baseline test — no changes"]
### Tests Run
[which zoom methods tested]
### Results Per Zoom Method
#### Ctrl+Wheel Zoom In
- Annotations visible during zoom: YES/NO
- Annotations visible after zoom settles: YES/NO
- Canvas container count dropped to 0: YES/NO
- Flickering observed: YES/NO
- Position shift observed: YES/NO
- Incorrect sizing observed: YES/NO
- Jank metrics: [frame times, dropped frames]
- Screenshot: [filename]
#### Ctrl+Wheel Zoom Out
[same fields]
#### Ctrl+Plus
[same fields]
#### Ctrl+Minus
[same fields]
#### Toolbar Zoom In Button
[same fields]
#### Toolbar Zoom Out Button
[same fields]
#### Trackpad Pinch (if possible)
[same fields or "cannot simulate via CDP"]
### DOM State
- canvas-container count before: X
- canvas-container minimum during zoom: X
- canvas-container count after settle: X
- lower-canvas count before/min/after: X/X/X
- Portal hosts connected: [list]
- Fallback hosts active: [list]
### Console Errors/Warnings
[any relevant console output]
### Assessment
[what's working, what's broken, what to try next]
### Next Action
[specific code change to make, or "all passing — run again to confirm"]
```

## How to Test — Step by Step

Use **Playwright MCP tools** (mcp__plugin_playwright_playwright__browser_* tools).

### Phase 1: Navigate & Login
1. `browser_navigate` to http://localhost:5173/
2. `browser_snapshot` to see the page state
3. If login screen: use `browser_click` and `browser_type` to enter credentials and submit
4. `browser_wait_for` until the dashboard/file list appears
5. `browser_snapshot` to find "Package 2 - Rev 4 -- IC.pdf"
6. `browser_click` on that PDF document
7. `browser_wait_for` until PDF loads (look for page content)
8. Navigate to page 6: find the page number input, clear it, type "6", press Enter
9. `browser_wait_for` a moment for page 6 to render
10. `browser_take_screenshot` — save as `ralph-test/baseline.png`

### Phase 2: Install Monitoring
Use `browser_run_code` to inject monitoring script:

```javascript
async (page) => {
  return await page.evaluate(() => {
    // Clear any previous monitor
    if (window.__zoomMonitor) {
      cancelAnimationFrame(window.__zoomMonitor.rafId);
    }

    window.__zoomMonitor = {
      frames: [],
      startTime: performance.now(),
      rafId: null,
      running: true
    };

    function recordFrame() {
      if (!window.__zoomMonitor.running) return;

      const now = performance.now();
      const canvasContainers = document.querySelectorAll('.canvas-container');
      const lowerCanvases = document.querySelectorAll('.lower-canvas');
      const upperCanvases = document.querySelectorAll('.upper-canvas');

      // Check visibility of canvas containers
      let visibleCanvases = 0;
      let hiddenCanvases = 0;
      canvasContainers.forEach(c => {
        const style = window.getComputedStyle(c);
        const rect = c.getBoundingClientRect();
        if (style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0) {
          visibleCanvases++;
        } else {
          hiddenCanvases++;
        }
      });

      // Check for CSS transforms on annotation overlays
      const overlays = document.querySelectorAll('[class*="overlay"], [class*="annotation"]');
      let transformedOverlays = 0;
      overlays.forEach(o => {
        const transform = window.getComputedStyle(o).transform;
        if (transform && transform !== 'none') transformedOverlays++;
      });

      // Check portal host connectivity
      const pageDivs = document.querySelectorAll('[id^="pageDiv_"]');
      let connectedPageDivs = 0;
      pageDivs.forEach(d => { if (d.isConnected) connectedPageDivs++; });

      // Frame timing
      const lastFrame = window.__zoomMonitor.frames[window.__zoomMonitor.frames.length - 1];
      const frameDelta = lastFrame ? now - lastFrame.time : 0;

      window.__zoomMonitor.frames.push({
        time: now - window.__zoomMonitor.startTime,
        frameDelta: Math.round(frameDelta * 100) / 100,
        canvasContainers: canvasContainers.length,
        visibleCanvases,
        hiddenCanvases,
        lowerCanvases: lowerCanvases.length,
        upperCanvases: upperCanvases.length,
        transformedOverlays,
        connectedPageDivs,
        pageDivTotal: pageDivs.length,
        jank: frameDelta > 50 // >50ms = dropped frame
      });

      window.__zoomMonitor.rafId = requestAnimationFrame(recordFrame);
    }

    recordFrame();
    return 'Monitor installed — tracking canvas containers, visibility, transforms, page divs, frame timing';
  });
}
```

### Phase 3: Test Each Zoom Method

**Test A — Ctrl+Wheel Zoom In (15 steps):**
```javascript
async (page) => {
  const session = await page.context().newCDPSession(page);
  for (let i = 0; i < 15; i++) {
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: 600,
      y: 400,
      deltaX: 0,
      deltaY: -100,
      modifiers: 2 // Ctrl key
    });
    await page.waitForTimeout(50);
  }
  return 'Fired 15 Ctrl+wheel zoom-in events';
}
```
Then wait 3 seconds, take screenshot, collect monitor data.

**Test B — Ctrl+Wheel Zoom Out (15 steps):**
Same but with `deltaY: 100` (positive = zoom out).

**Test C — Ctrl+Plus (zoom in via keyboard):**
Use `browser_press_key` with key `Control+=` (5 times).

**Test D — Ctrl+Minus (zoom out via keyboard):**
Use `browser_press_key` with key `Control+-` (5 times).

**Test E — Toolbar Zoom In Button:**
`browser_snapshot` to find the zoom-in toolbar button, then `browser_click` it (5 times with short waits).

**Test F — Toolbar Zoom Out Button:**
Same for zoom-out toolbar button.

**Test G — Trackpad Pinch:**
Note: True trackpad pinch cannot be simulated via CDP. Use gesture events if possible, otherwise document as "requires manual testing" and skip.

### Phase 4: Collect Results

After EACH zoom test, use `browser_run_code`:
```javascript
async (page) => {
  return await page.evaluate(() => {
    const m = window.__zoomMonitor;
    if (!m) return 'No monitor data';

    const frames = m.frames;
    const minCanvasContainers = Math.min(...frames.map(f => f.canvasContainers));
    const minVisible = Math.min(...frames.map(f => f.visibleCanvases));
    const minLower = Math.min(...frames.map(f => f.lowerCanvases));
    const jankFrames = frames.filter(f => f.jank).length;
    const maxFrameTime = Math.max(...frames.map(f => f.frameDelta));
    const avgFrameTime = frames.reduce((s, f) => s + f.frameDelta, 0) / frames.length;
    const droppedToZero = frames.some(f => f.canvasContainers === 0);
    const visibleDroppedToZero = frames.some(f => f.visibleCanvases === 0);
    const disconnectedFrames = frames.filter(f => f.connectedPageDivs < f.pageDivTotal);

    // Get the worst frames (highest frame time)
    const worstFrames = [...frames]
      .sort((a, b) => b.frameDelta - a.frameDelta)
      .slice(0, 5)
      .map(f => ({ time: Math.round(f.time), delta: f.frameDelta, containers: f.canvasContainers, visible: f.visibleCanvases }));

    // Reset for next test
    m.frames = [];
    m.startTime = performance.now();

    return JSON.stringify({
      totalFrames: frames.length,
      minCanvasContainers,
      minVisibleCanvases: minVisible,
      minLowerCanvases: minLower,
      droppedToZero,
      visibleDroppedToZero,
      jankFrames,
      jankPercent: Math.round(jankFrames / frames.length * 100),
      maxFrameTimeMs: Math.round(maxFrameTime),
      avgFrameTimeMs: Math.round(avgFrameTime),
      disconnectedPageDivFrames: disconnectedFrames.length,
      worstFrames
    }, null, 2);
  });
}
```

Also take a screenshot after each test and check console messages.

### Phase 5: Assess & Fix

After running all tests, analyze the results:

1. **If annotations disappear during zoom** → The portal host disconnect issue. Check:
   - Is `shouldFreezePortalHost` true during zoom? (line 23304)
   - Is `resolveSyncfusionOverlayPortalHost` returning a connected host? (line 11341)
   - The fallback portal host strategy in .planning/debug/zoom-fix-progress.md may need to be implemented

2. **If annotations disappear after zoom settles** → The two-phase settle isn't working. Check:
   - `handlePALScaleApplied` (line 10059) — is it being called?
   - `syncfusionScaleConfirmPendingRef` flow
   - Safety timer cleanup at line 11725

3. **If annotations flicker/jump** → Scale mismatch. Check:
   - `layerScale` computation at line 23381 — is it correctly frozen during zoom?
   - CSS transform values — are they being applied/removed cleanly?

4. **If sizing is wrong** → Scale calculation issue. Check:
   - `zoomOverlayBaseScaleRef` vs actual current scale
   - The ratio computation in `handlePALScaleApplied`

5. **If jank is high (>20% dropped frames)** → Performance issue. Check:
   - Are canvas re-renders happening during zoom? (they shouldn't be)
   - Is Fabric.js `renderAll()` being called mid-zoom?

**After identifying issues:**
- Read the relevant code sections in App.jsx
- Make targeted fixes
- Vite HMR will auto-refresh the browser
- Reload Playwright page and re-test

### Phase 6: Repeat Until Fixed

Each iteration:
1. Read this file + test log + debug progress file
2. Check what was tested/fixed in previous iterations
3. Run the full test suite (all zoom methods)
4. Record results in test log
5. If issues found → fix code → re-test
6. If all passing → run again to confirm (need 3 consecutive clean runs)

## Root Cause Reference

From confirmed Playwright testing:
- Syncfusion destroys/recreates `e-pv-page-div` DOM nodes during zoom re-render
- This disconnects React portal hosts for annotation layers
- `e-pv-viewer-container` and `e-pv-page-container` are STABLE (never destroyed)
- `e-pv-page-div` children GET REPLACED during zoom
- Timeline: CSS transforms work fine (0-622ms) → ALL canvases DESTROYED at ~764ms → partial recovery 891ms+

## Key Code Locations (App.jsx)

- Line 9003: `zoomOverlayTransformActiveRef` — master zoom-active flag
- Line 9008-9009: `syncfusionFallbackHostsRef`, `syncfusionCachedPageRectsRef` — fallback refs (defined but not yet used in render)
- Line 9157: `syncfusionScaleConfirmPendingRef` — post-zoom confirm flag
- Line 10059: `handlePALScaleApplied` — per-page CSS transform removal after canvas rebuild
- Line 11341: `resolveSyncfusionOverlayPortalHost` — portal host resolution with caching
- Line 11630: `shouldDeferScaleCommit` — gates `setScale()` during zoom
- Line 11660: Zoom start detection + page rect caching
- Line 11700-11730: Settle timer → confirm-pending → safety cleanup
- Line 23304: `shouldFreezePortalHost` — includes zoom refs
- Line 23341: `resolveSyncfusionOverlayPortalHost()` call in render
- Line 23360: `pageHost.isConnected` check — THIS IS WHERE ANNOTATIONS GET KILLED
- Line 23381: `layerScale` freeze during zoom
- Line 23421: `createPortal()` — the actual portal render

## Fix Strategy (from .planning/debug/zoom-fix-progress.md)

The fallback portal host approach is partially implemented:
- Refs defined (line 9008-9009): `syncfusionFallbackHostsRef`, `syncfusionCachedPageRectsRef`
- Page rect caching on zoom start (line 11660-11679): captures positions of page containers
- **NOT YET IMPLEMENTED**: The render loop fallback at line 23360 — when `pageHost.isConnected` is false and `shouldFreezePortalHost` is true, create a fallback div inside the stable `e-pv-page-container` to keep the portal alive
- **NOT YET IMPLEMENTED**: Cleanup of fallback hosts when real hosts reconnect
- **NOT YET IMPLEMENTED**: Cleanup of fallback hosts when zoom ends

See the full code snippets in .planning/debug/zoom-fix-progress.md under "Changes still needed".

## Success Criteria

ALL of these must pass across ALL zoom methods for 3 consecutive test runs:

1. canvas-container count NEVER drops to 0 during zoom
2. Visible canvas count NEVER drops to 0 during zoom
3. Annotations visible in screenshots during zoom AND after settle
4. No position shifting — annotations stay aligned with PDF content
5. No incorrect sizing — annotations match page scale at all times
6. Jank rate below 20% (fewer than 20% of frames >50ms)
7. No console errors related to portals, canvas, or annotations
8. Clean settle — annotations crisp at final zoom level with no artifacts

## Important Rules

- ALWAYS read App.jsx at the relevant lines BEFORE making code changes
- Make SMALL, targeted changes — do not rewrite large sections
- Vite HMR auto-refreshes on file save — no need to manually reload unless HMR fails
- After code changes, wait for HMR, then reload the page and re-test
- Take screenshots liberally — visual evidence is critical
- If a fix makes things WORSE, revert it immediately (git checkout src/App.jsx then re-apply only working changes)
- Do NOT modify PageAnnotationLayer.jsx unless absolutely necessary
- Do NOT break existing annotation creation/editing functionality

## Completion

Output `<promise>ZOOM FIX VERIFIED</promise>` ONLY when ALL success criteria pass across ALL testable zoom methods for 3 consecutive full test runs. Do NOT output this tag prematurely.
