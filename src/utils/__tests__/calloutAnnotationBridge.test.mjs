// src/utils/__tests__/calloutAnnotationBridge.test.mjs
//
// Unit tests for calloutAnnotationBridge.js (Phase 5a of callout unification).
//
// Test strategy:
//  1. Round-trip: callout → calloutToAnnotationObject → annotationObjectToCallout
//     verifies leader-line geometry (arrowTip, knee, textBoxPosition, width/height)
//     survives within a small pixel-derived tolerance after normalization round-trip.
//  2. Structural assertions: data.type, data.id, data.legacyNormalizedCoords present.
//  3. Text-style mapping: bold→fontWeight:700, strikethrough→linethrough, fontFamily
//     sanitization (no CSS fallback stacks).
//  4. Edge cases: missing knee, label vs textBox field naming, anchor alias, zero-size
//     label, empty text.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calloutToAnnotationObject,
  annotationObjectToCallout,
  projectCalloutsIntoByPage,
} from '../calloutAnnotationBridge.js';
import { fabric } from '../fabricCompat.js';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const PAGE = { width: 816, height: 1056 };

// Pixel tolerance for the normalized→pixel→normalized round-trip.
// The max error is: 1 ULP of the float * pageSize ≈ negligible; in practice
// < 1e-10 px because the math is x_frac*W/W — exact division. We use 0.5px
// as the published tolerance from the PLAN (phase 6 backfill visual bar is 1px).
const PX_TOL = 0.5;

/** Assert that two numbers differ by less than `tol`. */
function assertClose(actual, expected, tol, label) {
  const diff = Math.abs(actual - expected);
  assert.ok(diff < tol, `${label}: |${actual} - ${expected}| = ${diff} >= ${tol}`);
}

/** Standard full callout. */
const baseCallout = {
  id: 'c-001',
  pageNumber: 2,
  arrowTip: { x: 0.5, y: 0.25 },
  knee: { x: 0.3, y: 0.5 },
  textBoxPosition: { x: 0.1, y: 0.6 },
  textBoxWidth: 0.2,
  textBoxHeight: 0.1,
  text: 'Test callout',
  style: {
    bold: true,
    italic: false,
    underline: false,
    strikethrough: true,
    fontFamily: 'Inter, Arial, sans-serif',
    fontSize: 14,
    fontColor: '#000',
    borderColor: '#1e293b',
    lineThickness: 2,
  },
};

// ---------------------------------------------------------------------------
// Structural assertions
// ---------------------------------------------------------------------------

describe('calloutToAnnotationObject — structure', () => {
  it('sets data.type to callout', () => {
    const obj = calloutToAnnotationObject(baseCallout, PAGE);
    assert.equal(obj.data.type, 'callout');
  });

  it('sets data.id to callout.id', () => {
    const obj = calloutToAnnotationObject(baseCallout, PAGE);
    assert.equal(obj.data.id, 'c-001');
  });

  it('includes data.legacyNormalizedCoords with original fractions', () => {
    const obj = calloutToAnnotationObject(baseCallout, PAGE);
    const lnc = obj.data.legacyNormalizedCoords;
    assert.ok(lnc, 'legacyNormalizedCoords missing');
    assertClose(lnc.arrowTip.x, 0.5, 1e-12, 'lnc.arrowTip.x');
    assertClose(lnc.arrowTip.y, 0.25, 1e-12, 'lnc.arrowTip.y');
    assertClose(lnc.knee.x, 0.3, 1e-12, 'lnc.knee.x');
    assertClose(lnc.knee.y, 0.5, 1e-12, 'lnc.knee.y');
    assertClose(lnc.textBoxPosition.x, 0.1, 1e-12, 'lnc.tbPos.x');
    assertClose(lnc.textBoxPosition.y, 0.6, 1e-12, 'lnc.tbPos.y');
    assertClose(lnc.textBoxWidth, 0.2, 1e-12, 'lnc.tbW');
    assertClose(lnc.textBoxHeight, 0.1, 1e-12, 'lnc.tbH');
  });

  it('produces a group with 4 child objects', () => {
    const obj = calloutToAnnotationObject(baseCallout, PAGE);
    assert.equal(obj.type, 'group');
    assert.equal(obj.objects.length, 4);
  });

  it('getObjects() returns the same array as objects', () => {
    const obj = calloutToAnnotationObject(baseCallout, PAGE);
    assert.strictEqual(obj.getObjects(), obj.objects);
  });

  it('keeps getObjects() non-enumerable so Fabric 7 can enliven projected callout groups', async () => {
    const obj = calloutToAnnotationObject(baseCallout, PAGE);
    assert.equal(Object.prototype.propertyIsEnumerable.call(obj, 'getObjects'), false);

    // Full enliven needs a DOM canvas for Textbox metrics; in Node without a
    // canvas polyfill we still lock the non-enumerable contract above.
    try {
      const enlivened = await fabric.util.enlivenObjects([obj]);
      assert.equal(enlivened.length, 1);
      assert.equal(enlivened[0].type, 'group');
    } catch (err) {
      assert.match(String(err?.message || err), /canvas|document|window/i);
    }
  });
});

