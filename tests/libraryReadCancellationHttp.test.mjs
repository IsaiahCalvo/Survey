import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createClient } from '@supabase/supabase-js';
import { coalesceRead } from '../src/hooks/requestCoalescer.js';
import { readLibraryRows } from '../src/hooks/libraryPagination.js';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('shared paging with installed SDK keeps one consumer live, then aborts orphaned HTTP', { timeout: 5000 }, async () => {
  const firstEntered = deferred(), secondEntered = deferred(), secondClosed = deferred();
  const requests = []; let held;
  const server = createServer((req, res) => {
    requests.push(new URL(req.url, 'http://local'));
    if (requests.length === 1) { held = res; firstEntered.resolve(); }
    else { res.on('close', () => secondClosed.resolve()); secondEntered.resolve(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = createClient(`http://127.0.0.1:${server.address().port}`, 'owned-test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const key = `owned-http:${server.address().port}`;
  let work = 0;
  const read = async signal => {
    work++;
    const result = await readLibraryRows(() => client.from('documents').select('id,name').eq('user_id', 'owned-actor'), { signal });
    if (result.error) throw result.error;
    return result.data;
  };
  const first = new AbortController(), second = new AbortController(), orphan = new AbortController();
  try {
    const a = coalesceRead(key, read, { signal: first.signal });
    const b = coalesceRead(key, read, { signal: second.signal });
    await firstEntered.promise; first.abort();
    await assert.rejects(a, { code: 'LIBRARY_READ_ABORTED' });
    assert.equal(held.destroyed, false, 'one waiter leaving must not close the remaining consumer request');
    held.writeHead(200, { 'Content-Type': 'application/json' }); held.end(JSON.stringify([{ id: 'a', name: 'Saved' }]));
    assert.deepEqual(await b, [{ id: 'a', name: 'Saved' }]);
    assert.equal(work, 1); assert.equal(requests.length, 1);
    assert.equal(requests[0].searchParams.get('user_id'), 'eq.owned-actor');
    assert.equal(requests[0].searchParams.get('select'), 'id,name');
    const c = coalesceRead(key, read, { signal: orphan.signal });
    await secondEntered.promise; orphan.abort();
    await assert.rejects(c, { code: 'LIBRARY_READ_ABORTED' }); await secondClosed.promise;
    assert.equal(work, 2); assert.equal(requests.length, 2);
  } finally {
    first.abort(); second.abort(); orphan.abort();
    const closing = once(server, 'close'); server.close(); server.closeAllConnections(); await closing;
  }
});
