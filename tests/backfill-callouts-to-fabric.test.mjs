// tests/backfill-callouts-to-fabric.test.mjs
//
// Unit tests for scripts/backfill-callouts-to-fabric.mjs — the Phase 6 callout
// row transform. The bridge's geometry round-trip is covered by
// calloutAnnotationBridge.test.mjs; these tests cover the backfill-specific
// guarantees: losslessness of the extras the Fabric child shape drops, PDF-import
// identity lift, the migrated row shape, and idempotency.
//
// Fixtures are sanitized copies of the two real prod callout shapes observed
// 2026-06-28 (10 standard rows + 1 pdf-imported); UUIDs scrubbed.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFabricAnnotationData,
  verifyRoundTrip,
} from '../scripts/backfill-callouts-to-fabric.mjs';

const STANDARD_ROW_DATA = {
  callout: {
    id: 'callout-y1vltawo3-momawklj',
    knee: { x: 0.151825, y: 0.510263 },
    meta: { authorId: '00000000-0000-4000-8000-000000000001' },
    text: 'jhvj',
    style: {
      bold: false, italic: false, fontSize: 14,
      fillColor: 'transparent', fontColor: '#1e293b', textAlign: 'left',
      underline: false, fontFamily: 'Arial', borderColor: '#1e293b',
      fillOpacity: 1, borderOpacity: 1, lineThickness: 2,
      strikethrough: false, arrowheadStyle: 'solidTriangle',
    },
    arrowTip: { x: 0.242444, y: 0.61027 },
    pageNumber: 1,
    textBoxWidth: 0.098039,
    textBoxHeight: 0.040404,
    textBoxPosition: { x: 0.077533, y: 0.645655 },
  },
  pageNumber: 1,
  schemaVersion: 1,
  clientSessionId: '858727c6-96f0-49a5-9c9e-733ee107eb9f',
};

const PDF_IMPORTED_ROW_DATA = {
  callout: {
    ...STANDARD_ROW_DATA.callout,
    id: 'callout-pdf-imported-xyz',
    isPdfImported: true,
    pdfAnnotationId: 'pdfanno-1234',
    pageNumber: 3,
  },
  pageNumber: 3,
  schemaVersion: 1,
  clientSessionId: null,
};

describe('buildFabricAnnotationData — migrated row shape', () => {
  it('produces a fabricObject row, schemaVersion 2, no leftover .callout key', () => {
    const out = buildFabricAnnotationData(STANDARD_ROW_DATA);
    assert.ok(out.fabricObject, 'fabricObject present');
    assert.equal(out.fabricObject.data.type, 'callout');
    assert.equal(out.schemaVersion, 2);
    assert.equal('callout' in out, false, 'top-level .callout key dropped');
    assert.equal(out.pageNumber, 1);
    assert.equal(out.clientSessionId, '858727c6-96f0-49a5-9c9e-733ee107eb9f');
  });

  it('carries data.id and a stable callout id', () => {
    const out = buildFabricAnnotationData(STANDARD_ROW_DATA);
    assert.equal(out.fabricObject.data.id, 'callout-y1vltawo3-momawklj');
  });
});

describe('buildFabricAnnotationData — losslessness', () => {
  it('stashes the full original callout (incl. dropped style fields) at data.legacyCallout', () => {
    const out = buildFabricAnnotationData(STANDARD_ROW_DATA);
    const lc = out.fabricObject.data.legacyCallout;
    assert.ok(lc, 'legacyCallout present');
    // Style fields the Fabric child shape does NOT carry must survive verbatim.
    assert.equal(lc.style.fillColor, 'transparent');
    assert.equal(lc.style.fillOpacity, 1);
    assert.equal(lc.style.borderOpacity, 1);
    assert.equal(lc.style.arrowheadStyle, 'solidTriangle');
    assert.equal(lc.meta.authorId, '00000000-0000-4000-8000-000000000001');
  });

  it('legacyCallout is a deep copy (not a live reference into the input)', () => {
    const out = buildFabricAnnotationData(STANDARD_ROW_DATA);
    out.fabricObject.data.legacyCallout.text = 'MUTATED';
    assert.equal(STANDARD_ROW_DATA.callout.text, 'jhvj', 'input not mutated');
  });

  it('lifts author chain to data.authorId for the shared canModify gate', () => {
    const out = buildFabricAnnotationData(STANDARD_ROW_DATA);
    assert.equal(out.fabricObject.data.authorId, '00000000-0000-4000-8000-000000000001');
  });

  it('geometry round-trips within tolerance (verifyRoundTrip ok)', () => {
    const out = buildFabricAnnotationData(STANDARD_ROW_DATA);
    const rt = verifyRoundTrip(STANDARD_ROW_DATA.callout, out.fabricObject);
    assert.ok(rt.ok, `round-trip failed: maxFracDelta=${rt.maxFracDelta}`);
  });
});

describe('buildFabricAnnotationData — PDF-import identity', () => {
  it('lifts isPdfImported + pdfAnnotationId to the fabricObject root (getPdfImportDedupeKey)', () => {
    const out = buildFabricAnnotationData(PDF_IMPORTED_ROW_DATA);
    assert.equal(out.fabricObject.isPdfImported, true);
    assert.equal(out.fabricObject.pdfAnnotationId, 'pdfanno-1234');
  });

  it('non-imported rows do not gain a spurious isPdfImported flag', () => {
    const out = buildFabricAnnotationData(STANDARD_ROW_DATA);
    assert.equal('isPdfImported' in out.fabricObject, false);
  });
});

describe('buildFabricAnnotationData — idempotency', () => {
  it('returns null for an already-migrated row (fabricObject, no .callout)', () => {
    const migrated = buildFabricAnnotationData(STANDARD_ROW_DATA);
    // Feeding the migrated annotation_data back in must be a no-op skip.
    assert.equal(buildFabricAnnotationData(migrated), null);
  });

  it('throws on a row with neither .callout nor .fabricObject', () => {
    assert.throws(() => buildFabricAnnotationData({ pageNumber: 1 }), /neither/);
  });
});
