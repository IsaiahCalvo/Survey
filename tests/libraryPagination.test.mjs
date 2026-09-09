import test from 'node:test';
import assert from 'node:assert/strict';
import { readLibraryRows, readLibraryIdChunks, sortLibraryRows } from '../src/hooks/libraryPagination.js';
import { createClient } from '@supabase/supabase-js';

function query(rows, calls, { errorAt = null } = {}) {
  let column, limit, cursor = null;
  const builder = {
    order(value) { column = value; return builder; },
    limit(value) { limit = value; return builder; },
    gt(_column, value) { cursor = value; return builder; },
    then(resolve, reject) {
      calls.push({ column, limit, cursor });
      const data = [...rows].sort((a, b) => a[column].localeCompare(b[column]))
        .filter((row) => cursor === null || row[column] > cursor).slice(0, Math.min(limit, 1000));
      return Promise.resolve({ data, error: cursor === errorAt && cursor !== null ? new Error('page failed') : null }).then(resolve, reject);
    },
  };
  return builder;
}

test('keyset pagination reads past the 1000-row API cap, including equal timestamps', async () => {
  const rows = Array.from({ length: 1251 }, (_, i) => ({ id: String(i).padStart(4, '0'), updated_at: '2026-09-07' }));
  const calls = [];
  const result = await readLibraryRows(() => query(rows, calls));
  assert.equal(result.error, null);
  assert.deepEqual(result.data, rows);
  assert.deepEqual(calls.map((call) => call.cursor), [null, '0499', '0999']);
  assert.ok(calls.every((call) => call.limit === 500 && call.column === 'id'));
  assert.equal(sortLibraryRows(result.data, 'updated_at').length, 1251);
});

test('a later page failure returns no partial library', async () => {
  const rows = Array.from({ length: 600 }, (_, i) => ({ id: String(i).padStart(4, '0') }));
  const result = await readLibraryRows(() => query(rows, [], { errorAt: '0499' }));
  assert.equal(result.data, null);
  assert.equal(result.error.message, 'page failed');
});

test('duplicate, missing, or backwards cursors fail instead of hanging or dropping rows', async () => {
  for (const rows of [[{ id: 'a' }, { id: 'a' }], [{ id: null }], [{ id: 'b' }, { id: 'a' }]]) {
    const result = await readLibraryRows(() => {
      const builder = { order: () => builder, limit: () => builder, then: (resolve) => Promise.resolve({ data: rows }).then(resolve) };
      return builder;
    });
    assert.equal(result.data, null);
    assert.match(result.error.message, /cursor did not advance/);
  }
  let count = 0;
  const result = await readLibraryRows(() => {
    count++;
    const builder = { order: () => builder, limit: () => builder, gt: () => builder, then: (resolve) => Promise.resolve({ data: [{ id: 'a' }] }).then(resolve) };
    return builder;
  }, { pageSize: 1 });
  assert.equal(count, 2, 'stuck second page terminates');
  assert.match(result.error.message, /cursor did not advance/);
});

test('membership cursor can use the unique document_id column', async () => {
  const rows = Array.from({ length: 1001 }, (_, i) => ({ document_id: String(i).padStart(4, '0') }));
  const result = await readLibraryRows(() => query(rows, []), { cursorColumn: 'document_id' });
  assert.deepEqual(result.data, rows);
});

test('shared ID chunks stay bounded, remove repeated IDs, and keep every row', async () => {
  const ids = Array.from({ length: 1203 }, (_, i) => String(i).padStart(4, '0'));
  const chunks = [];
  const result = await readLibraryIdChunks([...ids, ids[0]], (chunk) => {
    chunks.push(chunk);
    return query(chunk.map((id) => ({ id })), []);
  });
  assert.deepEqual(result.data.map((row) => row.id), ids);
  assert.equal(chunks.length, 13);
  assert.ok(chunks.every((chunk) => chunk.length <= 100));
});

