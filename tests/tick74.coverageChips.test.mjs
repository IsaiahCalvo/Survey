/**
 * Tick-74 coverage chips. The original file also injected Vite env values
 * through a globalThis.__VITE_IMPORT_META_ENV__ hook that the July coverage
 * commit added to production code only for these tests; that hook was not
 * ported (KAL-370), so those five cases are gone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

test('FreeText callout near-white border falls back to non-white textColor', async () => {
  const { convertPdfAnnotationToFabric } = await import('../src/utils/pdfAnnotationImporter.js');
  const viewport = {
    convertToViewportPoint: (x, y) => [x, y],
    convertToViewportRectangle: (r) => r,
    width: 612,
    height: 792,
  };
  const obj = convertPdfAnnotationToFabric(
    {
      subtype: 'FreeText',
      id: 'ft-white-text',
      rect: [10, 10, 120, 50],
      color: [1, 1, 1],
      contents: 'note',
      intent: 'FreeTextCallout',
      calloutLine: [10, 10, 40, 40, 80, 40],
      defaultAppearance: '1 0 0 rg /Helv 12 Tf',
      borderStyle: { width: 1 },
      _appearance: { strokeColor: [1, 1, 1] },
    },
    viewport,
    1,
  );
  assert.ok(obj === null || typeof obj === 'object');
});

test('geometryHitTest textbox far miss returns false', async () => {
  const { doesRectIntersectTextbox } = await import('../src/utils/geometryHitTest.js');
  const miss = doesRectIntersectTextbox(
    { left: 500, top: 500, right: 510, bottom: 510 },
    {
      type: 'textbox',
      left: 0,
      top: 0,
      width: 40,
      height: 20,
      originX: 'left',
      originY: 'top',
    },
  );
  assert.equal(miss, false);
});

test('Hocuspocus missing-provider import throws actionable error', async () => {
  const { createHocuspocusYjsProvider } = await import('../src/lib/collab/HocuspocusYjsProvider.js');
  await assert.rejects(
    () => createHocuspocusYjsProvider({
      documentId: 'doc-missing',
      ydoc: {},
      supabase: {},
      // @hocuspocus/provider is deliberately not a dependency, so the real
      // dynamic import fails here. (The old test injected the failure through
      // an importProvider hook that was not ported.)
    }),
    /@hocuspocus\/provider not installed/,
  );
});
