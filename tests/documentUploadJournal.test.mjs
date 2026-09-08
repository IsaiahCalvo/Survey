import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, forceCloseDatabase } from 'fake-indexeddb';
import { createDocumentUploadJournal, DOCUMENT_UPLOAD_JOURNAL_DB_NAME } from '../src/services/documentUploadJournal.js';

const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=uuid(1),other=uuid(2),attempt=uuid(3),document=uuid(4),project=uuid(5),hash='a'.repeat(64);
const pdf=()=>new Blob(['%PDF-fixture'],{type:'application/pdf'});
const input=(owner=actor,changes={})=>({id:attempt,documentId:document,projectId:project,name:'plan.pdf',size:pdf().size,type:'application/pdf',lastModified:100,
  contentSha:hash,filePath:`${owner}/${document}/${hash}.pdf`,archiveDocument:null,...changes});
const target=(owner=actor,changes={})=>({id:document,user_id:owner,project_id:project,name:'plan.pdf',file_path:`${owner}/${document}/${hash}.pdf`,
  file_size:pdf().size,content_sha256:hash,updated_at:null,archived:false,user_archived_at:null,page_count:null,...changes});
function observedFactory(factory,observe) {
  return {open(...args){const request=factory.open(...args);request.addEventListener('success',()=>{
    const db=request.result,transaction=db.transaction.bind(db);
    db.transaction=(...parameters)=>{const tx=transaction(...parameters);observe(tx,parameters,db);return tx;};
  });return request;}};
}
async function raw(factory,names,mode,work) {
  const db=await new Promise((resolve,reject)=>{const request=factory.open(DOCUMENT_UPLOAD_JOURNAL_DB_NAME);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  try{return await new Promise((resolve,reject)=>{const tx=db.transaction(names,mode);let result;tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error);work(tx,value=>{result=value;});});}
  finally{db.close();}
}
async function complete(store,owner=actor) {
  await store.patch(owner,attempt,{phase:'running',target:target(owner)});
  await store.patch(owner,attempt,{phase:'document-confirmed',aliasName:null,aliasDecided:true});
  await store.patch(owner,attempt,{phase:'archive-confirmed'});
  return store.patch(owner,attempt,{phase:'complete'});
}

test('atomic create cold-reopens exact PDF and independent actor-scoped metadata',async()=>{
  const indexedDB=new IDBFactory(),store=createDocumentUploadJournal({indexedDB});
  const created=await store.create(actor,input(),pdf());
  assert.equal(created.version,1);assert.equal(created.revision,1);assert.equal(created.phase,'ready');
  assert.equal(created.target,null);assert.equal(created.aliasDecided,false);assert.equal(created.aliasName,null);
  await store.create(other,input(other),pdf());store.close();
  const cold=createDocumentUploadJournal({indexedDB});
  assert.deepEqual(await cold.get(actor,attempt),created);
  assert.equal(await(await cold.readFile(actor,attempt)).text(),'%PDF-fixture');
  assert.equal(await cold.readFile(actor,uuid(99)),null);
  await cold.discard(other,attempt);
  assert.equal(await cold.get(other,attempt),null);assert.equal((await cold.get(actor,attempt)).revision,1);
  await assert.rejects(cold.patch(other,attempt,{error:'foreign'}),{code:'not-found'});cold.close();
});

test('get/list/patch metadata cost never reads PDF records or Blob content',async()=>{
  const calls=[],store=createDocumentUploadJournal({indexedDB:observedFactory(new IDBFactory(),(_tx,args)=>calls.push(args))});
  await store.create(actor,input(),pdf());calls.length=0;
  const listed=await store.list(actor);await store.get(actor,attempt);await store.patch(actor,attempt,{error:'pending retry'});
  assert.equal(listed[0].blob,undefined);assert.deepEqual(calls,[[['attempts'],'readonly'],[['attempts'],'readonly'],[['attempts'],'readwrite']]);
  assert.deepEqual(await store.list(other),[]);store.close();
});

test('create snapshots caller metadata and native Blob truth before its first await',async()=>{
  const store=createDocumentUploadJournal({indexedDB:new IDBFactory()}),source=pdf(),data=input();
  Object.defineProperty(source,'size',{value:1});Object.defineProperty(source,'type',{value:'evil'});
  source.slice=()=>{throw Error('instance override');};source.arrayBuffer=()=>{throw Error('unneeded byte read');};
  const pending=store.create(actor,data,source);data.name='changed.pdf';data.documentId=uuid(88);
  const row=await pending;assert.equal(row.name,'plan.pdf');assert.equal(row.documentId,document);
  assert.equal((await store.readFile(actor,attempt)).size,pdf().size);
  const copy=await store.get(actor,attempt);copy.name='tamper';assert.equal((await store.get(actor,attempt)).name,'plan.pdf');store.close();
});

test('archive intent preserves a live owned legacy snapshot, nullable old size/hash, and immutable original input',async()=>{
  const store=createDocumentUploadJournal({indexedDB:new IDBFactory()});
  const archived=target(actor,{id:uuid(20),file_path:`${actor}/legacy.pdf`,file_size:null,content_sha256:null});
  delete archived.page_count;
  const pending=store.create(actor,input(actor,{archiveDocument:archived}),pdf());archived.name='after-call';
  assert.equal((await pending).archiveDocument.name,'plan.pdf');
  await assert.rejects(store.patch(actor,attempt,{archiveDocument:null}));
  const validArchive={...target(actor,{id:uuid(20)})};delete validArchive.page_count;
  for(const change of [{id:document},{user_id:other},{project_id:null},{archived:true},{user_archived_at:'2025-01-01'},{content_sha256:'bad'},{file_size:-1},{file_path:`${other}/foreign.pdf`}]) {
    await assert.rejects(store.create(actor,input(actor,{id:uuid(30),archiveDocument:{...validArchive,...change}}),pdf()));
  }
  store.close();
});

test('target binds once; refreshed same-row metadata may reflect edited published bytes',async()=>{
  const store=createDocumentUploadJournal({indexedDB:new IDBFactory()});await store.create(actor,input(),pdf());
  const existing=target(actor,{id:uuid(20),file_path:`${actor}/old-shared.pdf`,file_size:999,page_count:3,created_at:null});
  await store.patch(actor,attempt,{target:existing,phase:'running'});
  const updated={...existing,name:'renamed.pdf',file_size:null,page_count:7,name_aliases:['plan.pdf'],updated_at:'2026-09-08T00:00:00Z'};
  const pending=store.patch(actor,attempt,{target:updated});updated.name_aliases.push('caller-mutation');
  const result=await pending;assert.equal(result.target.file_size,null);assert.deepEqual(result.target.name_aliases,['plan.pdf']);
  for(const patch of [{target:null},{target:{...existing,id:uuid(21)}},{target:{...existing,file_path:`${actor}/changed.pdf`}},{target:{...existing,user_id:other}},
    {target:{...existing,project_id:null}},{target:{...existing,content_sha256:'b'.repeat(64)}}]) await assert.rejects(store.patch(actor,attempt,patch));
  assert.equal((await store.get(actor,attempt)).target.id,uuid(20));store.close();
});

test('phase and alias decisions are monotonic; finish requires separately committed archive confirmation',async()=>{
  const store=createDocumentUploadJournal({indexedDB:new IDBFactory()});await store.create(actor,input(),pdf());
  await assert.rejects(store.finish(actor,attempt),{code:'incomplete'});
  await assert.rejects(store.patch(actor,attempt,{phase:'document-confirmed'}));
  await store.patch(actor,attempt,{target:target(),phase:'document-confirmed',aliasName:'copy.pdf',aliasDecided:true});
  for(const patch of [{phase:'running'},{phase:'complete'},{aliasDecided:false},{aliasName:null},{aliasName:'other.pdf'}]) await assert.rejects(store.patch(actor,attempt,patch));
  await store.patch(actor,attempt,{phase:'archive-confirmed'});await store.patch(actor,attempt,{phase:'complete'});
  assert.equal(await store.finish(actor,attempt),true);assert.equal(await store.get(actor,attempt),null);assert.equal(await store.readFile(actor,attempt),null);store.close();
});

test('concurrent same-attempt patches serialize and reject conflicting first bindings',async()=>{
  const indexedDB=new IDBFactory(),a=createDocumentUploadJournal({indexedDB}),b=createDocumentUploadJournal({indexedDB});await a.create(actor,input(),pdf());
  await Promise.all([a.patch(actor,attempt,{phase:'running'}),b.patch(actor,attempt,{error:'retry'})]);
  assert.equal((await a.get(actor,attempt)).revision,3);
  const results=await Promise.allSettled([a.patch(actor,attempt,{target:target()}),b.patch(actor,attempt,{target:target(actor,{id:uuid(20)})})]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal((await a.get(actor,attempt)).revision,4);a.close();b.close();
});

test('invalid identities, paths, bytes and metadata produce no partial records',async()=>{
  const indexedDB=new IDBFactory(),store=createDocumentUploadJournal({indexedDB});
  for(const change of [{id:'bad'},{documentId:'UPPER'},{projectId:'bad'},{contentSha:'bad'},{name:'../escape.pdf'},{name:'\0bad'},{size:1},{type:'text/plain'},
    ...[`${other}/${document}/${hash}.pdf`,`${actor}/${hash}.pdf`,`${actor}/${project}/${hash}.pdf`,`${actor}/../${hash}.pdf`].map(filePath=>({filePath}))]) {
    await assert.rejects(store.create(actor,input(actor,change),pdf()));
  }
  await assert.rejects(store.create(actor,input(),{size:pdf().size,type:'application/pdf'}));
  assert.deepEqual(await store.list(actor),[]);
  await store.create(actor,input(),pdf());await assert.rejects(store.create(actor,input(),pdf()),{name:'ConstraintError'});
  assert.equal((await store.get(actor,attempt)).revision,1);store.close();
});

test('missing or corrupt persisted byte records fail closed while metadata remains available',async()=>{
  for(const stored of [null,{blob:new Blob(['bad'],{type:'application/pdf'})},{blob:{size:pdf().size,type:'application/pdf'}},{blob:pdf(),actorId:other}]) {
    const indexedDB=new IDBFactory(),store=createDocumentUploadJournal({indexedDB});await store.create(actor,input(),pdf());
    await raw(indexedDB,['files'],'readwrite',tx=>{const files=tx.objectStore('files');files.delete([actor,attempt]);if(stored) files.put({actorId:actor,id:attempt,...stored});});
    await assert.rejects(store.readFile(actor,attempt),{code:'corrupt'});assert.equal((await store.get(actor,attempt)).phase,'ready');store.close();
  }
});

test('all metadata reads reject persisted malformed identity/hash/target without deleting recovery data',async()=>{
  const indexedDB=new IDBFactory(),store=createDocumentUploadJournal({indexedDB});const created=await store.create(actor,input(),pdf());
  for(const change of [{contentSha:'broken'},{filePath:`${other}/x.pdf`},{target:target(other)},{phase:'complete'},{revision:0}]) {
    await raw(indexedDB,['attempts'],'readwrite',tx=>tx.objectStore('attempts').put({...created,...change}));
    for(const operation of [()=>store.get(actor,attempt),()=>store.list(actor),()=>store.readFile(actor,attempt)]) await assert.rejects(operation(),{code:'corrupt'});
  }
  const count=await raw(indexedDB,['files'],'readonly',(tx,done)=>{const req=tx.objectStore('files').count();req.onsuccess=()=>done(req.result);});assert.equal(count,1);store.close();
});

test('quota error after PDF add rolls back both stores and preserves other attempts',async()=>{
  const indexedDB=new IDBFactory();let failMetadata=false;
  const store=createDocumentUploadJournal({indexedDB:observedFactory(indexedDB,(tx,args)=>{
    if(!failMetadata || args[1]!=='readwrite')return;const get=tx.objectStore.bind(tx);
    tx.objectStore=name=>{const object=get(name);if(name==='attempts')object.add=()=>{throw new DOMException('full','QuotaExceededError');};return object;};
  })});
  await store.create(other,input(other),pdf());failMetadata=true;
  await assert.rejects(store.create(actor,input(),pdf()),{name:'QuotaExceededError'});
  assert.equal(await store.get(actor,attempt),null);assert.equal(await store.readFile(actor,attempt),null);
  assert.equal(await(await store.readFile(other,attempt)).text(),'%PDF-fixture');
  assert.equal(await raw(indexedDB,['files'],'readonly',(tx,done)=>{const req=tx.objectStore('files').count();req.onsuccess=()=>done(req.result);}),1);store.close();
});

test('request success followed by transaction abort never acknowledges create or removes earlier bytes',async()=>{
  const indexedDB=new IDBFactory();let abortCreate=false;
  const store=createDocumentUploadJournal({indexedDB:observedFactory(indexedDB,(tx,args)=>{
    if(!abortCreate || args[1]!=='readwrite')return;const get=tx.objectStore.bind(tx);
    tx.objectStore=name=>{const object=get(name);if(name==='attempts'){const add=object.add.bind(object);object.add=(...values)=>{const req=add(...values);req.addEventListener('success',()=>tx.abort());return req;};}return object;};
  })});
  await store.create(other,input(other),pdf());abortCreate=true;await assert.rejects(store.create(actor,input(),pdf()));
  assert.equal(await store.get(actor,attempt),null);assert.equal((await store.list(other)).length,1);store.close();
});

test('failed finish/discard cleanup is atomic; explicit discard touches only the selected local attempt',async()=>{
  let failDelete=false;const store=createDocumentUploadJournal({indexedDB:observedFactory(new IDBFactory(),(tx,args)=>{
    if(!failDelete || args[1]!=='readwrite')return;const get=tx.objectStore.bind(tx);
    tx.objectStore=name=>{const object=get(name);if(name==='attempts')object.delete=()=>{throw Error('interrupted cleanup');};return object;};
  })});
  await store.create(actor,input(),pdf());await store.create(other,input(other),pdf());await complete(store);failDelete=true;
  for(const method of ['finish','discard']){await assert.rejects(store[method](actor,attempt),/interrupted cleanup/);assert.equal(await(await store.readFile(actor,attempt)).text(),'%PDF-fixture');}
  assert.equal((await store.get(actor,attempt)).phase,'complete');failDelete=false;
  assert.equal(await store.discard(actor,attempt),true);assert.equal(await store.get(actor,attempt),null);assert.equal((await store.get(other,attempt)).phase,'ready');store.close();
});

test('unavailable/restricted/blocked/timed-out/wrong-schema opens never use a memory fallback',async()=>{
  await assert.rejects(createDocumentUploadJournal({indexedDB:null}).create(actor,input(),pdf()),{code:'unavailable'});
  await assert.rejects(createDocumentUploadJournal({indexedDB:{get open(){throw new DOMException('restricted','SecurityError');}}}).list(actor),{name:'SecurityError'});
  const stalled=createDocumentUploadJournal({indexedDB:{open:()=>({})},timeoutMs:5});await assert.rejects(stalled.list(actor),{code:'timed-out'});stalled.close();
  const blocked=createDocumentUploadJournal({indexedDB:{open:()=>{const request={};queueMicrotask(()=>request.onblocked());return request;}}});await assert.rejects(blocked.list(actor),{code:'blocked'});blocked.close();
  const indexedDB=new IDBFactory();await new Promise(resolve=>{const request=indexedDB.open('wrong',1);request.onupgradeneeded=()=>request.result.createObjectStore('unrelated');request.onsuccess=()=>{request.result.close();resolve();};});
  const wrong=createDocumentUploadJournal({indexedDB,dbName:'wrong'});await assert.rejects(wrong.list(actor),{code:'schema'});wrong.close();
});

test('missing commit acknowledgment times out but cold reopen preserves committed recovery',async()=>{
  const indexedDB=new IDBFactory();let hide=false;
  const store=createDocumentUploadJournal({timeoutMs:15,indexedDB:observedFactory(indexedDB,(tx,args)=>{if(hide&&args[1]==='readwrite')Object.defineProperty(tx,'oncomplete',{set(){}});})});
  await store.list(actor);hide=true;await assert.rejects(store.create(actor,input(),pdf()),{code:'timed-out'});store.close();
  const cold=createDocumentUploadJournal({indexedDB});assert.equal((await cold.get(actor,attempt)).revision,1);assert.equal(await(await cold.readFile(actor,attempt)).text(),'%PDF-fixture');cold.close();
});

test('close aborts pending open and closes its late result; settled data survives forced connection close',async()=>{
  let request,closed=0;const pendingStore=createDocumentUploadJournal({indexedDB:{open:()=>request={}}});
  const pending=pendingStore.create(actor,input(),pdf());pendingStore.close();await assert.rejects(pending,{code:'closed'});
  request.result={close(){closed++;}};request.onsuccess();assert.ok(closed>0);
  const indexedDB=new IDBFactory();let db;const store=createDocumentUploadJournal({indexedDB:observedFactory(indexedDB,(_tx,_args,opened)=>{db=opened;})});
  await store.create(actor,input(),pdf());forceCloseDatabase(db);assert.equal((await store.get(actor,attempt)).revision,1);
  db.onversionchange();assert.equal(await(await store.readFile(actor,attempt)).text(),'%PDF-fixture');store.close();await assert.rejects(store.get(actor,attempt),{code:'closed'});
});

test('closing after a successful write request aborts the transaction and sends no commit event',async(t)=>{
  const oldWindow=globalThis.window,window=new EventTarget();window.Event=Event;globalThis.window=window;
  t.after(()=>{if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;});
  let events=0,closeDuringWrite=false,store;window.addEventListener('document-upload-journal-changed',()=>events++);
  const indexedDB=new IDBFactory();
  store=createDocumentUploadJournal({indexedDB:observedFactory(indexedDB,(tx,args)=>{
    if(!closeDuringWrite||args[1]!=='readwrite')return;const get=tx.objectStore.bind(tx);
    tx.objectStore=name=>{const object=get(name);if(name==='attempts'){const add=object.add.bind(object);object.add=(...values)=>{const req=add(...values);req.addEventListener('success',()=>store.close());return req;};}return object;};
  })});
  await store.create(other,input(other),pdf());assert.equal(events,1);closeDuringWrite=true;
  await assert.rejects(store.create(actor,input(),pdf()),{code:'closed'});assert.equal(events,1);
  const cold=createDocumentUploadJournal({indexedDB});assert.equal(await cold.get(actor,attempt),null);assert.equal(await cold.readFile(actor,attempt),null);
  assert.equal(await(await cold.readFile(other,attempt)).text(),'%PDF-fixture');cold.close();
});

test('a null-project upload and empty PDF MIME cold-reopen without a project or cloud dependency',async()=>{
  const indexedDB=new IDBFactory(),store=createDocumentUploadJournal({indexedDB}),bytes=new Blob(['%PDF-fixture']);
  await store.create(actor,input(actor,{projectId:null,type:''}),bytes);
  await store.patch(actor,attempt,{target:target(actor,{project_id:null}),phase:'running'});store.close();
  const cold=createDocumentUploadJournal({indexedDB});assert.equal((await cold.get(actor,attempt)).projectId,null);
  assert.equal((await cold.readFile(actor,attempt)).type,'');cold.close();
});

test('quota-archived targets can be bound before revival but user archives can never be accepted',async()=>{
  const store=createDocumentUploadJournal({indexedDB:new IDBFactory()});await store.create(actor,input(),pdf());
  const quotaArchived=target(actor,{archived:true});
  await store.patch(actor,attempt,{target:quotaArchived,phase:'running'});
  assert.equal((await store.get(actor,attempt)).target.archived,true);
  await assert.rejects(store.patch(actor,attempt,{target:{...quotaArchived,user_archived_at:'2026-09-08T00:00:00Z'}}));
  await store.patch(actor,attempt,{target:{...quotaArchived,archived:false}});
  assert.equal((await store.get(actor,attempt)).target.archived,false);store.close();
});
