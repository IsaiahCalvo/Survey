import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchLinkedDocumentRow, formatLibraryDocument } from '../src/services/linkedDocumentRow.js';

function fakeSupabase({ doc = null, docError = null, role = null, roleError = null } = {}) {
  const calls = [];
  const builder = (table) => {
    const q = { table, filters: [] };
    const api = {
      select(cols) { q.cols = cols; return api; },
      eq(col, val) { q.filters.push(['eq', col, val]); return api; },
      is(col, val) { q.filters.push(['is', col, val]); return api; },
      maybeSingle() {
        calls.push(q);
        if (table === 'documents') return Promise.resolve({ data: doc, error: docError });
        return Promise.resolve({ data: role ? { role } : null, error: roleError });
      },
    };
    return api;
  };
  return { from: builder, calls };
}

const ROW = { id: 'd1', name: 'Set.pdf', user_id: 'owner', file_path: 'owner/set.pdf', project_id: 'p1', file_size: 10, created_at: 't' };

test('the owner gets the library row shape, one row read plus one role read, both filtered like the library', async () => {
  const sb = fakeSupabase({ doc: ROW });
  const row = await fetchLinkedDocumentRow(sb, { userId: 'owner', documentId: 'd1' });
  assert.deepEqual(row, formatLibraryDocument(ROW));
  assert.equal(row.filePath, 'owner/set.pdf');
  assert.equal(row.projectId, 'p1');
  assert.equal(sb.calls.length, 2);
  const docs = sb.calls.find((c) => c.table === 'documents');
  assert.deepEqual(docs.filters, [['eq', 'id', 'd1'], ['eq', 'archived', false], ['is', 'user_archived_at', null]]);
});

test('a collaborator gets the row tagged with their role', async () => {
  const row = await fetchLinkedDocumentRow(fakeSupabase({ doc: ROW, role: 'viewer' }), { userId: 'guest', documentId: 'd1' });
  assert.equal(row.my_role, 'viewer');
  assert.equal(row.filePath, 'owner/set.pdf');
});

test('rows the library would not list fall back to the list path (null)', async () => {
  assert.equal(await fetchLinkedDocumentRow(fakeSupabase({ doc: ROW }), { userId: 'stranger', documentId: 'd1' }), null);
  assert.equal(await fetchLinkedDocumentRow(fakeSupabase({ doc: null }), { userId: 'owner', documentId: 'd1' }), null);
  assert.equal(await fetchLinkedDocumentRow(fakeSupabase({ docError: new Error('x') }), { userId: 'owner', documentId: 'd1' }), null);
  assert.equal(await fetchLinkedDocumentRow(null, { userId: 'owner', documentId: 'd1' }), null);
});

test('AppShell opens a share link from its row as soon as the user is known, once', () => {
  const src = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  const start = src.indexOf('fetchLinkedDocumentRow(supabase, { userId: user.id, documentId })');
  assert.ok(start > 0);
  const block = src.slice(start, start + 600);
  assert.match(block, /deepLinkDocumentIdRef\.current !== documentId\) return;/);
  assert.match(block, /deepLinkDocumentIdRef\.current = null;\n\s+handleDocumentSelectRef\.current\?\.\(row, row\.filePath \|\| null\);/);
  assert.match(src, /\}, \[user\?\.id\]\);\n\n  const returnToDevHubPreview/);
  // The list path still exists for rows this one leaves alone.
  assert.match(src, /const documentToOpen = documents\.find\(/);
});
