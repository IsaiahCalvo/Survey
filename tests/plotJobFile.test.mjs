// KAL-581: Plot job files in R2 (bucket plot-files). The edge function's
// rules, its ledger calls, the migration's share and the R2 helper's
// additions. The function itself is a thin wrapper (plot-job-file/index.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handlePlotJobFile, plotFileKey, plotR2Env, MAX_FILE_BYTES } from '../supabase/functions/_shared/plotJobFile.js';
import { r2ConfigFromEnv, presignPut, putBucketCors } from '../supabase/functions/_shared/r2.js';

const JOB = '20000000-0000-4000-8000-000000000001';
const ENV = {
  R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
  R2_BUCKET: 'survey-pdfs',
  R2_ACCESS_KEY_ID: 'AKIDEXAMPLE',
  R2_SECRET_ACCESS_KEY: 'secret',
};
const config = r2ConfigFromEnv(plotR2Env((n) => ENV[n]));

function world({ role = 'editor', room = true, objects = new Map(), fileKey = null } = {}) {
  const calls = [];
  return {
    calls,
    objects,
    input: (body) => ({
      body,
      config,
      roleOf: async () => role,
      jobOf: async () => ({ file_key: fileKey, file_bytes: fileKey ? 10 : null }),
      reserve: async (...args) => { calls.push(['reserve', ...args]); return room; },
      commit: async (jobId, key, bytes) => { calls.push(['commit', jobId, key, bytes]); return ['jobs/old.plt']; },
      r2: {
        presignPut: async (_c, key) => `https://put/${key}`,
        presignGet: async (_c, key) => `https://get/${key}`,
        headObject: async (_c, key) => (objects.has(key) ? { exists: true, size: objects.get(key) } : { exists: false }),
        deleteObject: async (_c, key) => { calls.push(['delete', key]); },
        putBucketCors: async (_c, opts) => { calls.push(['cors', opts.methods.join(',')]); },
      },
      state: {},
    }),
  };
}

test('Plot uses its own bucket on the one Cloudflare account unless told otherwise', () => {
  assert.equal(config.bucket, 'plot-files');
  assert.equal(config.accessKeyId, 'AKIDEXAMPLE');
  const own = r2ConfigFromEnv(plotR2Env((n) => ({ ...ENV, PLOT_R2_BUCKET: 'other', PLOT_R2_ACCESS_KEY_ID: 'PLOTKEY' })[n]));
  assert.equal(own.bucket, 'other');
  assert.equal(own.accessKeyId, 'PLOTKEY');
});

test('a key names the job and its save, and never leaves the job folder', () => {
  assert.equal(plotFileKey(JOB.toUpperCase(), 'r1:abc/..'), `jobs/${JOB}/r1_abc_...plt`);
  assert.equal(plotFileKey(JOB, null), `jobs/${JOB}/file.plt`);
});

test('an editor gets an upload link, charged to the share, with the bucket set for browser uploads once', async () => {
  const w = world();
  const input = w.input({ op: 'upload', jobId: JOB, revision: 'r1', bytes: 1234 });
  const answer = await handlePlotJobFile(input);
  assert.deepEqual(answer, { status: 200, body: { stored: true, key: `jobs/${JOB}/r1.plt`, url: `https://put/jobs/${JOB}/r1.plt` } });
  assert.deepEqual(w.calls, [['reserve', `jobs/${JOB}/r1.plt`, JOB, 1234, 2, 0], ['cors', 'GET,HEAD,PUT']]);
  // The same instance does not set the rule again.
  await handlePlotJobFile({ ...input, body: { op: 'upload', jobId: JOB, revision: 'r2', bytes: 1 } });
  assert.deepEqual(w.calls.at(-1), ['reserve', `jobs/${JOB}/r2.plt`, JOB, 1, 1, 0]);
});

test('a viewer may download but never upload; a stranger gets nothing', async () => {
  const viewer = world({ role: 'viewer', fileKey: `jobs/${JOB}/r1.plt` });
  assert.equal((await handlePlotJobFile(viewer.input({ op: 'upload', jobId: JOB, revision: 'r1', bytes: 5 }))).status, 403);
  const down = await handlePlotJobFile(viewer.input({ op: 'download', jobId: JOB }));
  assert.equal(down.body.url, `https://get/jobs/${JOB}/r1.plt`);
  assert.deepEqual(viewer.calls, [['reserve', null, JOB, 0, 0, 1]]);
  const stranger = world({ role: null });
  assert.equal((await handlePlotJobFile(stranger.input({ op: 'download', jobId: JOB }))).status, 404);
});