test('a failed shared-ID chunk returns no earlier partial rows', async () => {
  const ids = Array.from({ length: 101 }, (_, i) => String(i).padStart(4, '0'));
  const result = await readLibraryIdChunks(ids, (chunk) => {
    if (chunk.length === 100) return query(chunk.map((id) => ({ id })), []);
    const builder = { order: () => builder, limit: () => builder, then: (resolve) => Promise.resolve({ error: new Error('denied') }).then(resolve) };
    return builder;
  });
  assert.equal(result.data, null);
  assert.equal(result.error.message, 'denied');
});

test('page, retained-row and UTF8 budgets return no partial library', async () => {
  const rows=[{id:'a',name:'😀'},{id:'b',name:'😀'},{id:'c',name:'😀'}];
  for(const options of [{pageSize:1,maxPages:2},{pageSize:2,maxRows:2},{maxBytes:10}]) {
    const result=await readLibraryRows(()=>query(rows,[]),options);
    assert.equal(result.data,null);assert.equal(result.error.code,'LIBRARY_READ_LIMIT');
  }
  const exactBytes=new TextEncoder().encode(JSON.stringify(rows)).byteLength;
  assert.deepEqual((await readLibraryRows(()=>query(rows,[]),{maxBytes:exactBytes})).data,rows);
  assert.equal((await readLibraryRows(()=>query(rows,[]),{maxBytes:exactBytes-1})).error.code,'LIBRARY_READ_LIMIT');
});

test('a full final page requires an empty confirmation rather than pretending the library is complete', async () => {
  const rows=[{id:'a'},{id:'b'}],calls=[];
  const result=await readLibraryRows(()=>query(rows,calls),{pageSize:1,maxRows:2,maxPages:3});
  assert.deepEqual(result.data,rows);assert.equal(calls.length,3);
  assert.equal((await readLibraryRows(()=>query(rows,[]),{pageSize:1,maxRows:2,maxPages:2})).error.code,'LIBRARY_READ_LIMIT');
});

test('shared chunks use one row/page/byte budget instead of resetting it for each request', async () => {
  const ids=Array.from({length:101},(_,i)=>String(i).padStart(4,'0'));
  const firstBytes=new TextEncoder().encode(JSON.stringify(ids.slice(0,100).map(id=>({id})))).byteLength;
  for(const options of [{maxRows:100},{maxPages:1},{maxBytes:firstBytes}]) {
    const result=await readLibraryIdChunks(ids,chunk=>query(chunk.map(id=>({id})),[]),options);
    assert.equal(result.data,null);assert.equal(result.error.code,'LIBRARY_READ_LIMIT');
  }
});

test('oversized responses and rows outside their requested ID chunk fail closed', async () => {
  const make=rows=>{const builder={order:()=>builder,limit:()=>builder,then:resolve=>Promise.resolve({data:rows}).then(resolve)};return builder;};
  assert.match((await readLibraryRows(()=>make([{id:'a'},{id:'b'}]),{pageSize:1})).error.message,/Invalid library page/);
  const result=await readLibraryIdChunks(['a'],()=>make([{id:'b'}]));
  assert.equal(result.data,null);assert.match(result.error.message,/Invalid library chunk result/);
});

test('invalid limits fail before any query is built', async () => {
  let calls=0;
  for(const options of [{pageSize:1001},{pageSize:0},{maxRows:0},{maxBytes:NaN},{maxPages:Infinity},
    {timeoutMs:0},{timeoutMs:120001},{cursorColumn:'id,private'},{signal:{aborted:false}}]) {
    await assert.rejects(readLibraryRows(()=>{calls++;},options),TypeError);
  }
  assert.equal(calls,0);
});

