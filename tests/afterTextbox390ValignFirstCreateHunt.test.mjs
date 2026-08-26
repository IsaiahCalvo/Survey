// Genuine hunt of 390 first-create / next-draw leftovers after valign
// first-create (f2f02e68). No unique LIVE leftover proved. Do not invent
// callout verticalAlign, Color chrome mobile does not have, Line /AP,
// callout Rotation, a richTextEditor, leftover-18, or a name/type/row leftover.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('390 Text first-create already rides italic / strike / size / color / align / valign', () => {
  const overlay = read('src/components/TextEditOverlay.jsx');
  assert.match(overlay, /fontStyle: newTextStyle\?\.italic \? 'italic' : 'normal'/);
  assert.match(overlay, /underline: Boolean\(newTextStyle\?\.underline\)/);
  assert.match(overlay, /linethrough: Boolean\(newTextStyle\?\.strike\)/);
  assert.match(overlay, /fontSize: Number\(newTextStyle\?\.fontSize\) \|\| 16/);
  assert.match(overlay, /fill: newTextStyle\?\.fontColor \|\| strokeColor/);
  assert.match(overlay, /textAlign: newTextStyle\?\.textAlign \|\| 'left'/);
  assert.match(overlay, /sanitizeVerticalAlign\(newTextStyle\?\.verticalAlign\)/);
});

test('390 Callout first-create already stamps live toolbar text + Width / Style / Arrowhead', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /fontColor: textStyleDefaults\.fontColor/);
  assert.match(viewer, /italic: textStyleDefaults\.italic/);
  assert.match(viewer, /strikethrough: textStyleDefaults\.strike/);
  assert.match(viewer, /textAlign: textStyleDefaults\.textAlign/);
  assert.match(viewer, /lineThickness: Math\.max\(1, Number\(strokeWidth\) \|\| 2\)/);
  assert.match(viewer, /lineBorderStyleRef\.current === 'dashed'/);
  assert.match(viewer, /arrowheadStyle: arrowheadStyleRef\.current/);
  const overlay = read('src/components/TextEditOverlay.jsx');
  assert.match(overlay, /do not invent a user-settable callout verticalAlign/);
});

test('390 sheet still offers Italic / Strike / size / color; no invented Color chrome', () => {
  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /\['I', 'italic', 'Italic'\]/);
  assert.match(mobile, /\['S', 'strike', 'Strikethrough'\]/);
  assert.match(mobile, /aria-label="Font size"/);
  assert.match(mobile, /Set Text color/);
  assert.doesNotMatch(mobile, /Set Text color opacity/);
});

test('hunt host still names the contract; isolated 8448 / 75/250 standing', () => {
  const spec = read('debug/scenarios/e2e-after-textbox-390-valign-first-create-hunt.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /390 Italic already rides first-create/);
  assert.match(spec, /390 Callout Width 8 already rides first-create/);
  assert.match(spec, /hubPreview Text formatting must be 0/);
  assert.match(spec, /must not invent callout verticalAlign/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