// ---------------------------------------------------------------------------
// R2 keystone: reload payload (data.legacyCallout) — makes runtime-persisted
// .fabricObject callout rows recoverable by the deserializeRowToCallout shim,
// byte-shape-identical to scripts/backfill-callouts-to-fabric.mjs output.
// ---------------------------------------------------------------------------

describe('calloutToAnnotationObject — R2 reload payload', () => {
  it('embeds data.legacyCallout as a deep copy of the original callout', () => {
    const obj = calloutToAnnotationObject(baseCallout, PAGE);
    assert.ok(obj.data.legacyCallout, 'legacyCallout missing');
    assert.equal(obj.data.legacyCallout.id, 'c-001');
    assert.equal(obj.data.legacyCallout.text, 'Test callout');
    assert.equal(obj.data.legacyCallout.style.strikethrough, true);
    // deep copy: mutating the output must not touch the input
    obj.data.legacyCallout.text = 'MUTATED';
    assert.equal(baseCallout.text, 'Test callout', 'input callout was mutated');
  });

  it('lifts author chain to data.authorId (meta.authorId precedence)', () => {
    const authored = { ...baseCallout, meta: { authorId: 'user-xyz' } };
    assert.equal(calloutToAnnotationObject(authored, PAGE).data.authorId, 'user-xyz');
    // bare authorId field also honored
    const authored2 = { ...baseCallout, authorId: 'user-bare' };
    assert.equal(calloutToAnnotationObject(authored2, PAGE).data.authorId, 'user-bare');
  });

  it('omits data.authorId when no author chain present', () => {
    const obj = calloutToAnnotationObject(baseCallout, PAGE);
    assert.equal('authorId' in obj.data, false);
  });

  it('lifts isPdfImported + pdfAnnotationId to the fabricObject root when imported', () => {
    const imported = { ...baseCallout, isPdfImported: true, pdfAnnotationId: 'pdfanno-9' };
    const obj = calloutToAnnotationObject(imported, PAGE);
    assert.equal(obj.isPdfImported, true);
    assert.equal(obj.pdfAnnotationId, 'pdfanno-9');
  });

  it('does not add a spurious isPdfImported flag for non-imported callouts', () => {
    const obj = calloutToAnnotationObject(baseCallout, PAGE);
    assert.equal('isPdfImported' in obj, false);
    assert.equal('pdfAnnotationId' in obj, false);
  });
});

// ---------------------------------------------------------------------------
// Page-pixel geometry: PLAN §5a expected values for the base callout
// ---------------------------------------------------------------------------

