// textEditCommit.test.mjs — commit-JSON contract for the same-surface text
// editor (TextEditOverlay). These builders replaced FabricEditCanvas's
// commitAndClose for editType 'text'; the rules they encode (tight-fit new
// text, never-shrink re-edit, callout padY=0, rotated-growth anchoring,
// scope/id preservation) came from that path and must not drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TEXT_PADDING,
  FABRIC_TEXTBOX_ENVELOPE,
  buildNewTextCommitJSON,
  buildExistingTextCommitJSON,
  ensureTextAnnotationId,
  isBlankTextEdit,
} from '../src/utils/textEditCommit.js';

test('new text: blank input is discarded (returns null)', () => {
  assert.equal(buildNewTextCommitJSON({ text: '   ', left: 0, top: 0, innerWrapWidth: 148, naturalInnerHeight: 21 }), null);
  assert.equal(buildNewTextCommitJSON({ text: '', left: 0, top: 0, innerWrapWidth: 148, naturalInnerHeight: 21 }), null);
});

test('new text: single line tight-fits width to measured content', () => {
  const json = buildNewTextCommitJSON({
    text: 'hi',
    left: 10,
    top: 20,
    innerWrapWidth: 148,
    maxLineWidth: 30,
    lineCount: 1,
    naturalInnerHeight: 21,
  });
  // ceil(30 + 2) + 2*pad — hugs the glyphs, not the 160 wrap target
  assert.equal(json.width, 32 + 2 * TEXT_PADDING);
  assert.equal(json.height, 21 + 2 * TEXT_PADDING);
  assert.equal(json.left, 10);
  assert.equal(json.top, 20);
  assert.equal(json.type, 'Textbox');
  // renderers treat left/top as the outer top-left corner
  assert.equal(json.originX, 'left');
  assert.equal(json.originY, 'top');
  assert.equal(json.splitByGrapheme, true);
  assert.ok(json.data.id, 'commit must carry a data.id');
});

test('new text: multi-line keeps the wrap width the user saw', () => {
  const json = buildNewTextCommitJSON({
    text: 'a longer run of text that wrapped',
    left: 0,
    top: 0,
    innerWrapWidth: 148,
    maxLineWidth: 300,
    lineCount: 3,
    naturalInnerHeight: 63,
  });
  assert.equal(json.width, 148 + 2 * TEXT_PADDING);
  assert.equal(json.height, 63 + 2 * TEXT_PADDING);
});

test('new text: style overrides apply and fontSize clamps', () => {
  const json = buildNewTextCommitJSON({
    text: 'x',
    left: 0,
    top: 0,
    innerWrapWidth: 148,
    naturalInnerHeight: 21,
    style: { fontSize: 999, fontWeight: 'bold', textAlign: 'center', verticalAlign: 'middle' },
  });
  assert.equal(json.fontSize, 200);
  assert.equal(json.fontWeight, 'bold');
  assert.equal(json.textAlign, 'center');
  assert.equal(json.verticalAlign, 'middle');
});

const ORIGINAL = Object.freeze({
  ...FABRIC_TEXTBOX_ENVELOPE,
  type: 'Textbox',
  left: 100,
  top: 200,
  width: 160,
  height: 75,
  text: 'old',
  fill: '#112233',
  stroke: '#000000',
  strokeWidth: 1,
  moduleId: 'mod-1',
  regionId: 'reg-1',
  data: { id: 'anno-keep-me' },
});

test('existing text: grows to fit content but never shrinks below stored size', () => {
  const grown = buildExistingTextCommitJSON({ original: ORIGINAL, text: 'new text', naturalInnerHeight: 100 });
  assert.equal(grown.height, 100 + 2 * TEXT_PADDING);
  const short = buildExistingTextCommitJSON({ original: ORIGINAL, text: 'x', naturalInnerHeight: 21 });
  assert.equal(short.height, 75);
  assert.equal(short.width, 160);
});

test('existing text: preserves scope stamps, id, colors; folds legacy scale', () => {
  const scaled = { ...ORIGINAL, scaleX: 2, scaleY: 2 };
  const json = buildExistingTextCommitJSON({ original: scaled, text: 'new', naturalInnerHeight: 21 });
  assert.equal(json.width, 320);
  assert.equal(json.height, 150);
  assert.equal(json.scaleX, 1);
  assert.equal(json.scaleY, 1);
  assert.equal(json.moduleId, 'mod-1');
  assert.equal(json.regionId, 'reg-1');
  assert.equal(json.data.id, 'anno-keep-me');
  assert.equal(json.fill, '#112233');
  assert.equal(json.text, 'new');
});

test('existing text: callout uses padY=0 for the height floor', () => {
  const json = buildExistingTextCommitJSON({ original: { ...ORIGINAL, height: 30 }, text: 'grow', naturalInnerHeight: 50, isCallout: true });
  assert.equal(json.height, 50); // natural + 0, no vertical gutter
});

test('existing text: rotated box keeps its rotated top-left anchored on height growth', () => {
  const rotated = { ...ORIGINAL, angle: 90 };
  const json = buildExistingTextCommitJSON({ original: rotated, text: 'grow', naturalInnerHeight: 100 });
  const dh = json.height - 75;
  // left' = left - dH/2*sin(a); top' = top - dH/2*(1-cos(a)) at a=90°
  assert.ok(Math.abs(json.left - (100 - dh / 2)) < 1e-9);
  assert.ok(Math.abs(json.top - (200 - dh / 2)) < 1e-9);
  assert.equal(json.angle, 90);
});

test('existing text: blank or whitespace commit is discarded so no ghost remains', () => {
  assert.equal(isBlankTextEdit(''), true);
  assert.equal(isBlankTextEdit('   \n\t'), true);
  assert.equal(isBlankTextEdit(null), true);
  assert.equal(isBlankTextEdit('keep'), false);

  assert.equal(buildExistingTextCommitJSON({ original: ORIGINAL, text: '', naturalInnerHeight: 21 }), null);
  assert.equal(buildExistingTextCommitJSON({ original: ORIGINAL, text: '   ', naturalInnerHeight: 21 }), null);
  assert.equal(buildExistingTextCommitJSON({
    original: { ...ORIGINAL, height: 30 },
    text: '\n',
    naturalInnerHeight: 50,
    isCallout: true,
  }), null);
  const kept = buildExistingTextCommitJSON({ original: ORIGINAL, text: 'still here', naturalInnerHeight: 21 });
  assert.equal(kept.text, 'still here');
});

test('ensureTextAnnotationId: reuses any existing id, never overwrites', () => {
  const a = { id: 'top-level-id' };
  ensureTextAnnotationId(a);
  assert.equal(a.data.id, 'top-level-id');
  const b = { data: { id: 'already' } };
  ensureTextAnnotationId(b);
  assert.equal(b.data.id, 'already');
  const c = {};
  ensureTextAnnotationId(c, 'Textbox');
  assert.ok(c.data.id.length > 0);
});
