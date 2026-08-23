import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('hunt after hub Account menuitem looks for Sync chip leftover, not nameless-menu', () => {
  const spec = read('debug/scenarios/e2e-after-hub-account-independent-hunt.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /checking whether this document uses live collaboration/);
  assert.match(spec, /inventory\.editor\.sync/);
  assert.match(spec, /Up to date\\. Tap to sync now/);
  assert.doesNotMatch(spec, /data-pages-context-menu/);
  assert.doesNotMatch(spec, /data-annotation-context-menu/);
  assert.doesNotMatch(spec, /collapsed rail Spaces must be live/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
});
