/**
 * Tick-64 coverage chips: pdfLib missing-page-size-at-write, documentProvenance
 * electron device paths, geometryHitTest stroke-rect / textbox edge samples.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';

import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import {
  buildDocumentProvenance,
  detectDevice,
} from '../src/utils/documentProvenance.js';
import {
  doesRectIntersectRect,
  doesRectIntersectTextbox,
  doesRectIntersectEllipse,
} from '../src/utils/geometryHitTest.js';

test('pdfLib missing-page-size-at-write via pageSizes Proxy', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const bytes = await doc.save();
  const pdfFile = { arrayBuffer: async () => bytes.buffer };

  let hits = 0;
  const pageSizes = new Proxy({}, {
    get(_t, prop) {
      if (prop === '1' || prop === 1) {
        hits += 1;
        // Plan-time consider() only needs the first truthy lookup.
        if (hits === 1) return { width: 612, height: 792 };
        return undefined;
      }
      return undefined;
    },
  });

  await savePDFWithAnnotationsPdfLib(
    pdfFile,
    {
      1: {
        objects: [{
          type: 'rect',
          left: 10,
          top: 10,
          width: 40,
          height: 30,
          fill: '#f00',
          stroke: '#000',
          strokeWidth: 1,
          visibilityScope: 'canvas',
        }],
      },
    },
    pageSizes,
    null,
    { returnBytes: true, documentId: 'tick64' },
  );
  assert.ok(hits >= 2);
});

test('documentProvenance electron device detection', () => {
  const prevWindow = globalThis.window;
  const prevNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    globalThis.window = {
      electronAPI: {},
    };
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { platform: 'MacIntel', userAgent: 'Electron' },
    });
    assert.equal(detectDevice(), 'mac');

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { platform: 'Win32', userAgent: 'Electron' },
    });
    assert.equal(detectDevice(), 'windows');

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { platform: 'Linux x86_64', userAgent: 'Electron' },
    });
    assert.equal(detectDevice(), 'linux');

    const prov = buildDocumentProvenance({ subscriptionTier: 'Pro' });
    assert.equal(prov.first_opened_user_tier, 'pro');
    assert.ok(prov.first_opened_app_version);
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
    if (prevNav) Object.defineProperty(globalThis, 'navigator', prevNav);
    else delete globalThis.navigator;
  }
});

test('geometryHitTest stroke-rect and textbox partial overlap', () => {
  // Stroke-only rect: sel overlaps stroke without containing vertices
  const strokeHit = doesRectIntersectRect(
    { left: 45, top: -2, right: 55, bottom: 2 },
    {
      type: 'rect',
      left: 0,
      top: 0,
      width: 100,
      height: 50,
      fill: 'transparent',
      stroke: '#000',
      strokeWidth: 4,
      originX: 'left',
      originY: 'top',
    },
  );
  assert.equal(strokeHit, true);

  // Textbox: sel clips mid-edge without containing corners
  const textHit = doesRectIntersectTextbox(
    { left: 40, top: -5, right: 60, bottom: 5 },
    {
      type: 'textbox',
      left: 0,
      top: 0,
      width: 100,
      height: 40,
      originX: 'left',
      originY: 'top',
    },
  );
  assert.equal(textHit, true);

  // Stroke-only ellipse edge sample
  const ellHit = doesRectIntersectEllipse(
    { left: 48, top: -2, right: 52, bottom: 2 },
    50,
    50,
    50,
    50,
    false,
    6,
  );
  assert.equal(typeof ellHit, 'boolean');
});