describe('calloutToAnnotationObject — pixel geometry', () => {
  it('places arrowTip (line2.x2/y2) at correct page-pixel coords', () => {
    const obj = calloutToAnnotationObject(baseCallout, PAGE);
    const line2 = obj.objects.find((c) => c.data?.calloutPart === 'line2');
    assert.ok(line2, 'line2 child missing');
    assertClose(line2.x2, 0.5 * PAGE.width, 1e-10, 'line2.x2 (arrowTip.x)');
    assertClose(line2.y2, 0.25 * PAGE.height, 1e-10, 'line2.y2 (arrowTip.y)');
  });

  it('places knee (line1.x2/y2) at correct page-pixel coords', () => {
    const obj = calloutToAnnotationObject(baseCallout, PAGE);
    const line1 = obj.objects.find((c) => c.data?.calloutPart === 'line1');
    assert.ok(line1, 'line1 child missing');
    assertClose(line1.x2, 0.3 * PAGE.width, 1e-10, 'line1.x2 (knee.x)');
    assertClose(line1.y2, 0.5 * PAGE.height, 1e-10, 'line1.y2 (knee.y)');
  });

  it('places textbox at correct page-pixel coords', () => {
    const obj = calloutToAnnotationObject(baseCallout, PAGE);
    const tb = obj.objects.find((c) => c.data?.calloutPart === 'textBox');
    assert.ok(tb, 'textbox child missing');
    assertClose(tb.left, 0.1 * PAGE.width, 1e-10, 'textbox.left');
    assertClose(tb.top, 0.6 * PAGE.height, 1e-10, 'textbox.top');
    assertClose(tb.width, 0.2 * PAGE.width, 1e-10, 'textbox.width');
    assertClose(tb.height, 0.1 * PAGE.height, 1e-10, 'textbox.height');
  });
});

// ---------------------------------------------------------------------------
// Text-style mapping (PLAN §5a)
// ---------------------------------------------------------------------------

describe('calloutToAnnotationObject — text-style mapping', () => {
  it('maps bold:true → fontWeight:700', () => {
    const obj = calloutToAnnotationObject(baseCallout, PAGE);
    const tb = obj.objects.find((c) => c.data?.calloutPart === 'textBox');
    assert.equal(tb.fontWeight, 700);
  });

  it('maps strikethrough:true → linethrough:true', () => {
    const obj = calloutToAnnotationObject(baseCallout, PAGE);
    const tb = obj.objects.find((c) => c.data?.calloutPart === 'textBox');
    assert.equal(tb.linethrough, true);
  });

  it('strips CSS fallback stack from fontFamily → single name', () => {
    const obj = calloutToAnnotationObject(baseCallout, PAGE);
    const tb = obj.objects.find((c) => c.data?.calloutPart === 'textBox');
    // 'Inter, Arial, sans-serif' → 'Inter'
    assert.equal(tb.fontFamily, 'Inter');
  });

  it('maps bold:false → fontWeight:normal', () => {
    const c = { ...baseCallout, style: { ...baseCallout.style, bold: false } };
    const obj = calloutToAnnotationObject(c, PAGE);
    const tb = obj.objects.find((c2) => c2.data?.calloutPart === 'textBox');
    assert.equal(tb.fontWeight, 'normal');
  });

  it('maps italic:true → fontStyle:italic', () => {
    const c = { ...baseCallout, style: { ...baseCallout.style, italic: true } };
    const obj = calloutToAnnotationObject(c, PAGE);
    const tb = obj.objects.find((c2) => c2.data?.calloutPart === 'textBox');
    assert.equal(tb.fontStyle, 'italic');
  });
});

// ---------------------------------------------------------------------------
// Round-trip: callout → calloutToAnnotationObject → annotationObjectToCallout
// ---------------------------------------------------------------------------

