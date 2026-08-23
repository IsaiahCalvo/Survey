import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('hunt after keep-mount inert looks past hub nav type and PDF form widgets', () => {
  const spec = read('debug/scenarios/e2e-after-hub-keep-mount-independent-hunt.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /keepMount/);
  assert.match(spec, /hubNavFocusable/);
  assert.match(spec, /formWidgets/);
  assert.match(spec, /AFTER_HUB_KEEP_MOUNT_INDEPENDENT_HUNT/);
  assert.doesNotMatch(spec, /data-pages-context-menu/);
  assert.doesNotMatch(spec, /data-annotation-context-menu/);
  assert.doesNotMatch(spec, /collapsed rail Spaces must be live/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
});
