import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  ACCOUNT_EXPORT_ERROR_TEXT,
  accountExportFileName,
  buildAccountExportZip,
  buildAccountExportZips,
  planExportPaths,
  requestAccountExport,
} from '../src/services/accountExport.js';

const manifest = () => ({
  format: 1,
  exported_at: '2026-10-21T08:00:00.000Z',
  account: { id: 'u1', email: 'a@example.test' },
  tables: {
    projects: [{ id: 'p1', name: 'Site: North/East' }],
    documents: [
      { id: 'd1', name: 'Plan A.pdf', project_id: 'p1', file_path: 'u1/d1.pdf' },
      { id: 'd2', name: 'Plan A', project_id: 'p1', file_path: 'u1/d2.pdf' },
      { id: 'd3', name: 'Loose', project_id: null, file_path: 'u1/d3.pdf' },
    ],
    document_annotations: [{ id: 'a1', document_id: 'd1' }],
  },
  files: [
    { bucket: 'documents', path: 'u1/d1.pdf', url: 'https://x/1' },
    { bucket: 'documents', path: 'u1/d2.pdf', url: 'https://x/2' },
    { bucket: 'documents', path: 'u1/d3.pdf', url: 'https://x/3' },
    { bucket: 'survey-media', path: 'd1/marker-1/m1.jpg', url: 'https://x/4' },
    { bucket: 'documents', path: 'u1/older/legacy.pdf', url: null },
  ],
});

test('export paths: PDFs by project and name, media by document, the rest kept', () => {
  const paths = planExportPaths(manifest()).map((f) => f.zipPath);
  assert.deepEqual(paths, [
    'Documents/Site_ North_East/Plan A.pdf',
    'Documents/Site_ North_East/Plan A (2).pdf',
    'Documents/Loose.pdf',
    'Survey media/Plan A/marker-1/m1.jpg',
    'Other files/documents/u1/older/legacy.pdf',
  ]);
});

test('the zip holds data.json, the files, and lists what failed', async () => {
  const fetched = [];
  const fetchImpl = async (url) => {
    fetched.push(url);
    if (url === 'https://x/3') return { ok: false, status: 404 };
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode(`bytes of ${url}`).buffer };
  };
  const progress = [];
  const { bytes, failures } = await buildAccountExportZip(manifest(), { fetchImpl, onProgress: (p) => progress.push(p) });
  assert.equal(failures.length, 2);
  assert.deepEqual(progress.at(-1), { done: 5, total: 5 });

  const zip = await JSZip.loadAsync(bytes);
  const data = JSON.parse(await zip.file('data.json').async('string'));
  assert.equal(data.account.email, 'a@example.test');
  assert.deepEqual(data.document_annotations, [{ id: 'a1', document_id: 'd1' }]);
  assert.ok(data.files.every((f) => !('url' in f)), 'links are not kept in the zip');
  assert.equal(await zip.file('Documents/Site_ North_East/Plan A.pdf').async('string'), 'bytes of https://x/1');
  assert.ok(zip.file('README.txt'));
  const errors = await zip.file('errors.txt').async('string');
  assert.match(errors, /u1\/d3\.pdf: HTTP 404/);
  assert.match(errors, /legacy\.pdf: no download link/);
});

test('export errors map to plain words', async () => {
  const fail = (status) => ({ invoke: async () => ({ data: null, error: { context: { status } } }) });
  await assert.rejects(requestAccountExport(fail(403)), { message: ACCOUNT_EXPORT_ERROR_TEXT[403] });
  await assert.rejects(requestAccountExport(fail(502)), { message: ACCOUNT_EXPORT_ERROR_TEXT[500] });
  const ok = { invoke: async (name, opts) => ({ data: { format: 1, files: [], name, opts }, error: null }) };
  assert.equal((await requestAccountExport(ok)).name, 'export-account');
  // Links come back on the app's own Supabase host.
  const internal = {
    url: 'https://abc.supabase.co/functions/v1',
    invoke: async () => ({ data: { format: 1, files: [{ bucket: 'documents', path: 'u/a.pdf', url: 'http://kong:8000/storage/v1/object/sign/documents/u/a.pdf?token=t' }] }, error: null }),
  };
  assert.equal((await requestAccountExport(internal)).files[0].url, 'https://abc.supabase.co/storage/v1/object/sign/documents/u/a.pdf?token=t');
});

test('big exports are split into parts, data.json in the first', async () => {
  const fetchImpl = async () => ({ ok: true, arrayBuffer: async () => new Uint8Array(400).buffer });
  const parts = [];
  const { parts: count, failures } = await buildAccountExportZips(manifest(), {
    fetchImpl, partBytes: 1000, onPart: async (bytes, index) => { parts.push({ bytes, index }); },
  });
  assert.equal(count, 2);
  assert.equal(failures.length, 1, 'the file with no link');
  assert.deepEqual(parts.map((p) => p.index), [0, 1]);
  const first = await JSZip.loadAsync(parts[0].bytes);
  const second = await JSZip.loadAsync(parts[1].bytes);
  assert.ok(first.file('data.json'));
  assert.equal(second.file('data.json'), null);
  assert.equal(Object.values(first.files).filter((f) => !f.dir && f.name.endsWith('.pdf')).length, 2);
  assert.ok(second.file('Survey media/Plan A/marker-1/m1.jpg'));
  assert.ok(second.file('errors.txt'));
  assert.equal(accountExportFileName(new Date('2026-10-21T08:00:00Z'), 1), 'Survey data 2026-10-21 part 2.zip');
  assert.equal(accountExportFileName(new Date('2026-10-21T08:00:00Z')), 'Survey data 2026-10-21.zip');
});