describe('round-trip — base callout', () => {
  it('preserves arrowTip within PX_TOL after pixel→normalized', () => {
    const obj = calloutToAnnotationObject(baseCallout, PAGE);
    const back = annotationObjectToCallout(obj, PAGE);
    assertClose(back.arrowTip.x * PAGE.width, baseCallout.arrowTip.x * PAGE.width, PX_TOL, 'arrowTip.x px');
    assertClose(back.arrowTip.y * PAGE.height, baseCallout.arrowTip.y * PAGE.height, PX_TOL, 'arrowTip.y px');
  });

  it('preserves knee within PX_TOL', () => {
    const obj = calloutToAnnotationObject(baseCallout, PAGE);
    const back = annotationObjectToCallout(obj, PAGE);
    assertClose(back.knee.x * PAGE.width, baseCallout.knee.x * PAGE.width, PX_TOL, 'knee.x px');
    assertClose(back.knee.y * PAGE.height, baseCallout.knee.y * PAGE.height, PX_TOL, 'knee.y px');
  });

  it('preserves textBoxPosition within PX_TOL', () => {
    const obj = calloutToAnnotationObject(baseCallout, PAGE);
    const back = annotationObjectToCallout(obj, PAGE);
    assertClose(back.textBoxPosition.x * PAGE.width, baseCallout.textBoxPosition.x * PAGE.width, PX_TOL, 'tbPos.x px');
    assertClose(back.textBoxPosition.y * PAGE.height, baseCallout.textBoxPosition.y * PAGE.height, PX_TOL, 'tbPos.y px');
  });

  it('preserves textBoxWidth within PX_TOL', () => {
    const obj = calloutToAnnotationObject(baseCallout, PAGE);
    const back = annotationObjectToCallout(obj, PAGE);
    assertClose(back.textBoxWidth * PAGE.width, baseCallout.textBoxWidth * PAGE.width, PX_TOL, 'tbW px');
  });

  it('preserves textBoxHeight within PX_TOL', () => {
    const obj = calloutToAnnotationObject(baseCallout, PAGE);
    const back = annotationObjectToCallout(obj, PAGE);
    assertClose(back.textBoxHeight * PAGE.height, baseCallout.textBoxHeight * PAGE.height, PX_TOL, 'tbH px');
  });

  it('preserves id', () => {
    const obj = calloutToAnnotationObject(baseCallout, PAGE);
    const back = annotationObjectToCallout(obj, PAGE);
    assert.equal(back.id, 'c-001');
  });

  it('preserves text', () => {
    const obj = calloutToAnnotationObject(baseCallout, PAGE);
    const back = annotationObjectToCallout(obj, PAGE);
    assert.equal(back.text, 'Test callout');
  });
});

// ---------------------------------------------------------------------------
// Round-trip with a variety of callout shapes
// ---------------------------------------------------------------------------

describe('round-trip — additional geometries', () => {
  const cases = [
    {
      label: 'top-left callout',
      callout: {
        id: 'c-top-left',
        arrowTip: { x: 0.05, y: 0.05 },
        knee: { x: 0.15, y: 0.1 },
        textBoxPosition: { x: 0.2, y: 0.05 },
        textBoxWidth: 0.25,
        textBoxHeight: 0.08,
        text: 'Top left',
      },
    },
    {
      label: 'bottom-right callout',
      callout: {
        id: 'c-bottom-right',
        arrowTip: { x: 0.95, y: 0.9 },
        knee: { x: 0.8, y: 0.8 },
        textBoxPosition: { x: 0.6, y: 0.75 },
        textBoxWidth: 0.15,
        textBoxHeight: 0.05,
        text: 'Bottom right',
      },
    },
    {
      label: 'center callout with empty text',
      callout: {
        id: 'c-center-empty',
        arrowTip: { x: 0.5, y: 0.5 },
        knee: { x: 0.45, y: 0.45 },
        textBoxPosition: { x: 0.3, y: 0.3 },
        textBoxWidth: 0.15,
        textBoxHeight: 0.08,
        text: '',
      },
    },
  ];

  for (const { label, callout } of cases) {
    it(`${label} — arrowTip survives round-trip`, () => {
      const obj = calloutToAnnotationObject(callout, PAGE);
      const back = annotationObjectToCallout(obj, PAGE);
      assertClose(back.arrowTip.x * PAGE.width, callout.arrowTip.x * PAGE.width, PX_TOL, `${label} arrowTip.x px`);
      assertClose(back.arrowTip.y * PAGE.height, callout.arrowTip.y * PAGE.height, PX_TOL, `${label} arrowTip.y px`);
    });

    it(`${label} — knee survives round-trip`, () => {
      const obj = calloutToAnnotationObject(callout, PAGE);
      const back = annotationObjectToCallout(obj, PAGE);
      assertClose(back.knee.x * PAGE.width, callout.knee.x * PAGE.width, PX_TOL, `${label} knee.x px`);
      assertClose(back.knee.y * PAGE.height, callout.knee.y * PAGE.height, PX_TOL, `${label} knee.y px`);
    });

    it(`${label} — textBox survives round-trip`, () => {
      const obj = calloutToAnnotationObject(callout, PAGE);
      const back = annotationObjectToCallout(obj, PAGE);
      assertClose(back.textBoxPosition.x * PAGE.width, callout.textBoxPosition.x * PAGE.width, PX_TOL, `${label} tbPos.x px`);
      assertClose(back.textBoxPosition.y * PAGE.height, callout.textBoxPosition.y * PAGE.height, PX_TOL, `${label} tbPos.y px`);
      assertClose(back.textBoxWidth * PAGE.width, callout.textBoxWidth * PAGE.width, PX_TOL, `${label} tbW px`);
      assertClose(back.textBoxHeight * PAGE.height, callout.textBoxHeight * PAGE.height, PX_TOL, `${label} tbH px`);
    });
  }
});