function trackedAbort() {
  const controller=new AbortController(),listeners=new Set();
  return {controller,listeners,signal:{get aborted(){return controller.signal.aborted;},
    addEventListener(type,callback,options){listeners.add(callback);controller.signal.addEventListener(type,callback,options);},
    removeEventListener(type,callback){listeners.delete(callback);controller.signal.removeEventListener(type,callback);},
  }};
}

test('already-canceled reads, including empty ID chunks, do no I/O and release listeners', async () => {
  const tracked=trackedAbort();tracked.controller.abort();let calls=0;
  for(const result of [await readLibraryRows(()=>{calls++;},{signal:tracked.signal}),
    await readLibraryIdChunks([],()=>{calls++;},{signal:tracked.signal})]) {
    assert.equal(result.data,null);assert.equal(result.error.code,'LIBRARY_READ_ABORTED');
  }
  assert.equal(calls,0);assert.equal(tracked.listeners.size,0);
});

test('an uncooperative hung query settles on abort and its late page is discarded', async () => {
  const tracked=trackedAbort();let release,started;
  const ready=new Promise(resolve=>{started=resolve;});
  const read=readLibraryRows(()=>{
    const builder={order:()=>builder,limit:()=>builder,then:resolve=>{release=resolve;started();}};return builder;
  },{signal:tracked.signal});
  await ready;tracked.controller.abort();
  const result=await read;assert.equal(result.data,null);assert.equal(result.error.code,'LIBRARY_READ_ABORTED');
  assert.equal(tracked.listeners.size,0);release({data:[{id:'late'}]});await Promise.resolve();
  assert.equal(result.data,null);
});

test('deadline settles hung pages and detaches external listeners', async () => {
  const tracked=trackedAbort();
  const result=await readLibraryRows(()=>{
    const builder={order:()=>builder,limit:()=>builder,then:()=>{}};return builder;
  },{timeoutMs:15,signal:tracked.signal});
  assert.equal(result.error.code,'LIBRARY_READ_ABORTED');assert.equal(tracked.listeners.size,0);
});

test('abort at the final completion handoff cannot return a successful library', async () => {
  const controller=new AbortController();
  const result=await readLibraryRows(()=>{
    const builder={order:()=>builder,limit:()=>builder,then(resolve){
      resolve({data:[{id:'a'}]});
      queueMicrotask(()=>queueMicrotask(()=>queueMicrotask(()=>controller.abort())));
    }};return builder;
  },{signal:controller.signal});
  assert.equal(controller.signal.aborted,true);assert.equal(result.data,null);
  assert.equal(result.error.code,'LIBRARY_READ_ABORTED');
});

test('success and failure both detach the caller abort listener', async () => {
  for(const fail of [false,true]) {
    const tracked=trackedAbort();
    const result=await readLibraryRows(()=>{
      if(fail)throw new Error('query failed');return query([{id:'a'}],[]);
    },{signal:tracked.signal});
    assert.equal(Boolean(result.error),fail);assert.equal(tracked.listeners.size,0);
  }
});

test('installed Supabase builder receives cancellation and immutable keyset query parameters', async () => {
  const tracked=trackedAbort();let started,requestSignal,requestUrl;
  const ready=new Promise(resolve=>{started=resolve;});
  const client=createClient('http://127.0.0.1:9','fixture-public-key',{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:async(url,init)=>{
      requestUrl=new URL(url);requestSignal=init.signal;started();
      return new Promise((_resolve,reject)=>{init.signal.addEventListener('abort',()=>reject(new Error('fixture aborted')),{once:true});});
    }},
  });
  const read=readLibraryRows(()=>client.from('documents').select('id'),{signal:tracked.signal});
  await ready;assert.equal(requestUrl.searchParams.get('order'),'id.asc');assert.equal(requestUrl.searchParams.get('limit'),'500');
  tracked.controller.abort();assert.equal((await read).error.code,'LIBRARY_READ_ABORTED');
  assert.equal(requestSignal.aborted,true);assert.equal(tracked.listeners.size,0);
});
