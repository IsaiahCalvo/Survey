import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Independent hunt after annotation context menuitem (`8d95e104`).
// Live proof: debug/scenarios/e2e-after-annotation-menuitem-independent-hunt.spec.mjs

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('hunt spec covers Pages/Fit/Style/hub menus and skips leftover-18 + exhausted replay', () => {
  const spec = read('debug/scenarios/e2e-after-annotation-menuitem-independent-hunt.spec.mjs');
  assert.match(spec, /independent hunt after annotation context menuitem/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /Page 1 actions/);
  assert.match(spec, /Fit page/);
  assert.match(spec, /role="option"/);
  assert.match(spec, /Account menu/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /collapsed rail Spaces must be live/);
  assert.doesNotMatch(spec, /click-outside must close Pages context/);
  assert.doesNotMatch(spec, /Bring to front/);
  assert.doesNotMatch(spec, /viewBox `0 0 792 612`/);
});
