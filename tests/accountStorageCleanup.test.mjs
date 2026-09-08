import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupAccountStorage } from '../supabase/functions/_shared/accountStorageCleanup.js';

const userId = '11111111-1111-4111-8111-111111111111';
const path = n => `${userId}/${n}.pdf`;
const empty = { paths: [], has_remaining: false, cycle_complete: true };
const batch = (paths, cycle_complete = false) => ({ paths, has_remaining: true, cycle_complete });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

// Actual account helper calls the actual document cleanup helper. Only remote
// RPC and Storage transport are simulated; no claim here proves SQL authority.
function fixture(options = {}) {
  const calls = [], objects = new Set(options.paths || []);
  let claimCount = 0;
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'claim_account_storage_cleanup') {
        assert.deepEqual(args, { target_user_id: userId, p_limit: 100 });
        claimCount++;
        if (options.claim) return options.claim(claimCount);
        const paths = [...objects].slice(0, 100);
        return { data: paths.length ? batch(paths, paths.length === objects.size) : empty };
      }
      if (name === 'retire_document_storage_paths') {
        if (options.retire) return options.retire(args.p_paths);
        return { data: { retired_paths: args.p_paths, referenced_paths: [] } };
      }
      if (name === 'ack_document_storage_cleanup') {
        if (options.ack) return options.ack(args.p_paths);
        return { data: { acknowledged_paths: args.p_paths.filter(p => !objects.has(p)), pending_paths: args.p_paths.filter(p => objects.has(p)) } };
      }
      throw Error(`Unexpected RPC ${name}`);
    },
    storage: { from(bucket) { assert.equal(bucket, 'documents'); return {
      async remove(paths) {
        calls.push({ name: 'remove', paths: [...paths] });
        if (options.remove) return options.remove(paths);
        for (const p of paths) objects.delete(p);
        return { data: paths.map(name => ({ name })), error: null };
      },
      list() { throw Error('Unbounded Storage listing is forbidden'); },
    }; } },
  };
  return { client, calls, objects, count: name => calls.filter(call => call.name === name).length };
}
const run = (f, options) => cleanupAccountStorage(f.client, userId, options);
function incomplete(result) { assert.equal(result.complete, false); assert.ok(Array.isArray(result.errors)); }

test('only a fresh canonical empty completion receipt proves account storage cleanup complete', async () => {
  const f = fixture();
  assert.deepEqual(await run(f), { complete: true, removedCount: 0, retainedCount: 0, errors: [] });
  assert.equal(f.calls.length, 1);
});

test('last nonempty batch still requires an independent empty confirmation', async () => {
  const f = fixture({ paths: [path(0), path(1)] });
  assert.deepEqual(await run(f), { complete: true, removedCount: 2, retainedCount: 0, errors: [] });
  assert.deepEqual(f.calls.map(call => call.name), ['claim_account_storage_cleanup', 'retire_document_storage_paths', 'remove',
    'ack_document_storage_cleanup', 'claim_account_storage_cleanup']);
});

test('an exact account-prefix object key ending in slash is not mistaken for a broad prefix deletion', async () => {
  const exact = `${userId}/`, f = fixture({ paths: [exact] });
  const result = await run(f);
  assert.equal(result.complete, true);
  assert.equal(result.removedCount, 1);
});

test('250 objects require another bounded call after three claims even when all bytes were acknowledged', async () => {
  const f = fixture({ paths: Array.from({ length: 250 }, (_, n) => path(n)) });
  const first = await run(f);
  incomplete(first); assert.equal(first.removedCount, 250); assert.equal(first.retainedCount, 0);
  assert.equal(f.count('claim_account_storage_cleanup'), 3);
  assert.deepEqual(f.calls.filter(call => call.name === 'remove').map(call => call.paths.length), [100, 100, 50]);
  assert.deepEqual(await run(f), { complete: true, removedCount: 0, retainedCount: 0, errors: [] });
  assert.equal(f.count('claim_account_storage_cleanup'), 4);
});

test('repeated bounded calls make progress through a large durable queue without revisiting removed keys', async () => {
  const p = Array.from({ length: 701 }, (_, n) => path(n)), f = fixture({ paths: p });
  let removed = 0, completed = false;
  for (let turn = 0; turn < 4 && !completed; turn++) {
    const before = f.count('claim_account_storage_cleanup');
    const result = await run(f); removed += result.removedCount; completed = result.complete;
    assert.ok(f.count('claim_account_storage_cleanup') - before <= 3);
  }
  assert.equal(completed, true); assert.equal(removed, 701); assert.equal(f.objects.size, 0);
  const sent = f.calls.filter(call => call.name === 'remove').flatMap(call => call.paths);
  assert.deepEqual(sent, p); assert.equal(new Set(sent).size, 701);
});

