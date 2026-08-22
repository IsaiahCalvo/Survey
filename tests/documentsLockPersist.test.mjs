import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-hub-docs-lock-persist.spec.mjs
// Unique leftover after Hub Documents extras: Lock persist. Chrome is
// DocumentsLedger More → Lock document. Persist is fail-closed on
// hubPreview (no onLockDocument). Dashboard lockDocument needs a real id
// (leftover-18). Do not invent preview lock.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('DocumentsLedger Lock is owner-only and calls onLockDocument', () => {
  const ledger = read('src/home/DocumentsLedger.jsx');
  assert.match(ledger, /label: locked \? 'Unlock document' : 'Lock document'/);
  assert.match(ledger, /const canLock = user\?\.id && doc\.raw\?\.user_id === user\.id;/);
  assert.match(ledger, /disabled: !canLock,/);
  assert.match(ledger, /onClick: \(\) => onLockDocument && onLockDocument\(doc\.raw\),/);
  assert.match(ledger, /const locked = doc\.raw\?\.locked_at != null;/);
  assert.doesNotMatch(ledger, /onExportSpaceCSV/);
  assert.doesNotMatch(ledger, /file\.id/);
  assert.doesNotMatch(ledger, /__e2eDocsLock/);
  assert.doesNotMatch(ledger, /PRINT_PANEL_ENABLED/);
});

test('HubPreview does not invent Lock persist; Dashboard owns the host', () => {
  const preview = read('src/home/HubPreview.jsx');
  assert.doesNotMatch(preview, /onLockDocument/);
  assert.doesNotMatch(preview, /lockDocument\(/);
  assert.doesNotMatch(preview, /kal49_lock_document/);
  assert.match(preview, /\{ id: 'd1', name: 'SE-011 Security Shop Drawings\.pdf'/);
  assert.match(preview, /user_id: mockUser\.id/);
  assert.match(preview, /\{ id: 'd2', name: 'Package 2 — Rev 4 — IC\.pdf'/);
  assert.doesNotMatch(preview, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(preview, /onExportSpaceCSV/);

  const dashboard = read('src/Dashboard.jsx');
  assert.match(dashboard, /const hubToggleDocumentLock = async \(doc\) => \{/);
  assert.match(dashboard, /result = await lockDocument\(doc\.id, raw\.trim\(\) \? raw\.trim\(\) : null\);/);
  assert.match(dashboard, /result = await unlockDocument\(doc\.id\);/);
  assert.match(dashboard, /onLockDocument=\{hubToggleDocumentLock\}/);
  assert.match(dashboard, /locked_at: result\.data\.locked_at \?\? null,/);
});

test('documentLockService requires a real document id and the owner RPC', () => {
  const service = read('src/services/documentLockService.js');
  assert.match(service, /export async function lockDocument\(documentId, label = null\) \{/);
  assert.match(service, /return \{ data: null, error: new Error\('lockDocument: documentId required'\) \};/);
  assert.match(service, /supabase\.rpc\('kal49_lock_document'/);
  assert.match(service, /export async function unlockDocument\(documentId\) \{/);
  assert.match(service, /supabase\.rpc\('kal49_unlock_document'/);
  assert.doesNotMatch(service, /__e2eDocsLock/);
  assert.doesNotMatch(service, /VITE_DEV_AUTO_LOGIN/);
});
