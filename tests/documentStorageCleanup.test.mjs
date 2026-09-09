import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupDocumentStorage, drainDocumentStorageCleanup } from '../supabase/functions/_shared/documentStorageCleanup.js';

const paths = count => Array.from({ length: count }, (_, i) => `owner/${i}.pdf`);
const goodRetire = p => ({ data: { retired_paths: p, referenced_paths: [] } });
const goodAck = p => ({ data: { acknowledged_paths: p, pending_paths: [] } });
const goodRemove = p => ({ data: p.map(name => ({ name })), error: null });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
// Only the external transport is faked. Retirement authorization, locking and
// durable queue semantics require the separate PostgreSQL tests.
function fixture(overrides = {}) {
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'retire_document_storage_paths') return (overrides.retire || goodRetire)(args.p_paths);
      if (name === 'ack_document_storage_cleanup') return (overrides.ack || goodAck)(args.p_paths);
      if (name === 'list_document_storage_cleanup') return (overrides.list || (() => ({ data: { paths: [] } })))(args.p_limit);
      throw Error(`Unexpected RPC ${name}`);
    },
    storage: { from(bucket) { assert.equal(bucket, 'documents'); return {
      async remove(p) { calls.push({ name: 'remove', paths: [...p] }); return (overrides.remove || goodRemove)(p); },
    }; } },
  };
  return { client, calls, count: name => calls.filter(call => call.name === name).length };
}
function pending(report, expected) {
  assert.deepEqual([...report.pendingPaths].sort(), [...expected].sort());
  assert.deepEqual(report.removedPaths, []);
  assert.ok(report.errors.length > 0);
}

test('deduplicates exact keys and splits 101 unique paths into bounded batches', async () => {
  const p = paths(101), f = fixture();
  const report = await cleanupDocumentStorage(f.client, [...p, p[0], p[100]]);
  assert.deepEqual(report, { removedPaths: p, retainedPaths: [], pendingPaths: [], errors: [] });
  assert.deepEqual(f.calls.map(call => call.name), [
    'retire_document_storage_paths', 'remove', 'ack_document_storage_cleanup',
    'retire_document_storage_paths', 'remove', 'ack_document_storage_cleanup',
  ]);
  assert.deepEqual(f.calls.filter(call => call.name === 'remove').map(call => call.paths.length), [100, 1]);
});

for (const invalid of [null, {}, '', [''], ['owner/control\u0000.pdf'], ['owner/\u007f.pdf'], ['x'.repeat(2049)], [3], paths(10001)]) {
  test(`rejects invalid path input before any transport (${Array.isArray(invalid) ? invalid.length : typeof invalid})`, async () => {
    const f = fixture(); await assert.rejects(cleanupDocumentStorage(f.client, invalid), /valid exact object paths/);
    assert.deepEqual(f.calls, []);
  });
}

test('empty input is a successful no-op', async () => {
  const f = fixture();
  assert.deepEqual(await cleanupDocumentStorage(f.client, []), { removedPaths: [], retainedPaths: [], pendingPaths: [], errors: [] });
  assert.deepEqual(f.calls, []);
});

test('legacy raw keys preserve percent, question, hash and dot segments without decoding', async () => {
  const p = ['owner/a/../100%25?#.pdf', 'owner/%2F.pdf', 'owner/./x.pdf'];
  const f = fixture(); const report = await cleanupDocumentStorage(f.client, p);
  assert.deepEqual(report.removedPaths, p);
  for (const call of f.calls) assert.deepEqual(call.paths || call.args.p_paths, p);
});

for (const phase of ['retire', 'ack']) {
  const yes = phase === 'retire' ? 'retired_paths' : 'acknowledged_paths';
  const no = phase === 'retire' ? 'referenced_paths' : 'pending_paths';
  const p = paths(2);
  const bad = [null, {}, { [yes]: p }, { [yes]: [], [no]: [] },
    { [yes]: [...p, 'owner/injected.pdf'], [no]: [] },
    { [yes]: [p[0], p[0], p[1]], [no]: [] },
    { [yes]: p, [no]: [p[0]] }, { [yes]: [p[0], 4], [no]: [] }];
  bad.forEach((receipt, index) => test(`${phase} rejects malformed partition ${index} without unsafe follow-up`, async () => {
    const f = fixture({ [phase]: () => ({ data: receipt }) });
    pending(await cleanupDocumentStorage(f.client, p), p);
    assert.equal(f.count('remove'), phase === 'retire' ? 0 : 1);
    assert.equal(f.count('ack_document_storage_cleanup'), phase === 'retire' ? 0 : 1);
  }));
}

