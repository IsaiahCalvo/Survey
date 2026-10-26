// Smart fill (Nightly beta): the phone template editor lists taught tag
// shapes with the same remove action as desktop, at 44px tap size.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../src/home/TemplatesEditor.jsx', import.meta.url), 'utf8');

test('phone template options list Smart fill shapes behind the beta flag', () => {
  const start = SRC.indexOf('<div className="templates-mobile-template-options">');
  assert.ok(start > 0);
  const end = SRC.indexOf('templates-mobile-modules-section', start);
  const phoneBlock = SRC.slice(start, end);
  assert.match(phoneBlock, /smartFillBeta && \(\s*<SmartFillShapeChips\s+phone/);
  assert.match(phoneBlock, /removedSmartFillShapeIds/);
});

test('phone chips are 44px tap targets', () => {
  assert.match(SRC, /minHeight: phone \? 44 : 0, minWidth: phone \? 44 : undefined/);
});
