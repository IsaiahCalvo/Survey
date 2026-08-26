// Genuine hunt after tip 096fc1b0: Ellipse rotate then Select persist,
// Cloud first-create after Textbox sibling, imported Line/Poly Select
// Width + dash export. No unique LIVE leftover. Do not invent stamp
// renderer, Note/Link create, create-poly tool, Font family chrome,
// leftover-18 hosts, or stamp file.id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Circle / Poly writers keep rotate Matrix and Select Width /BS', () => {
  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(writer, /const needsRotate = pdfNeedsRotate\(angle\);/);
  assert.match(writer, /Border: \[0, 0, fabricObj\.strokeWidth \|\| 1\]/);
  assert.match(writer, /W: fabricObj\.strokeWidth \|\| 1,/);
  const prefs = read('src/hooks/useDatabase.js');
  assert.match(prefs, /cloudIntensity: 2/);
});

test('live spec covers Ellipse rotate-Select + Cloud after Textbox + Poly Width + no invent', () => {
  const spec = read('debug/scenarios/e2e-after-counter-ellipse-rotate-cloud-poly-hunt.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /testPdf=e2e-poly-vertices\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /Ellipse Select Fill after Rotation must keep 45/);
  assert.match(spec, /export must keep Circle \/AP \/Matrix \+ angle 45 after rotate then Select Fill/);
  assert.match(spec, /Cloud first-create Bump 8 after Textbox sibling/);
  assert.match(spec, /Cloud first-create must not leftover-stamp Textbox dash/);
  assert.match(spec, /export must keep Select Width 8, not leftover-drop/);
  assert.match(spec, /must not invent 390 hex chrome/);
  assert.match(spec, /must not invent Font family chrome/);
  assert.match(spec, /0 0 612 792/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});

test('isolated 8448 / 75\/250 stay standing; leftover-18 stay fail-closed', () => {
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
