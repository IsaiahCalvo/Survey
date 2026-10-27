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
  // One AccessRow draws every member, invite and link row (design review
  // 2026-10-27); Manage team uses the same grid.
  assert.equal((jsx.match(/className="access-grid"/g) || []).length, 1);
  assert.match(jsx, /className="access-grid access-grid--head"/);
  const team = readFileSync(new URL('../src/home/ManageTeamModal.jsx', import.meta.url), 'utf8');
  assert.equal((team.match(/className="access-grid"/g) || []).length, 2);
  assert.match(team, /className="access-grid access-grid--head"/);
  assert.doesNotMatch(team, /gridTemplateColumns: "30px 1fr 1fr 1fr 24px"/);
});

test('phone layout puts the person on its own line and keeps rows from shrinking', () => {
  assert.match(css, /\.access-grid \{ grid-template-columns: 30px 1fr 1fr 1fr 24px; flex-shrink: 0; \}/);
  const phone = css.slice(css.indexOf('@media (max-width: 600px) {\n  .access-grid'));
  assert.match(phone, /grid-template-columns: 30px minmax\(0, 1fr\) auto auto/);
  assert.match(phone, /\.access-grid > :nth-child\(2\) \{ grid-column: 2 \/ -1; \}/);
});

test('names and emails never break mid-word; actions live in the row More menu', () => {
  assert.doesNotMatch(jsx, /overflowWrap: 'anywhere'/);
  assert.match(jsx, /whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'/);
  assert.doesNotMatch(jsx, /<select/, 'no browser drop-down for the role');
  assert.doesNotMatch(css, /access-role-select/);
  // The More button is 44px to a finger; the menu is the shared action menu.
  assert.match(jsx, /aria-label="More" \{\.\.\.tip\('More'\)\}[\s\S]{0,400}className="hub-icon-btn dialog-close-touch-pad"/);
  assert.match(jsx, /className="hub-menu"[\s\S]{0,200}<MenuRows items=\{menuItems\}/);
  for (const label of ['Remove access', 'Copy email', 'Resend invite', 'Revoke invite', 'Copy link', 'Revoke link']) {
    assert.ok(jsx.includes(`label: '${label}'`), label);
  }
  // The last owner's rows explain themselves instead of a dead Remove.
  assert.equal((jsx.match(/reason: isLastOwner \? 'At least one owner must remain' : null/g) || []).length, 2);
});
