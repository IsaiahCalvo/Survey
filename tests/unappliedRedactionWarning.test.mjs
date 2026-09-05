import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/utils/svgAnnotationRenderers.jsx', import.meta.url), 'utf8');

test('unapplied imported redactions use the fixed warning color, not authored color', () => {
  assert.match(source, /UNAPPLIED_REDACTION_WARNING_COLOR = '#d0021b'/);
  assert.match(source, /stroke=\{isUnappliedImportedRedaction \? UNAPPLIED_REDACTION_WARNING_COLOR : undefined\}/);
});
