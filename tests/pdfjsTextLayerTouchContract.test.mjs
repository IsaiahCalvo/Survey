import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  new URL('../src/components/PdfjsTextLayer.jsx', import.meta.url),
  'utf8',
);

test('interactive PDF text keeps selection and pan while allowing native pinch zoom', () => {
  assert.match(
    source,
    /\.pdfjsTextLayer\.is-interactive \{[^}]*pointer-events: auto;[^}]*user-select: text !important;[^}]*touch-action: pan-x pan-y pinch-zoom;/,
  );
  assert.match(
    source,
    /\.pdfjsTextLayer:not\(\.is-interactive\) \{ pointer-events: none; \}/,
  );
});
