# Zoom Fix Progress — Session 2026-03-10

## Root Cause (CONFIRMED via Playwright MCP testing)

The annotation disappearance during zoom is caused by Syncfusion destroying and recreating page container DOM nodes (`e-pv-page-div`) during zoom re-render. This disconnects the React portal hosts for annotation layers.

### Timeline (from 259-frame rAF monitoring):
| Time | Fabric Containers | What happens |
|------|-------------------|-------------|
| 0-438ms | 7 visible | CSS transforms scaling annotations (works fine) |
| 463-622ms | 7 visible | Transforms settle to identity |
| **764ms** | **0** | **ALL Fabric canvases DESTROYED — Syncfusion replacing containers** |
| 891ms | 3 | Partial recovery |
| 1071ms+ | 1 | Final state (1 page visible at high zoom) |

### Code path:
1. `App.jsx:23341` — `resolveSyncfusionOverlayPortalHost()` returns disconnected cached host
2. `App.jsx:23360` — `if (!pageHost.isConnected)` check triggers
3. Lines 23361-23363 — overlay refs DELETED, returns `null`
4. Portal unmounts → Fabric canvas destroyed → annotations vanish
5. 300ms later Syncfusion creates new containers → portal remounts → canvas rebuilds

### Key insight:
- `e-pv-viewer-container` and `e-pv-page-container` are STABLE (never destroyed)
- `e-pv-page-div` children GET REPLACED during zoom
- Portal hosts point to elements inside `e-pv-page-div` → they disconnect when page-div is replaced

## Fix Implementation (IN PROGRESS)

### Strategy: Fallback portal hosts
When Syncfusion destroys page containers during zoom, create fallback `<div>` elements inside the stable `e-pv-page-container` to keep React portal tree alive.

### Changes already made:

1. **Added refs** (line ~9005 in App.jsx):
```js
const syncfusionFallbackHostsRef = useRef({});
const syncfusionCachedPageRectsRef = useRef({});
```

2. **Added page rect caching at zoom start** (line ~11660):
When `zoomOverlayTransformActiveRef` first becomes true, snapshot `offsetTop/Left/Width/Height` of all connected page containers. These cached positions are used to position fallback containers.

### Changes still needed:

3. **Modify render loop at line ~23360** (the `!pageHost.isConnected` check):
```js
// BEFORE the existing null check:
let portalTarget = pageHost;

if (!portalTarget || !portalTarget.isConnected) {
  if (shouldFreezePortalHost && resolvedPageSize && contentRef.current?.isConnected) {
    let fallback = syncfusionFallbackHostsRef.current[pageNumber];
    if (!fallback || !fallback.isConnected) {
      fallback = document.createElement('div');
      fallback.style.position = 'absolute';
      fallback.style.overflow = 'hidden';
      fallback.style.pointerEvents = 'none';
      fallback.style.zIndex = '20';
      const cachedRect = syncfusionCachedPageRectsRef.current[pageNumber];
      if (cachedRect) {
        fallback.style.top = cachedRect.top + 'px';
        fallback.style.left = cachedRect.left + 'px';
        fallback.style.width = cachedRect.width + 'px';
        fallback.style.height = cachedRect.height + 'px';
      }
      contentRef.current.appendChild(fallback);
      syncfusionFallbackHostsRef.current[pageNumber] = fallback;
    }
    if (fallback?.isConnected) {
      portalTarget = fallback;
    }
  }
}

// Clean up fallback when real host reconnects
if (pageHost?.isConnected && syncfusionFallbackHostsRef.current[pageNumber]) {
  const fb = syncfusionFallbackHostsRef.current[pageNumber];
  if (fb?.parentNode) fb.parentNode.removeChild(fb);
  delete syncfusionFallbackHostsRef.current[pageNumber];
}

if (!resolvedPageSize || !portalTarget || !portalTarget.isConnected) {
  delete syncfusionOverlayLayerRefs.current[pageNumber];
  delete syncfusionOverlayContentRefs.current[pageNumber];
  return null;
}
```

4. **Change `pageHost` to `portalTarget`** in the `createPortal()` call at line ~23421

5. **Cleanup fallback hosts when zoom ends** — in the settle timer safety callback and `finalizeSyncfusionInteractionWindow`:
```js
Object.keys(syncfusionFallbackHostsRef.current).forEach(pageNum => {
  const fb = syncfusionFallbackHostsRef.current[pageNum];
  if (fb?.parentNode) fb.parentNode.removeChild(fb);
});
syncfusionFallbackHostsRef.current = {};
syncfusionCachedPageRectsRef.current = {};
```

## How to Test (Playwright MCP)

```js
// 1. Navigate to http://localhost:5173/
// 2. Click "Package 2 - Rev 4 -- IC.pdf"
// 3. Go to page 6
// 4. Install rAF monitor tracking .canvas-container count
// 5. Fire 15 CDP wheel events: Input.dispatchMouseEvent type:mouseWheel x:600 y:400 deltaY:-50 modifiers:2
// 6. Wait 3s, check: fabricContainers must NEVER drop to 0
// 7. Take screenshots to verify visual continuity
```

## DOM Hierarchy (stable vs unstable)
```
e-pv-viewer-container (STABLE — scroll container)
  └── e-pv-page-container (STABLE — page holder)
       └── e-pv-page-div (UNSTABLE — replaced during zoom)
            └── div → div → div → canvas-container → lower-canvas, upper-canvas
```

## Key Concern
When React switches portal target from fallback to real host, it may unmount/remount the portal children (destroying the Fabric canvas). If so, we'd need a canvas snapshot approach instead. Test to verify.
