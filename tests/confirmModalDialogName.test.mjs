import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contract: ConfirmModal is named via the visible title.
// Live proof: debug/scenarios/e2e-confirm-modal-dialog-name.spec.mjs
// Distinct from leftover-18 / nameless-menu / Settings dialog name /
// survey-rail Delete selected categories apply chrome.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('ConfirmModal dialog is labelled by the visible title', () => {
  const src = read('src/home/BulkModals.jsx');
  const start = src.indexOf('export function ConfirmModal');
  const end = src.indexOf('export function RenameModal');
  assert.ok(start > 0 && end > start);
  const slice = src.slice(start, end);
  assert.match(slice, /role="dialog"/);
  assert.match(slice, /aria-modal="true"/);
  assert.match(slice, /aria-labelledby="confirm-modal-title"/);
  assert.match(slice, /id="confirm-modal-title"/);
  assert.doesNotMatch(slice, /role="dialog" aria-modal="true" onClick=/);
  assert.doesNotMatch(slice, /create-checkout-session|Turnstile|msalInstance/);
});

test('sibling compile-visible dialogs stay named; leftover-18 hosts stay gated', () => {
  const share = read('src/home/ShareModal.jsx');
  const create = read('src/home/CreateProjectModal.jsx');
  const bulk = read('src/home/BulkModals.jsx');
  const auth = read('src/components/AuthModal.jsx');
  const settings = read('src/components/AccountSettings.jsx');
  const confirmDelete = read('src/components/collab/ConfirmDeleteModal.jsx');
  const archive = read('src/home/ArchiveScreen.jsx');
  const hub = read('src/home/HubPreview.jsx');
  assert.match(share, /aria-label=\{`Share \$\{noun\}`\}/);
  assert.match(create, /aria-label="Create project"/);
  assert.match(bulk, /aria-label=\{title\}/);
  assert.match(auth, /aria-labelledby="auth-modal-title"/);
  assert.match(settings, /aria-labelledby="account-settings-title"/);
  assert.match(confirmDelete, /aria-labelledby="confirm-delete-heading"/);
  assert.match(archive, /<ConfirmModal[\s\S]*?title=\{DELETE_FOREVER_COPY\.title\}/);
  assert.match(hub, /onDeleteArchiveForever=\{previewBlocked\('delete archived items forever'\)\}/);
});

test('live spec covers named ConfirmModal intended + break + edge; skip leftover-18 and Settings replay', () => {
  const spec = read('debug/scenarios/e2e-confirm-modal-dialog-name.spec.mjs');
  assert.match(spec, /surveyTransitionE2E=1/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /getByRole\('dialog', \{ name: title, exact: true \}\)/);
  assert.match(spec, /confirm-modal-title/);
  assert.match(spec, /Delete 1 category\?/);
  assert.match(spec, /Delete 2 categories\?/);
  assert.match(spec, /guest=1/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
  assert.doesNotMatch(spec, /account-settings-title/);
  assert.doesNotMatch(spec, /viewBox `0 0 792 612`/);
});
