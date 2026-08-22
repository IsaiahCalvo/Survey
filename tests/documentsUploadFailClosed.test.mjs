import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-hub-docs-upload-failclosed.spec.mjs
// Leftover-18 UL-03 hubPreview Documents Upload fail-closed.
// Distinct from leftover18-unblock web `/` Auth modal + Electron IPC,
// Guest AuthModal A-01, Select All, Share Access, extras, Lock, Open file,
// and Hub Try again.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('HubPreview Upload logs and returns unless workflowE2E', () => {
  const preview = read('src/home/HubPreview.jsx');
  assert.match(preview, /const handleUpload = \(projectId = null\) => \{/);
  assert.match(preview, /if \(!workflowE2E\) \{\s*console\.log\('\[hub preview\] upload'\);\s*return;/);
  assert.match(preview, /onUpload=\{handleUpload\}/);
  assert.match(preview, /data-testid="mobile-workflow-upload-input"/);
  assert.match(preview, /\{workflowE2E \? \(/);
  assert.doesNotMatch(preview, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(preview, /invented-upload|fake-checkout|captchaToken\s*=\s*['\"]cf-/);
});

test('DocumentsLedger Upload / Upload PDF only call onUpload', () => {
  const ledger = read('src/home/DocumentsLedger.jsx');
  assert.match(ledger, /className="btn primary documents-desktop-upload"/);
  assert.match(ledger, /className="btn primary hub-mobile-primary-action"/);
  assert.match(ledger, /onClick=\{\(\) => onUpload && onUpload\(\)\}/);
  assert.match(ledger, /actionLabel="Upload PDF"/);
  assert.match(ledger, /onAction=\{\(\) => onUpload && onUpload\(\)\}/);
  assert.doesNotMatch(ledger, /<input[^>]*type=["']file["']/);
  assert.doesNotMatch(ledger, /VITE_DEV_AUTO_LOGIN/);
});

test('Upload fail-closed is not Select All / Try again / A-01 AuthModal', () => {
  const live = read('debug/scenarios/e2e-hub-docs-upload-failclosed.spec.mjs');
  assert.match(live, /HUB_DOCS_UPLOAD_FAILCLOSED_PROOF/);
  assert.match(live, /\[hub preview\] upload/);
  assert.match(live, /empty=1/);
  assert.match(live, /Upload PDF/);
  assert.match(live, /workflowE2E=1/);
  assert.match(live, /Continue without an account/);
  assert.doesNotMatch(live, /hubError=/);
  assert.doesNotMatch(live, /DOCS_SELECT_ALL_PROOF/);
  assert.doesNotMatch(live, /HUB_LOAD_ERROR_RETRY_PROOF/);
  assert.doesNotMatch(live, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(live, /setInputFiles/);

  const selectAll = read('debug/scenarios/e2e-hub-docs-select-all.spec.mjs');
  assert.match(selectAll, /DOCS_SELECT_ALL_PROOF/);
  assert.doesNotMatch(selectAll, /HUB_DOCS_UPLOAD_FAILCLOSED_PROOF/);

  const a01 = read('debug/scenarios/e2e-a01-hubpreview-adversarial.spec.mjs');
  assert.match(a01, /A01_ADV_INTENDED/);
  assert.doesNotMatch(a01, /HUB_DOCS_UPLOAD_FAILCLOSED_PROOF/);
});

test('96 unique inventory IDs still have proven receipts', () => {
  const inventory = read('.planning/logic-audit-2026-08-20/ISSUE-INVENTORY.md');
  const unique = inventory
    .split('## All unique IDs (96)')[1]
    .split('### P2-34 / P2-35 sub-defects')[0];
  const ids = [];
  for (const line of unique.split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells.length < 3) continue;
    const head = cells[1];
    const singles = head.match(/^(KB-\d+|P1-\d+|P2-\d+)$/);
    if (singles) {
      ids.push(singles[1]);
      continue;
    }
    const pair = head.match(/^(P1-\d+) \/ (P1-\d+)$/);
    if (pair) {
      ids.push(pair[1], pair[2]);
    }
  }
  assert.equal(ids.length, 96, `expected 96 unique IDs, got ${ids.length}: ${ids.join(',')}`);
  assert.equal(new Set(ids).size, 96);
  const unproven = [];
  for (const line of unique.split('\n')) {
    if (!/^\| (KB-\d+|P1-\d+|P2-\d+)/.test(line)) continue;
    if (!line.includes('**proven**')) unproven.push(line.slice(0, 80));
  }
  assert.deepEqual(unproven, []);
});
