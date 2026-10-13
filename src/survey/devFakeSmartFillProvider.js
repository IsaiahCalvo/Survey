/**
 * devFakeSmartFillProvider.js — TEST ONLY. A stand-in Smart fill so the
 * polygon-marker path can be exercised end to end before the real one lands.
 *
 * Loaded only by the dev server with ?fakeSmartFill=1 (SurveyMarkerModeTools);
 * a production build never contains it. It ignores the drawing and returns a
 * fixed outline around the press: a 120 x 80 box with a 40 x 24 hole, as a
 * GeoJSON Polygon with closed rings (the shape the real provider is expected
 * to hand back).
 */
import { registerMarkerShapeProvider } from './markerShapeProviders.js';

export function fakeSmartFillPolygon(point) {
  const x = Number(point?.x) || 0;
  const y = Number(point?.y) || 0;
  const ring = (w, h) => [
    [x - w / 2, y - h / 2],
    [x + w / 2, y - h / 2],
    [x + w / 2, y + h / 2],
    [x - w / 2, y + h / 2],
    [x - w / 2, y - h / 2],
  ];
  return { type: 'Polygon', coordinates: [ring(120, 80), ring(40, 24)] };
}

export function registerDevFakeSmartFillProvider() {
  if (typeof window !== 'undefined') window.__fakeSmartFillCalls = [];
  return registerMarkerShapeProvider({
    id: 'smartFill',
    label: 'Smart fill (test)',
    icon: 'paintBucket',
    onPagePointerDown: async (context) => {
      if (typeof window !== 'undefined') {
        window.__fakeSmartFillCalls.push({
          pageIndex: context.pageIndex,
          pageNumber: context.pageNumber,
          point: context.point,
          hasPdfPage: Boolean(context.pdfPage),
          hasViewport: Boolean(context.viewport),
          hasPageCanvas: Boolean(context.pageCanvas),
          pageSize: context.pageSize,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
      return { polygons: fakeSmartFillPolygon(context.point) };
    },
  });
}