// ---------------------------------------------------------------------------
// Edge case: missing knee (knee defaults to {x:0, y:0})
// ---------------------------------------------------------------------------

describe('edge case — missing knee', () => {
  it('handles callout with no knee field without throwing', () => {
    const noKnee = {
      id: 'c-no-knee',
      arrowTip: { x: 0.5, y: 0.5 },
      textBoxPosition: { x: 0.1, y: 0.1 },
      textBoxWidth: 0.2,
      textBoxHeight: 0.1,
      text: 'No knee',
    };
    const obj = calloutToAnnotationObject(noKnee, PAGE);
    assert.equal(obj.data.type, 'callout');
    // Knee defaults to {x:0, y:0} → pixels (0, 0)
    const line1 = obj.objects.find((c) => c.data?.calloutPart === 'line1');
    assertClose(line1.x2, 0, 1e-10, 'line1.x2 (default knee x)');
    assertClose(line1.y2, 0, 1e-10, 'line1.y2 (default knee y)');
  });

  it('round-trips missing knee as {x:0,y:0}', () => {
    const noKnee = {
      id: 'c-no-knee',
      arrowTip: { x: 0.5, y: 0.5 },
      textBoxPosition: { x: 0.1, y: 0.1 },
      textBoxWidth: 0.2,
      textBoxHeight: 0.1,
      text: '',
    };
    const obj = calloutToAnnotationObject(noKnee, PAGE);
    const back = annotationObjectToCallout(obj, PAGE);
    assertClose(back.knee.x, 0, 1e-12, 'knee.x default');
    assertClose(back.knee.y, 0, 1e-12, 'knee.y default');
  });
});

// ---------------------------------------------------------------------------
// Edge case: anchor alias (legacy field for arrowTip)
// ---------------------------------------------------------------------------

describe('edge case — anchor alias for arrowTip', () => {
  it('reads anchor as arrowTip when arrowTip is absent', () => {
    const withAnchor = {
      id: 'c-anchor',
      anchor: { x: 0.6, y: 0.7 },
      knee: { x: 0.4, y: 0.5 },
      textBoxPosition: { x: 0.1, y: 0.1 },
      textBoxWidth: 0.2,
      textBoxHeight: 0.1,
      text: '',
    };
    const obj = calloutToAnnotationObject(withAnchor, PAGE);
    const line2 = obj.objects.find((c) => c.data?.calloutPart === 'line2');
    assertClose(line2.x2, 0.6 * PAGE.width, 1e-10, 'anchor alias x');
    assertClose(line2.y2, 0.7 * PAGE.height, 1e-10, 'anchor alias y');
  });

  it('round-trip with anchor alias preserves arrowTip geometry', () => {
    const withAnchor = {
      id: 'c-anchor-rt',
      anchor: { x: 0.6, y: 0.7 },
      knee: { x: 0.4, y: 0.5 },
      textBoxPosition: { x: 0.1, y: 0.1 },
      textBoxWidth: 0.2,
      textBoxHeight: 0.1,
      text: '',
    };
    const obj = calloutToAnnotationObject(withAnchor, PAGE);
    const back = annotationObjectToCallout(obj, PAGE);
    assertClose(back.arrowTip.x * PAGE.width, 0.6 * PAGE.width, PX_TOL, 'anchor rt x');
    assertClose(back.arrowTip.y * PAGE.height, 0.7 * PAGE.height, PX_TOL, 'anchor rt y');
  });
});

