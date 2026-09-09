import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { IDBFactory } from 'fake-indexeddb';
import { createGenerationCollaborationSession } from '../src/lib/collab/generationCollaborationSession.js';
import { getOrCreateYDoc, purgeYDoc } from '../src/lib/collab/ydocRegistry.js';

const id=n=>`85000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),documentId=id(2),generation=id(3);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await tick();}assert.fail('bounded async condition not reached');}
function fixture(t, options={}) {
  let current=actor, role='editor', generationBlocked=false, openCurrent=true, interceptor=options.interceptor;
  const bundle={actorUserId:actor,documentId,pdfGenerationId:generation,
    pdf:{bucket_id:'documents',path:`${actor}/_generations/a.pdf`,id:id(4),version:id(5),byte_length:'3',content_sha256:'a'.repeat(64)},
    publication:{operation_id:id(6),generation_id:generation,published_at:'2026-09-09T00:00:00Z',wal_head:'0'}};
  const calls=[],channels=[],authListeners=new Set(),syncListeners=new Set(),presences=[],recoveryCalls=[];
  const client=createClient('https://generation-authority.example.test','synthetic-public',{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:async(url,request)=>{
      const u=new URL(url);assert.equal(u.origin,'https://generation-authority.example.test');
      const name=u.pathname.split('/').at(-1),body=request.body?JSON.parse(request.body):null;
      const call={name,body,headers:new Headers(request.headers),method:request.method};calls.push(call);
      let response=name==='read_document_generation_collaboration'?{version:1,actor_user_id:actor,document_id:documentId,generation_id:generation,
        pdf:{...bundle.pdf},publication:{...bundle.publication},role}:[];
      if(interceptor)response=await interceptor(call,response);
      if(response instanceof Response)return response;
      return new Response(JSON.stringify(response),{status:200,headers:{'Content-Type':'application/json'}});
    }},
  });
  client.auth.getSession=async()=>({data:{session:{user:{id:current},access_token:`synthetic-${current}`}},error:null});
  client.auth.onAuthStateChange=callback=>{authListeners.add(callback);return {data:{subscription:{unsubscribe:()=>authListeners.delete(callback)}}};};
  client.realtime.setAuth=async token=>calls.push({name:'setAuth',token});
  client.channel=topic=>{const c={topic,on(){return c;},subscribe(callback){c.status=callback;return c;}};channels.push(c);return c;};
  client.removeChannel=async c=>{c.removed=true;};
  const handle={documentId,actorUserId:actor,pdfGenerationId:generation,
    getGenerationStatus:()=>({pdfGenerationId:generation,blocked:generationBlocked}),
    getSyncStatus:()=>({healthy:true,stage:'idle'}),
    onSyncStatus:fn=>{syncListeners.add(fn);return()=>syncListeners.delete(fn);}};
  const recovery={prepare:async options=>{recoveryCalls.push(options);return {};},isCurrent:()=>true,validate:async()=>true};
  let runtime;
  const args={checkedBundle:bundle,generationSession:handle,client,indexedDb:new IDBFactory(),
    getCurrentActorUserId:()=>current,isCurrentOpen:()=>openCurrent,
    windowTarget:new EventTarget(),documentTarget:new EventTarget(),timeoutMs:1000,
    recoveryFactory:options.realRecovery?undefined:()=>recovery,
    presenceFactory:opts=>{const p={opts,disposed:false,active:true,awareness:{getStates:()=>new Map()}};presences.push(p);
      return {getAwareness:()=>p.awareness,dispose:()=>{p.disposed=true;},setActive:v=>{p.active=v;}};},
    ...options.args};
  t.after(()=>runtime?.dispose());
  return {bundle,handle,client,calls,channels,authListeners,syncListeners,presences,recoveryCalls,recovery,args,
    start(){runtime=createGenerationCollaborationSession(args);return runtime;},
    setRole:v=>{role=v;},setActor:v=>{current=v;},setOpenCurrent:v=>{openCurrent=v;},
    intercept:fn=>{interceptor=fn;},
    auth(event,user=current){for(const fn of authListeners)fn(event,user?{user:{id:user},access_token:`synthetic-${user}`}:null);},
    retire(){generationBlocked=true;for(const fn of syncListeners)fn({healthy:false});}};
}

test('authority starts read-only and checks generation with role in one captured SDK JWT request',async t=>{
  const f=fixture(t),r=f.start();assert.equal(r.getState().docRole,'viewer');
  await until(()=>r.getState().authorityStatus==='confirmed');
  assert.equal(r.getState().docRole,'editor');
  assert.equal(f.calls.filter(c=>c.name==='read_document_generation_collaboration').length,1);
  for(const c of f.calls){assert.equal(c.headers.get('Authorization'),`Bearer synthetic-${actor}`);
    assert.ok(['read_document_generation_collaboration','document_collaborators'].includes(c.name));}
  const open=f.calls.find(c=>c.name==='read_document_generation_collaboration');
  assert.deepEqual(open.body,{p_document_id:documentId,p_generation_id:generation});
  assert.equal(f.presences[0].opts.pdfGenerationId,generation);
  assert.equal(await f.presences[0].opts.authorize(),true);
});

test('viewer and denied role stay restricted; null denial permanently retires only owned resources',async t=>{
  const f=fixture(t);f.setRole('viewer');const r=f.start();await until(()=>r.getState().authorityStatus==='confirmed');
  assert.equal(r.getState().docRole,'viewer');
  f.setRole(null);assert.equal(await r.authorize(),false);
  assert.equal(r.getState().accessRevoked,true);assert.equal(r.getAwareness(),null);
  assert.equal(f.presences[0].disposed,true);assert.ok(f.channels.every(c=>c.removed));
  const count=f.calls.length;f.setRole('owner');assert.equal(await r.authorize(),false);assert.equal(f.calls.length,count);
});

test('authority rejects unknown contract fields and incomplete or version-mismatched responses',async t=>{
  const mutations=[v=>({...v,version:2}),v=>({...v,private_snapshot:'SECRET'}),
    v=>{const {role,...rest}=v;return rest;},v=>({...v,pdf:{...v.pdf,download_url:'SECRET'}}),
    v=>({...v,publication:null}),()=>null,()=>[]];
  for(const mutate of mutations){
    const f=fixture(t),r=f.start();await until(()=>r.getState().authorityStatus==='confirmed');
    f.intercept((call,value)=>call.name==='read_document_generation_collaboration'?mutate(value):value);
    assert.equal(await r.authorize(),false);assert.equal(r.getState().docRole,'viewer');
    assert.equal(r.getState().authorityStatus,'unavailable');
    assert.ok(!JSON.stringify(r.getState()).includes('SECRET'));r.dispose();
  }
});

test('missing combined RPC fails closed without fallback; access errors retire the open',async t=>{
  for(const code of ['PGRST202','42501','SG001','SG002']){
    const f=fixture(t),r=f.start();await until(()=>r.getState().authorityStatus==='confirmed');
    const count=f.calls.length;
    f.intercept(call=>new Response(JSON.stringify({code,message:'SECRET provider detail'}),{
      status:code==='PGRST202'?404:403,headers:{'Content-Type':'application/json'}}));
    assert.equal(await r.authorize(),false);assert.equal(r.getState().docRole,'viewer');
    assert.equal(r.getState().accessRevoked,code!=='PGRST202');
    assert.deepEqual(f.calls.slice(count).map(c=>c.name),['read_document_generation_collaboration']);
    assert.ok(!JSON.stringify(r.getState()).includes('SECRET'));r.dispose();
  }
});

test('concurrent authority refreshes share one request and never refetch the checkpoint',async t=>{
  const f=fixture(t),r=f.start();await until(()=>r.getState().authorityStatus==='confirmed');
  const gate=deferred(),entered=deferred(),count=f.calls.length;
  f.intercept(async(call,value)=>{if(call.name==='read_document_generation_collaboration'){entered.resolve();await gate.promise;}return value;});
  const first=r.authorize(),second=r.authorize();assert.equal(first,second);await entered.promise;
  assert.equal(f.calls.length,count+1);gate.resolve();assert.equal(await first,true);
  assert.deepEqual(f.calls.at(-1).body,{p_document_id:documentId,p_generation_id:generation});
});

test('invalid role and transient errors never promote authority or expose private diagnostics',async t=>{
  const f=fixture(t);f.setRole({private:'SECRET'});const r=f.start();
  await until(()=>r.getState().authorityStatus==='unavailable');assert.equal(r.getState().docRole,'viewer');
  assert.ok(!JSON.stringify(r.getState()).includes('SECRET'));
  f.setRole('owner');assert.equal(await r.authorize(),true);assert.equal(r.getState().docRole,'owner');
  f.intercept(()=>{throw new Error('SECRET payload');});assert.equal(await r.authorize(),false);
  assert.equal(r.getState().docRole,'viewer');
});

test('wrong-actor auth event blocks immediately and later same-actor login cannot revive the open',async t=>{
  const f=fixture(t),r=f.start();await until(()=>r.getState().authorityStatus==='confirmed');
  f.auth('USER_UPDATED',id(99));assert.equal(r.isCurrent(),false);assert.equal(r.getState().loginExpired,true);
  f.auth('SIGNED_IN',actor);assert.equal(r.isCurrent(),false);assert.equal(await r.authorize(),false);
  r.dispose();assert.equal(f.authListeners.size,0);assert.equal(f.syncListeners.size,0);
});

test('late role response after actor switch never unlocks the retired provider',async t=>{
  const gate=deferred(),entered=deferred();
  const f=fixture(t,{interceptor:async(call,value)=>{if(call.name==='read_document_generation_collaboration'){entered.resolve();await gate.promise;}return value;}});
  const r=f.start();await entered.promise;f.setActor(id(99));f.auth('SIGNED_IN');gate.resolve();
  await tick();assert.equal(r.getState().docRole,'viewer');assert.equal(r.getState().accessRevoked,true);
  assert.ok(f.calls.every(c=>c.headers.get('Authorization')===`Bearer synthetic-${actor}`));
});

test('changed physical PDF or publication cannot yield role authority for the old checked open',async t=>{
  for(const changed of ['pdf','publication']){
    const f=fixture(t,{interceptor:(call,value)=>call.name==='read_document_generation_collaboration'
      ?{...value,[changed]:{...value[changed],...(changed==='pdf'?{version:id(99)}:{operation_id:id(99)})}}:value});
    const r=f.start();await until(()=>r.getState().accessRevoked);
    assert.ok(!f.calls.some(c=>c.name==='get_my_document_role'));assert.equal(r.getState().docRole,'viewer');
  }
});

test('modern handle retirement closes presence but does not destroy or mutate the handle',async t=>{
  const f=fixture(t),r=f.start();await until(()=>r.getState().authorityStatus==='confirmed');
  f.retire();assert.equal(r.getState().accessRevoked,true);assert.equal(f.presences[0].disposed,true);
  assert.equal(r.getAwareness(),null);assert.equal(await r.authorize(),false);
});

test('retained close proof is actor/open/role scoped and viewer close is strictly read-only',async t=>{
  const f=fixture(t),r=f.start();await until(()=>r.getState().authorityStatus==='confirmed');
  const c=r.localCloseSession,proof=await c.prepareLocalClose();assert.equal(f.recoveryCalls.at(-1).readOnly,false);
  assert.equal(await c.validateLocalCloseReceipt(proof),true);assert.equal(c.isLocalCloseReceiptCurrent({}),false);
  f.setRole('viewer');await r.authorize();assert.equal(c.isLocalCloseReceiptCurrent(proof),false);
  const viewed=await c.prepareLocalClose();assert.equal(f.recoveryCalls.at(-1).readOnly,true);
  f.setOpenCurrent(false);assert.equal(c.isLocalCloseReceiptCurrent(viewed),false);
  await assert.rejects(c.validateLocalCloseReceipt(viewed),{code:'GENERATION_COLLABORATION_UNAVAILABLE'});
});

test('role changes abort a pending archive transaction and cannot issue a close receipt',async t=>{
  const f=fixture(t),r=f.start();await until(()=>r.getState().authorityStatus==='confirmed');
  const gate=deferred(),entered=deferred();let signal;
  f.recovery.prepare=async options=>{signal=options.signal;entered.resolve();await gate.promise;return {};};
  const preparing=r.localCloseSession.prepareLocalClose();await entered.promise;
  f.setRole('viewer');await r.authorize();assert.equal(signal.aborted,true);gate.resolve();
  await assert.rejects(preparing,{code:'GENERATION_COLLABORATION_UNAVAILABLE'});
});

test('real recovery receipt invalidates when an old raw registry document appears',async t=>{
  const f=fixture(t,{realRecovery:true}),r=f.start();await until(()=>r.getState().authorityStatus==='confirmed');
  const proof=await r.localCloseSession.prepareLocalClose();
  assert.equal(await r.localCloseSession.validateLocalCloseReceipt(proof),true);
  const old=getOrCreateYDoc(documentId);old.getMap('annotations').set('unsent','keep');
  t.after(()=>purgeYDoc(documentId));
  assert.equal(r.localCloseSession.isLocalCloseReceiptCurrent(proof),false);
  const archived=await r.localCloseSession.prepareLocalClose();
  assert.equal(await r.localCloseSession.validateLocalCloseReceipt(archived),true);
  assert.equal(old.getMap('annotations').get('unsent'),'keep');
});

test('late session lookup after deadline never starts a query',async t=>{
  const f=fixture(t,{args:{timeoutMs:5}}),gate=deferred();
  f.client.auth.getSession=()=>gate.promise;const r=f.start();
  assert.equal(await r.authorize(),false);gate.resolve({data:{session:{user:{id:actor},access_token:'synthetic-late'}}});
  await tick();assert.equal(f.calls.length,0);assert.equal(r.getState().docRole,'viewer');
});

test('mismatched modern handle actor fails before auth, queries or recovery construction',t=>{
  const f=fixture(t);f.handle.actorUserId=id(99);
  assert.throws(()=>f.start(),{code:'GENERATION_COLLABORATION_UNAVAILABLE'});
  assert.equal(f.calls.length,0);assert.equal(f.authListeners.size,0);
});

test('partial or malformed checked identities cannot start authority or presence work',t=>{
  for(const mutate of [
    b=>{delete b.pdf.id;b.pdf.unrelated=undefined;},
    b=>{b.pdf.byte_length='01';},b=>{b.pdf.version='not-a-version';},
    b=>{b.pdf.content_sha256='a';},b=>{b.publication.generation_id=id(99);},
    b=>{b.publication.published_at='not-a-date';},b=>{b.publication.wal_head='9223372036854775808';},
  ]){
    const f=fixture(t);mutate(f.bundle);
    assert.throws(()=>f.start(),{code:'GENERATION_COLLABORATION_UNAVAILABLE'});
    assert.equal(f.calls.length,0);assert.equal(f.presences.length,0);
  }
});

test('state readers fail closed as soon as the captured open changes, before effect cleanup',async t=>{
  const f=fixture(t),r=f.start();await until(()=>r.getState().authorityStatus==='confirmed');
  f.setOpenCurrent(false);
  assert.equal(r.getState().docRole,'viewer');assert.equal(r.getState().accessRevoked,true);
  assert.equal(r.getAwareness(),null);assert.equal(r.isCurrent(),false);
});
