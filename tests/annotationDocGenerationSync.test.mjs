import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { IDBFactory } from 'fake-indexeddb';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import { openAnnotationDoc } from '../src/services/annotationDocSync.js';
import { META_MAP } from '../src/services/annotationDocStore.js';
import { createAnnotationOutbox, annotationOutboxRecordKey } from '../src/services/annotationDocOutbox.js';
import { purgeYDocsByPrefix } from '../src/lib/collab/ydocRegistry.js';

const id=n=>`82000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const A=id(1),B=id(2),actor=id(3);
const hex=bytes=>'\\x'+Buffer.from(bytes).toString('hex');
const hash=bytes=>createHash('sha256').update(Buffer.from(bytes.slice(2),'hex')).digest('hex');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await tick();}assert.fail('bounded async condition not reached');}
function signal(f,{head=f.remote.scope(A).head,wake=1,epoch=0,generation=A}={}){
  f.remote.channels[0].handlers[0].cb({new:{document_id:f.documentId,generation_id:generation,
    last_seq:String(head),wake_revision:String(wake),snapshot_writer_epoch:String(epoch)}});
}
function addRemote(f,key,value){const doc=new Y.Doc();doc.getMap(META_MAP).set(key,value);
  const s=f.remote.scope(A);s.rows.push({seq:String(++s.head),data:hex(Y.encodeStateAsUpdate(doc)),client_id:'peer',client_seq:String(s.head),actor_user_id:actor});doc.destroy();}
function causalFixture() {
  const doc=new Y.Doc(),updates=[];doc.on('update',u=>updates.push(u));
  doc.getMap(META_MAP).set('predecessor','needed');
  doc.getMap(META_MAP).set('dependent','complete');
  const complete=Y.encodeStateAsUpdate(doc);
  doc.getMap(META_MAP).delete('dependent');doc.destroy();
  return {missing:updates[1],deleteOnly:updates[2],complete};
}
function privateMalformedUpdate() {
  const e=encoding.createEncoder();
  for(const value of [1,1,123,0])encoding.writeVarUint(e,value);
  encoding.writeUint8(e,2);encoding.writeVarUint(e,1);encoding.writeVarString(e,'meta');
  encoding.writeVarUint(e,1);encoding.writeVarString(e,'PRIVATE-SURVEY-SECRET');
  encoding.writeVarUint(e,0);return encoding.toUint8Array(e);
}
function backend(documentId) {
  const scopes=new Map(),calls=[],channels=[];
  let current=A,gate=null;
  const scope=g=>{if(!scopes.has(g))scopes.set(g,{head:0n,rows:[],snapshot:null});return scopes.get(g);};
  const client={
    from(){throw new Error('Generated handles must not use unscoped table requests');},
    async rpc(name,p){
      calls.push({name,p});assert.ok(name.endsWith('_v2'));assert.equal(p.p_document_id,documentId);
      const g=p.p_generation_id,s=scope(g),envelope={version:2,document_id:documentId,generation_id:g};
      if(current!==g)return{error:{code:'SG001',details:JSON.stringify({document_id:documentId,
        expected_generation_id:g,current_generation_id:current})}};
      let data;
      if(name==='read_annotation_writer_sequence_v2')data={client_id:p.p_client_id,client_seq:'0'};
      else if(name==='read_annotation_snapshot_v2')data={snapshot:s.snapshot,wal_head:String(s.head)};
      else if(name==='read_annotation_updates_v2'){
        const frontier=p.p_through_seq??String(s.head),eligible=s.rows.filter(r=>BigInt(r.seq)>BigInt(p.p_after_seq)&&BigInt(r.seq)<=BigInt(frontier));
        const rows=eligible.slice(0,1);data={rows,through_seq:frontier,has_more:eligible.length>rows.length};
      }else if(name==='append_annotation_update_v2'){
        const row={seq:String(++s.head),client_id:p.p_client_id,client_seq:p.p_client_seq,actor_user_id:actor,data:p.p_data};
        s.rows.push(row);
        if(gate){const wait=gate;gate=null;wait.entered.resolve();await wait.release.promise;}
        data={...row,accepted:true,data_sha256:hash(p.p_data),is_current:current===g,current_generation_id:current};
      }else if(name==='store_annotation_snapshot_v2'){
        s.snapshot={at_seq:p.p_at_seq,snapshot:p.p_snapshot,encoding_version:p.p_encoding_version,
          writer_id:p.p_writer_id,writer_epoch:p.p_writer_epoch};
        data={stored:true,at_seq:p.p_at_seq,writer_id:p.p_writer_id,writer_epoch:p.p_writer_epoch,
          snapshot_sha256:hash(p.p_snapshot),encoding_version:p.p_encoding_version};
      }else throw new Error(`Unexpected RPC ${name}`);
      return{data:{...envelope,...data},error:null};
    },
    channel(topic){const handlers=[];const ch={topic,handlers,on(_type,filter,cb){handlers.push({filter,cb});return ch;},
      subscribe(cb){ch.status=cb;return ch;}};channels.push(ch);return ch;},
    removeChannel:async()=>{},
  };
  return{client,calls,scope,channels,setCurrent:value=>current=value,
    holdAppend(){const wait={entered:deferred(),release:deferred()};gate=wait;return wait;}};
}
async function fixture(t,{realtime=false,local=false}={}){
  const documentId=crypto.randomUUID(),indexedDb=new IDBFactory(),remote=backend(documentId),handles=[],stores=[];
  t.after(async()=>{for(const h of handles)await h.destroy();for(const s of stores)await s.close();purgeYDocsByPrefix(`annoflat:${documentId}:`);});
  return{documentId,remote,indexedDb,async store(){const s=await createAnnotationOutbox({indexedDb});stores.push(s);return s;},
    async open(g,options={}){const s=await createAnnotationOutbox({indexedDb});stores.push(s);
      const h=await openAnnotationDoc({documentId,actorUserId:actor,pdfGenerationId:g,supabase:remote.client,
        writerId:'fixed-writer',enableLocal:local,enableRealtime:realtime,outboxStore:s,snapshotRetryDelayMs:0,...options});
      handles.push(h);return h;}};
}

test('two PDF generations isolate registry, accepted checkpoints, outbox keys and local receipts',async t=>{
  const f=await fixture(t),a=await f.open(A);a.setMeta('name','A');await a.drain();
  const receiptA=await a.flushLocalDurability();assert.equal(receiptA.pdfGenerationId,A);
  const legacyStore=await f.store(),legacyDoc=new Y.Doc();legacyDoc.getMap(META_MAP).set('legacy-only','do not adopt');
  const legacy={documentId:f.documentId,actorUserId:actor,writerId:'legacy',clientSeq:1,ordinal:1,incarnation:0,status:'pending',
    update:Y.encodeStateAsUpdate(legacyDoc)};legacy.key=annotationOutboxRecordKey(legacy);legacyDoc.destroy();await legacyStore.put(legacy);
  f.remote.setCurrent(B);const b=await f.open(B);assert.notEqual(a.doc,b.doc);assert.equal(b.getMeta('name'),undefined);
  assert.equal(b.getMeta('legacy-only'),undefined);assert.equal((await legacyStore.list(f.documentId,actor)).length,1);
  b.setMeta('name','B');await b.drain();const receiptB=await b.flushLocalDurability();
  assert.equal(receiptB.pdfGenerationId,B);assert.equal(b.isLocalReceiptCurrent(receiptA),false);
  assert.equal(a.getMeta('name'),'A');assert.equal(b.getMeta('name'),'B');
  const store=await f.store(),sa=await store.readLocalState(f.documentId,actor,0,{pdfGenerationId:A}),sb=await store.readLocalState(f.documentId,actor,0,{pdfGenerationId:B});
  assert.notDeepEqual(sa.checkpointUpdate,sb.checkpointUpdate);
  assert.notEqual(annotationOutboxRecordKey({documentId:f.documentId,actorUserId:actor,writerId:'fixed-writer',clientSeq:1,pdfGenerationId:A}),
    annotationOutboxRecordKey({documentId:f.documentId,actorUserId:actor,writerId:'fixed-writer',clientSeq:1,pdfGenerationId:B}));
});

test('generation change preserves queued edits in old scope and never repairs or snapshots them',async t=>{
  const f=await fixture(t),a=await f.open(A);f.remote.setCurrent(B);a.setMeta('old-edit','keep');
  await assert.rejects(a.drain(),e=>['SG001','ANNOTATION_PDF_GENERATION_RETIRED'].includes(e.code));
  assert.equal(a.getGenerationStatus().blocked,true);assert.throws(()=>a.setMeta('later','no'));
  const s=await f.store(),retired=await s.readRetiredScope(f.documentId,actor,0,{pdfGenerationId:A});
  assert.equal(retired.quarantined.length,1);assert.equal(retired.retirement.replacementGenerationId,B);
  assert.ok(!f.remote.calls.some(c=>c.name==='store_annotation_snapshot_v2'));
  const b=await f.open(B);assert.equal(b.getMeta('old-edit'),undefined);
  const count=f.remote.calls.length;await a.destroy();assert.equal(f.remote.calls.length,count,'retired close cannot replay cloud work');
});

test('append accepted before publication keeps exact late receipt only in its retired generation',async t=>{
  const f=await fixture(t),a=await f.open(A),wait=f.remote.holdAppend();a.setMeta('late','accepted');
  await wait.entered.promise;f.remote.setCurrent(B);await a.retireGeneration({replacementGenerationId:B});wait.release.resolve();
  await assert.rejects(a.drain());await a.destroy();
  const s=await f.store(),retired=await s.readRetiredScope(f.documentId,actor,0,{pdfGenerationId:A});
  assert.equal(retired.accepted.length,1);assert.equal(retired.accepted[0].seq,1);
  assert.equal(retired.quarantined.length,1);assert.ok(!f.remote.calls.some(c=>c.name==='store_annotation_snapshot_v2'));
});

test('metadata hints and reconnect use checked generation reads, never raw realtime bytes',async t=>{
  const f=await fixture(t,{realtime:true}),a=await f.open(A),ch=f.remote.channels[0];
  const poisoned=new Y.Doc();poisoned.getMap(META_MAP).set('poison','wrong generation');
  assert.deepEqual(ch.handlers.map(h=>h.filter),[{event:'*',schema:'public',table:'annotation_generation_signals',filter:`document_id=eq.${f.documentId}`}]);
  assert.ok(ch.topic.startsWith(`anno-generation-${f.documentId}-${A}-`));
  ch.handlers[0].cb({new:{seq:999,data:hex(Y.encodeStateAsUpdate(poisoned))}});poisoned.destroy();
  await a.drain();assert.equal(a.getMeta('poison'),undefined);
  f.remote.setCurrent(B);ch.status('SUBSCRIBED');
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(a.getGenerationStatus().blocked,true);assert.throws(()=>a.setMeta('old','no'));
  assert.equal(ch.handlers.length,1);
});

test('generated cold reads follow short hasMore pages and retain bigint frontiers and epochs exactly',async t=>{
  const f=await fixture(t),s=f.remote.scope(A),base=9007199254740993n,doc=new Y.Doc();
  doc.getMap(META_MAP).set('baseline','yes');
  s.snapshot={snapshot:hex(Y.encodeStateAsUpdate(doc)),at_seq:String(base),encoding_version:1,writer_id:'old',writer_epoch:String(base)};
  for(let i=1;i<=2;i++){let update;const capture=u=>update=u;doc.on('update',capture);doc.getMap(META_MAP).set(`tail${i}`,i);doc.off('update',capture);
    s.rows.push({seq:String(base+BigInt(i)),data:hex(update),client_id:'peer',client_seq:String(i),actor_user_id:actor});}
  doc.destroy();s.head=base+2n;
  const a=await f.open(A);assert.equal(a.getMeta('tail1'),1);assert.equal(a.getMeta('tail2'),2);
  assert.equal(f.remote.calls.filter(c=>c.name==='read_annotation_updates_v2').length,2,'one-row page with hasMore must continue');
  assert.equal(await a.flushSnapshot(),true);
  const write=f.remote.calls.find(c=>c.name==='store_annotation_snapshot_v2').p;
  assert.equal(write.p_at_seq,String(base+2n));assert.equal(write.p_expected_at_seq,String(base));
  assert.equal(write.p_expected_writer_epoch,String(base));assert.equal(write.p_writer_epoch,String(base+1n));
});

test('ordinary generated close drains its accepted edit and writes only the scoped final checkpoint',async t=>{
  const f=await fixture(t),a=await f.open(A);a.setMeta('close','save');await a.destroy();
  assert.equal(f.remote.calls.filter(c=>c.name==='append_annotation_update_v2').length,1);
  assert.equal(f.remote.calls.filter(c=>c.name==='store_annotation_snapshot_v2').length,1);
  assert.ok(f.remote.calls.every(c=>c.p.p_generation_id===A));
});

test('generated local persistence names differ and never load actorless legacy candidates',async t=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'indexedDB');
  Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:new IDBFactory()});
  t.after(()=>{if(original)Object.defineProperty(globalThis,'indexedDB',original);else delete globalThis.indexedDB;});
  const f=await fixture(t,{local:true}),names=[];
  const options={localPersistenceFactory:async name=>{names.push(name);return{synced:true,destroy(){}};},
    legacyPersistenceFactory:()=>{throw new Error('Generated scope must never load legacy persistence');}};
  await f.open(A,options);f.remote.setCurrent(B);await f.open(B,options);
  assert.equal(names.length,2);assert.notEqual(names[0],names[1]);assert.ok(names[0].includes(A));assert.ok(names[1].includes(B));
});

test('retirement in another IDB connection blocks a new dispatch and survives a cold open',async t=>{
  const f=await fixture(t),a=await f.open(A),other=await f.store();
  await other.retireScope(f.documentId,actor,0,{pdfGenerationId:A,replacementGenerationId:B,reason:'cloud-generation-replaced'});
  const before=f.remote.calls.length;
  assert.equal(await a.flushSnapshot(),false);assert.equal(a.getGenerationStatus().blocked,true);
  assert.equal(f.remote.calls.length,before,'local retirement guard must run before RPC dispatch');
  await a.destroy();
  await assert.rejects(f.open(A),{code:'ANNOTATION_PDF_GENERATION_RETIRED'});
  f.remote.setCurrent(B);const b=await f.open(B);assert.equal(b.pdfGenerationId,B);
});

test('failed durable retirement stays blocked and keeps pending bytes until exact retirement can retry',async t=>{
  const f=await fixture(t),store=await f.store(),retire=store.retireScope.bind(store);
  const a=await f.open(A,{outboxStore:store}),wait=f.remote.holdAppend();a.setMeta('keep','pending');await wait.entered.promise;
  store.retireScope=async()=>{throw new Error('fixture storage transaction failed');};
  await assert.rejects(a.retireGeneration({replacementGenerationId:B}),/storage transaction failed/);
  assert.equal(a.getGenerationStatus().blocked,true);assert.throws(()=>a.setMeta('no','no'));
  const other=await f.store();assert.equal((await other.list(f.documentId,actor,{pdfGenerationId:A})).length,1);
  store.retireScope=retire;await a.retireGeneration({replacementGenerationId:B});
  f.remote.setCurrent(B);wait.release.resolve();await assert.rejects(a.drain());await a.destroy();
  const saved=await other.readRetiredScope(f.documentId,actor,0,{pdfGenerationId:A});
  assert.equal(saved.accepted.length,1);assert.equal(saved.quarantined.length,1);
});

test('missing generation RPC or durable journal fails closed before any cloud request',async()=>{
  const documentId=crypto.randomUUID(),remote=backend(documentId);
  await assert.rejects(openAnnotationDoc({documentId,actorUserId:actor,pdfGenerationId:A,supabase:{},enableLocal:false}),/checked RPC/);
  await assert.rejects(openAnnotationDoc({documentId,actorUserId:actor,pdfGenerationId:A,supabase:remote.client,enableLocal:false}),
    {code:'ANNOTATION_LOCAL_STORAGE_UNAVAILABLE'});
  assert.equal(remote.calls.length,0);purgeYDocsByPrefix(`annoflat:${documentId}:`);
});

test('first publication preserves an in-flight legacy/null append receipt without reassigning its key',async t=>{
  const documentId=crypto.randomUUID(),indexedDb=new IDBFactory(),store=await createAnnotationOutbox({indexedDb}),other=await createAnnotationOutbox({indexedDb});
  const entered=deferred(),release=deferred(),calls=[];
  const client={from(){const query={select:()=>query,eq:()=>query,gt:()=>query,order:()=>query,limit:()=>query,
    maybeSingle:async()=>({data:null}),then:(resolve,reject)=>Promise.resolve({data:[]}).then(resolve,reject)};return query;},
    async rpc(name){calls.push(name);assert.equal(name,'append_annotation_update');entered.resolve();await release.promise;return{data:[{seq:1}]};}};
  const a=await openAnnotationDoc({documentId,actorUserId:actor,supabase:client,outboxStore:store,enableLocal:false,enableRealtime:false});
  t.after(async()=>{await a.destroy();await other.close();purgeYDocsByPrefix(`annoflat:${documentId}:`);});
  a.setMeta('legacy','saved');await entered.promise;await a.retireGeneration({replacementGenerationId:A});release.resolve();await a.destroy();
  const saved=await other.readRetiredScope(documentId,actor,0,{pdfGenerationId:null});
  assert.equal(saved.accepted.length,1);assert.equal(saved.accepted[0].seq,1);assert.equal(saved.accepted[0].pdfGenerationId,undefined);
  assert.equal(saved.accepted[0].key,[documentId,actor,a.writerId,1].join('\0'));assert.deepEqual(calls,['append_annotation_update']);
});

test('SG002 without a verified successor blocks writes but never guesses a retirement target or deletes evidence',async t=>{
  const f=await fixture(t),a=await f.open(A),rpc=f.remote.client.rpc;
  f.remote.client.rpc=async(name,p)=>name==='append_annotation_update_v2'?{error:{code:'SG002'}}:rpc(name,p);
  a.setMeta('unknown-successor','keep');await assert.rejects(a.drain());
  assert.equal(a.getGenerationStatus().blocked,true);assert.equal(a.getGenerationStatus().retirement,null);
  const store=await f.store();assert.equal((await store.list(f.documentId,actor,{pdfGenerationId:A})).length,1);
  assert.ok(!f.remote.calls.some(c=>c.name==='store_annotation_snapshot_v2'));
});

test('covered generated prefixes do not replay rows or download snapshots for own append echoes',async t=>{
  const f=await fixture(t,{realtime:true}),a=await f.open(A);
  addRemote(f,'remote1','one');signal(f);await until(()=>a.getMeta('remote1')==='one');await a.drain();
  const before=f.remote.calls.length;signal(f);signal(f,{wake:2});await tick();await a.drain();
  assert.equal(f.remote.calls.length,before,'duplicate or already-covered metadata does not fetch');
  addRemote(f,'remote2','two');signal(f,{wake:3});await until(()=>a.getMeta('remote2')==='two');await a.drain();
  const reads=f.remote.calls.filter(c=>c.name==='read_annotation_updates_v2');
  assert.deepEqual(reads.map(c=>c.p.p_after_seq),['0','0','1']);
  a.setMeta('own','edit');await a.drain();const afterOwn=f.remote.calls.length;signal(f,{wake:4});await tick();await a.drain();
  assert.equal(f.remote.calls.length,afterOwn);
  assert.equal(f.remote.calls.filter(c=>c.name==='read_annotation_snapshot_v2').length,1);
});

test('burst hints coalesce one in-flight tail and preserve a stronger snapshot refresh',async t=>{
  const f=await fixture(t,{realtime:true}),a=await f.open(A),rpc=f.remote.client.rpc,entered=deferred(),release=deferred();
  let gated=true;
  f.remote.client.rpc=async(name,p)=>{const response=await rpc(name,p);
    if(gated&&name==='read_annotation_updates_v2'){gated=false;entered.resolve();await release.promise;}return response;};
  addRemote(f,'tail','one');signal(f);await entered.promise;
  const checkpoint=new Y.Doc();checkpoint.getMap(META_MAP).set('snapshot-only','yes');
  f.remote.scope(A).snapshot={snapshot:hex(Y.encodeStateAsUpdate(checkpoint)),at_seq:'0',encoding_version:1,writer_id:'peer',writer_epoch:'1'};checkpoint.destroy();
  for(let i=2;i<30;i++)signal(f,{wake:i,epoch:1});
  release.resolve();await until(()=>a.getMeta('snapshot-only')==='yes');await a.drain();
  assert.equal(a.getMeta('tail'),'one');
  assert.equal(f.remote.calls.filter(c=>c.name==='read_annotation_snapshot_v2').length,2);
  assert.equal(f.remote.calls.filter(c=>c.name==='read_annotation_updates_v2').length,3,'cold, active tail, one refresh tail');
});

test('same-head snapshot wake merges remote fields without dropping a pending local edit',async t=>{
  const f=await fixture(t,{realtime:true}),a=await f.open(A),gate=f.remote.holdAppend();
  a.setMeta('pending-local','keep');await gate.entered.promise;
  const checkpoint=new Y.Doc();checkpoint.getMap(META_MAP).set('remote-snapshot','keep-too');
  f.remote.scope(A).snapshot={snapshot:hex(Y.encodeStateAsUpdate(checkpoint)),at_seq:'0',encoding_version:1,writer_id:'peer',writer_epoch:'1'};checkpoint.destroy();
  signal(f,{head:0,epoch:1});await until(()=>a.getMeta('remote-snapshot')==='keep-too');
  assert.equal(a.getMeta('pending-local'),'keep');gate.release.resolve();await a.drain();
  assert.equal(a.getMeta('pending-local'),'keep');assert.equal(a.getMeta('remote-snapshot'),'keep-too');
  const before=f.remote.calls.length;signal(f,{head:1,epoch:1});await tick();await a.drain();assert.equal(f.remote.calls.length,before);
});

test('unsafe or missing metadata takes a checked full refresh and reconnect always rechecks',async t=>{
  const f=await fixture(t,{realtime:true}),a=await f.open(A),ch=f.remote.channels[0];
  ch.handlers[0].cb({new:{document_id:f.documentId,generation_id:A,last_seq:9007199254740992,wake_revision:'1',snapshot_writer_epoch:'0'}});
  await until(()=>f.remote.calls.filter(c=>c.name==='read_annotation_snapshot_v2').length===2);
  await ch.status('SUBSCRIBED');assert.equal(f.remote.calls.filter(c=>c.name==='read_annotation_snapshot_v2').length,3);
});

test('a supplied Y.Doc cannot bridge generations or actors and unknown populated docs cannot enter a generation',async t=>{
  const f=await fixture(t),doc=new Y.Doc(),a=await f.open(A,{doc});a.setMeta('private','A');await a.drain();
  f.remote.setCurrent(B);const before=f.remote.calls.length;
  await assert.rejects(f.open(B,{doc}),{code:'ANNOTATION_DOC_SCOPE_MISMATCH'});
  await assert.rejects(f.open(A,{doc,actorUserId:id(99)}),{code:'ANNOTATION_DOC_SCOPE_MISMATCH'});
  await assert.rejects(f.open(null,{doc,supabase:null}),{code:'ANNOTATION_DOC_SCOPE_MISMATCH'});
  assert.equal(f.remote.calls.length,before);assert.equal(a.getMeta('private'),'A');
  const unknown=new Y.Doc();unknown.getMap(META_MAP).set('untrusted','old');
  await assert.rejects(f.open(B,{doc:unknown}),{code:'ANNOTATION_DOC_SCOPE_MISMATCH'});
  assert.equal(unknown.getMap(META_MAP).get('untrusted'),'old');unknown.destroy();
  await a.retireGeneration({replacementGenerationId:B});
});

test('a generation cannot adopt a caller-supplied Y.Doc already bound to a legacy/null scope',async t=>{
  const f=await fixture(t),doc=new Y.Doc();
  await f.open(null,{doc,supabase:null});const before=f.remote.calls.length;
  await assert.rejects(f.open(A,{doc}),{code:'ANNOTATION_DOC_SCOPE_MISMATCH'});
  assert.equal(f.remote.calls.length,before);
});

test('a failed metadata read reports unhealthy, preserves the covered frontier and retries the same hint',async t=>{
  const f=await fixture(t,{realtime:true}),a=await f.open(A),ch=f.remote.channels[0];await ch.status('SUBSCRIBED');
  const statuses=[];a.onSyncStatus(s=>statuses.push(s));const rpc=f.remote.client.rpc;let fail=true;
  f.remote.client.rpc=async(name,p)=>fail&&name==='read_annotation_updates_v2'
    ?{error:{code:'NETWORK_ERROR',message:'fixture unavailable'}}:rpc(name,p);
  addRemote(f,'retry','saved');signal(f);await until(()=>statuses.some(s=>s.healthy===false));
  assert.equal(a.getMeta('retry'),undefined);
  a.setMeta('own-while-read-failed','saved');await a.drain();
  assert.equal(statuses.at(-1)?.healthy,false,'an own receipt cannot hide an unresolved peer read failure');
  const beforeRetry=f.remote.calls.length;fail=false;signal(f);
  await until(()=>a.getMeta('retry')==='saved'&&statuses.at(-1)?.healthy===true);
  assert.equal(f.remote.calls.slice(beforeRetry).find(c=>c.name==='read_annotation_updates_v2').p.p_after_seq,'0',
    'own seq=2 cannot skip the unobserved seq=1 prefix');
});

test('a delayed hinted read cannot mark a CLOSED channel healthy',async t=>{
  const f=await fixture(t,{realtime:true}),a=await f.open(A),ch=f.remote.channels[0];await ch.status('SUBSCRIBED');
  const statuses=[];a.onSyncStatus(s=>statuses.push(s));const rpc=f.remote.client.rpc,entered=deferred(),release=deferred();
  f.remote.client.rpc=async(name,p)=>{const response=await rpc(name,p);if(name==='read_annotation_updates_v2'){entered.resolve();await release.promise;}return response;};
  addRemote(f,'while-closed','saved');signal(f);await entered.promise;ch.status('CLOSED');release.resolve();
  await until(()=>a.getMeta('while-closed')==='saved');await tick();
  assert.equal(statuses.at(-1)?.healthy,false);assert.ok(!statuses.some(s=>s.healthy));
});

test('an own receipt during hinted catch-up cannot restore CLOSED health before checked reconnect',async t=>{
  const f=await fixture(t,{realtime:true}),a=await f.open(A),ch=f.remote.channels[0];await ch.status('SUBSCRIBED');
  const statuses=[];a.onSyncStatus(s=>statuses.push(s));const append=f.remote.holdAppend();
  a.setMeta('own-late','saved');await append.entered.promise;
  const rpc=f.remote.client.rpc,readEntered=deferred(),readRelease=deferred();let gated=true;
  f.remote.client.rpc=async(name,p)=>{const response=await rpc(name,p);
    if(gated&&name==='read_annotation_updates_v2'){gated=false;readEntered.resolve();await readRelease.promise;}return response;};
  signal(f);await readEntered.promise;statuses.length=0;ch.status('CLOSED');readRelease.resolve();append.release.resolve();
  await a.drain();await tick();
  assert.equal(statuses.at(-1)?.healthy,false);assert.ok(!statuses.some(s=>s.healthy));
  await ch.status('SUBSCRIBED');assert.equal(statuses.at(-1)?.healthy,true);
  assert.equal(a.getMeta('own-late'),'saved');
});

test('generated cold snapshots reject unresolved struct and delete dependencies',async t=>{
  for(const kind of ['missing','deleteOnly']) {
    const f=await fixture(t),s=f.remote.scope(A),bytes=causalFixture()[kind];
    s.snapshot={snapshot:hex(bytes),at_seq:'0',encoding_version:1,writer_id:'peer',writer_epoch:'0'};
    await assert.rejects(f.open(A),{code:'ANNOTATION_GENERATION_STATE'});
    assert.ok(!f.remote.calls.some(c=>c.name==='store_annotation_snapshot_v2'));
  }
});

test('a complete WAL frontier cannot hide a causally incomplete generated tail',async t=>{
  const f=await fixture(t),s=f.remote.scope(A);addRemote(f,'first','not exposed');
  s.rows.push({seq:String(++s.head),data:hex(causalFixture().missing),client_id:'peer',client_seq:'2',actor_user_id:actor});
  await assert.rejects(f.open(A),{code:'ANNOTATION_GENERATION_STATE'});
  assert.ok(!f.remote.calls.some(c=>c.name==='store_annotation_snapshot_v2'));
});

test('generated catch-up stages a whole checked tail before exposing or persisting any row',async t=>{
  const f=await fixture(t,{realtime:true}),a=await f.open(A),ch=f.remote.channels[0];await ch.status('SUBSCRIBED');
  a.setMeta('own','kept');await a.drain();
  addRemote(f,'first','peer');const s=f.remote.scope(A),causal=causalFixture();
  s.rows.push({seq:String(++s.head),data:hex(causal.missing),client_id:'peer',client_seq:'3',actor_user_id:actor});
  const before=f.remote.calls.length;signal(f);
  await until(()=>a.getSyncStatus().healthy===false);
  assert.equal(a.getMeta('first'),undefined,'a valid early row must stay detached until the whole tail verifies');
  assert.equal(a.getMeta('own'),'kept');assert.equal(a.doc.store.pendingStructs,null);
  const store=await f.store(),clean=await store.loadCleanState(f.documentId,actor,{pdfGenerationId:A});
  const cached=new Y.Doc();
  if(clean?.checkpointUpdate)Y.applyUpdate(cached,clean.checkpointUpdate);
  for(const row of clean?.records||[])Y.applyUpdate(cached,row.update);
  assert.equal(cached.getMap(META_MAP).get('first'),undefined);cached.destroy();
  s.rows.at(-1).data=hex(causal.complete);signal(f);
  await until(()=>a.getMeta('dependent')==='complete'&&a.getSyncStatus().healthy===true);
  assert.equal(a.getMeta('first'),'peer');assert.equal(a.getMeta('own'),'kept');
  const reads=f.remote.calls.slice(before).filter(c=>c.name==='read_annotation_updates_v2');
  assert.equal(reads[0].p.p_after_seq,'1');assert.equal(reads[2].p.p_after_seq,'1','retry must start at the prior covered prefix');
});

test('a later failed page leaves even valid earlier peer rows uninstalled and retries the same prefix',async t=>{
  const f=await fixture(t,{realtime:true}),a=await f.open(A),ch=f.remote.channels[0];await ch.status('SUBSCRIBED');
  addRemote(f,'first','one');addRemote(f,'second','two');
  const rpc=f.remote.client.rpc;let failed=true;
  f.remote.client.rpc=(name,p)=>failed&&name==='read_annotation_updates_v2'&&p.p_after_seq==='1'
    ?Promise.resolve({error:{code:'ETIMEDOUT'}}):rpc(name,p);
  signal(f);await until(()=>!a.getSyncStatus().healthy);
  assert.equal(a.getMeta('first'),undefined);assert.equal(a.getMeta('second'),undefined);
  failed=false;const start=f.remote.calls.length;signal(f);
  await until(()=>a.getSyncStatus().healthy&&a.getMeta('second')==='two');
  assert.equal(a.getMeta('first'),'one');
  assert.equal(f.remote.calls.slice(start).find(c=>c.name==='read_annotation_updates_v2').p.p_after_seq,'0');
});

test('dependencies resolved by a later row in the same fixed tail remain valid',async t=>{
  const f=await fixture(t,{realtime:true}),a=await f.open(A),ch=f.remote.channels[0];await ch.status('SUBSCRIBED');
  const s=f.remote.scope(A),causal=causalFixture();
  for(const bytes of [causal.missing,causal.complete])s.rows.push({seq:String(++s.head),data:hex(bytes),client_id:'peer',client_seq:String(s.head),actor_user_id:actor});
  signal(f);await until(()=>a.getMeta('dependent')==='complete');
  assert.equal(a.getMeta('predecessor'),'needed');assert.equal(a.getSyncStatus().healthy,true);
});

test('generated snapshot decoding accepts real gzip but bounds its expanded bytes',async t=>{
  const f=await fixture(t),s=f.remote.scope(A),causal=causalFixture();
  s.snapshot={snapshot:hex(gzipSync(causal.complete)),at_seq:'0',encoding_version:2,writer_id:'peer',writer_epoch:'0'};
  const a=await f.open(A);assert.equal(a.getMeta('dependent'),'complete');
  const oversized=await fixture(t),os=oversized.remote.scope(A);
  os.snapshot={...s.snapshot,snapshot:hex(gzipSync(Buffer.alloc(64*1024*1024+1)))};
  await assert.rejects(oversized.open(A),{code:'ANNOTATION_GENERATION_LIMIT'});
});

test('generated tails stop at a fixed page bound without exposing a partial document',async t=>{
  const f=await fixture(t),s=f.remote.scope(A);
  for(let i=1;i<=1001;i++)s.rows.push({seq:String(i),data:'\\x0000',client_id:'peer',client_seq:String(i),actor_user_id:actor});
  s.head=1001n;
  await assert.rejects(f.open(A),{code:'ANNOTATION_GENERATION_LIMIT'});
  assert.equal(f.remote.calls.filter(c=>c.name==='read_annotation_updates_v2').length,1000);
  assert.ok(!f.remote.calls.some(c=>c.name==='store_annotation_snapshot_v2'));
});

test('corrupt generated Yjs content never enters cold-open or catch-up diagnostics',async t=>{
  const cold=await fixture(t),bytes=privateMalformedUpdate();
  cold.remote.scope(A).snapshot={snapshot:hex(bytes),at_seq:'0',encoding_version:1,writer_id:'peer',writer_epoch:'0'};
  await assert.rejects(cold.open(A),error=>error.code==='ANNOTATION_GENERATION_STATE'
    &&!error.message.includes('PRIVATE')&&!error.cause);
  const f=await fixture(t,{realtime:true}),a=await f.open(A),ch=f.remote.channels[0];await ch.status('SUBSCRIBED');
  addRemote(f,'first','kept detached');const s=f.remote.scope(A);
  s.rows.push({seq:String(++s.head),data:hex(bytes),client_id:'peer',client_seq:'2',actor_user_id:actor});
  const warn=console.warn,messages=[];console.warn=(...args)=>messages.push(args.join(' '));
  try { signal(f);await until(()=>!a.getSyncStatus().healthy); }
  finally { console.warn=warn; }
  assert.equal(a.getMeta('first'),undefined);
  assert.ok(!JSON.stringify(a.getSyncStatus()).includes('PRIVATE'));
  assert.ok(!messages.join(' ').includes('PRIVATE'));
});