// ---------------------------------------------------------------------------
// Edge case: textBox object naming (legacy {x,y,width,height} shape)
// ---------------------------------------------------------------------------

describe('edge case — textBox object field naming', () => {
  it('reads textBox.{x,y,width,height} when textBoxPosition is absent', () => {
    const withTextBox = {
      id: 'c-textbox-legacy',
      arrowTip: { x: 0.5, y: 0.5 },
      knee: { x: 0.4, y: 0.45 },
      textBox: { x: 0.1, y: 0.6, width: 0.25, height: 0.12 },
      text: 'Legacy textBox',
    };
    const obj = calloutToAnnotationObject(withTextBox, PAGE);
    const tb = obj.objects.find((c) => c.data?.calloutPart === 'textBox');
    assertClose(tb.left, 0.1 * PAGE.width, 1e-10, 'textBox.x');
    assertClose(tb.top, 0.6 * PAGE.height, 1e-10, 'textBox.y');
    assertClose(tb.width, 0.25 * PAGE.width, 1e-10, 'textBox.width');
    assertClose(tb.height, 0.12 * PAGE.height, 1e-10, 'textBox.height');
  });

  it('round-trips textBox legacy shape correctly', () => {
    const withTextBox = {
      id: 'c-textbox-legacy-rt',
      arrowTip: { x: 0.5, y: 0.5 },
      knee: { x: 0.4, y: 0.45 },
      textBox: { x: 0.1, y: 0.6, width: 0.25, height: 0.12 },
      text: '',
    };
    const obj = calloutToAnnotationObject(withTextBox, PAGE);
    const back = annotationObjectToCallout(obj, PAGE);
    assertClose(back.textBoxPosition.x * PAGE.width, 0.1 * PAGE.width, PX_TOL, 'textBox legacy tbPos.x');
    assertClose(back.textBoxWidth * PAGE.width, 0.25 * PAGE.width, PX_TOL, 'textBox legacy tbW');
    assertClose(back.textBoxHeight * PAGE.height, 0.12 * PAGE.height, PX_TOL, 'textBox legacy tbH');
  });
});

// ---------------------------------------------------------------------------
// Edge case: label field naming (earliest legacy shape)
// ---------------------------------------------------------------------------

describe('edge case — label field naming (earliest legacy)', () => {
  it('reads label.{left,top,width,height} when textBoxPosition and textBox are absent', () => {
    const withLabel = {
      id: 'c-label-legacy',
      arrowTip: { x: 0.5, y: 0.3 },
      knee: { x: 0.4, y: 0.4 },
      label: { left: 0.05, top: 0.5, width: 0.3, height: 0.15 },
      text: 'Label legacy',
    };
    const obj = calloutToAnnotationObject(withLabel, PAGE);
    const tb = obj.objects.find((c) => c.data?.calloutPart === 'textBox');
    assertClose(tb.left, 0.05 * PAGE.width, 1e-10, 'label.left');
    assertClose(tb.top, 0.5 * PAGE.height, 1e-10, 'label.top');
    assertClose(tb.width, 0.3 * PAGE.width, 1e-10, 'label.width');
    assertClose(tb.height, 0.15 * PAGE.height, 1e-10, 'label.height');
  });
});

// ---------------------------------------------------------------------------
// Edge case: zero-size label — should clamp to minimum 1 pixel
// ---------------------------------------------------------------------------

