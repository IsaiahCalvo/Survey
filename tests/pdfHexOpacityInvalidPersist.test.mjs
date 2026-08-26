// P1-39 leftover sibling: Hex already skipped applyHex('zzzzzz'), but
// Opacity still onChange(localHex) so composeColorForPatch leftover-
// persisted `#zzzzzz`. Distinct from leftover-18, C-01 swatch apply,
// and C-02 hex-field-only lengths. Do not invent Color chrome on 390.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { composeColorForPatch } from '../src/utils/annotationData.js';
import { normalizeHexColor } from '../src/utils/annotationStyleCatalog.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('composeColorForPatch leftover-passthroughs invalid #zzzzzz', () => {
  assert.equal(composeColorForPatch('#zzzzzz', 40), '#zzzzzz');
  assert.equal(normalizeHexColor('zzzzzz'), null);
  assert.equal(normalizeHexColor('#000000'), '#000000');
  assert.match(composeColorForPatch('#000000', 40), /rgba\(0, 0, 0, 0\.4\)/);
});

test('CompactColorPicker Opacity commits normalized hex, not leftover localHex', () => {
  const picker = read('src/components/CompactColorPicker.jsx');
  assert.match(picker, /commitRememberedOpacity/);
  assert.match(picker, /normalizeHexColor\(localHex\) \|\| normalizeHexColor\(color\)/);
  assert.doesNotMatch(picker, /onChange\(localHex,/);
  assert.match(picker, /const normalized = normalizeHexColor\(val\)/);
  assert.match(picker, /if \(normalized\) applyHex\(normalized\)/);
});

test('live spec covers intended zzzzzz\+Opacity + hubPreview break + 390 edge', () => {
  const spec = read('debug/scenarios/e2e-hex-opacity-invalid-persist.spec.mjs');
  assert.match(spec, /zzzzzz/);
  assert.match(spec, /must not leftover-persist #zzzzzz/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /must not invent 390 hex chrome/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /viewBox/);
});

test('isolated 8448 / 75/250 stay standing; leftover-18 stay fail-closed', () => {
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
