import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { drainDocumentStorageCleanup } from '../supabase/functions/_shared/documentStorageCleanup.js';

const source = stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/archive-purge-sweep/index.ts', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, ''));
const id = n => `80000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const queuedPath = `${id(1)}/unrelated.pdf`;
const receipt = (canceled = [], skipped = []) => ({ canceled_operation_ids: canceled, skipped_operation_ids: skipped });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function harness({ expiry = async () => ({ data: receipt() }), skippedLock = false, fakeTimer = false } = {}) {
  const calls = [], logs = [], timers = new Map();
  let handler, nextTimer = 0;
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'sweep_expired_archives') return { data: { run_id: id(2), skipped_lock: skippedLock, orphaned_paths: [], documents_purged: 0 } };
      if (name === 'expire_document_generation_uploads') return expiry();
      if (name === 'list_document_storage_cleanup') return { data: { paths: [queuedPath] } };
      if (name === 'retire_document_storage_paths') return { data: { retired_paths: args.p_paths, referenced_paths: [] } };
      if (name === 'ack_document_storage_cleanup') return { data: { acknowledged_paths: args.p_paths, pending_paths: [] } };
      throw new Error(`Unexpected RPC ${name}`);
    },
    storage: { from(bucket) { assert.equal(bucket, 'documents'); return { async remove(paths) {
      calls.push({ name: 'storage.remove', paths }); return { data: paths.map(name => ({ name })) };
    } }; } },
    from(table) { assert.equal(table, 'archive_purge_runs'); return { update(values) { return { async eq(key, value) {
      calls.push({ name: 'writeback', values, key, value }); return {};
    } }; } }; },
  };
  vm.runInNewContext(source, {
    Deno: { serve(value) { handler = value; }, env: { get(name) { return ({ SUPABASE_SERVICE_ROLE_KEY: 'owned-service-secret', SUPABASE_URL: 'https://owned.invalid', ARCHIVE_PURGE_CRON_SECRET: 'owned-cron-secret' })[name]; } } },
    createClient() { calls.push({ name: 'createClient' }); return client; }, drainDocumentStorageCleanup,
    Response, console: { log(value) { logs.push(JSON.parse(value)); } },
    setTimeout: fakeTimer ? (callback, milliseconds) => { const token = ++nextTimer; timers.set(token, { callback, milliseconds }); return token; } : setTimeout,
    clearTimeout: fakeTimer ? token => timers.delete(token) : clearTimeout,
  });
  return { calls, logs, timers, async run(body = {}, authorization = 'Bearer owned-cron-secret', method = 'POST') {
    const result = await handler(new Request('https://owned.invalid/sweep', { method, headers: { Authorization: authorization }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) }));
    return { status: result.status, body: method === 'OPTIONS' ? null : await result.json() };
  } };
}
const names = h => h.calls.map(call => call.name);

test('actual sweep rejects user credentials before SDK creation; OPTIONS and GET do no work', async () => {
  const h = harness(); assert.equal((await h.run({}, 'Bearer user-token')).status, 401);
  assert.equal((await h.run({}, '', 'GET')).status, 405); assert.equal((await h.run({}, '', 'OPTIONS')).status, 200);
  assert.deepEqual(h.calls, []);
});

test('dry run and archive sweep lock skip never expire or unlink or write back', async () => {
  const dry = harness(); const result = await dry.run({ dry_run: true });
  assert.equal(result.body.dry_run, true); assert.deepEqual(names(dry), ['createClient', 'sweep_expired_archives']);
  assert.equal(dry.calls[1].args.p_dry_run, true);
  const busy = harness({ skippedLock: true }); assert.equal((await busy.run()).body.skipped_lock, true);
  assert.deepEqual(names(busy), ['createClient', 'sweep_expired_archives']);
});

test('expiry commit receipt precedes actual shared retirement/remove/ack, even with zero newly purged rows', async () => {
  const gate = deferred(), h = harness({ expiry: () => gate.promise });
  const running = h.run(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(names(h), ['createClient', 'sweep_expired_archives', 'expire_document_generation_uploads']);
  assert.deepEqual({ ...h.calls[2].args }, { p_limit: 100 });
  gate.resolve({ data: receipt([id(3)]) }); const result = await running;
  assert.deepEqual(names(h), ['createClient', 'sweep_expired_archives', 'expire_document_generation_uploads', 'list_document_storage_cleanup', 'retire_document_storage_paths', 'storage.remove', 'ack_document_storage_cleanup', 'writeback']);
  assert.equal(result.body.unlinked, 1); assert.deepEqual(result.body.unlink_errors, []);
  const log = h.logs.find(row => row.event === 'generation_upload_expiry');
  assert.equal(log.canceled, 1); assert.equal(log.skipped, 0);
  assert.ok(!JSON.stringify(h.logs).includes(queuedPath)); assert.ok(!JSON.stringify(h.logs).includes(id(3)));
});

test('valid skipped expiry operations report retry while unrelated jobs still drain', async () => {
  const h = harness({ expiry: async () => ({ data: receipt([id(3)], [id(4)]) }) });
  const result = await h.run(); assert.equal(result.body.unlinked, 1);
  assert.match(result.body.unlink_errors.join(' '), /busy.*retry/);
  assert.equal(h.logs.find(row => row.event === 'generation_upload_expiry').skipped, 1);
});

for (const [label, expiry] of [
  ['RPC error', async () => ({ error: { message: 'secret-provider-error' } })],
  ['lost reply', async () => { throw new Error('secret-provider-error'); }],
  ['missing reply', async () => ({ data: null })],
  ['missing array', async () => ({ data: { canceled_operation_ids: [] } })],
  ['wrong type', async () => ({ data: receipt([123]) })],
  ['malformed UUID', async () => ({ data: receipt(['not-a-uuid']) })],
  ['duplicate', async () => ({ data: receipt([id(3), id(3)]) })],
  ['overlap', async () => ({ data: receipt([id(3)], [id(3)]) })],
  ['over bound', async () => ({ data: receipt(Array.from({ length: 100 }, (_, i) => id(i)), [id(100)]) })],
]) test(`${label} expiry receipt is explicit, sanitized, and does not block unrelated checked cleanup`, async () => {
  const h = harness({ expiry }); const result = await h.run();
  assert.equal(result.status, 200); assert.equal(result.body.unlinked, 1);
  assert.match(result.body.unlink_errors.join(' '), /could not be confirmed.*retry/);
  assert.ok(h.logs.some(row => row.event === 'generation_upload_expiry_failed'));
  assert.ok(!JSON.stringify([h.logs, result.body]).includes('secret-provider-error'));
  assert.equal(names(h).filter(name => name === 'expire_document_generation_uploads').length, 1);
});

test('exact 100 unique IDs across both arrays remain a bounded valid receipt', async () => {
  const h = harness({ expiry: async () => ({ data: receipt(Array.from({ length: 100 }, (_, i) => id(i))) }) });
  const result = await h.run(); assert.deepEqual(result.body.unlink_errors, []);
  assert.equal(h.logs.find(row => row.event === 'generation_upload_expiry').canceled, 100);
});

test('hung expiry has a 15s bound; late failure is handled and never starts another drain', async () => {
  const gate = deferred(), h = harness({ expiry: () => gate.promise, fakeTimer: true });
  const unhandled = []; const onUnhandled = error => unhandled.push(error); process.on('unhandledRejection', onUnhandled);
  try {
    const running = h.run(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.timers.size, 1); const timer = [...h.timers.values()][0]; assert.equal(timer.milliseconds, 15000);
    assert.ok(!names(h).includes('storage.remove')); timer.callback();
    const result = await running; assert.equal(result.body.unlinked, 1); assert.equal(result.body.unlink_errors.length, 1);
    assert.equal(h.timers.size, 0); gate.reject(new Error('late lost reply'));
    await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(unhandled, []);
    assert.equal(names(h).filter(name => name === 'storage.remove').length, 1);
  } finally { process.off('unhandledRejection', onUnhandled); }
});