test('past the share, or with R2 off, Plot is told to keep the job local', async () => {
  const full = world({ room: false });
  assert.deepEqual((await handlePlotJobFile(full.input({ op: 'upload', jobId: JOB, revision: 'r1', bytes: 5 }))).body, { stored: false, reason: 'full' });
  const off = world();
  assert.deepEqual((await handlePlotJobFile({ ...off.input({ op: 'upload', jobId: JOB, revision: 'r1', bytes: 5 }), config: null })).body, { stored: false, reason: 'off' });
  const huge = world();
  assert.equal((await handlePlotJobFile(huge.input({ op: 'upload', jobId: JOB, revision: 'r1', bytes: MAX_FILE_BYTES + 1 }))).status, 413);
});

test('commit checks the file landed, points the job at it, and deletes the save it replaces', async () => {
  const key = `jobs/${JOB}/r1.plt`;
  const w = world({ objects: new Map([[key, 999]]) });
  const answer = await handlePlotJobFile(w.input({ op: 'commit', jobId: JOB, key }));
  assert.deepEqual(answer.body, { stored: true, key, bytes: 999 });
  assert.deepEqual(w.calls, [['reserve', null, JOB, 0, 0, 1], ['commit', JOB, key, 999], ['delete', 'jobs/old.plt']]);
  const missing = world();
  assert.equal((await handlePlotJobFile(missing.input({ op: 'commit', jobId: JOB, key }))).status, 409);
  assert.equal((await handlePlotJobFile(w.input({ op: 'commit', jobId: JOB, key: 'jobs/other/x.plt' }))).status, 400);
});

test('a download with no file yet says so', async () => {
  assert.equal((await handlePlotJobFile(world().input({ op: 'download', jobId: JOB }))).status, 404);
});

test('the R2 helper signs an upload link and keeps Survey\'s read-only CORS rule by default', async () => {
  const url = new URL(await presignPut(config, `jobs/${JOB}/r1.plt`, { now: new Date('2026-11-23T00:00:00Z') }));
  assert.equal(url.pathname, `/plot-files/jobs/${JOB}/r1.plt`);
  assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'host');
  assert.equal(url.searchParams.get('X-Amz-Expires'), '600');
  const bodies = [];
  const fetchImpl = async (_u, init) => { bodies.push(init.body); return new Response('', { status: 200 }); };
  await putBucketCors(config, { fetchImpl });
  assert.match(bodies[0], /<AllowedMethod>GET<\/AllowedMethod><AllowedMethod>HEAD<\/AllowedMethod><AllowedHeader>range<\/AllowedHeader>/);
  assert.doesNotMatch(bodies[0], /PUT/);
  await putBucketCors(config, { fetchImpl, methods: ['GET', 'HEAD', 'PUT'], headers: ['range', 'content-type'] });
  assert.match(bodies[1], /<AllowedMethod>PUT<\/AllowedMethod>/);
});

test('the migration caps Plot at its share and keeps the ledger off the public API', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261124010000_plot_kal_581_files.sql', import.meta.url), 'utf8');
  assert.match(sql, /select 1500000000::bigint, 150000::bigint, 1500000::bigint/);
  assert.match(sql, /revoke all on function public\.plot_r2_reserve\(text, uuid, bigint, bigint, bigint\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.plot_r2_reserve\(text, uuid, bigint, bigint, bigint\) to service_role;/);
  assert.match(sql, /revoke all on function public\.plot_r2_commit\(uuid, text, bigint\) from public, anon, authenticated;/);
  assert.match(sql, /revoke all on plot\.r2_objects from public, anon, authenticated;/);
  assert.doesNotMatch(sql, /\bdrop table\b|\bdelete from plot\.jobs\b/i);
  const toml = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  assert.match(toml, /\[functions\.plot-job-file\]\nverify_jwt = false/);
});