test('durable raw cursor reaches later keys despite a failed early key and revisits it on a later call', async () => {
  const all = Array.from({ length: 205 }, (_, n) => path(String(n).padStart(4, '0')));
  const remaining = new Set(all), bad = all[0], claimed = [];
  let cursor = '', allowBad = false;
  const f = fixture({
    claim: () => {
      let eligible = [...remaining].sort().filter(p => p > cursor);
      if (!eligible.length) { cursor = ''; eligible = [...remaining].sort(); }
      if (!eligible.length) return { data: empty };
      const page = eligible.slice(0, 100);
      cursor = page.at(-1); // Committed service cursor advances before the reply.
      claimed.push(page);
      return { data: batch(page, page.length === eligible.length) };
    },
    remove: p => {
      if (!allowBad && p.includes(bad)) return { error: { message: 'one blocked object' } };
      for (const key of p) remaining.delete(key);
      return { data: p.map(name => ({ name })) };
    },
    ack: p => ({ data: { acknowledged_paths: p.filter(key => !remaining.has(key)), pending_paths: p.filter(key => remaining.has(key)) } }),
  });
  const first = await run(f);
  incomplete(first); assert.equal(first.removedCount, 99); assert.equal(claimed.length, 1);
  const second = await run(f);
  incomplete(second); assert.equal(second.removedCount, 105);
  assert.equal(claimed[1][0], all[100], 'a failed early key must not restart the raw scan');
  assert.deepEqual([...remaining], [bad]);
  allowBad = true;
  const last = await run(f);
  assert.equal(last.complete, true); assert.equal(last.removedCount, 1); assert.equal(remaining.size, 0);
  assert.equal(f.count('claim_account_storage_cleanup'), 6);
});

test('a lost committed cursor reply leaves paths for a later cycle, never falsely completes', async () => {
  const all = [path(0), path(1)], remaining = new Set(all);
  let next = 0, loseFirst = true;
  const f = fixture({
    claim: () => {
      if (!remaining.size) return { data: empty };
      const key = all[next++ % all.length];
      if (loseFirst) { loseFirst = false; throw Error('claim reply lost after cursor advance'); }
      return { data: batch(remaining.has(key) ? [key] : [], false) };
    },
    remove: p => { p.forEach(key => remaining.delete(key)); return { data: p.map(name => ({ name })) }; },
    ack: p => ({ data: { acknowledged_paths: p, pending_paths: [] } }),
  });
  const first = await run(f); incomplete(first); assert.equal(first.removedCount, 0); assert.equal(remaining.size, 2);
  const second = await run(f); assert.equal(second.complete, true); assert.equal(second.removedCount, 2);
  assert.deepEqual(f.calls.filter(call => call.name === 'remove').map(call => call.paths[0]), [all[1], all[0]]);
});

test('empty eligible batch with an unfinished raw cursor continues to the next claim', async () => {
  const f = fixture({ paths: [path(0)], claim: n => ({ data: n === 1 ? batch([], false) : n === 2 ? batch([path(0)], true) : empty }) });
  const result = await run(f);
  assert.equal(result.complete, true); assert.equal(result.removedCount, 1); assert.equal(f.count('claim_account_storage_cleanup'), 3);
});

test('a completed raw cycle with objects remaining stops pending without looping', async () => {
  const f = fixture({ claim: () => ({ data: batch([], true) }) });
  incomplete(await run(f)); assert.equal(f.calls.length, 1);
});

const invalidReceipts = [null, {}, [], { paths: [] }, { ...empty, paths: 'no' },
  { ...empty, has_remaining: 'false' }, { ...empty, cycle_complete: 1 },
  { paths: [path(0)], has_remaining: false, cycle_complete: true },
  { paths: [], has_remaining: false, cycle_complete: false },
  batch(Array.from({ length: 101 }, (_, n) => path(n))), batch([path(0), path(0)]),
  batch(['22222222-2222-4222-8222-222222222222/foreign.pdf']), batch([`${userId}-suffix/file.pdf`]),
  batch([`${userId}/control\u0000.pdf`]), batch([`${userId}/${'x'.repeat(2049)}`]), batch([null])];
