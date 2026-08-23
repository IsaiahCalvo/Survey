import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contract: Templates Edit modules is named via the visible title.
// Live proof: debug/scenarios/e2e-templates-module-edit-dialog-name.spec.mjs
// Distinct from leftover-18 / nameless-menu / Settings / Confirm /
// CreateCategory / KeyboardShortcuts / AccessManagement dialog name /
// leftover-18 module Move/Copy apply.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Templates Edit modules dialog is labelled by the visible title', () => {
  const src = read('src/home/TemplatesEditor.jsx');
  const start = src.indexOf('className="templates-module-edit-modal"');
  const end = src.indexOf('templates-module-edit-title');
  assert.ok(start > 0 && end > start);
  const slice = src.slice(start, start + 1100);
  assert.match(slice, /role="dialog"/);
  assert.match(slice, /aria-modal="true"/);
  assert.match(slice, /aria-labelledby="templates-module-edit-title"/);
  assert.match(slice, /id="templates-module-edit-title"/);
  assert.match(slice, />Edit modules</);
  assert.doesNotMatch(slice, /className="templates-module-edit-modal"\s*\n\s*onClick=\{\(e\) => e\.stopPropagation\(\)\}/);
  assert.doesNotMatch(src, /create-checkout-session|Turnstile|msalInstance/);
});

test('sibling compile-visible dialogs stay named; leftover-18 hosts stay gated', () => {
  const access = read('src/home/AccessManagementModal.jsx');
  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  const create = read('src/components/CreateCategoryModal.jsx');
  const confirm = read('src/home/BulkModals.jsx');
  const settings = read('src/components/AccountSettings.jsx');
  const share = read('src/home/ShareModal.jsx');
  const project = read('src/home/CreateProjectModal.jsx');
  const prompt = read('src/components/dialogPrompts.jsx');
  const columns = read('src/components/NewColumnsModal.jsx');
  const start = confirm.indexOf('export function ConfirmModal');
  const end = confirm.indexOf('export function RenameModal');
  assert.match(access, /aria-labelledby="access-management-modal-title"/);
  assert.match(overlay, /aria-labelledby="keyboard-shortcuts-title"/);
  assert.match(create, /aria-labelledby="create-category-modal-title"/);
  assert.match(confirm.slice(start, end), /aria-labelledby="confirm-modal-title"/);
  assert.match(settings, /aria-labelledby="account-settings-title"/);
  assert.match(share, /aria-label=\{`Share \$\{noun\}`\}/);
  assert.match(project, /aria-label="Create project"/);
  assert.match(prompt, /export function PromptModal/);
  assert.match(prompt, /title = ''/);
  const colStart = columns.indexOf('role="dialog"');
  const colSlice = columns.slice(colStart, colStart + 220);
  assert.match(colSlice, /role="dialog"/);
  assert.doesNotMatch(colSlice, /aria-labelledby|aria-label=/);
});

test('live spec covers named Edit modules intended + break + edge; skip leftover-18 and Access name replay', () => {
  const spec = read('debug/scenarios/e2e-templates-module-edit-dialog-name.spec.mjs');
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /tab=templates/);
  assert.match(spec, /getByRole\('dialog', \{ name: 'Edit modules', exact: true \}\)/);
  assert.match(spec, /templates-module-edit-title/);
  assert.match(spec, /Security Walk-Through/);
  assert.match(spec, /guest=1/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
  assert.doesNotMatch(spec, /setMoveModal/);
  assert.doesNotMatch(spec, /openDesktopMoreShare|menuitem.*Share/);
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
});
