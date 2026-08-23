import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contract: keep-mounted Dashboard under the viewer is inert +
// aria-hidden while isViewerVisible. Home / Back lift both.
// Live proof: debug/scenarios/e2e-hub-keep-mount-inert.spec.mjs
// Distinct from leftover-18 / nameless-menu / rail-toggle / Home tab
// click / hub nav type=button / Sync chip.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('AppShell keep-mount wrapper is inert only while the viewer is visible', () => {
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /data-hub-keep-mount=""/);
  assert.match(shell, /\.\.\.\(isViewerVisible \? \{ inert: '', 'aria-hidden': 'true' \} : \{\}\)/);
  assert.match(shell, /const isViewerVisible = activeTab && !activeTab\.isHome && selectedPDF && currentView === 'viewer'/);
  assert.doesNotMatch(shell, /file\.id\s*=/);
  assert.doesNotMatch(shell, /create-checkout-session|Turnstile|msalInstance/);
});

test('live spec covers keep-mount inert intended + break + edge; skip leftover-18 and nameless-menu', () => {
  const spec = read('debug/scenarios/e2e-hub-keep-mount-inert.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /empty=1/);
  assert.match(spec, /keep-mount hub is inert under the viewer/);
  assert.match(spec, /Home lifts it/);
  assert.match(spec, /pdfjs_internal_id_10R|input\[name="name"\]/);
  assert.match(spec, /input\[type="checkbox"\]\[name="agree"\]/);
  assert.match(spec, /Tab from Draw must not leak/);
  assert.match(spec, /390 viewer keeps hub inert/);
  assert.match(spec, /hubPreview is not AppShell keep-mount/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /data-pages-context-menu/);
  assert.doesNotMatch(spec, /viewBox `0 0 792 612`/);
});
