import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { handleDocumentGenerationUpload, hashGenerationUploadStream } from '../supabase/functions/document-generation-upload/handler.js';

const id = n => `80000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor = id(1), operationId = id(2), documentId = id(3), generationId = id(4), owner = id(5), claimId = id(6);
const token = 'private-bearer-token';
const bytes = new TextEncoder().encode('%PDF-1.7\nverified full body\n%%EOF');
const sha = value => createHash('sha256').update(value).digest('hex');
const object = () => ({ id:id(7), version:id(8), byte_length:String(bytes.length) });
const descriptor = overrides => ({ version:1, actor_user_id:actor, operation_id:operationId, document_id:documentId,
  generation_id:generationId, owner_user_id:owner, content_sha256:sha(bytes), byte_length:String(bytes.length),
  source_sql_sha256:'a'.repeat(64), path:`${owner}/_generations/${documentId}/${generationId}/${operationId}.pdf`,
  expires_at:'2026-09-09T12:00:00.000Z', state:'reserved', verified_at:null, rejection:null, object:null, ...overrides });
const verified = overrides => descriptor({ state:'verified', object:object(), verified_at:'2026-09-09T11:00:00.000Z', ...overrides });
const wrongBytes = new Uint8Array(bytes.length).fill(65);
const rejection = overrides => ({ reason:'sha256_mismatch',observed_sha256:sha(wrongBytes),byte_length:String(bytes.length),
  object:{id:object().id,version:object().version},rejected_at:'2026-09-09T11:00:00.000Z',...overrides });
const rejected = overrides => descriptor({state:'rejected',object:object(),rejection:rejection(),...overrides});
const input = (action = 'begin', overrides = {}) => ({ action, operation_id:operationId,
  ...(action === 'begin' ? { document_id:documentId, content_sha256:sha(bytes), byte_length:String(bytes.length) } : {}), ...overrides });
const stream = (value = bytes, width = 3, observation = {}) => {
  let offset = 0;
  return new ReadableStream({
    pull(controller) { observation.reads = (observation.reads || 0) + 1;
      if (offset === value.length) controller.close();
      else { controller.enqueue(value.slice(offset, offset + width)); offset = Math.min(value.length, offset + width); }
    },
    cancel() { observation.canceled = true; },
  });
};
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(overrides = {}) {
  const calls = [];
  const defaults = {
    enabled:true, timeoutMs:2000, newId:() => claimId,
    getUser:async () => ({ id:actor }), begin:async () => descriptor(), get:async () => descriptor(),
    mint:async path => ({ path, token:'private-upload-token', signedUrl:'https://storage.invalid/signed?token=private-upload-token' }),
    cancel:async () => descriptor({ state:'canceled' }),
    claim:async () => descriptor({ object:object(), verification_claim_id:claimId }),
    openStream:async () => stream(), record:async () => verified(), reject:async () => rejected(), release:async () => ({ released:true }),
    ...overrides,
  };
  const deps = Object.fromEntries(Object.entries(defaults).map(([name,value]) => [name, typeof value === 'function'
    ? (...args) => { calls.push({ name,args }); return value(...args); } : value]));
  return { calls, deps,
    async run(body = input(), { signal, authorization = `Bearer ${token}`, method = 'POST', raw } = {}) {
      const request = new Request('https://edge.invalid/document-generation-upload', { method, signal,
        headers:authorization == null ? {} : { Authorization:authorization },
        ...(method === 'POST' ? { body:raw ?? JSON.stringify(body) } : {}) });
      const response = await handleDocumentGenerationUpload(request,deps);
      return { status:response.status, headers:response.headers, body:response.status === 204 ? null : await response.json() };
    },
  };
}
const names = h => h.calls.map(call => call.name);
const error = (result, code, status) => {
  assert.equal(result.body.error.code,code); if (status) assert.equal(result.status,status);
  const encoded = JSON.stringify(result.body);
  for (const secret of [token,'private-upload-token','SELECT secret','postgres://','service-key']) assert.ok(!encoded.includes(secret),secret);
};

test('begin reserves before mint, rechecks exact receipt and exposes no private lease fields', async () => {
  const h = harness({ get:async () => descriptor({ verification_claim_id:id(90), private_rpc_field:'service-key' }) });
  const result = await h.run(); assert.equal(result.status,200);
  assert.deepEqual(names(h),['getUser','begin','mint','get']);
  assert.equal(h.calls[0].args[0],token); assert.equal(h.calls[1].args[0],token);
  assert.deepEqual(h.calls[1].args[1],input()); assert.equal(h.calls[2].args[0],descriptor().path);
  assert.equal(h.calls[3].args[1],operationId); assert.equal(result.body.upload.path,descriptor().path);
  assert.equal(result.body.operation.owner_user_id,owner,'shared project actor need not own path');
  assert.equal(Object.hasOwn(result.body.operation,'verification_claim_id'),false);
  assert.equal(Object.hasOwn(result.body.operation,'private_rpc_field'),false);
  assert.equal(result.headers.get('Access-Control-Allow-Origin'),'*'); assert.equal(result.headers.get('Cache-Control'),'no-store');
});

test('preflight and unsupported methods perform no auth or provider work', async () => {
  const h = harness(); assert.equal((await h.run(null,{ method:'OPTIONS' })).status,204);
  assert.equal((await h.run(null,{ method:'GET' })).status,405); assert.deepEqual(names(h),[]);
});

test('public receipts strip private fields inside the RPC object on every success path', async () => {
  const secretObject = { ...object(), private_rpc_field:'service-key', nested:{ sql:'SELECT secret' } };
  for (const action of ['begin','get','verify','cancel']) {
    const receipt = verified({ object:secretObject, private_rpc_field:'service-key', verification_claim_id:claimId });
    const h = harness({ begin:async () => receipt, get:async () => receipt,
      cancel:async () => ({ ...receipt,state:'canceled' }) });
    const result = await h.run(input(action)); assert.equal(result.status,200);
    assert.deepEqual(result.body.operation.object,object());
    assert.ok(!JSON.stringify(result.body).includes('service-key'));
    assert.ok(!JSON.stringify(result.body).includes('SELECT secret'));
    assert.equal(Object.hasOwn(result.body.operation,'verification_claim_id'),false);
  }
});

test('disabled, rejected auth and malformed request never reserve or mint', async () => {
  const cases = [
    [{ enabled:false },input(),{},'unavailable'],
    [{},input(),{ authorization:null },'unauthorized'],
    [{},input(),{ authorization:'Bearer a b' },'unauthorized'],
    [{ getUser:async () => null },input(),{},'unauthorized'],
    [{ getUser:async () => ({ id:'not-a-user' }) },input(),{},'unauthorized'],
    [{},input(),{ raw:'{bad' },'invalid_request'],
    [{},[],{},'invalid_request'],
    [{},input('begin',{ unexpected:'payload' }),{},'invalid_request'],
    [{},input('get',{ document_id:documentId }),{},'invalid_request'],
    [{},input('unknown'),{},'invalid_request'],
    [{},input('begin',{ operation_id:'uuid' }),{},'invalid_request'],
    [{},input('begin',{ content_sha256:'A'.repeat(64) }),{},'invalid_request'],
    ...[0,'0','01','-1','1.1','9223372036854775808'].map(byte_length => [{},input('begin',{ byte_length }),{},'invalid_request']),
    [{},input(),{ raw:' '.repeat(8193) },'invalid_request'],
    [{},input(),{ raw:new Uint8Array([0xff,0xfe]) },'invalid_request'],
  ];
  for (const [deps,body,options,code] of cases) {
    const h = harness(deps); error(await h.run(body,options),code);
    assert.ok(names(h).every(name => name === 'getUser'),JSON.stringify(names(h)));
  }
});

test('reserve rejection or mismatched receipt cannot mint a signed upload', async () => {
  for (const change of [{ actor_user_id:id(99) },{ operation_id:id(99) },{ document_id:id(99) },
    { generation_id:'bad' },{ path:`${actor}/other.pdf` },{ content_sha256:'b'.repeat(64) },
    { byte_length:'1' },{ expires_at:'bad' },{ state:'unknown' },{ object:{ id:'bad',version:null,byte_length:null } }]) {
    const h = harness({ begin:async () => descriptor(change) }); error(await h.run(),'invalid_receipt',502);
    assert.ok(!names(h).includes('mint'));
  }
  const h = harness({ begin:async () => { throw Object.assign(new Error('SELECT secret service-key'),{ code:'42501' }); } });
  error(await h.run(),'42501',403); assert.deepEqual(names(h),['getUser','begin']);
});

test('mint receipt mismatch, post-mint actor change, revoke and cancellation do not return upload authority', async () => {
  for (const deps of [
    { mint:async () => ({ path:'wrong',token:'private-upload-token',signedUrl:'private-upload-token' }) },
    { get:async () => descriptor({ actor_user_id:id(99) }) },
    { get:async () => descriptor({ source_sql_sha256:'b'.repeat(64) }) },
    { get:async () => { throw Object.assign(new Error('SELECT secret'),{ code:'42501' }); } },
    { get:async () => descriptor({ state:'canceled' }) },
  ]) {
    const h = harness(deps), result = await h.run(); assert.notEqual(result.status,200);
    assert.equal(Object.hasOwn(result.body,'upload'),false); error(result,result.body.error.code);
    assert.ok(!names(h).includes('openStream') && !names(h).includes('record'));
  }
});

test('existing upload or verified begin replay never mints; post-mint completed upload suppresses token', async () => {
  for (const receipt of [descriptor({ object:object() }),verified()]) {
    const h = harness({ begin:async () => receipt,get:async () => receipt });
    const result = await h.run(); assert.equal(result.status,200); assert.equal(result.body.upload,null);
    assert.ok(!names(h).includes('mint'));
  }
  const h = harness({ get:async () => descriptor({ object:object() }) });
  assert.equal((await h.run()).body.upload,null); assert.ok(names(h).includes('mint'));
});

test('get and cancel return exact scoped receipts without hash, download or upload calls', async () => {
  for (const action of ['get','cancel']) {
    const h = harness(); const result = await h.run(input(action)); assert.equal(result.status,200);
    assert.deepEqual(names(h),['getUser',action]);
  }
  const h = harness({ cancel:async () => descriptor() }); error(await h.run(input('cancel')),'invalid_receipt',502);
});

test('stream hash covers all real chunks, ignores boundaries and validates decimal size without metadata proof', async () => {
  for (const width of [1,3,bytes.length,bytes.length+5]) {
    assert.deepEqual(await hashGenerationUploadStream(stream(bytes,width),{ byteLength:String(bytes.length) }),
      { contentSha256:sha(bytes),byteLength:String(bytes.length) });
  }
  for (const byteLength of [undefined,'0','01','-2',bytes.length,'9223372036854775808']) {
    await assert.rejects(hashGenerationUploadStream(stream(),{ byteLength }),{ code:'invalid_object' });
  }
});

test('truncated, extra, absent, malformed and failed streams never produce a byte receipt', async () => {
  for (const [value,byteLength] of [[bytes.slice(0,-1),String(bytes.length)],[bytes,String(bytes.length-1)],
    [new Uint8Array(),String(bytes.length)]]) {
    await assert.rejects(hashGenerationUploadStream(stream(value),{ byteLength }),{ code:'byte_mismatch' });
  }
  await assert.rejects(hashGenerationUploadStream(null,{ byteLength:'1' }),{ code:'invalid_object' });
  await assert.rejects(hashGenerationUploadStream(new ReadableStream({ start(c) { c.enqueue('wrong');c.close(); } }),{ byteLength:'5' }),{ code:'invalid_object' });
  await assert.rejects(hashGenerationUploadStream(new ReadableStream({ start(c) { c.error(new Error('stream failed')); } }),{ byteLength:'5' }),/stream failed/);
});

test('verify obtains durable claim before stream and records exact full hash, size and object version', async () => {
  const h = harness(); const result = await h.run(input('verify')); assert.equal(result.status,200);
  assert.deepEqual(names(h),['getUser','get','newId','claim','openStream','record']);
  assert.deepEqual(h.calls.find(c => c.name === 'claim').args.slice(0,-1),[actor,operationId,claimId]);
  assert.deepEqual(h.calls.find(c => c.name === 'record').args.slice(0,-1),
    [actor,operationId,claimId,object().id,object().version,sha(bytes),String(bytes.length)]);
  assert.equal(result.body.operation.state,'verified'); assert.ok(!names(h).includes('release'));
});

test('busy durable claim prevents duplicate verification; verified replay skips download', async () => {
  let claimed = false; const opened = deferred();
  const h = harness({ claim:async () => {
    if (claimed) throw Object.assign(new Error('busy'),{ code:'40001' }); claimed=true;
    return descriptor({ object:object(),verification_claim_id:claimId });
  },openStream:async () => { opened.resolve(); return stream(); } });
  const [a,b] = await Promise.all([h.run(input('verify')),h.run(input('verify'))]);
  assert.deepEqual([a.status,b.status].sort(),[200,409]);
  assert.equal(h.calls.filter(c => c.name === 'openStream').length,1);
  assert.equal(h.calls.filter(c => c.name === 'record').length,1);
  for (const deps of [{ get:async () => verified() },{ claim:async () => verified() }]) {
    const retry = harness(deps); assert.equal((await retry.run(input('verify'))).status,200);
    assert.ok(!names(retry).includes('openStream')); assert.ok(!names(retry).includes('record'));
  }
});

test('bad object metadata or claim receipt cannot authorize download or release someone else’s claim', async () => {
  for (const change of [{ object:null },{ object:{ ...object(),version:null } },{ object:{ ...object(),byte_length:null } },
    { object:{ ...object(),byte_length:'1' } },{ verification_claim_id:id(99) },{ actor_user_id:id(99) },{ path:'wrong' }]) {
    const h = harness({ claim:async () => descriptor({ object:object(),verification_claim_id:claimId,...change }) });
    assert.notEqual((await h.run(input('verify'))).status,200);
    assert.ok(!names(h).includes('openStream')); assert.ok(!names(h).includes('release'));
  }
});

test('short, extra, malformed and failed streams release exact claim without terminal rejection', async () => {
  for (const openStream of [async () => stream(bytes.slice(0,-1)),async () => stream(new Uint8Array(bytes.length+1)),
    async () => null,async () => { throw new Error('SELECT secret service-key'); },
    async () => new ReadableStream({start(c){c.enqueue('malformed');c.close();}}),
    async () => new ReadableStream({start(c){c.error(Object.assign(new Error('not a proven hash mismatch'),{code:'byte_mismatch'}));}})]) {
    const h = harness({ openStream }); const result = await h.run(input('verify'));
    assert.notEqual(result.status,200); error(result,result.body.error.code);
    assert.ok(!names(h).includes('record')); assert.ok(!names(h).includes('reject'));
    assert.deepEqual(h.calls.find(c => c.name === 'release').args.slice(0,-1),[actor,operationId,claimId]);
  }
});

test('complete exact-size wrong hash records a terminal receipt and repeated verification never downloads again', async () => {
  let saved=null;
  const h=harness({get:async()=>saved||descriptor(),begin:async()=>saved||descriptor(),openStream:async()=>stream(wrongBytes),
    reject:async()=>saved=rejected()});
  const result=await h.run(input('verify'));error(result,'byte_mismatch',422);
  assert.equal(result.body.operation.state,'rejected');assert.deepEqual(result.body.operation.rejection,rejection());
  assert.deepEqual(h.calls.find(c=>c.name==='reject').args.slice(0,-1),
    [actor,operationId,claimId,object().id,object().version,sha(wrongBytes),String(bytes.length)]);
  error(await h.run(input('verify')),'byte_mismatch',422);
  for(const action of ['get','begin']) {
    const retry=await h.run(input(action));assert.equal(retry.status,200);assert.equal(retry.body.operation.state,'rejected');
    if(action==='begin')assert.equal(retry.body.upload,null);
  }
  for(const name of ['openStream','reject'])assert.equal(h.calls.filter(c=>c.name===name).length,1,name);
  for(const name of ['record','release','mint'])assert.ok(!names(h).includes(name),name);
});

test('already rejected claim skips bytes and nested rejection fields never expose private data',async()=>{
  const receipt=rejected({rejection:rejection({secret:token,object:{...rejection().object,private:'service-key'}})});
  const h=harness({claim:async()=>receipt});const result=await h.run(input('verify'));
  error(result,'byte_mismatch',422);assert.deepEqual(result.body.operation.rejection,rejection());
  assert.ok(!names(h).includes('openStream'));assert.ok(!names(h).includes('reject'));assert.ok(!names(h).includes('release'));
  const canceled=harness({cancel:async()=>({...receipt,state:'canceled',object:null})});
  const cancelResult=await canceled.run(input('cancel'));assert.equal(cancelResult.status,200);
  assert.deepEqual(cancelResult.body.operation.rejection,rejection(),'cancel retains historical negative receipt after object cleanup');
});

test('malformed or stale negative receipts cannot report a confirmed rejection or release an uncertain claim',async()=>{
  const bad=[{rejection:null},{rejection:rejection({reason:'size_mismatch'})},{rejection:rejection({observed_sha256:sha(bytes)})},
    {rejection:rejection({observed_sha256:'A'.repeat(64)})},{rejection:rejection({observed_sha256:'b'.repeat(64)})},
    {rejection:rejection({byte_length:'1'})},
    {rejection:rejection({rejected_at:'bad'})},{rejection:rejection({object:{id:object().id,version:id(99)}})},
    {object:{...object(),version:id(99)}},{object:{...object(),id:id(99)}},
    {object:{...object(),version:id(99)},rejection:rejection({object:{id:object().id,version:id(99)}})},
    {actor_user_id:id(99)},
    {state:'reserved'},{state:'verified',verified_at:'2026-09-09T11:00:00.000Z'}];
  for(const change of bad) {
    const h=harness({openStream:async()=>stream(wrongBytes),reject:async()=>rejected(change)});
    const result=await h.run(input('verify'));error(result,'invalid_receipt',502);
    assert.equal(result.body.operation,undefined);assert.ok(!names(h).includes('release'));assert.ok(!names(h).includes('record'));
  }
  for(const code of ['40001','42501','23514']) {
    const h=harness({openStream:async()=>stream(wrongBytes),reject:async()=>{throw Object.assign(new Error('SELECT secret'),{code});}});
    error(await h.run(input('verify')),code);assert.ok(!names(h).includes('release'));assert.ok(!names(h).includes('record'));
  }
});

test('lost rejection reply reconciles committed result without downloading or releasing again',async()=>{
  let saved=null;
  const h=harness({get:async()=>saved||descriptor(),openStream:async()=>stream(wrongBytes),reject:async()=>{
    saved=rejected();throw new Error('SELECT secret service-key');}});
  error(await h.run(input('verify')),'upload_unconfirmed',502);
  error(await h.run(input('verify')),'byte_mismatch',422);
  assert.equal(h.calls.filter(c=>c.name==='openStream').length,1);assert.equal(h.calls.filter(c=>c.name==='reject').length,1);
  assert.ok(!names(h).includes('release'));assert.ok(!names(h).includes('record'));
});

test('rejection timeout keeps its claim and never upgrades a late reply into confirmed response',async()=>{
  const gate=deferred(),h=harness({timeoutMs:15,openStream:async()=>stream(wrongBytes),reject:async()=>gate.promise});
  error(await h.run(input('verify')),'verification_pending',503);gate.resolve(rejected());await tick();
  assert.equal(h.calls.filter(c=>c.name==='reject').length,1);assert.ok(!names(h).includes('release'));assert.ok(!names(h).includes('record'));
});

test('wrong final object/receipt or lost record reply retains claim for reconciliation', async () => {
  for (const record of [async () => verified({ object:{ ...object(),version:id(99) } }),
    async () => verified({ object:{ ...object(),id:id(99) } }),async () => descriptor(),
    async () => verified({ byte_length:'1' }),async () => { throw new Error('postgres://service-key SELECT secret'); },
    async () => { throw Object.assign(new Error('revoked'),{ code:'42501' }); }]) {
    const h = harness({ record }), result = await h.run(input('verify'));
    assert.notEqual(result.status,200); error(result,result.body.error.code);
    assert.ok(names(h).includes('record')); assert.ok(!names(h).includes('release'));
  }
});

test('abort after mint starts prevents late get or returned signed token', async () => {
  const gate=deferred(), entered=deferred(), controller=new AbortController();
  const h=harness({ mint:async path => { entered.resolve(); await gate.promise; return { path,token:'private-upload-token',signedUrl:'private-upload-token' }; } });
  const pending=h.run(input(),{ signal:controller.signal }); await entered.promise; controller.abort();
  error(await pending,'verification_pending',503); gate.resolve(); await tick();
  assert.deepEqual(names(h),['getUser','begin','mint']);
});

test('timeout before reserve reply prevents late mint and timeout during bytes prevents record or release', async () => {
  const gate=deferred(); const before=harness({ timeoutMs:15,begin:async () => gate.promise });
  error(await before.run(),'verification_pending',503); gate.resolve(descriptor()); await tick();
  assert.ok(!names(before).includes('mint'));
  let canceled=false; const stalled=new ReadableStream({ pull() { return new Promise(() => {}); },cancel() { canceled=true;return new Promise(() => {}); } });
  const during=harness({ timeoutMs:15,openStream:async () => stalled });
  error(await during.run(input('verify')),'verification_pending',503); await tick();
  assert.equal(canceled,true); assert.ok(!names(during).includes('record')); assert.ok(!names(during).includes('release'));
});

test('lost record timeout never converts a late successful record into response success or a release', async () => {
  const gate=deferred(); const h=harness({ timeoutMs:15,record:async () => gate.promise });
  error(await h.run(input('verify')),'verification_pending',503); gate.resolve(verified()); await tick();
  assert.equal(h.calls.filter(c => c.name === 'record').length,1); assert.ok(!names(h).includes('release'));
});

test('request canceled before entry does no auth, mint, claim or record work', async () => {
  const controller=new AbortController();controller.abort();const h=harness();
  error(await h.run(input(),{ signal:controller.signal }),'verification_pending',503);assert.deepEqual(names(h),[]);
});

test('late stream opener that ignores abort cannot start byte proof or record', async () => {
  const entered=deferred(), gate=deferred(), controller=new AbortController();let readerRequests=0;
  const h=harness({ openStream:async () => { entered.resolve();return gate.promise; } });
  const pending=h.run(input('verify'),{ signal:controller.signal });await entered.promise;controller.abort();
  error(await pending,'verification_pending',503);
  gate.resolve({ getReader() { readerRequests++;throw new Error('late stream read'); } });await tick();
  assert.equal(readerRequests,0);assert.ok(!names(h).includes('record'));assert.ok(!names(h).includes('release'));
});

test('valid canonical UUID versions are kept exactly, never rewritten to a version-four identity', async () => {
  for (const version of ['1','5','7']) {
    const operation=id(2).replace('-4000-',`-${version}000-`);
    const receipt=descriptor({ operation_id:operation,
      path:`${owner}/_generations/${documentId}/${generationId}/${operation}.pdf` });
    const h=harness({ begin:async () => receipt,get:async () => receipt });
    const result=await h.run(input('begin',{ operation_id:operation }));
    assert.equal(result.status,200);assert.equal(result.body.operation.operation_id,operation);
    assert.equal(h.calls.find(call => call.name === 'mint').args[0],receipt.path);
  }
});
