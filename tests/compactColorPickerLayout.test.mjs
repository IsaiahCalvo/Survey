import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('../src/components/CompactColorPicker.jsx', import.meta.url), 'utf8');

test('attached color picker joins its header without changing standalone corners', () => {
  assert.match(SOURCE, /attachedHeader\s*=\s*false/);
  assert.match(SOURCE, /borderTop:\s*attachedHeader\s*\?\s*'none'\s*:\s*undefined/);
  assert.match(SOURCE, /borderRadius:\s*attachedHeader\s*\?\s*'0 0 8px 8px'\s*:\s*'8px'/);
});

test('opacity field reserves room for 0 through 100 and the percent suffix', () => {
  assert.match(SOURCE, /width:\s*'72px',\s*flex:\s*'0 0 72px'/);
  assert.match(SOURCE, /aria-label="Opacity percentage"/);
  assert.match(SOURCE, /flex:\s*'1 1 auto',\s*minWidth:\s*0,\s*width:\s*'auto'/);
  assert.match(SOURCE, /fontSize:\s*'10px',\s*flexShrink:\s*0/);
});