test('shared keys are retained without errors and never sent to Storage', async () => {
  const p = paths(3), f = fixture({ retire: () => ({ data: { retired_paths: [p[0]], referenced_paths: p.slice(1) } }) });
  const report = await cleanupDocumentStorage(f.client, p);
  assert.deepEqual(report, { removedPaths: [p[0]], retainedPaths: p.slice(1), pendingPaths: [], errors: [] });
  assert.deepEqual(f.calls.find(call => call.name === 'remove').paths, [p[0]]);
  const shared = fixture({ retire: keys => ({ data: { retired_paths: [], referenced_paths: keys } }) });
  assert.deepEqual((await cleanupDocumentStorage(shared.client, p)).retainedPaths, p);
  assert.equal(shared.count('remove'), 0);
});

for (const data of [null, {}, [null], [{ name: 'owner/injected.pdf' }], [{ wrong: 'name' }]]) {
  test(`invalid Storage acknowledgement prevents SQL ack and bisection: ${JSON.stringify(data)}`, async () => {
    const p = paths(2), f = fixture({ remove: () => ({ data }) });
    pending(await cleanupDocumentStorage(f.client, p), p);
    assert.equal(f.count('remove'), 1); assert.equal(f.count('ack_document_storage_cleanup'), 0);
  });
}

for (const phase of ['retire', 'remove', 'ack']) {
  for (const thrown of [false, true]) test(`lost ${phase} reply (${thrown ? 'throw' : 'error'}) keeps exact paths pending`, async () => {
    const p = paths(1), f = fixture({ [phase]: () => { if (thrown) throw Error('reply lost'); return { error: { message: 'reply lost' } }; } });
    pending(await cleanupDocumentStorage(f.client, p), p);
    assert.equal(f.count('remove'), phase === 'retire' ? 0 : 1);
    assert.equal(f.count('ack_document_storage_cleanup'), phase === 'ack' ? 1 : 0);
  });
}

test('already missing objects accept empty Storage reply only after SQL absence acknowledgement', async () => {
  const p = paths(2), f = fixture({ remove: () => ({ data: [], error: null }) });
  assert.deepEqual((await cleanupDocumentStorage(f.client, p)).removedPaths, p);
  assert.equal(f.count('ack_document_storage_cleanup'), 1);
});

test('partial acknowledgement reports only confirmed removals, keeping remaining metadata pending', async () => {
  const p = paths(2), f = fixture({ ack: () => ({ data: { acknowledged_paths: [p[0]], pending_paths: [p[1]] } }) });
  const report = await cleanupDocumentStorage(f.client, p);
  assert.deepEqual(report.removedPaths, [p[0]]); assert.deepEqual(report.pendingPaths, [p[1]]);
  assert.equal(report.errors.length, 1);
});

test('one permanently bad Storage key is isolated so good retired keys make progress', async () => {
  const p = paths(9), bad = p[4], f = fixture({ remove: keys => keys.includes(bad) ? { error: { message: 'bad key' } } : goodRemove(keys) });
  const report = await cleanupDocumentStorage(f.client, p);
  assert.deepEqual([...report.removedPaths].sort(), p.filter(key => key !== bad).sort());
  assert.deepEqual(report.pendingPaths, [bad]); assert.deepEqual(report.errors, ['bad key']);
  assert.equal(f.count('retire_document_storage_paths'), 1);
  assert.ok(f.count('remove') > 1);
  for (const call of f.calls.filter(call => call.name === 'ack_document_storage_cleanup')) assert.equal(call.args.p_paths.includes(bad), false);
});

for (const phase of ['retire', 'remove', 'ack']) {
  test(`${phase} network hang is bounded and late reply cannot cause unsafe follow-up`, { timeout: 2000 }, async () => {
    const p = paths(2), late = deferred(), f = fixture({ [phase]: () => late.promise });
    const started = performance.now();
    const report = await cleanupDocumentStorage(f.client, p, { requestTimeoutMs: 5, maxDurationMs: 50 });
    assert.ok(performance.now() - started < 1000); pending(report, p);
    const callsAtTimeout = f.calls.length;
    const frozen = structuredClone(report);
    late.resolve((phase === 'retire' ? goodRetire : phase === 'remove' ? goodRemove : goodAck)(p));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.calls.length, callsAtTimeout);
    assert.deepEqual(report, frozen);
    assert.equal(f.count('remove'), phase === 'retire' ? 0 : 1, 'timeouts do not trigger bisection');
    assert.equal(f.count('ack_document_storage_cleanup'), phase === 'ack' ? 1 : 0);
  });
}

test('total duration cap keeps later batches pending without starting them', { timeout: 2000 }, async () => {
  const p = paths(201), f = fixture({ retire: () => new Promise(() => {}) });
  const started = performance.now();
  pending(await cleanupDocumentStorage(f.client, p, { requestTimeoutMs: 50, maxDurationMs: 5 }), p);
  assert.ok(performance.now() - started < 1000);
  assert.equal(f.count('retire_document_storage_paths'), 1); assert.equal(f.count('remove'), 0);
});

