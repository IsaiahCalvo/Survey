import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contract: AccessManagementModal is named via the visible title.
// Live proof: debug/scenarios/e2e-access-management-dialog-name.spec.mjs
// Distinct from leftover-18 / nameless-menu / Settings / Confirm /
// CreateCategory / KeyboardShortcuts dialog name / Documents Share Access apply.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('AccessManagementModal dialog is labelled by the visible title', () => {
  const src = read('src/home/AccessManagementModal.jsx');
  const start = src.indexOf('role="dialog"');
  const end = src.indexOf('access-management-modal-title');
  assert.ok(start > 0 && end > start);
  const slice = src.slice(start, start + 900);
  assert.match(slice, /role="dialog"/);
  assert.match(slice, /aria-modal="true"/);
  assert.match(slice, /aria-labelledby="access-management-modal-title"/);
  assert.match(slice, /id="access-management-modal-title"/);
  assert.match(src, /if \(kind === 'document'\) return 'Document Access';/);
  assert.doesNotMatch(slice, /role="dialog"\s*\n\s*aria-modal="true"\s*\n\s*onClick=\{\(e\) => e\.stopPropagation\(\)\}/);
  assert.doesNotMatch(src, /create-checkout-session|Turnstile|msalInstance/);
});

test('sibling compile-visible dialogs stay named; PromptModal lock stays gated', () => {
  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  const create = read('src/components/CreateCategoryModal.jsx');
  const confirm = read('src/home/BulkModals.jsx');
  const settings = read('src/components/AccountSettings.jsx');
  const share = read('src/home/ShareModal.jsx');
  const project = read('src/home/CreateProjectModal.jsx');
  const prompt = read('src/components/dialogPrompts.jsx');
  const start = confirm.indexOf('export function ConfirmModal');
  const end = confirm.indexOf('export function RenameModal');
  assert.match(overlay, /aria-labelledby="keyboard-shortcuts-title"/);
  assert.match(create, /aria-labelledby="create-category-modal-title"/);
  assert.match(confirm.slice(start, end), /aria-labelledby="confirm-modal-title"/);
  assert.match(settings, /aria-labelledby="account-settings-title"/);
  assert.match(share, /aria-label=\{`Share \$\{noun\}`\}/);
  assert.match(project, /aria-label="Create project"/);
  assert.match(prompt, /export function PromptModal/);
  assert.match(prompt, /title = ''/);
});

test('live spec covers named AccessManagementModal intended + break + edge; skip leftover-18 and Share apply replay', () => {
  const spec = read('debug/scenarios/e2e-access-management-dialog-name.spec.mjs');
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /getByRole\('dialog', \{ name: 'Document Access', exact: true \}\)/);
  assert.match(spec, /access-management-modal-title/);
  assert.match(spec, /SE-011 Security Shop Drawings\.pdf/);
  assert.match(spec, /Package 2/);
  assert.match(spec, /guest=1/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
  assert.doesNotMatch(spec, /createDocumentInvite\(/);
  assert.doesNotMatch(spec, /Sharing needs a signed-in cloud account/);
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
});
