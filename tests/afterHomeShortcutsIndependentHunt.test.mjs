import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Hunt after Home shortcuts overlay singleton (`afac0655` / `8373deda`).
// Live: debug/scenarios/e2e-after-home-shortcuts-independent-hunt.spec.mjs
// Distinct from leftover-18 / remapped-after-CW / dismiss-family /
// rail-toggle family / Home tab / Home `?` singleton / Close tab.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('hunt goes beyond Home `?` singleton and skips leftover-18 / Home replay as leftover', () => {
  const hunt = read('debug/scenarios/e2e-after-home-shortcuts-independent-hunt.spec.mjs');
  assert.match(hunt, /independent hunt after Home shortcuts overlay singleton/);
  assert.match(hunt, /afac0655/);
  assert.match(hunt, /Font color/);
  assert.match(hunt, /Rectangle/);
  assert.match(hunt, /kal412-mixed-import-e2e\.pdf/);
  assert.match(hunt, /se011\.pdf/);
  assert.match(hunt, /spike-large-sheet\.pdf/);
  assert.match(hunt, /spike=features/);
  assert.match(hunt, /hubPreview=1/);
  assert.match(hunt, /testPdf=clickable-link-test\.pdf/);
  assert.match(hunt, /file\.id/);
  assert.doesNotMatch(hunt, /file\.id\s*=/);
  assert.doesNotMatch(hunt, /Home `\?` must be one overlay/);
  assert.doesNotMatch(hunt, /getByRole\('tab', \{ name: 'Home'/);
  assert.doesNotMatch(hunt, /Bookmarks → Pages must not jump/);
  assert.doesNotMatch(hunt, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(hunt, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(hunt, /viewBox `0 0 792 612`/);
  assert.doesNotMatch(hunt, /rotatePageSpaceInk|page-rotate-remap/);
  assert.doesNotMatch(hunt, /name: 'Close tab'[^;\n]*\.click\(/);

  const shell = read('src/AppShell.jsx');
  const dedicatedStart = shell.indexOf("if (e.target.closest && e.target.closest('[data-font-color-picker]')) return;");
  assert.notEqual(dedicatedStart, -1);
  const dedicated = shell.slice(dedicatedStart, dedicatedStart + 280);
  assert.match(dedicated, /addEventListener\('mousedown', onDown, true\)/);
  const exclusive = shell.slice(
    shell.indexOf('Formatting popovers share one exclusive layer'),
    shell.indexOf('Formatting popovers share one exclusive layer') + 2800,
  );
  assert.match(exclusive, /addEventListener\('pointerdown', onDown, true\)/);
  assert.doesNotMatch(exclusive, /addEventListener\('mousedown', onDown, true\)/);
});
