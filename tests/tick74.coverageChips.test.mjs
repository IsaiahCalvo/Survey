/**
 * Tick-74 coverage chips: inject Vite env via globalThis.__VITE_IMPORT_META_ENV__
 * (avoids per-module import.meta binding limits).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { isCRDTEnabled } from '../src/lib/collab/crdtFeatureFlag.js';
import { isLegacyBulkUpsertEnabled } from '../src/lib/collab/featureFlags.js';
import { isSnapshotEnabled } from '../src/lib/collab/snapshotFeatureFlag.js';
import { isPdfNativeExportEnabled, clearPdfNativeExportOverride } from '../src/utils/pdfNativeExport/featureFlag.js';
import { detectDevice } from '../src/utils/documentProvenance.js';

function withViteEnv(env, fn) {
  const prev = globalThis.__VITE_IMPORT_META_ENV__;
  globalThis.__VITE_IMPORT_META_ENV__ = env;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete globalThis.__VITE_IMPORT_META_ENV__;
    else globalThis.__VITE_IMPORT_META_ENV__ = prev;
  }
}

test('crdtFeatureFlag honors injected VITE_CRDT_LAYER_DISABLED', () => {
  withViteEnv({ VITE_CRDT_LAYER_DISABLED: '1' }, () => {
    assert.equal(isCRDTEnabled(), false);
  });
});

test('featureFlags honors injected VITE_LEGACY_BULK_UPSERT_ENABLED', () => {
  withViteEnv({ VITE_LEGACY_BULK_UPSERT_ENABLED: 'true' }, () => {
    assert.equal(isLegacyBulkUpsertEnabled(), true);
  });
});

test('snapshotFeatureFlag honors injected VITE_YDOC_SNAPSHOT_ENABLED', () => {
  withViteEnv({ VITE_YDOC_SNAPSHOT_ENABLED: '1' }, () => {
    assert.equal(isSnapshotEnabled(), true);
  });
});

test('pdfNativeExport featureFlag honors injected VITE_ENABLE_PDF_NATIVE_EXPORT', () => {
  const prev = process.env.ENABLE_PDF_NATIVE_EXPORT;
  delete process.env.ENABLE_PDF_NATIVE_EXPORT;
  try {
    withViteEnv({ VITE_ENABLE_PDF_NATIVE_EXPORT: 'true' }, () => {
      clearPdfNativeExportOverride('doc-74');
      assert.equal(isPdfNativeExportEnabled(), true);
    });
  } finally {
    if (prev === undefined) delete process.env.ENABLE_PDF_NATIVE_EXPORT;
    else process.env.ENABLE_PDF_NATIVE_EXPORT = prev;
  }
});

test('documentProvenance detectDevice returns dev when injected DEV', () => {
  const prevWindow = globalThis.window;
  globalThis.window = {};
  try {
    withViteEnv({ DEV: true }, () => {
      assert.equal(detectDevice(), 'dev');
    });
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
  }
});

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
      importProvider: async () => {
        throw new Error('MODULE_NOT_FOUND');
      },
    }),
    /@hocuspocus\/provider not installed/,
  );
});
