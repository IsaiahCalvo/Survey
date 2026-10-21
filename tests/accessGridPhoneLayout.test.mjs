// Document Access dialog on a phone: at 320px the five-column row squeezed the
// Users column to 0px (names/emails one letter per line over the next rows),
// Remove ran off the card, rows shrank under each other and the role picker was
// a 24px target. The grid columns now live in hub.css with a phone layout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const jsx = readFileSync(new URL('../src/home/AccessManagementModal.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/home/hub.css', import.meta.url), 'utf8');

test('rows and header use the access-grid class, not inline five-column grids', () => {
  assert.doesNotMatch(jsx, /gridTemplateColumns:\s*'30px 1fr 1fr 1fr 90px'/);
  assert.equal((jsx.match(/className="access-grid"/g) || []).length, 3);
  assert.match(jsx, /className="access-grid access-grid--head"/);
});

test('phone layout puts the person on its own line and keeps rows from shrinking', () => {
  assert.match(css, /\.access-grid \{ grid-template-columns: 30px 1fr 1fr 1fr 90px; flex-shrink: 0; \}/);
  const phone = css.slice(css.indexOf('@media (max-width: 600px) {\n  .access-grid'));
  assert.match(phone, /grid-template-columns: 30px minmax\(0, 1fr\) auto auto/);
  assert.match(phone, /\.access-grid > :nth-child\(2\) \{ grid-column: 2 \/ -1; \}/);
});

test('role picker and row buttons get 44px touch targets', () => {
  assert.match(jsx, /<select className="access-role-select"/);
  assert.match(css, /@media \(pointer: coarse\) \{\n  \.access-role-select \{ height: 44px !important; \}/);
  for (const label of ['Remove', 'Resend', 'Revoke', 'Copy']) {
    assert.ok(jsx.includes('dialog-touch-pad') && new RegExp(`dialog-touch-pad"[^>]*>\\s*(?:${label})|dialog-touch-pad"\\s*\\n[\\s\\S]{0,400}?>\\s*${label}`).test(jsx), label);
  }
});
