import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Independent hunt after official overlay-mount align (`0e812b9f` / `5b7114de`).
// Axis: leftover official files that still fail vs live source, not
// overlay-mount / isolated 8448 / rail-toggle product replay / dismiss /
// Home `?`. Live proof: debug/scenarios/e2e-after-overlay-mount-independent-hunt.spec.mjs

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('hunt spec covers live DOM + leftover-18 hosts and skips overlay-mount / rail-toggle replay', () => {
  const spec = read('debug/scenarios/e2e-after-overlay-mount-independent-hunt.spec.mjs');
  assert.match(spec, /independent hunt after official overlay-mount align/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /Up to date|Retry now|Presence|More document options/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /!isViewerVisible && <KeyboardShortcutsOverlay/);
  assert.doesNotMatch(spec, /collapsed rail Spaces must be live/);
  assert.doesNotMatch(spec, /Home `\?` must be one overlay/);
  assert.doesNotMatch(spec, /click-outside must close Style/);
  assert.doesNotMatch(spec, /viewBox `0 0 792 612`/);
});
