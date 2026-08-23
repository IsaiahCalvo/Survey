import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for annotation context *actions* role=menuitem + Enter.
// Live proof: debug/scenarios/e2e-annotation-context-menuitem.spec.mjs
// Distinct from leftover-18 / dismiss-family / spacesRailToggle /
// overlay-mount / Cut-Copy-Paste execute catalogs.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('annotation context items are role=menuitem with Enter/Space; menu has role=menu', () => {
  const hook = read('src/hooks/useAnnotationContextMenu.jsx');
  assert.match(hook, /role="menu"/);
  assert.match(hook, /aria-label=\{mobileTitle\}/);
  assert.match(hook, /role="menuitem"/);
  assert.match(hook, /tabIndex=\{it\.disabled \? -1 : 0\}/);
  assert.match(hook, /aria-disabled=\{it\.disabled \? 'true' : undefined\}/);
  assert.match(hook, /e\.key === 'Enter' \|\| e\.key === ' '/);
  assert.match(hook, /it\.onClick\?\.\(\)/);
  assert.doesNotMatch(hook, /item\('Duplicate'/);
  assert.match(hook, /Group \/ Ungroup items intentionally omitted/);
});

test('live spec covers named menuitem actions intended + break + edge; skip leftover-18 and dismiss replay', () => {
  const spec = read('debug/scenarios/e2e-annotation-context-menuitem.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /getByRole\('menuitem', \{ name, exact: true \}\)/);
  assert.match(spec, /Bring to front/);
  assert.match(spec, /aria-disabled/);
  assert.match(spec, /keyboard\.press\('Enter'\)/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /collapsed rail Spaces must be live/);
  assert.doesNotMatch(spec, /!isViewerVisible && <KeyboardShortcutsOverlay/);
  assert.doesNotMatch(spec, /click-outside must close Style/);
  assert.doesNotMatch(spec, /viewBox `0 0 792 612`/);
});