for (const phase of ['retire', 'remove', 'ack']) {
  test(`early total-budget timer in ${phase} cannot start another batch`, async t => {
    const timers = new Map(); let nextTimer = 0;
    t.mock.method(performance, 'now', () => 100);
    t.mock.method(globalThis, 'setTimeout', callback => { const id = ++nextTimer; timers.set(id, callback); return id; });
    t.mock.method(globalThis, 'clearTimeout', id => timers.delete(id));
    const started = deferred(), late = deferred(), p = paths(201);
    const f = fixture({ [phase]: () => { started.resolve(); return late.promise; } });
    const run = cleanupDocumentStorage(f.client, p, { requestTimeoutMs: 50, maxDurationMs: 5 });
    await started.promise;
    // The total timer fires while the clock still reads before the deadline.
    assert.equal(timers.size, 1); [...timers.values()][0]();
    const report = await run; pending(report, p);
    assert.equal(f.count('retire_document_storage_paths'), 1);
    assert.equal(f.count('remove'), phase === 'retire' ? 0 : 1);
    assert.equal(f.count('ack_document_storage_cleanup'), phase === 'ack' ? 1 : 0);
    const calls = f.calls.length;
    late.resolve((phase === 'retire' ? goodRetire : phase === 'remove' ? goodRemove : goodAck)(p.slice(0, 100)));
    await Promise.resolve(); assert.equal(f.calls.length, calls);
  });
}

test('wall-clock jumps cannot end a live monotonic cleanup budget', async t => {
  t.mock.method(Date, 'now', (() => { let time = 0; return () => (time += 1000000); })());
  const p = paths(201), f = fixture();
  assert.deepEqual((await cleanupDocumentStorage(f.client, p)).removedPaths, p);
  assert.equal(f.count('retire_document_storage_paths'), 3);
});

test('200-request cap bounds repeated Storage errors and preserves every unattempted key', async () => {
  const p = paths(301), f = fixture({ remove: () => ({ error: { message: 'all unavailable' } }) });
  const report = await cleanupDocumentStorage(f.client, p);
  pending(report, p);
  assert.equal(new Set(report.pendingPaths).size, p.length);
  assert.equal(f.calls.length, 200); assert.equal(f.count('retire_document_storage_paths'), 1);
  assert.equal(f.count('ack_document_storage_cleanup'), 0);
  assert.ok(report.errors.some(error => /budget/.test(error)));
});

for (const options of [{ requestTimeoutMs: 0 }, { maxDurationMs: 45001 }, { requestTimeoutMs: 2.5 }, { maxDurationMs: NaN }]) {
  test(`invalid time limits reject before network: ${JSON.stringify(options)}`, async () => {
    const f = fixture(); await assert.rejects(cleanupDocumentStorage(f.client, paths(1), options), /time limits/);
    assert.deepEqual(f.calls, []);
  });
}

test('empty service queue uses one bounded list RPC and no Storage', async () => {
  const f = fixture();
  assert.deepEqual(await drainDocumentStorageCleanup(f.client, 7), { removedPaths: [], retainedPaths: [], pendingPaths: [], errors: [] });
  assert.deepEqual(f.calls, [{ name: 'list_document_storage_cleanup', args: { p_limit: 7 } }]);
});

test('service queue routes returned exact paths through the same retirement protocol', async () => {
  const p = paths(2), f = fixture({ list: () => ({ data: { paths: p } }) });
  assert.deepEqual((await drainDocumentStorageCleanup(f.client, 2)).removedPaths, p);
  assert.deepEqual(f.calls.map(call => call.name), ['list_document_storage_cleanup', 'retire_document_storage_paths', 'remove', 'ack_document_storage_cleanup']);
});

for (const limit of [0, -1, 101, 1.5, NaN, '10']) {
  test(`invalid queue bound ${limit} rejects before network`, async () => {
    const f = fixture(); await assert.rejects(drainDocumentStorageCleanup(f.client, limit), /batch limit/); assert.deepEqual(f.calls, []);
  });
}
for (const response of [{ data: null }, { data: {} }, { data: { paths: 'wrong' } }, { data: { paths: paths(3) } },
  { data: { paths: ['owner/\u0000.pdf'] } }, { error: { message: 'queue unavailable' } }]) {
  test(`invalid service queue reply never removes Storage: ${JSON.stringify(response)}`, async () => {
    const f = fixture({ list: () => response });
    await assert.rejects(drainDocumentStorageCleanup(f.client, 2)); assert.equal(f.calls.length, 1);
  });
}
