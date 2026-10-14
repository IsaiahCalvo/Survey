# Survey Marker draw modes — plugging in Smart fill

The desktop tool bar shows a Survey Marker group (right of the tool groups,
where Pen / Highlighter / Eraser sit) while the Survey Marker tool is armed:

| Mode | Button | What a press does |
| --- | --- | --- |
| Rectangle | always | drag a box (the marker as it always was) |
| Freehand | always | draw a highlighter-like stroke |
| Smart fill | **only while a provider is registered** | ask the provider for the outline under the press |

Everything after "here is an outline" already works: the marker is stored,
drawn (SVG, zoom by viewBox), hit-tested on its outline, selected, moved,
resized, undone / redone, synced, copied / pasted, erased and exported (as its
box). You only supply the outline.

## 1. Register a provider

```js
import { registerMarkerShapeProvider } from './markerShapeProviders.js';

const unregister = registerMarkerShapeProvider({
  id: 'smartFill',          // must be exactly this to drive the Smart fill button
  label: 'Smart fill',      // tooltip / accessible name
  icon: 'smartFillDrop',    // any <Icon> name in src/Icons.jsx (default: smartFillDrop)
  async onPagePointerDown({ pageIndex, pageNumber, point, pageSize, pdfPage, viewport, pageCanvas, signal }) {
    // point: { x, y } where the user pressed, PDF page units (see below)
    // pdfPage: the pdf.js PDFPageProxy (pdfPage.getOperatorList(), getTextContent() …)
    // viewport: pdfPage.getViewport({ scale: 1 })
    // pageCanvas: the page's rendered <canvas>, if you want pixels
    // signal: AbortSignal — aborted when the user leaves the tool; stop early
    const rings = await findRegion(pdfPage, point);   // your algorithm
    if (!rings) return null;                           // nothing to fill: no marker, no undo step
    return { polygons: { type: 'MultiPolygon', coordinates: rings } };
  },
});
```

Call it once at app start-up (for example from `src/survey/SurveyMarkerModeTools.jsx`
next to the dev fake, or from `src/main.jsx`). The button appears the moment a
provider registers and disappears again on `unregister()`.

## 2. Units

`point` and every polygon point are **PDF page units in the overlay's space**:
origin top-left, y pointing down, 1 unit = 1 PDF point (the SVG layer's
viewBox; the same as pdf.js viewport coordinates at scale 1). The PDF's own
vector geometry (operator lists) is in PDF user space — origin bottom-left, y
up. Convert with the viewport you are given:

```js
const [px, py] = viewport.convertToPdfPoint(point.x, point.y);   // press -> PDF user space
const [vx, vy] = viewport.convertToViewportPoint(px2, py2);      // your result -> page units
```

## 3. What to return

`{ polygons }`, where `polygons` is any of:

- a GeoJSON-like `{ type: 'Polygon', coordinates: [outer, hole, ...] }`
- a GeoJSON-like `{ type: 'MultiPolygon', coordinates: [[outer, hole, ...], ...] }`
- the bare coordinate arrays of either (or a single ring)

Rings may be closed (first point repeated) or open; points may be `[x, y]` or
`{ x, y }`. Holes are drawn clear (even-odd). Very dense outlines are thinned to
6 000 points. Return `null` (or throw) when there is nothing to fill.

## 4. Try it without the real provider

Run the dev server and open the viewer with `?fakeSmartFill=1` added to the URL.
`devFakeSmartFillProvider.js` registers a stand-in that ignores the drawing and
returns a 120 x 80 box with a 40 x 24 hole around the press. It is never part of
a production build.

## 5. How it is stored (no schema change)

The outline rides inside the marker's existing `bounds` (JSONB) next to the box:

```js
bounds: { x, y, width, height, angle?,
  shape: { type: 'polygon', v: 1, frame: { x, y, width, height }, polygons: [...] } }
```

`frame` is the box the outline was made in; when a marker is moved or resized
only x / y / width / height change and every renderer maps the outline from
`frame` onto the current box. Older app versions and box-only readers (Excel,
the eraser's first pass, PDF export) just see the box. See `markerShapes.js`.

## Files

- `markerShapeProviders.js` — the registry + `runMarkerShapeProvider`
- `markerShapes.js` — build / normalise / project / hit-test outlines
- `markerShapeSvg.jsx` — how an outline paints on the page
- `markerDrawMode.js` — the remembered mode (Rectangle where no picker shows)
- `../mobile/MobileSurveyRail.jsx` `MobileMarkerShapeChip` — the phone's picker: one rail chip in survey mode opening a Rectangle / Freehand (/ Smart fill) menu
- `SurveyMarkerModeTools.jsx` — the tool-bar group
- `devFakeSmartFillProvider.js` — test-only stand-in
