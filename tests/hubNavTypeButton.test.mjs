import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts: hub primary nav Documents/Projects/Templates/Archive
// must be type=button (same helper as 390 Home sections).
// Live proof: debug/scenarios/e2e-hub-nav-type-button.spec.mjs
// Distinct from leftover-18 / nameless-menu / rail-toggle / Sync chip /
// hub Account menuitem / MobileRailNav (already typed).

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('hub navBtn is type=button; MobileRailNav already typed', () => {
  const shell = read('src/home/HubShell.jsx');
  const start = shell.indexOf('const navBtn =');
  const end = shell.indexOf('return (', start);
  assert.ok(start > 0 && end > start);
  const slice = shell.slice(start, end);
  assert.match(slice, /type="button"/);
  assert.match(slice, /onClick=\{\(\) => !disabled && onNav && onNav\(key\)\}/);
  assert.match(slice, /Templates is a Pro feature/);
  assert.doesNotMatch(slice, /role="menuitem"/);
  assert.doesNotMatch(slice, /create-checkout-session|Turnstile|msalInstance/);

  const railStart = shell.indexOf('const MobileRailNav');
  const railEnd = shell.indexOf('export const HubShell');
  const rail = shell.slice(railStart, railEnd);
  assert.match(rail, /type="button"/);
  assert.match(rail, /aria-label="Open navigation"/);
});

test('live spec covers hub nav type=button intended + break + edge; skip leftover-18 and nameless-menu', () => {
  const spec = read('debug/scenarios/e2e-hub-nav-type-button.spec.mjs');
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /mobileNav=tabs/);
  assert.match(spec, /empty=1/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /desktop hub nav is type=button/);
  assert.match(spec, /390 Home sections/);
  assert.match(spec, /archive-desktop-search/);
  assert.match(spec, /documents-desktop-search/);
  assert.match(spec, /Search archive/);
  assert.match(spec, /getByRole\('button', \{ name: \/Security Walk-Through\/ \}\)/);
  assert.match(spec, /keyboard\.press\('Enter'\)/);
  assert.match(spec, /dblclick/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /getByRole\('menuitem'/);
  assert.doesNotMatch(spec, /data-pages-context-menu/);
  assert.doesNotMatch(spec, /viewBox `0 0 792 612`/);
});
