// 2026-10-28: a rename shows everywhere at once - open tabs, every library
// list and other screens. One bus (src/hooks/documentNameBus.js) carries every
// rename; the database echoes renames to other screens over a private
// Realtime topic per person (src/services/documentNameRealtime.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  announceDocumentName,
  latestDocumentName,
  renameRows,
  resetDocumentNameBusForTests,
  subscribeDocumentNames,
} from '../src/hooks/documentNameBus.js';
import {
  DOCUMENT_RENAMED_EVENT,
  applyDocumentRenameMessage,
  documentNamesTopic,
  subscribeDocumentRenames,
} from '../src/services/documentNameRealtime.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('every subscriber hears a rename once, with the trimmed name', () => {
  resetDocumentNameBusForTests();
  const heard = [];
  subscribeDocumentNames((rename) => heard.push(['a', rename]));
  subscribeDocumentNames((rename) => heard.push(['b', rename]));
  assert.equal(announceDocumentName('doc-1', '  Level 2.pdf ', { at: 1000 }), true);
  assert.deepEqual(heard, [
    ['a', { id: 'doc-1', name: 'Level 2.pdf' }],
    ['b', { id: 'doc-1', name: 'Level 2.pdf' }],
  ]);
  // The same name again (our own rename echoed back) tells nobody.
  assert.equal(announceDocumentName('doc-1', 'Level 2.pdf', { at: 2000 }), false);
  assert.equal(heard.length, 2);
});

test('an older echo never puts a stale name back (A -> B -> C, B arrives last)', () => {
  resetDocumentNameBusForTests();
  const heard = [];
  subscribeDocumentNames(({ name }) => heard.push(name));
  announceDocumentName('doc-1', 'B', { at: '2026-10-28T10:00:01.000Z' });
  announceDocumentName('doc-1', 'C', { at: '2026-10-28T10:00:02.000Z' });
  assert.equal(announceDocumentName('doc-1', 'B', { at: '2026-10-28T10:00:01.000Z' }), false);
  assert.deepEqual(heard, ['B', 'C']);
  assert.equal(latestDocumentName('doc-1'), 'C');
});

test('a failed rename going back is newer, so it applies', () => {
  resetDocumentNameBusForTests();
  const heard = [];
  subscribeDocumentNames(({ name }) => heard.push(name));
  announceDocumentName('doc-1', 'New', { at: Date.now() - 50 });
  announceDocumentName('doc-1', 'Old');
  assert.deepEqual(heard, ['New', 'Old']);
});

test('one bad subscriber does not stop the others; empty input is ignored', () => {
  resetDocumentNameBusForTests();
  const heard = [];
  const warn = console.warn;
  console.warn = () => {};
  try {
    subscribeDocumentNames(() => { throw new Error('boom'); });
    subscribeDocumentNames(({ name }) => heard.push(name));
    announceDocumentName(42, 'Numbered id');
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(heard, ['Numbered id']);
  assert.equal(announceDocumentName('', 'x'), false);
  assert.equal(announceDocumentName('doc-2', '   '), false);
});

test('renameRows patches only the matching row and keeps the array when nothing changed', () => {
  const rows = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, null];
  const next = renameRows(rows, { id: 'b', name: 'B2' });
  assert.notEqual(next, rows);
  assert.deepEqual(next, [{ id: 'a', name: 'A' }, { id: 'b', name: 'B2' }, null]);
  assert.equal(next[0], rows[0]);
  assert.equal(renameRows(next, { id: 'b', name: 'B2' }), next);
  assert.equal(renameRows(next, { id: 'zzz', name: 'Q' }), next);
});

test('a broadcast from the database goes through the same bus', () => {
  resetDocumentNameBusForTests();
  const heard = [];
  subscribeDocumentNames((rename) => heard.push(rename));
  assert.equal(applyDocumentRenameMessage({ id: 'doc-9', name: 'From phone.pdf', updated_at: '2026-10-28T10:00:00Z' }), true);
  assert.equal(applyDocumentRenameMessage(null), false);
  assert.equal(applyDocumentRenameMessage({ id: 'doc-9' }), false);
  assert.deepEqual(heard, [{ id: 'doc-9', name: 'From phone.pdf' }]);
});

test('the realtime listener joins the private per-person topic and applies messages', () => {
  resetDocumentNameBusForTests();
  const heard = [];
  subscribeDocumentNames(({ name }) => heard.push(name));
  const calls = { removed: 0 };
  let handler = null;
  const channel = {
    on(type, filter, fn) { calls.on = [type, filter]; handler = fn; return channel; },
    subscribe(fn) { calls.subscribeStatus = fn; return channel; },
  };
  const supabase = {
    channel(topic, opts) { calls.topic = topic; calls.opts = opts; return channel; },
    removeChannel() { calls.removed += 1; },
  };
  const stop = subscribeDocumentRenames(supabase, 'user-1');
  assert.equal(calls.topic, documentNamesTopic('user-1'));
  assert.equal(calls.topic, 'doc-names:user-1');
  assert.equal(calls.opts.config.private, true);
  assert.deepEqual(calls.on, ['broadcast', { event: DOCUMENT_RENAMED_EVENT }]);
  handler({ payload: { id: 'd', name: 'Renamed elsewhere', updated_at: '2026-10-28T10:00:00Z' } });
  assert.deepEqual(heard, ['Renamed elsewhere']);
  stop();
  handler({ payload: { id: 'd', name: 'After stop', updated_at: '2026-10-28T11:00:00Z' } });
  assert.deepEqual(heard, ['Renamed elsewhere']);
  assert.equal(subscribeDocumentRenames(supabase, null)(), undefined);
});

test('every holder of a name is wired to the bus', () => {
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /subscribeDocumentNames\(\(rename\) =>/);
  assert.match(shell, /subscribeDocumentRenames\(supabase, signedInUserId\)/);
  assert.match(shell, /documentName=\{tab\.name\}/);
  assert.match(shell, /documentName=\{activeTab\?\.name \|\| selectedPDF\?\.name/);
  const lists = read('src/hooks/useDatabase.js');
  assert.match(lists, /subscribeDocumentNames\(\(rename\) => \{\s*setDocuments\(\(current\) => renameRows\(current, rename\)\)/);
  const dashboard = read('src/Dashboard.jsx');
  assert.match(dashboard, /announceDocumentName\(doc\.id, name, \{ at: updatedAt \}\)/);
  assert.match(dashboard, /updateSupabaseDocument\(doc\.id, \{ name, updated_at: updatedAt \}\)/);
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /const pdfDisplayName = documentName \|\| pdfFile\?\.name/);
});

test('the database broadcasts only name changes, to the people who can open the document', () => {
  const sql = read('supabase/migrations/20261028050000_document_rename_broadcast.sql');
  assert.match(sql, /AFTER UPDATE OF name ON public\.documents/);
  assert.match(sql, /WHEN \(OLD\.name IS DISTINCT FROM NEW\.name\)/);
  assert.match(sql, /realtime\.send\(payload, 'document_renamed', 'doc-names:' \|\| recipient::text, true\)/);
  assert.match(sql, /document_collaborators dc[\s\S]*dc\.status = 'active'/);
  assert.match(sql, /project_collaborators pc[\s\S]*pc\.status = 'active'/);
  assert.match(sql, /EXCEPTION WHEN OTHERS THEN/);
  assert.match(sql, /realtime\.topic\(\) = 'doc-names:' \|\| \(SELECT auth\.uid\(\)\)::text/);
  // Receive only: no INSERT policy, so nobody can post fake renames.
  assert.doesNotMatch(sql, /FOR INSERT/);
});
