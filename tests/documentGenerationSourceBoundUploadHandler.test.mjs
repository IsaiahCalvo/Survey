import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { handleDocumentGenerationUpload } from '../supabase/functions/document-generation-upload/handler.js';

const id=n=>`94000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1), operation=id(2), document=id(3), generation=id(4), owner=id(5), source=id(6), claim=id(7);
const bytes=new TextEncoder().encode('%PDF exact candidate');
const sha=b=>createHash('sha256').update(b).digest('hex');
const object={id:id(8),version:id(9),byte_length:String(bytes.length)};
const receipt=(changes={})=>({version:2,operation_id:operation,actor_user_id:actor,document_id:document,
  generation_id:generation,owner_user_id:owner,source_id:source,purpose:'candidate-pdf',expected_source_generation_id:null,
  path:`${owner}/_generations/${document}/${generation}/${operation}.pdf`,content_sha256:sha(bytes),byte_length:String(bytes.length),
  source_sql_sha256:'a'.repeat(64),expires_at:'2026-09-09T12:00:00Z',state:'reserved',upload_state:'reserved',
  object:null,verified_at:null,rejection:null,...changes});
const verified=()=>receipt({state:'verified',upload_state:'verified',object,verified_at:'2026-09-09T11:00:00Z'});
const unavailable=(upload_state='reserved')=>receipt({state:'source-unavailable',upload_state});
const input=(action='begin',extra={})=>({action,operation_id:operation,...(action==='begin'?{
  source_id:source,purpose:'candidate-pdf',content_sha256:sha(bytes),byte_length:String(bytes.length)}:{}),...extra});
function harness(overrides={}) {
  const calls=[];
  const defaults={enabled:true,sourceBoundEnabled:true,timeoutMs:2000,newId:()=>claim,getUser:async()=>({id:actor}),
    begin:async()=>{throw Error('v1 fallback');},beginV2:async()=>receipt(),get:async()=>receipt(),
    mint:async path=>({path,token:'upload-secret',signedUrl:'https://invalid.test/signed'}),
    cancel:async()=>receipt({state:'canceled',upload_state:'canceled'}),
    claim:async()=>receipt({object,verification_claim_id:claim}),
    openStream:async()=>new ReadableStream({start(c){c.enqueue(bytes);c.close();}}),record:async()=>verified(),
    release:async()=>({released:true}),...overrides};
  const deps=Object.fromEntries(Object.entries(defaults).map(([k,v])=>[k,typeof v==='function'?(...args)=>{calls.push({name:k,args});return v(...args);}:v]));
  return {calls,async run(body=input()) {const r=await handleDocumentGenerationUpload(new Request('https://invalid.test',{method:'POST',
    headers:{Authorization:'Bearer caller-token'},body:JSON.stringify(body)}),deps);return {status:r.status,body:await r.json()};}};
}
const names=h=>h.calls.map(c=>c.name);

test('v2 begin binds caller source and purpose, strips private fields, and never falls back',async()=>{
  const h=harness({get:async()=>receipt({verification_claim_id:claim,private_body:'private'})});const r=await h.run();
  assert.equal(r.status,200);assert.deepEqual(names(h),['getUser','beginV2','mint','get']);
  assert.equal(h.calls[1].args[0],'caller-token');assert.deepEqual(h.calls[1].args[1],input());
  assert.equal(r.body.operation.source_id,source);assert.equal(r.body.operation.purpose,'candidate-pdf');
  assert.equal(r.body.operation.verification_claim_id,undefined);assert.equal(r.body.operation.private_body,undefined);
});

test('source-bound flag blocks begin and verify, while get and cancel still recover',async()=>{
  for(const action of ['begin','verify','get','cancel']) {
    const h=harness({sourceBoundEnabled:false});const r=await h.run(input(action));
    assert.equal(r.status,['get','cancel'].includes(action)?200:503);
    assert.ok(names(h).every(n=>['getUser','get','cancel'].includes(n)));
  }
});

test('invalid source binding and injected caller fields cannot reserve or mint',async()=>{
  for(const extra of [{source_id:null},{purpose:null},{purpose:'pdf'},{document_id:document},{actor_user_id:actor},
    {expected_source_generation_id:id(50)},{path:'other.pdf'},{verification_claim_id:claim},{content_sha256:[sha(bytes)]}]) {
    const h=harness();assert.equal((await h.run(input('begin',extra))).status,400);assert.deepEqual(names(h),['getUser']);
  }
});

test('source-unavailable recovery survives every checked phase without exposing proof or authority',async()=>{
  for(const phase of ['beginV2','get','claim','record']) {
    const h=harness({[phase]:async()=>unavailable(phase==='record'?'verified':'reserved')});
    const r=await h.run(input(['claim','record'].includes(phase)?'verify':'begin'));
    assert.equal(r.status,409,phase);assert.equal(r.body.error.code,'source_unavailable');
    assert.deepEqual(r.body.operation,unavailable(phase==='record'?'verified':'reserved'));
    assert.equal(r.body.upload,undefined);assert.ok(!names(h).includes('release'));
    if(phase!=='record')assert.ok(!names(h).includes('openStream'));
    if(phase==='beginV2')assert.ok(!names(h).includes('mint'));
  }
  const h=harness({get:async()=>unavailable('verified')});assert.equal((await h.run(input('get'))).status,200);
});

test('source, purpose, expected generation and version cannot change between checked phases',async()=>{
  for(const phase of ['get','claim','record']) for(const change of [{source_id:id(99)},{purpose:'prior-pdf'},
    {expected_source_generation_id:id(99)},{version:1}]) {
    const h=harness({[phase]:async()=>phase==='record'?{...verified(),...change}:
      receipt({...(phase==='claim'?{object,verification_claim_id:claim}:{}),...change})});
    if(phase==='get') {const r=await h.run();assert.equal(r.status,502);assert.equal(r.body.upload,undefined);}
    else {const r=await h.run(input('verify'));assert.equal(r.status,502);}
    assert.ok(!names(h).includes('begin'));
  }
});

test('v2 begin cannot receive a v1 receipt and canceled or unavailable receipts cannot carry old proofs',async()=>{
  for(const value of [receipt({version:1}),receipt({state:'canceled',upload_state:'canceled',object}),
    receipt({state:'source-unavailable',upload_state:'verified',object}),
    receipt({state:'reserved',upload_state:'verified'})]) {
    const h=harness({beginV2:async()=>value});assert.equal((await h.run()).status,502);assert.ok(!names(h).includes('mint'));
  }
});

test('v2 full byte proof is recorded once and a lost record reply never releases the claim',async()=>{
  const h=harness();const r=await h.run(input('verify'));assert.equal(r.status,200);
  assert.deepEqual(names(h),['getUser','get','newId','claim','openStream','record']);
  assert.deepEqual(h.calls.at(-1).args.slice(0,7),[actor,operation,claim,object.id,object.version,sha(bytes),String(bytes.length)]);
  const lost=harness({record:async()=>{throw Error('lost private reply');}});assert.equal((await lost.run(input('verify'))).status,502);
  assert.ok(!names(lost).includes('release'));
});

test('v2 completed wrong bytes retain negative proof, including source loss during rejection',async()=>{
  const wrong=new Uint8Array(bytes.length).fill(65);
  const negative=receipt({state:'rejected',upload_state:'rejected',object,rejection:{reason:'sha256_mismatch',
    observed_sha256:sha(wrong),byte_length:String(bytes.length),object:{id:object.id,version:object.version},rejected_at:'2026-09-09T11:00:00Z'}});
  for(const result of [negative,unavailable('rejected')]) {
    const h=harness({openStream:async()=>new ReadableStream({start(c){c.enqueue(wrong);c.close();}}),reject:async()=>result});
    const r=await h.run(input('verify'));assert.equal(r.status,result.state==='rejected'?422:409);
    assert.deepEqual(r.body.operation,result);assert.ok(!names(h).includes('record'));assert.ok(!names(h).includes('release'));
  }
});

test('source-domain SQL failure rereads only the same checked operation, without retrying a write',async()=>{
  for(const phase of ['claim','record']) {
    let gets=0;const h=harness({get:async()=>++gets===1?receipt():unavailable(),
      [phase]:async()=>{throw Object.assign(Error('source changed'),{code:'23514'});}});
    const r=await h.run(input('verify'));assert.equal(r.status,409);assert.deepEqual(r.body.operation,unavailable());
    assert.equal(names(h).filter(n=>n===phase).length,1);assert.equal(gets,2);assert.ok(!names(h).includes('release'));
  }
});

test('failed or mismatched SQL recovery cannot leak another operation or mask the original denial',async()=>{
  for(const next of [()=>{throw Object.assign(Error('denied'),{code:'42501'});},
    ()=>({...unavailable(),source_id:id(98)}),()=>({...unavailable(),actor_user_id:id(98)}),()=>verified()]) {
    let gets=0;const h=harness({get:async()=>++gets===1?receipt():next(),
      claim:async()=>{throw Object.assign(Error('private failure'),{code:'42501'});}});
    const r=await h.run(input('verify'));assert.equal(r.status,403);assert.equal(r.body.operation,undefined);assert.equal(gets,2);
  }
});

test('model-bound candidate begin uses only beginV3 and preserves its checked model',async()=>{
  for(const contentModelVersion of [1,2]) {
    const h=harness({contentModelVersion,beginV2:()=>assert.fail('v2 fallback'),
      beginV3:async()=>receipt({content_model_version:contentModelVersion})});
    const r=await h.run();assert.equal(r.status,200);
    assert.deepEqual(names(h),['getUser','beginV3','mint','get']);
    assert.deepEqual(h.calls[1].args.slice(0,3),['caller-token',input(),contentModelVersion]);
    assert.equal(h.calls[1].args[3] instanceof AbortSignal,true);
    assert.equal(r.body.operation.content_model_version,contentModelVersion);
  }
});

test('model-bound candidate begin rejects missing or switched model receipts and maps SG003',async()=>{
  for(const value of [receipt(),receipt({content_model_version:2})]) {
    const h=harness({contentModelVersion:1,beginV3:async()=>value,beginV2:()=>assert.fail('v2 fallback')});
    assert.equal((await h.run()).status,502);assert.ok(!names(h).includes('mint'));
  }
  const h=harness({contentModelVersion:1,beginV3:async()=>{throw Object.assign(Error('private'),{code:'SG003'});}});
  const r=await h.run();assert.equal(r.status,409);assert.equal(r.body.error.code,'SG003');
});

test('default candidate output strips an unselected future content model field',async()=>{
  const h=harness({get:async()=>receipt({content_model_version:2})});
  const r=await h.run();assert.equal(r.status,200);
  assert.equal(Object.hasOwn(r.body.operation,'content_model_version'),false);
});
