// 390 Text vertical alignment must ride first-create.
// Live probe: sheet Bottom + Right → textAlign right, leftover verticalAlign top.
// Distinct from leftover-18, MobileRailNav Escape, 390 stroke minOpacity,
// and user-settable callout verticalAlign (not invented).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sanitizeVerticalAlign } from '../src/utils/annotationStyleCatalog.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('sanitizeVerticalAlign keeps bottom / middle and leftovers unknown to top', () => {
  assert.equal(sanitizeVerticalAlign('bottom'), 'bottom');
  assert.equal(sanitizeVerticalAlign('middle'), 'middle');
  assert.equal(sanitizeVerticalAlign('top'), 'top');
  assert.equal(sanitizeVerticalAlign(''), 'top');
  assert.equal(sanitizeVerticalAlign(undefined), 'top');
});

test('390 first-create reads newTextStyle.verticalAlign; callout stays top', () => {
  const overlay = read('src/components/TextEditOverlay.jsx');
  assert.match(overlay, /sanitizeVerticalAlign/);
  assert.match(overlay, /Next-draw 390 Text vertical alignment must ride the first box/);
  assert.match(overlay, /verticalAlign: reactCalloutId/);
  assert.match(overlay, /sanitizeVerticalAlign\(newTextStyle\?\.verticalAlign\)/);
  assert.doesNotMatch(
    overlay,
    /textAlign: newTextStyle\?\.textAlign \|\| 'left',\s*verticalAlign: 'top',/,
  );
});

test('390 sheet still offers Bottom / Middle; does not invent callout valign apply', () => {
  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /Bottom vertical alignment|verticalAlign: alignment/);
  assert.match(mobile, /updateTextDefaults\(\{ verticalAlign: alignment \}\)/);
  assert.match(mobile, /\['top', 'middle', 'bottom'\]/);
  const overlay = read('src/components/TextEditOverlay.jsx');
  assert.match(overlay, /do not invent a user-settable callout verticalAlign/);
});

test('390 valign leftover host still names the contract; isolated 8448 / 75/250 standing', () => {
  const spec = read('debug/scenarios/e2e-textbox-390-valign-first-create.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /390 Bottom must ride first-create/);
  assert.match(spec, /hubPreview Text formatting must be 0/);
  assert.match(spec, /1440 first-create stays top/);
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
