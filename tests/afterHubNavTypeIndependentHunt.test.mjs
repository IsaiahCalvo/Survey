import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('hunt after hub nav type=button looks past Sync chip and nameless-menu', () => {
  const spec = read('debug/scenarios/e2e-after-hub-nav-type-independent-hunt.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /navTypeButton/);
  assert.match(spec, /searchInputs/);
  assert.match(spec, /unnamed/);
  assert.match(spec, /AFTER_HUB_NAV_TYPE_INDEPENDENT_HUNT/);
  assert.doesNotMatch(spec, /data-pages-context-menu/);
  assert.doesNotMatch(spec, /data-annotation-context-menu/);
  assert.doesNotMatch(spec, /collapsed rail Spaces must be live/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
});
