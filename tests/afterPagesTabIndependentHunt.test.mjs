import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Hunt after Pages tab-as-switcher (`e03c9deb`). Not a leftover slice.
// Live: debug/scenarios/e2e-after-pages-tab-independent-hunt.spec.mjs
// Distinct from leftover-18 / remapped-after-CW / dismiss-family /
// rail-toggle family / Home / Close tab / Export dedicated paths.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('hunt goes beyond Bookmarks hunt and skips leftover-18 / Pages switcher replay as leftover', () => {
  const hunt = read('debug/scenarios/e2e-after-pages-tab-independent-hunt.spec.mjs');
  assert.match(hunt, /independent hunt after Pages tab-as-switcher leftover/);
  assert.match(hunt, /e2e-after-bookmarks-rail-independent-hunt/);
  assert.match(hunt, /clickable-link-test-annotated|Export annotated PDF/);
  assert.match(hunt, /Control\+s/);
  assert.match(hunt, /Control\+Shift\+E/);
  assert.match(hunt, /Control\+w/);
  assert.match(hunt, /More document options/);
  assert.match(hunt, /e2e-sticky-note\.pdf/);
  assert.match(hunt, /kal405-ink-dots\.pdf/);
  assert.match(hunt, /e2e-poly-vertices\.pdf/);
  assert.match(hunt, /kal441-form-fields\.pdf/);
  assert.match(hunt, /hubPreview=1&empty=1/);
  assert.match(hunt, /hubPreview=1&guest=1/);
  assert.match(hunt, /tab=billing/);
  assert.match(hunt, /testPdf=clickable-link-test\.pdf/);
  assert.match(hunt, /file\.id/);
  assert.doesNotMatch(hunt, /file\.id\s*=/);
  assert.doesNotMatch(hunt, /Bookmarks → Pages must not jump/);
  assert.doesNotMatch(hunt, /expanded Pages panel is 272/);
  assert.doesNotMatch(hunt, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(hunt, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(hunt, /viewBox `0 0 792 612`/);
  assert.doesNotMatch(hunt, /rotatePageSpaceInk|page-rotate-remap/);
});
