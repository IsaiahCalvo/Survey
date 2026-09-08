// src/services/__tests__/excelSyncPendingChangeset.test.mjs
//
// KAL-309 round-3 finding #2 — the per-(document, workbook) pending-changeset descriptor that
// lets a retry-capped incomplete writeback REUSE the same client_change_set_id on the next sync
// (idempotent replay), instead of minting a fresh change-set. Pure unit tests with an injected
// in-memory storage shim — no localStorage, no DOM.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  readPendingChangeset,
  writePendingChangeset,
  clearPendingChangeset,
  pendingKey,
} from '../excelSyncPendingChangeset.js';

function memStorage() {
  const mem = {};
  return {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; },
    _mem: mem,
  };
}

test('write then read returns the descriptor for the same (document, template, workbook)', () => {
  const s = memStorage();
  const desc = { documentId: 'doc-1', templateId: 'tpl-1', workbookId: 'wb_a', clientChangeSetId: 'ccs-1' };
  assert.equal(writePendingChangeset(desc, s), true);
  const got = readPendingChangeset({ documentId: 'doc-1', templateId: 'tpl-1', workbookId: 'wb_a' }, s);
  assert.equal(got.clientChangeSetId, 'ccs-1');
  assert.equal(got.workbookId, 'wb_a');
  assert.ok(typeof got.at === 'number');
});

test('read returns null for a DIFFERENT workbook (re-export → never reuse a stale id)', () => {
  const s = memStorage();
  writePendingChangeset({ documentId: 'doc-1', templateId: 'tpl-1', workbookId: 'wb_OLD', clientChangeSetId: 'ccs-1' }, s);
  const got = readPendingChangeset({ documentId: 'doc-1', templateId: 'tpl-1', workbookId: 'wb_NEW' }, s);
  assert.equal(got, null);
});

test('read returns null for a different template', () => {
  const s = memStorage();
  writePendingChangeset({ documentId: 'doc-1', templateId: 'tpl-1', workbookId: 'wb_a', clientChangeSetId: 'ccs-1' }, s);
  const got = readPendingChangeset({ documentId: 'doc-1', templateId: 'tpl-OTHER', workbookId: 'wb_a' }, s);
  assert.equal(got, null);
});

test('clear removes the descriptor', () => {
  const s = memStorage();
  writePendingChangeset({ documentId: 'doc-1', templateId: 'tpl-1', workbookId: 'wb_a', clientChangeSetId: 'ccs-1' }, s);
  assert.equal(clearPendingChangeset({ documentId: 'doc-1', templateId: 'tpl-1', workbookId: 'wb_a', clientChangeSetId: 'ccs-1' }, s), true);
  assert.equal(readPendingChangeset({ documentId: 'doc-1', templateId: 'tpl-1', workbookId: 'wb_a' }, s), null);
});

test('write overwrites a prior descriptor (one in-flight change-set per document)', () => {
  const s = memStorage();
  writePendingChangeset({ documentId: 'doc-1', templateId: 'tpl-1', workbookId: 'wb_a', clientChangeSetId: 'ccs-1' }, s);
  writePendingChangeset({ documentId: 'doc-1', templateId: 'tpl-1', workbookId: 'wb_a', clientChangeSetId: 'ccs-2' }, s);
  const got = readPendingChangeset({ documentId: 'doc-1', templateId: 'tpl-1', workbookId: 'wb_a' }, s);
  assert.equal(got.clientChangeSetId, 'ccs-2');
});

test('write is a no-op without documentId or clientChangeSetId', () => {
  const s = memStorage();
  assert.equal(writePendingChangeset({ documentId: null, clientChangeSetId: 'x' }, s), false);
  assert.equal(writePendingChangeset({ documentId: 'd', clientChangeSetId: null }, s), false);
});

test('read tolerates corrupt storage (returns null, never throws)', () => {
  const s = memStorage();
  s.setItem(pendingKey('doc-1'), '{not json');
  assert.equal(readPendingChangeset({ documentId: 'doc-1', workbookId: 'wb_a' }, s), null);
});

test('round-trip: incomplete → persist → reuse → complete → clear', () => {
  const s = memStorage();
  const doc = { documentId: 'doc-9', templateId: 'tpl-9', workbookId: 'wb_9' };
  // First sync left writeback incomplete → persist.
  writePendingChangeset({ ...doc, clientChangeSetId: 'ccs-persist' }, s);
  // Next sync reads it → reuses the SAME id (idempotent replay).
  const reuse = readPendingChangeset(doc, s);
  assert.equal(reuse.clientChangeSetId, 'ccs-persist');
  // That sync completes → clear.
  clearPendingChangeset({ ...doc, clientChangeSetId: 'ccs-persist' }, s);
  assert.equal(readPendingChangeset(doc, s), null);
});

test('pending descriptors from separate templates/workbooks coexist and late clear preserves newer attempt', () => {
  const s = memStorage();
  const a = { documentId: 'doc', templateId: 'a', workbookId: 'workbook-a', clientChangeSetId: 'first' };
  const b = { documentId: 'doc', templateId: 'b', workbookId: 'workbook-b', clientChangeSetId: 'other' };
  writePendingChangeset(a, s);
  writePendingChangeset(b, s);
  writePendingChangeset({ ...a, clientChangeSetId: 'newer' }, s);
  clearPendingChangeset(a, s);
  assert.equal(readPendingChangeset(a, s).clientChangeSetId, 'newer');
  assert.equal(readPendingChangeset(b, s).clientChangeSetId, 'other');
});

test('legacy descriptor remains readable and is cleared only by its exact completed attempt', () => {
  const s = memStorage();
  const descriptor = { documentId: 'doc', templateId: 'tpl', workbookId: 'wb', clientChangeSetId: 'old' };
  s.setItem(pendingKey('doc'), JSON.stringify(descriptor));
  assert.equal(readPendingChangeset(descriptor, s).clientChangeSetId, 'old');
  clearPendingChangeset({ ...descriptor, workbookId: 'different' }, s);
  assert.equal(readPendingChangeset(descriptor, s).clientChangeSetId, 'old');
  clearPendingChangeset(descriptor, s);
  assert.equal(readPendingChangeset(descriptor, s), null);
});
