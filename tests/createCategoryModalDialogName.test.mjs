import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contract: CreateCategoryModal is named via the visible title.
// Live proof: debug/scenarios/e2e-create-category-modal-dialog-name.spec.mjs
// Distinct from leftover-18 / nameless-menu / Settings dialog name /
// ConfirmModal dialog name / survey-rail Create category apply.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('CreateCategoryModal dialog is labelled by the visible title', () => {
  const src = read('src/components/CreateCategoryModal.jsx');
  const start = src.indexOf('role="dialog"');
  const end = src.indexOf('Create category');
  assert.ok(start > 0 && end > start);
  const slice = src.slice(start, end + 40);
  assert.match(slice, /role="dialog"/);
  assert.match(slice, /aria-modal="true"/);
  assert.match(slice, /aria-labelledby="create-category-modal-title"/);
  assert.match(slice, /id="create-category-modal-title"/);
  assert.doesNotMatch(slice, /role="dialog"\s*\n\s*aria-modal="true"\s*\n\s*onClick=/);
  assert.doesNotMatch(src, /create-checkout-session|Turnstile|msalInstance/);
});

test('sibling compile-visible dialogs stay named; PromptModal lock stays gated', () => {
  const confirm = read('src/home/BulkModals.jsx');
  const settings = read('src/components/AccountSettings.jsx');
  const share = read('src/home/ShareModal.jsx');
  const create = read('src/home/CreateProjectModal.jsx');
  const prompt = read('src/components/dialogPrompts.jsx');
  const dashboard = read('src/Dashboard.jsx');
  const start = confirm.indexOf('export function ConfirmModal');
  const end = confirm.indexOf('export function RenameModal');
  assert.match(confirm.slice(start, end), /aria-labelledby="confirm-modal-title"/);
  assert.match(settings, /aria-labelledby="account-settings-title"/);
  assert.match(share, /aria-label=\{`Share \$\{noun\}`\}/);
  assert.match(create, /aria-label="Create project"/);
  assert.match(prompt, /export function PromptModal/);
  assert.match(prompt, /title = ''/);
  assert.match(dashboard, /title: 'Lock this document\?'/);
  assert.match(dashboard, /const raw = await askPrompt\(/);
});

test('live spec covers named CreateCategoryModal intended + break + edge; skip leftover-18 and ConfirmModal replay', () => {
  const spec = read('debug/scenarios/e2e-create-category-modal-dialog-name.spec.mjs');
  assert.match(spec, /surveyTransitionE2E=1/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /getByRole\('dialog', \{ name: 'Create category', exact: true \}\)/);
  assert.match(spec, /create-category-modal-title/);
  assert.match(spec, /A category with this name already exists/);
  assert.match(spec, /guest=1/);
  assert.match(spec, /Lock this document/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
  assert.doesNotMatch(spec, /Delete 2 categories\?/);
  assert.doesNotMatch(spec, /viewBox `0 0 792 612`/);
});
