// The Canvas2D annotation painter must never break a line inside one emoji.
//
// WHY THIS MATTERS AT ALL, given the SVG layer is the visual truth at rest:
// LightweightAnnotationOverlay mounts with `visible={suspendFullSvgForProxy}`,
// so this painter IS the annotation surface the reader is looking at for the
// duration of a zoom or scroll gesture. Any layout disagreement between it and
// the SVG twin reads as the marks changing shape the moment a gesture starts
// and changing back when it ends — which is exactly what the owner reported
// about emoji on 2026-09-15.
//
// The disagreement was the wrap walk. Both wrappers here used
// `for (const character of paragraph)`, which iterates CODE POINTS, so a break
// could land between the two regional indicators of a flag, between a base
// emoji and its skin-tone modifier, or anywhere inside a ZWJ sequence — and the
// halves then paint as separate glyphs on two lines. The foreignObject twin
// wraps with CSS `word-break: break-all`, and CSS breaks only between
// typographic character units: it can never split a cluster. Both now walk
// segmentGraphemes().
//
// The assertions are on the STRINGS handed to fillText, so they are
// deterministic on any machine: no canvas library, no font, no pixels. The
// stub measures a fixed width per code unit, which makes the break positions
// exact arithmetic.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { paintAnnotationCanvas } from '../src/utils/annotationCanvasPainter.js';
import { segmentGraphemes } from '../src/utils/textGraphemes.js';

const FLAG_JP = '\u{1F1EF}\u{1F1F5}';                                  // 2 code points
const WORKER = '\u{1F477}\u{1F3FD}‍♀️';                 // 5 code points
const KEYCAP = '1️⃣';                                        // 3 code points
const HEART = '❤️';                                          // 2 code points

// Width per UTF-16 code unit. Every cluster above is several units wide, so a
// per-code-point walk WILL find a break inside one at these box widths.
const UNIT = 10;

function makeContext(log) {
  return {
    setTransform: () => {},
    clearRect: () => {},
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    setLineDash: () => {},
    stroke: () => {},
    arc: () => {},
    fill: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    clip: () => {},
    rect: () => {},
    measureText: (text) => ({ width: String(text).length * UNIT }),
    fillText: (text) => { if (text !== '') log.push(String(text)); },
    set font(value) { this._font = value; },
    get font() { return this._font || ''; },
  };
}

function paintTextLines({ text, width, height, fontSize = 12 }) {
  const log = [];
  paintAnnotationCanvas(makeContext(log), {
    canvasWidth: 600,
    canvasHeight: 800,
    drawScale: 1,
    displayScale: 1,
    pageWidth: 600,
    pageHeight: 800,
    objects: [{
      type: 'textbox',
      text,
      left: 10,
      top: 10,
      width,
      height,
      fontSize,
      fontFamily: 'Helvetica',
      fill: '#000',
    }],
    callouts: [],
  });
  return log;
}

function paintCalloutLines({ text, width, height, fontSize = 12 }) {
  const log = [];
  paintAnnotationCanvas(makeContext(log), {
    canvasWidth: 600,
    canvasHeight: 800,
    drawScale: 1,
    displayScale: 1,
    pageWidth: 600,
    pageHeight: 800,
    objects: [],
    callouts: [{
      pageNumber: 1,
      text,
      arrowTip: { x: 0.05, y: 0.05 },
      knee: { x: 0.08, y: 0.08 },
      textBoxPosition: { x: 0.1, y: 0.1 },
      textBoxWidth: width / 600,
      textBoxHeight: height / 800,
      style: { fontSize, fontFamily: 'Helvetica', color: '#000' },
    }],
  });
  return log;
}

// A painted line is "cluster-clean" when re-segmenting it yields only whole
// clusters that also appear whole in the source — i.e. no half of an emoji.
function assertNoSplitClusters(lines, source, label) {
  const wholeClusters = new Set(segmentGraphemes(source));
  const joined = lines.join('');
  assert.equal(joined, source.replace(/\n/g, ''), `${label}: every code point must still be painted exactly once, in order`);
  for (const line of lines) {
    for (const cluster of segmentGraphemes(line)) {
      assert.ok(
        wholeClusters.has(cluster),
        `${label}: painted "${[...cluster].map((c) => c.codePointAt(0).toString(16)).join('+')}" which is not a whole cluster of the source — a line break landed inside one emoji`,
      );
    }
  }
}

for (const [name, emoji] of [['regional-indicator flag', FLAG_JP], ['ZWJ sequence', WORKER], ['keycap', KEYCAP], ['variation-selector heart', HEART]]) {
  test(`canvas text wrap never breaks a ${name} in half`, () => {
    const source = `${emoji}${emoji}${emoji}${emoji}${emoji}${emoji}`;
    // Deliberately narrow: several breaks are forced inside the run.
    for (const width of [40, 55, 70, 85, 100]) {
      const lines = paintTextLines({ text: source, width, height: 400 });
      assert.ok(lines.length > 1, `width ${width} must actually wrap`);
      assertNoSplitClusters(lines, source, `text @${width}`);
    }
  });

  test(`canvas callout wrap never breaks a ${name} in half`, () => {
    const source = `${emoji}${emoji}${emoji}${emoji}`;
    for (const width of [50, 70, 90]) {
      const lines = paintCalloutLines({ text: source, width, height: 400 });
      assertNoSplitClusters(lines, source, `callout @${width}`);
    }
  });
}

test('plain ASCII still breaks per character, exactly where it did before', () => {
  // break-all, not word wrap: the SVG twin sets word-break:break-all, so the
  // painter must keep breaking mid-word. Guard against "fixing" the cluster
  // walk by switching to word wrap.
  const lines = paintTextLines({ text: 'ABCDEFGH', width: 40, height: 400 });
  assert.equal(lines.join(''), 'ABCDEFGH');
  assert.ok(lines.length > 1, 'an 8-character run must wrap inside a 40-unit box');
  assert.ok(lines.every((l) => l.length <= 8));
});

test('a newline still starts a new painted line', () => {
  const lines = paintTextLines({ text: 'AB\nCD', width: 400, height: 400 });
  assert.deepEqual(lines, ['AB', 'CD']);
});

test('the painter source no longer walks a paragraph by code point', () => {
  // Source assertion: the per-code-point walk is the defect itself, and it is
  // a two-word edit to reintroduce.
  const source = new URL('../src/utils/annotationCanvasPainter.js', import.meta.url);
  const text = readFileSync(source, 'utf8');
  const walks = text.split('\n').filter((line) => /for \(const character of paragraph\)/.test(line) && !line.trimStart().startsWith('//'));
  assert.equal(walks.length, 0, 'wrap by grapheme cluster (wrapByGraphemeBreakAll), never by code point');
});
