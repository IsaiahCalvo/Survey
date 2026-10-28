// 2026-10-28: a rename shows everywhere at once - open tabs, every library
// list and other screens. One bus (src/hooks/documentNameBus.js) carries every
// rename; the database echoes renames to other screens over a private
// Realtime topic per person (src/services/documentNameRealtime.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  announceRemoteDocumentName,
  beginLocalRename,
  confirmLocalRename,
  documentNameSequence,
  failLocalRename,
  latestDocumentName,
  renameRows,
  resetDocumentNameBusForTests,
  subscribeDocumentNames,
  withRenamesSince,
} from '../src/hooks/documentNameBus.js';
import {
  DOCUMENT_RENAMED_EVENT,
  applyDocumentRenameMessage,
  documentNamesTopic,
  subscribeDocumentRenames,
} from '../src/services/documentNameRealtime.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const T = (s) => `2026-10-28T10:00:0${s}.000Z`;

function listen() {
  const heard = [];
  subscribeDocumentNames(({ name }) => heard.push(name));
  return heard;
}

test('a local rename shows at once to every subscriber, trimmed', () => {
  resetDocumentNameBusForTests();
  const heard = [];
  subscribeDocumentNames((rename) => heard.push(['a', rename]));
  subscribeDocumentNames((rename) => heard.push(['b', rename]));
  const token = beginLocalRename('doc-1', '  Level 2.pdf ');
  assert.ok(token);
  assert.deepEqual(heard, [
    ['a', { id: 'doc-1', name: 'Level 2.pdf' }],
    ['b', { id: 'doc-1', name: 'Level 2.pdf' }],
  ]);
  confirmLocalRename('doc-1', token, T(1));
  // Our own rename echoed back by the database tells nobody.
  assert.equal(applyDocumentRenameMessage({ id: 'doc-1', name: 'Level 2.pdf', updated_at: T(1) }), false);
  assert.equal(heard.length, 2);
});

test('A -> B -> C typed quickly never flashes back to B when the echoes land late', () => {
  resetDocumentNameBusForTests();
  const heard = listen();
  const b = beginLocalRename('doc-1', 'B');
  const c = beginLocalRename('doc-1', 'C');
  announceRemoteDocumentName('doc-1', 'B', T(1)); // B's echo, C still saving
  confirmLocalRename('doc-1', b, T(1));
  announceRemoteDocumentName('doc-1', 'C', T(2));
  confirmLocalRename('doc-1', c, T(2));
  announceRemoteDocumentName('doc-1', 'B', T(1)); // a very late duplicate
  assert.deepEqual(heard, ['B', 'C']);
  assert.equal(latestDocumentName('doc-1'), 'C');
});

test('ordering uses the database clock only: a device clock far ahead cannot block later renames', () => {
  resetDocumentNameBusForTests();
  const heard = listen();
  // Whatever this device's clock says, our rename saved at T(1) by the database.
  const mine = beginLocalRename('doc-1', 'Mine');
  confirmLocalRename('doc-1', mine, T(1));
  assert.equal(announceRemoteDocumentName('doc-1', 'Theirs', T(2)), true);
  assert.deepEqual(heard, ['Mine', 'Theirs']);
});

test('a remote rename that lands while ours saves applies after, only if the database says newer', () => {
  resetDocumentNameBusForTests();
  let heard = listen();
  let token = beginLocalRename('doc-1', 'Mine');
  assert.equal(announceRemoteDocumentName('doc-1', 'Theirs', T(3)), false);
  confirmLocalRename('doc-1', token, T(2));
  assert.deepEqual(heard, ['Mine', 'Theirs']);

  resetDocumentNameBusForTests();
  heard = listen();
  token = beginLocalRename('doc-1', 'Mine');
  announceRemoteDocumentName('doc-1', 'Theirs', T(1));
  confirmLocalRename('doc-1', token, T(2));
  assert.deepEqual(heard, ['Mine']);
});

test('a failed rename puts the old name back; a later rename of ours keeps its name', () => {
  resetDocumentNameBusForTests();
  const heard = listen();
  const first = beginLocalRename('doc-1', 'New');
  failLocalRename('doc-1', first, 'Old');
  assert.deepEqual(heard, ['New', 'Old']);
  const a = beginLocalRename('doc-1', 'A');
  const b = beginLocalRename('doc-1', 'B');
  failLocalRename('doc-1', a, 'Old');
  assert.deepEqual(heard, ['New', 'Old', 'A', 'B']);
  confirmLocalRename('doc-1', b, T(1));
});

test('one bad subscriber does not stop the others; empty input is ignored', () => {
  resetDocumentNameBusForTests();
  const heard = [];
  const warn = console.warn;
  console.warn = () => {};
  try {
    subscribeDocumentNames(() => { throw new Error('boom'); });
    subscribeDocumentNames(({ name }) => heard.push(name));
    beginLocalRename(42, 'Numbered id');
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(heard, ['Numbered id']);
  assert.equal(beginLocalRename('', 'x'), null);
  assert.equal(beginLocalRename('doc-2', '   '), null);
  assert.equal(announceRemoteDocumentName('doc-2', 'No time', null), false);
});

test('a list read in flight keeps the renames shown while it ran', () => {
  resetDocumentNameBusForTests();
  beginLocalRename('before', 'Before read');
  const seq = documentNameSequence();
  announceRemoteDocumentName('doc-1', 'Renamed mid-read', T(5));
  const stale = [{ id: 'doc-1', name: 'Old' }, { id: 'before', name: 'Server name' }, { id: 'x', name: 'X' }];
  const merged = withRenamesSince(stale, seq);
  assert.deepEqual(merged, [{ id: 'doc-1', name: 'Renamed mid-read' }, { id: 'before', name: 'Server name' }, { id: 'x', name: 'X' }]);
  assert.equal(withRenamesSince(stale, documentNameSequence()), stale);
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
  assert.match(dashboard, /const renameToken = beginLocalRename\(doc\.id, name\)/);
  assert.match(dashboard, /confirmLocalRename\(doc\.id, renameToken, saved\?\.updated_at\)/);
  assert.match(dashboard, /failLocalRename\(doc\.id, renameToken, previousName\)/);
  assert.match(lists, /withRenamesSince\(read, renameSeqAtStart\)/);
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
  // An archived document exists only for its owner (user_can_access_document).
  assert.equal((sql.match(/NEW\.user_archived_at IS NULL/g) || []).length, 3);
  assert.match(sql, /EXCEPTION WHEN OTHERS THEN/);
  assert.match(sql, /realtime\.topic\(\) = 'doc-names:' \|\| \(SELECT auth\.uid\(\)\)::text/);
  // Receive only: no INSERT policy, so nobody can post fake renames.
  assert.doesNotMatch(sql, /FOR INSERT/);
});