describe('edge case — zero-size label', () => {
  it('clamps zero-width textBox to at least 1 pixel', () => {
    const zeroSize = {
      id: 'c-zero-size',
      arrowTip: { x: 0.5, y: 0.5 },
      knee: { x: 0.4, y: 0.4 },
      textBoxPosition: { x: 0.2, y: 0.2 },
      textBoxWidth: 0,
      textBoxHeight: 0,
      text: '',
    };
    const obj = calloutToAnnotationObject(zeroSize, PAGE);
    const tb = obj.objects.find((c) => c.data?.calloutPart === 'textBox');
    assert.ok(tb.width >= 1, `textbox.width should be >= 1, got ${tb.width}`);
    assert.ok(tb.height >= 1, `textbox.height should be >= 1, got ${tb.height}`);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('error handling', () => {
  it('calloutToAnnotationObject throws when callout is missing', () => {
    assert.throws(() => calloutToAnnotationObject(null, PAGE), /callout is required/);
  });

  it('calloutToAnnotationObject throws when pageSize is missing', () => {
    assert.throws(() => calloutToAnnotationObject(baseCallout, null), /pageSize/);
  });

  it('calloutToAnnotationObject throws when pageSize has non-finite width', () => {
    assert.throws(() => calloutToAnnotationObject(baseCallout, { width: NaN, height: 100 }), /pageSize/);
  });

  it('annotationObjectToCallout throws when obj is missing', () => {
    assert.throws(() => annotationObjectToCallout(null, PAGE), /obj is required/);
  });

  it('annotationObjectToCallout throws when pageSize is missing', () => {
    const obj = calloutToAnnotationObject(baseCallout, PAGE);
    assert.throws(() => annotationObjectToCallout(obj, null), /pageSize/);
  });
});

// ---------------------------------------------------------------------------
// Multi-cycle stability (no accumulating drift through repeated conversion)
// ---------------------------------------------------------------------------

describe('multi-cycle stability', () => {
  it('10 forward+reverse cycles produce no measurable drift', () => {
    let current = { ...baseCallout };
    for (let i = 0; i < 10; i++) {
      const obj = calloutToAnnotationObject(current, PAGE);
      current = annotationObjectToCallout(obj, PAGE);
    }
    // After 10 cycles the geometry should still be within PX_TOL of the
    // original pixel coordinates.
    assertClose(
      current.arrowTip.x * PAGE.width,
      baseCallout.arrowTip.x * PAGE.width,
      PX_TOL,
      '10-cycle arrowTip.x'
    );
    assertClose(
      current.knee.y * PAGE.height,
      baseCallout.knee.y * PAGE.height,
      PX_TOL,
      '10-cycle knee.y'
    );
    assertClose(
      current.textBoxWidth * PAGE.width,
      baseCallout.textBoxWidth * PAGE.width,
      PX_TOL,
      '10-cycle textBoxWidth'
    );
  });
});

// ---------------------------------------------------------------------------
// projectCalloutsIntoByPage — shared rebuild-from-source projector (Phase 5
// keystone). This is the single canonical projection used by BOTH PDFViewer's
// local reactive effect AND useAnnotationDoc's cloud hydrate, so its contract is
// load-bearing: idempotent, ghost-free on delete, non-callout objects preserved.
// ---------------------------------------------------------------------------

describe('projectCalloutsIntoByPage — shared projector', () => {
  const SIZES = { 2: PAGE };

  it('empty/non-array list returns the input byPage unchanged (referentially)', () => {
    const byPage = { 2: { objects: [{ data: { type: 'pen' } }] } };
    assert.equal(projectCalloutsIntoByPage(byPage, [], SIZES), byPage);
    assert.equal(projectCalloutsIntoByPage(byPage, null, SIZES), byPage);
  });

  it('projects each callout into its page as a data.type===callout object', () => {
    const next = projectCalloutsIntoByPage({}, [baseCallout], SIZES);
    const objs = next[2].objects;
    const callouts = objs.filter((o) => o?.data?.type === 'callout');
    assert.equal(callouts.length, 1);
    assert.equal(callouts[0].data.id, 'c-001');
  });

  it('preserves non-callout objects on the page untouched', () => {
    const pen = { data: { type: 'pen' }, id: 'p1' };
    const byPage = { 2: { objects: [pen] } };
    const next = projectCalloutsIntoByPage(byPage, [baseCallout], SIZES);
    const objs = next[2].objects;
    assert.ok(objs.includes(pen), 'pen object kept by reference');
    assert.equal(objs.filter((o) => o?.data?.type === 'callout').length, 1);
  });

  it('is idempotent: re-running never doubles a callout', () => {
    const once = projectCalloutsIntoByPage({}, [baseCallout], SIZES);
    const twice = projectCalloutsIntoByPage(once, [baseCallout], SIZES);
    assert.equal(twice[2].objects.filter((o) => o?.data?.type === 'callout').length, 1);
  });

  it('strips a removed callout (ghost-cleanup) when the list shrinks', () => {
    const c2 = { ...baseCallout, id: 'c-002' };
    const both = projectCalloutsIntoByPage({}, [baseCallout, c2], SIZES);
    assert.equal(both[2].objects.filter((o) => o?.data?.type === 'callout').length, 2);
    // Re-project from a list that no longer contains c-002.
    const after = projectCalloutsIntoByPage(both, [baseCallout], SIZES);
    const ids = after[2].objects.filter((o) => o?.data?.type === 'callout').map((o) => o.data.id);
    assert.deepEqual(ids, ['c-001']);
  });

  it('de-dupes a duplicated callout id within a single projection', () => {
    const dup = { ...baseCallout };
    const next = projectCalloutsIntoByPage({}, [baseCallout, dup], SIZES);
    assert.equal(next[2].objects.filter((o) => o?.data?.type === 'callout').length, 1);
  });

  it('falls back to US-Letter dims when the page is unmeasured (no throw)', () => {
    const next = projectCalloutsIntoByPage({}, [baseCallout], {});
    assert.equal(next[2].objects.filter((o) => o?.data?.type === 'callout').length, 1);
  });

  it('uses default text-box geometry when label/textBox fields are absent', () => {
    const obj = calloutToAnnotationObject({
      id: 'c-defaults',
      pageNumber: 1,
      arrowTip: { x: 0.5, y: 0.5 },
      text: 'x',
    }, PAGE);
    const tb = obj.objects.find((c) => c?.data?.calloutPart === 'textBox');
    assertClose(tb.left, 0, 1e-10, 'default left');
    assertClose(tb.top, 0, 1e-10, 'default top');
    assertClose(tb.width, 0.1 * PAGE.width, 1e-10, 'default width');
    assertClose(tb.height, 0.05 * PAGE.height, 1e-10, 'default height');
  });

  it('returns un-projected byPage when projection throws', () => {
    const byPage = new Proxy({}, {
      ownKeys() { throw new Error('project-boom'); },
      getOwnPropertyDescriptor() { return { configurable: true, enumerable: true }; },
    });
    const out = projectCalloutsIntoByPage(byPage, [baseCallout], SIZES);
    assert.equal(out, byPage);
  });

  it('annotationObjectToCallout reads _objects and unmarked textbox children', () => {
    const back = annotationObjectToCallout({
      data: { type: 'callout', id: 'c-legacy-children' },
      _objects: [
        { type: 'line', data: { calloutPart: 'line1' }, x2: 10, y2: 20 },
        { type: 'line', data: { calloutPart: 'line2' }, x2: 30, y2: 40 },
        { type: 'textbox', text: 'hi', left: 50, top: 60, width: 80, height: 24 },
      ],
    }, PAGE);
    assert.equal(back.id, 'c-legacy-children');
    assertClose(back.knee.x * PAGE.width, 10, 1e-10, 'knee.x');
    assertClose(back.arrowTip.x * PAGE.width, 30, 1e-10, 'arrowTip.x');
    assert.equal(back.text, 'hi');

    const empty = annotationObjectToCallout({
      data: { type: 'callout', id: 'c-empty-children' },
    }, PAGE);
    assert.equal(empty.id, 'c-empty-children');
    assert.equal(empty.knee.x, 0);
    assert.equal(empty.arrowTip.x, 0);
  });
});
