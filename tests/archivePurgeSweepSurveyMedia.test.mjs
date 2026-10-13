// Codex review (release PR #811, P1 B): survey media whose document row is gone
// (collaborators' uploads after "delete forever", media of documents the
// scheduled sweep purged) had no remover - public.list_orphaned_survey_media
// existed but nothing called it. archive-purge-sweep now lists those objects
// and removes them from the survey-media bucket with the service role.
//
// surveyMediaSweep.js has no Deno APIs, so it runs here for real against a stub
// client; the index.ts wiring is pinned from its source text.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  sweepOrphanedSurveyMedia,
  mediaDocumentId,
  MEDIA_REMOVE_CHUNK,
  MEDIA_SWEEP_LIMIT,
  SURVEY_MEDIA_BUCKET,
} from '../supabase/functions/archive-purge-sweep/surveyMediaSweep.js';

const uuid = (n) => `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const media = (doc, n) => `${uuid(doc)}/m1/${uuid(1000 + n)}.jpg`;

function stubClient({ orphans = [], liveDocs = [], listError = null, checkError = null, removeImpl = null } = {}) {
  const calls = { rpc: [], checks: [], remove: [], buckets: [] };
  const client = {
    async rpc(name, args) {
      calls.rpc.push({ name, args });
      if (listError) return { data: null, error: listError };
      return { data: orphans.map((name) => ({ name, owner_id: 'u', size: 1, created_at: 'x' })), error: null };
    },
    from(table) {
      return {
        select() {
          return {
            async in(column, ids) {
              calls.checks.push({ table, column, ids });
              if (checkError) return { data: null, error: checkError };
              return { data: ids.filter((id) => liveDocs.includes(id)).map((id) => ({ id })), error: null };
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

describe('sweepOrphanedSurveyMedia', () => {
  it('lists through list_orphaned_survey_media and removes the names from survey-media', async () => {
    const orphans = [media(1, 1), media(1, 2), media(2, 3)];
    const { client, calls } = stubClient({ orphans });
    const summary = await sweepOrphanedSurveyMedia(client, { limit: 500 });
    assert.deepEqual(calls.rpc, [{ name: 'list_orphaned_survey_media', args: { p_limit: 500 } }]);
    assert.deepEqual(calls.buckets, [SURVEY_MEDIA_BUCKET]);
    assert.equal(SURVEY_MEDIA_BUCKET, 'survey-media');
    assert.deepEqual(calls.remove, [orphans]);
    assert.deepEqual(summary, { found: 3, removed: 3, failed: 0, skipped_live: 0, errors: [] });
  });

  it('removes in chunks, and a failing chunk does not stop the next one', async () => {
    const orphans = Array.from({ length: MEDIA_REMOVE_CHUNK + 5 }, (_, i) => media(i + 1, i));
    let call = 0;
    const { client, calls } = stubClient({
      orphans,
      removeImpl: async (paths) => {
        call += 1;
        if (call === 1) return { data: null, error: { message: 'storage 503' } };
        return { data: paths.map((name) => ({ name })), error: null };
      },
    });
    const summary = await sweepOrphanedSurveyMedia(client);
    assert.equal(calls.remove.length, 2);
    assert.equal(calls.remove[0].length, MEDIA_REMOVE_CHUNK);
    assert.equal(summary.found, MEDIA_REMOVE_CHUNK + 5);
    assert.equal(summary.removed, 5);
    assert.equal(summary.failed, MEDIA_REMOVE_CHUNK);
    assert.deepEqual(summary.errors, ['storage 503']);
  });

  it('a thrown storage error is isolated too - the sweep never throws', async () => {
    const orphans = Array.from({ length: MEDIA_REMOVE_CHUNK + 1 }, (_, i) => media(i + 1, i));
    let call = 0;
    const { client } = stubClient({
      orphans,
      removeImpl: async (paths) => {
        call += 1;
        if (call === 1) throw new TypeError('fetch failed');
        return { data: paths.map((name) => ({ name })), error: null };
      },
    });
    const summary = await sweepOrphanedSurveyMedia(client);
    assert.equal(summary.removed, 1);
    assert.equal(summary.failed, MEDIA_REMOVE_CHUNK);
  });

  it('a listing failure is reported, not thrown, and removes nothing', async () => {
    const { client, calls } = stubClient({ listError: { message: 'permission denied' } });
    const summary = await sweepOrphanedSurveyMedia(client);
    assert.deepEqual(calls.remove, []);
    assert.equal(summary.found, 0);
    assert.match(summary.errors[0], /list_failed: permission denied/);
  });

  it('re-checks the documents table and never removes media of a document that exists', async () => {
    const orphans = [media(1, 1), media(2, 2)];
    const { client, calls } = stubClient({ orphans, liveDocs: [uuid(2)] });
    const summary = await sweepOrphanedSurveyMedia(client);
    assert.deepEqual(calls.checks, [{ table: 'documents', column: 'id', ids: [uuid(1), uuid(2)] }]);
    assert.deepEqual(calls.remove, [[media(1, 1)]]);
    assert.equal(summary.skipped_live, 1);
    assert.equal(summary.removed, 1);
  });

  it('when the re-check fails, the chunk is skipped (not removed)', async () => {
    const { client, calls } = stubClient({ orphans: [media(1, 1)], checkError: { message: 'timeout' } });
    const summary = await sweepOrphanedSurveyMedia(client);
    assert.deepEqual(calls.remove, []);
    assert.equal(summary.failed, 1);
  });

  it('a dry run counts and removes nothing', async () => {
    const { client, calls } = stubClient({ orphans: [media(1, 1)] });
    const summary = await sweepOrphanedSurveyMedia(client, { dryRun: true });
    assert.equal(summary.found, 1);
    assert.deepEqual(calls.remove, []);
    assert.deepEqual(calls.checks, []);
  });

  it('ignores names that are not document media paths', async () => {
    assert.equal(mediaDocumentId('not-a-doc/m1/x.jpg'), null);
    assert.equal(mediaDocumentId(media(7, 1)), uuid(7));
    const { client, calls } = stubClient({ orphans: ['stray.txt', media(3, 1)] });
    const summary = await sweepOrphanedSurveyMedia(client);
    assert.deepEqual(calls.remove, [[media(3, 1)]]);
    assert.equal(summary.found, 1);
  });
});

describe('archive-purge-sweep wiring', () => {
  const src = readFileSync(new URL('../supabase/functions/archive-purge-sweep/index.ts', import.meta.url), 'utf8');

  it('imports the media sweep and runs it with the service-role client after the PDF work', () => {
    assert.match(src, /import \{ sweepOrphanedSurveyMedia, MEDIA_SWEEP_LIMIT \} from '\.\/surveyMediaSweep\.js';/);
    const createAt = src.indexOf('createClient(supabaseUrl, serviceKey');
    const unlinkAt = src.indexOf(".from(STORAGE_BUCKET)");
    const mediaAt = src.indexOf('await sweepOrphanedSurveyMedia(supabase, {');
    assert.ok(createAt > 0 && unlinkAt > createAt && mediaAt > unlinkAt, 'media sweep runs after the PDF unlink');
    assert.match(src.slice(mediaAt, mediaAt + 200), /dryRun,[\s\S]*limit: MEDIA_SWEEP_LIMIT,[\s\S]*log,/);
    assert.ok(MEDIA_SWEEP_LIMIT >= 1 && MEDIA_SWEEP_LIMIT <= 1000);
  });

  it('reports the media counts in the response and the run log', () => {
    for (const field of ['media_orphans_found: media.found', 'media_removed: media.removed', 'media_failed: media.failed']) {
      assert.ok(src.includes(field), field);
    }
    assert.match(src, /log\('media_sweep_done'/);
  });

  it('the PDF bucket is unchanged and the media sweep uses the Storage API, not SQL deletes', () => {
    assert.match(src, /const STORAGE_BUCKET = 'documents';/);
    const helper = readFileSync(new URL('../supabase/functions/archive-purge-sweep/surveyMediaSweep.js', import.meta.url), 'utf8');
    assert.match(helper, /rpc\('list_orphaned_survey_media', \{ p_limit: limit \}\)/);
    assert.match(helper, /storage\s*\.from\(SURVEY_MEDIA_BUCKET\)\s*\.remove\(/);
    assert.doesNotMatch(helper, /Deno\./, 'stays node-testable');
  });
});
