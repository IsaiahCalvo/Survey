import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contract: KeyboardShortcutsOverlay is named via the visible title.
// Live proof: debug/scenarios/e2e-keyboard-shortcuts-overlay-dialog-name.spec.mjs
// Distinct from leftover-18 / nameless-menu / Home `?` singleton /
// CreateCategory / ConfirmModal / Settings dialog name / V-09 catalog.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('KeyboardShortcutsOverlay dialog is labelled by the visible title', () => {
  const src = read('src/components/KeyboardShortcutsOverlay.jsx');
  const start = src.indexOf('role="dialog"');
  const end = src.indexOf('Keyboard shortcuts');
  assert.ok(start > 0 && end > start);
  const slice = src.slice(start, end + 40);
  assert.match(slice, /role="dialog"/);
  assert.match(slice, /aria-modal="true"/);
  assert.match(slice, /aria-labelledby="keyboard-shortcuts-title"/);
  assert.match(slice, /id="keyboard-shortcuts-title"/);
  assert.match(src, /data-keyboard-shortcuts-modal="true"/);
  assert.doesNotMatch(src, /create-checkout-session|Turnstile|msalInstance/);
});

test('sibling compile-visible dialogs stay named; PromptModal lock stays gated', () => {
  const create = read('src/components/CreateCategoryModal.jsx');
  const confirm = read('src/home/BulkModals.jsx');
  const settings = read('src/components/AccountSettings.jsx');
  const share = read('src/home/ShareModal.jsx');
  const project = read('src/home/CreateProjectModal.jsx');
  const prompt = read('src/components/dialogPrompts.jsx');
  const dashboard = read('src/Dashboard.jsx');
  const start = confirm.indexOf('export function ConfirmModal');
  const end = confirm.indexOf('export function RenameModal');
  assert.match(create, /aria-labelledby="create-category-modal-title"/);
  assert.match(confirm.slice(start, end), /aria-labelledby="confirm-modal-title"/);
  assert.match(settings, /aria-labelledby="account-settings-title"/);
  assert.match(share, /aria-label=\{`Share \$\{noun\}`\}/);
  assert.match(project, /aria-label="Create project"/);
  assert.match(prompt, /export function PromptModal/);
  assert.match(prompt, /title = ''/);
  assert.match(dashboard, /title: 'Lock this document\?'/);
  assert.match(dashboard, /const raw = await askPrompt\(/);
});

test('live spec covers named KeyboardShortcuts overlay intended + break + edge; skip leftover-18 and Home `?` singleton replay', () => {
  const spec = read('debug/scenarios/e2e-keyboard-shortcuts-overlay-dialog-name.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /getByRole\('dialog', \{ name: 'Keyboard shortcuts', exact: true \}\)/);
  assert.match(spec, /keyboard-shortcuts-title/);
  assert.match(spec, /hubPreview must not open the named dialog/);
  assert.match(spec, /390 viewer `\?` names the dialog/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /viewBox `0 0 792 612`/);
});
