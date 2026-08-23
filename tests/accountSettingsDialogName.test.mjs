import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contract: Account Settings dialog is named via the Settings
// heading. Live proof: debug/scenarios/e2e-account-settings-dialog-name.spec.mjs
// Distinct from leftover-18 / nameless-menu / hub Account menuitem /
// Settings General content / keep-mount inert.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Account Settings dialog is labelled by the Settings heading', () => {
  const src = read('src/components/AccountSettings.jsx');
  assert.match(src, /aria-labelledby="account-settings-title"/);
  assert.match(src, /<h2 id="account-settings-title">Settings<\/h2>/);
  assert.match(src, /role="dialog"/);
  assert.match(src, /aria-modal="true"/);
  assert.doesNotMatch(src, /role="dialog"\s*\n\s*aria-modal="true"\s*\n\s*onClick=/);
  assert.doesNotMatch(src, /create-checkout-session|Turnstile|msalInstance/);
});

test('sibling compile-visible hub dialogs stay named; leftover-18 hosts stay gated', () => {
  const share = read('src/home/ShareModal.jsx');
  const create = read('src/home/CreateProjectModal.jsx');
  const rename = read('src/home/BulkModals.jsx');
  const auth = read('src/components/AuthModal.jsx');
  assert.match(share, /aria-label=\{`Share \$\{noun\}`\}/);
  assert.match(create, /aria-label="Create project"/);
  assert.match(rename, /aria-label=\{title\}/);
  assert.match(auth, /aria-labelledby="auth-modal-title"/);
});

test('live spec covers named Settings dialog intended + break + edge; skip leftover-18 and keep-mount replay', () => {
  const spec = read('debug/scenarios/e2e-account-settings-dialog-name.spec.mjs');
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /getByRole\('dialog', \{ name: 'Settings', exact: true \}\)/);
  assert.match(spec, /account-settings-title/);
  assert.match(spec, /Connected services/);
  assert.match(spec, /guest=1/);
  assert.match(spec, /dev-test-user@example\.invalid/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /data-hub-keep-mount=""/);
  assert.doesNotMatch(spec, /collapsed rail Spaces must be live/);
  assert.doesNotMatch(spec, /viewBox `0 0 792 612`/);
});