invalidReceipts.forEach((receipt, index) => test(`malformed or injected claim ${index} cannot authorize cleanup or completion`, async () => {
  const f = fixture({ claim: () => ({ data: receipt }) });
  const result = await run(f); incomplete(result); assert.ok(result.errors.length);
  assert.equal(result.removedCount, 0); assert.equal(f.calls.length, 1);
}));

test('legacy raw owned keys are not normalized or URL-decoded', async () => {
  const p = `${userId}/legacy/../100%25?#.pdf`, f = fixture({ paths: [p] });
  assert.equal((await run(f)).complete, true);
  assert.deepEqual(f.calls.find(call => call.name === 'remove').paths, [p]);
});

test('a newly shared path is retained and prevents account cleanup completion', async () => {
  const f = fixture({ paths: [path(0)], retire: p => ({ data: { retired_paths: [], referenced_paths: p } }) });
  const result = await run(f); incomplete(result); assert.equal(result.retainedCount, 1); assert.equal(result.removedCount, 0);
  assert.equal(f.count('remove'), 0); assert.equal(f.count('claim_account_storage_cleanup'), 1);
});

for (const phase of ['claim', 'retire', 'remove', 'ack']) {
  for (const throws of [true, false]) test(`lost ${phase} reply (${throws ? 'throw' : 'error'}) never reports account complete`, async () => {
    const f = fixture({ paths: [path(0)], [phase]: () => { if (throws) throw Error('reply lost'); return { error: { message: 'reply lost' } }; } });
    const result = await run(f); incomplete(result); assert.ok(result.errors.length);
    assert.equal(f.count('claim_account_storage_cleanup'), 1);
    if (phase === 'claim' || phase === 'retire') assert.equal(f.count('remove'), 0);
  });
}

test('acknowledgement with pending metadata stops without consuming another claim', async () => {
  const f = fixture({ paths: [path(0)], ack: p => ({ data: { acknowledged_paths: [], pending_paths: p } }) });
  incomplete(await run(f)); assert.equal(f.count('claim_account_storage_cleanup'), 1);
});

for (const phase of ['claim', 'remove']) {
  test(`${phase} timeout is bounded and a late reply cannot restart cleanup`, { timeout: 2000 }, async () => {
    const late = deferred(), f = fixture({ paths: [path(0)], [phase]: () => late.promise });
    const started = performance.now(), result = await run(f, { requestTimeoutMs: 5, maxDurationMs: 50 });
    incomplete(result); assert.ok(result.errors.length); assert.ok(performance.now() - started < 1000);
    const count = f.calls.length, frozen = structuredClone(result);
    late.resolve(phase === 'claim' ? { data: batch([path(0)], true) } : { data: [{ name: path(0) }] });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.calls.length, count); assert.deepEqual(result, frozen);
    assert.equal(f.count('ack_document_storage_cleanup'), 0);
  });
}

test('shared duration bound applies to the claim RPC as well as document cleanup', { timeout: 2000 }, async () => {
  const f = fixture({ claim: () => new Promise(() => {}) });
  const started = performance.now(); incomplete(await run(f, { requestTimeoutMs: 50, maxDurationMs: 5 }));
  assert.ok(performance.now() - started < 1000); assert.equal(f.calls.length, 1);
});

test('maxClaims one cannot infer completion from a successful final batch', async () => {
  const f = fixture({ paths: [path(0)] });
  const result = await run(f, { maxClaims: 1 }); incomplete(result); assert.equal(result.removedCount, 1);
  assert.equal(f.count('claim_account_storage_cleanup'), 1);
});

for (const value of ['', 'owner', `${userId}/suffix`, null, 9, 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA']) {
  test(`invalid or noncanonical account id rejects before transport: ${value}`, async () => {
    const f = fixture(); await assert.rejects(cleanupAccountStorage(f.client, value)); assert.deepEqual(f.calls, []);
  });
}
for (const options of [{ requestTimeoutMs: 0 }, { requestTimeoutMs: 45001 }, { maxDurationMs: 0 },
  { maxDurationMs: 45001 }, { maxClaims: 0 }, { maxClaims: 4 }, { maxClaims: 1.5 }]) {
  test(`invalid account cleanup limits reject before transport: ${JSON.stringify(options)}`, async () => {
    const f = fixture(); await assert.rejects(run(f, options)); assert.deepEqual(f.calls, []);
  });
}
