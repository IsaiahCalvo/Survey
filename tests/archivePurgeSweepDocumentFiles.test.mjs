// Backend security and cost pass: stored PDFs no row points at (an upload whose
// row insert failed, a lost client unlink) stayed billed forever.
// archive-purge-sweep now lists them with list_orphaned_document_files and
// removes them, re-checking every chunk right before the remove.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  sweepOrphanedDocumentFiles,
  DOCUMENT_FILE_REMOVE_CHUNK,
  DOCUMENT_FILE_MIN_AGE_HOURS,
  DOCUMENT_FILES_BUCKET,
} from '../supabase/functions/archive-purge-sweep/documentFileSweep.js';

const path = (n) => `owner-${n}/sha-${n}.pdf`;

function stubClient({ orphans = [], liveDocs = [], liveTemplates = [], listError = null, checkError = null, removeImpl = null } = {}) {
  const calls = { rpc: [], checks: [], remove: [], buckets: [] };
  const client = {
    async rpc(name, args) {
      calls.rpc.push({ name, args });
      if (listError) return { data: null, error: listError };
      return { data: orphans.map((name) => ({ name, size: 10, created_at: 'x' })), error: null };
    },
    from(table) {
      return {
        select() {
          return {
            async in(column, values) {
              calls.checks.push({ table, column, values });
              if (checkError) return { data: null, error: checkError };
              const live = table === 'documents' ? liveDocs : liveTemplates;
              return { data: values.filter((v) => live.includes(v)).map((v) => ({ [column]: v })), error: null };
            },
          };
        },
      };
    },
    storage: {
      from(bucket) {
        calls.buckets.push(bucket);
        return {
          async remove(paths) {
            calls.remove.push([...paths]);
            if (removeImpl) return removeImpl(paths);
            return { data: paths.map((name) => ({ name })), error: null };
          },
        };
      },
    },
  };
  return { client, calls };
}

describe('sweepOrphanedDocumentFiles', () => {
  it('asks for files at least a day old and removes them from the documents bucket', async () => {
    const { client, calls } = stubClient({ orphans: [path(1), path(2)] });
    const out = await sweepOrphanedDocumentFiles(client);
    assert.equal(calls.rpc[0].name, 'list_orphaned_document_files');
    assert.equal(calls.rpc[0].args.p_min_age_hours, DOCUMENT_FILE_MIN_AGE_HOURS);
    assert.ok(DOCUMENT_FILE_MIN_AGE_HOURS >= 24);
    assert.deepEqual(calls.buckets, [DOCUMENT_FILES_BUCKET]);
    assert.deepEqual(calls.remove, [[path(1), path(2)]]);
    assert.deepEqual({ found: out.found, bytes: out.bytes, removed: out.removed }, { found: 2, bytes: 20, removed: 2 });
  });

  it('never touches survey-data sidecars or anything that is not a PDF', async () => {
    const sidecar = 'project-1/doc-1_data.json';
    const { client, calls } = stubClient({ orphans: [sidecar, 'x/y.txt', path(1)] });
    const out = await sweepOrphanedDocumentFiles(client);
    assert.deepEqual(calls.remove, [[path(1)]]);
    assert.equal(out.found, 1);
  });

  it('a dry run counts and removes nothing', async () => {
    const { client, calls } = stubClient({ orphans: [path(1)] });
    const out = await sweepOrphanedDocumentFiles(client, { dryRun: true });
    assert.equal(out.found, 1);
    assert.equal(calls.remove.length, 0);
    assert.equal(calls.checks.length, 0);
  });

  it('never removes a file a document or template points at again', async () => {
    const { client, calls } = stubClient({ orphans: [path(1), path(2), path(3)], liveDocs: [path(1)], liveTemplates: [path(3)] });
    const out = await sweepOrphanedDocumentFiles(client);
    assert.deepEqual(calls.remove, [[path(2)]]);
    assert.equal(out.skipped_live, 2);
  });

  it('skips the chunk when the re-check fails', async () => {
    const { client, calls } = stubClient({ orphans: [path(1)], checkError: { message: 'down' } });
    const out = await sweepOrphanedDocumentFiles(client);
    assert.equal(calls.remove.length, 0);
    assert.equal(out.failed, 1);
  });

  it('reports a listing failure without throwing', async () => {
    const { client } = stubClient({ listError: { message: 'nope' } });
    const out = await sweepOrphanedDocumentFiles(client);
    assert.equal(out.found, 0);
    assert.match(out.errors[0], /list_failed/);
  });

  it('removes in chunks and isolates a failed chunk', async () => {
    const orphans = Array.from({ length: DOCUMENT_FILE_REMOVE_CHUNK + 1 }, (_, i) => path(i));
    let n = 0;
    const { client } = stubClient({
      orphans,
      removeImpl: (paths) => (n++ === 0 ? { data: null, error: { message: 'boom' } } : { data: paths.map((name) => ({ name })), error: null }),
    });
    const out = await sweepOrphanedDocumentFiles(client);
    assert.equal(out.failed, DOCUMENT_FILE_REMOVE_CHUNK);
    assert.equal(out.removed, 1);
  });
});

describe('wiring', () => {
  it('archive-purge-sweep runs the file sweep and passes dry_run through', () => {
    const src = readFileSync(new URL('../supabase/functions/archive-purge-sweep/index.ts', import.meta.url), 'utf8');
    assert.match(src, /sweepOrphanedDocumentFiles\(supabase, \{\s*dryRun,/);
  });

  it('the lister is service-role only and never lists files under a day old', () => {
    const sql = readFileSync(new URL('../supabase/migrations/20261021170000_list_orphaned_document_files.sql', import.meta.url), 'utf8');
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.list_orphaned_document_files\(integer, integer\) FROM PUBLIC, anon, authenticated/);
    assert.match(sql, /GREATEST\(COALESCE\(p_min_age_hours, 24\), 24\)/);
    assert.match(sql, /public\.templates/);
    assert.match(sql, /lower\(o\.name\) LIKE '%\.pdf'/);
  });
});
