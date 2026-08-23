import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for hub Account menu *actions* role=menuitem.
// Live proof: debug/scenarios/e2e-hub-account-menuitem.spec.mjs
// Distinct from leftover-18 / dismiss-family / annotation context
// menuitem / Pages context menuitem / Settings General content.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Account menu items are role=menuitem; confirm Cancel/Sign out stay buttons', () => {
  const shell = read('src/home/HubShell.jsx');
  const start = shell.indexOf('const ProfileMenu');
  const end = shell.indexOf('const MobileRailNav');
  assert.ok(start > 0 && end > start);
  const slice = shell.slice(start, end);
  assert.match(slice, /role="menu"/);
  assert.match(slice, /aria-label="Account menu"/);
  assert.equal((slice.match(/role="menuitem"/g) || []).length, 3);
  assert.match(slice, /role="menuitem"[\s\S]*Settings/);
  assert.match(slice, /role="menuitem"[\s\S]*Sign out/);
  assert.match(slice, /showArchive && \([\s\S]*role="menuitem"[\s\S]*Archive/);
  assert.match(slice, /profile-signout-buttons[\s\S]*<button type="button" onClick=\{\(\) => setConfirmSignOut\(false\)\}>Cancel/);
  assert.doesNotMatch(slice, /create-checkout-session|Turnstile|msalInstance/);
});

test('live spec covers named menuitem actions intended + break + edge; skip leftover-18 and Pages replay', () => {
  const spec = read('debug/scenarios/e2e-hub-account-menuitem.spec.mjs');
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /getByRole\('menuitem', \{ name: 'Settings', exact: true \}\)/);
  assert.match(spec, /Account menu/);
  assert.match(spec, /keyboard\.press\('Enter'\)/);
  assert.match(spec, /Profile information/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /data-pages-context-menu/);
  assert.doesNotMatch(spec, /data-annotation-context-menu/);
  assert.doesNotMatch(spec, /click-outside must close Pages context/);
  assert.doesNotMatch(spec, /viewBox `0 0 792 612`/);
});
