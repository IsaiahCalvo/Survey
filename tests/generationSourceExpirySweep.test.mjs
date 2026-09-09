import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { drainDocumentStorageCleanup } from '../supabase/functions/_shared/documentStorageCleanup.js';

const source = stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/archive-purge-sweep/index.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, ''));
const id = n => `92000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const path = `${id(1)}/unrelated.pdf`;
const receipt = (expired = [], skipped = []) => ({ expired_source_ids: expired, skipped_source_ids: skipped });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function harness({ flag = 'v1-metadata-only', expiry = async () => ({ data: receipt() }), uploadError = false, skippedLock = false, fakeTimer = false, queued = true } = {}) {
  const calls = [], logs = [], timers = new Map(); let handler, serial = 0;
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'sweep_expired_archives') return { data: { run_id: id(2), skipped_lock: skippedLock, orphaned_paths: [] } };
      if (name === 'expire_document_generation_uploads') return uploadError ? { error: {} } : { data: { canceled_operation_ids: [], skipped_operation_ids: [] } };
      if (name === 'expire_document_generation_sources') return expiry();
      if (name === 'list_document_storage_cleanup') return { data: { paths: queued ? [path] : [] } };
      if (name === 'retire_document_storage_paths') return { data: { retired_paths: args.p_paths, referenced_paths: [] } };
      if (name === 'ack_document_storage_cleanup') return { data: { acknowledged_paths: args.p_paths, pending_paths: [] } };
      throw new Error(`Unexpected RPC ${name}`);
    },
    storage: { from(bucket) { assert.equal(bucket, 'documents'); return { async remove(paths) {
      calls.push({ name: 'storage.remove', paths }); return { data: paths.map(name => ({ name })) };
    } }; } },
    from(table) { assert.equal(table, 'archive_purge_runs'); return { update() { return { async eq() { calls.push({ name: 'writeback' }); return {}; } }; } }; },
  };
  vm.runInNewContext(source, {
    Deno: { serve(value) { handler = value; }, env: { get(name) { return ({ SUPABASE_SERVICE_ROLE_KEY: 'owned-secret', SUPABASE_URL: 'https://owned.invalid', SURVEY_GENERATION_SOURCE_CAPTURE: flag })[name]; } } },
    createClient() { calls.push({ name: 'createClient' }); return client; }, drainDocumentStorageCleanup, Response,
    console: { log(value) { logs.push(JSON.parse(value)); } },
    setTimeout: fakeTimer ? (callback, milliseconds) => { const token = ++serial; timers.set(token, { callback, milliseconds }); return token; } : setTimeout,
    clearTimeout: fakeTimer ? token => timers.delete(token) : clearTimeout,
  });
  return { calls, logs, timers, async run(body = {}, token = 'owned-secret') {
    const response = await handler(new Request('https://owned.invalid/sweep', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }));
    return { status: response.status, body: await response.json() };
  } };
}
const names = h => h.calls.map(c => c.name);

test('source expiry rollout is exact and flag-off creates no second error or RPC', async () => {
  for (const flag of [null, '', 'true', 'v1-metadata-only ']) {
    const h = harness({ flag, uploadError: true });
    const result = await h.run(); assert.equal(result.body.unlink_errors.length, 1);
    assert.ok(!names(h).includes('expire_document_generation_sources'));
    assert.ok(!h.logs.some(row => row.event.startsWith('generation_source')));
  }
  const absent = harness({ flag: null }); assert.deepEqual((await absent.run()).body.unlink_errors, []);
  assert.ok(!names(absent).includes('expire_document_generation_sources'));
});

test('auth denial, dry run and busy archive sweep never expire sources or remove files', async () => {
  const denied = harness(); assert.equal((await denied.run({}, 'user-token')).status, 401); assert.deepEqual(denied.calls, []);
  for (const [options, body] of [[{}, { dry_run: true }], [{ skippedLock: true }, {}]]) {
    const h = harness(options); await h.run(body); assert.deepEqual(names(h), ['createClient', 'sweep_expired_archives']);
  }
});

test('source expiry receipt precedes independent checked cleanup and logs counts only', async () => {
  const gate = deferred(), h = harness({ expiry: () => gate.promise });
  const running = h.run(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(names(h), ['createClient', 'sweep_expired_archives', 'expire_document_generation_uploads', 'expire_document_generation_sources']);
  assert.deepEqual({ ...h.calls[3].args }, { p_limit: 100 });
  gate.resolve({ data: receipt([id(3)]) }); const result = await running;
  assert.deepEqual(names(h).slice(4), ['list_document_storage_cleanup', 'retire_document_storage_paths', 'storage.remove', 'ack_document_storage_cleanup', 'writeback']);
  assert.deepEqual(h.calls.find(c => c.name === 'storage.remove').paths, [path]);
  assert.equal(result.body.unlinked, 1); assert.deepEqual(result.body.unlink_errors, []);
  const log = h.logs.find(row => row.event === 'generation_source_expiry'); assert.equal(log.expired, 1); assert.equal(log.skipped, 0);
  assert.ok(!JSON.stringify(h.logs).includes(id(3)));
});

test('source expiry never fabricates cleanup jobs; skipped rows remain explicit', async () => {
  const h = harness({ queued: false, expiry: async () => ({ data: receipt([id(3)], [id(4)]) }) });
  const result = await h.run(); assert.equal(result.body.unlinked, 0);
  assert.match(result.body.unlink_errors.join(' '), /sources are busy/);
  assert.ok(!names(h).includes('storage.remove')); assert.ok(!names(h).includes('retire_document_storage_paths'));
});

for (const [label, expiry] of [
  ['returned failure', async () => ({ error: { message: 'private-provider-detail' } })],
  ['lost reply', async () => { throw new Error('private-provider-detail'); }],
  ['null', async () => ({ data: null })],
  ['missing array', async () => ({ data: { expired_source_ids: [] } })],
  ['wrong UUID', async () => ({ data: receipt(['wrong']) })],
  ['wrong type', async () => ({ data: receipt([1]) })],
  ['duplicate', async () => ({ data: receipt([id(3), id(3)]) })],
  ['overlap', async () => ({ data: receipt([id(3)], [id(3)]) })],
  ['overflow', async () => ({ data: receipt(Array.from({ length: 100 }, (_, n) => id(n)), [id(100)]) })],
]) test(`source ${label} fails safely while unrelated cleanup progresses`, async () => {
  const h = harness({ expiry }); const result = await h.run();
  assert.equal(result.status, 200); assert.equal(result.body.unlinked, 1); assert.equal(result.body.unlink_errors.length, 1);
  assert.match(result.body.unlink_errors[0], /source cleanup could not be confirmed/);
  assert.deepEqual(h.calls.find(c => c.name === 'storage.remove').paths, [path]);
  assert.ok(!JSON.stringify([h.logs, result.body]).includes('private-provider-detail'));
  assert.equal(names(h).filter(name => name === 'expire_document_generation_sources').length, 1);
});

test('exact total of 100 source IDs is valid', async () => {
  const h = harness({ expiry: async () => ({ data: receipt(Array.from({ length: 100 }, (_, n) => id(n))) }) });
  assert.deepEqual((await h.run()).body.unlink_errors, []);
  assert.equal(h.logs.find(row => row.event === 'generation_source_expiry').expired, 100);
});

test('hung source expiry ends at 15 seconds; late rejection cannot start a second drain', async () => {
  const gate = deferred(), h = harness({ expiry: () => gate.promise, fakeTimer: true });
  const unhandled = [], listen = e => unhandled.push(e); process.on('unhandledRejection', listen);
  try {
    const running = h.run(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.timers.size, 1); const timer = [...h.timers.values()][0]; assert.equal(timer.milliseconds, 15000);
    assert.ok(!names(h).includes('storage.remove')); timer.callback();
    const result = await running; assert.equal(result.body.unlinked, 1); assert.equal(result.body.unlink_errors.length, 1);
    assert.equal(h.timers.size, 0); gate.reject(new Error('late rejection'));
    await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(unhandled, []);
    assert.equal(names(h).filter(name => name === 'storage.remove').length, 1);
  } finally { process.off('unhandledRejection', listen); }
});
