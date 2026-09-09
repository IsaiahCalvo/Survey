import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { handleDocumentGenerationUpload } from '../supabase/functions/document-generation-upload/handler.js';

const id = n => `95000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor=id(1),operation=id(2),document=id(3),generation=id(4),owner=id(5),source=id(6),claim=id(7),sourceObject=id(8);
const bytes=new TextEncoder().encode('{"version":1,"annotations":{"2":{"objects":[]}}}');
const sha=value=>createHash('sha256').update(value).digest('hex');
const object={id:id(9),version:id(10),byte_length:String(bytes.length)};
const sourceMember=()=>({kind:'sidecar',bucket_id:'documents',path:`project/${document}_data.json`,id:sourceObject,
  version:id(11),byte_length:String(bytes.length),content_sha256:sha(bytes)});
const receipt=(changes={})=>({version:3,operation_id:operation,actor_user_id:actor,document_id:document,generation_id:generation,
  owner_user_id:owner,source_id:source,purpose:'source-object-archive',expected_source_generation_id:null,
  archived_source_object_id:sourceObject,source_object:sourceMember(),path:`${owner}/_generations/${document}/${generation}/${operation}.bin`,
  content_sha256:sha(bytes),byte_length:String(bytes.length),source_sql_sha256:'a'.repeat(64),expires_at:'2030-01-02T00:00:00Z',
  state:'reserved',upload_state:'reserved',object:null,verified_at:null,rejection:null,...changes});
const unavailable=(state='reserved')=>receipt({state:'source-unavailable',upload_state:state,source_object:null});
const verified=()=>receipt({state:'verified',upload_state:'verified',object,verified_at:'2030-01-01T00:00:00Z'});
const input=(action='begin-archive',extra={})=>({action,operation_id:operation,...(action==='begin-archive'?{
  source_id:source,source_object_id:sourceObject}:{}),...extra});
const stream=value=>new ReadableStream({start(c){c.enqueue(value.slice(0,3));c.enqueue(value.slice(3));c.close();}});
function harness(overrides={}) {
  const calls=[];
  const defaults={enabled:true,sourceBoundEnabled:true,archiveEnabled:true,timeoutMs:2000,newId:()=>claim,getUser:async()=>({id:actor}),
    begin:async()=>{throw Error('v1 fallback');},beginV2:async()=>{throw Error('v2 fallback');},beginArchive:async()=>receipt(),
    get:async()=>receipt(),mint:async path=>({path,token:'private-upload',signedUrl:'https://invalid.test/signed'}),
    cancel:async()=>receipt({state:'canceled',upload_state:'canceled',source_object:null}),
    claim:async()=>receipt({object,verification_claim_id:claim}),openStream:async()=>stream(bytes),record:async()=>verified(),
    release:async()=>({released:true}),...overrides};
  const deps=Object.fromEntries(Object.entries(defaults).map(([k,v])=>[k,typeof v==='function'?(...args)=>{
    calls.push({name:k,args});return v(...args);}:v]));
  return {calls,async run(body=input()) {const r=await handleDocumentGenerationUpload(new Request('https://invalid.test/upload',{
    method:'POST',headers:{Authorization:'Bearer caller-token'},body:JSON.stringify(body)}),deps);return{status:r.status,body:await r.json()};}};
}
const names=h=>h.calls.map(c=>c.name);

test('archive begin accepts only the selected source member and uses a generic immutable destination',async()=>{
  const h=harness();const r=await h.run();assert.equal(r.status,200);
  assert.deepEqual(names(h),['getUser','beginArchive','mint','get']);
  assert.equal(h.calls[1].args[0],'caller-token');assert.deepEqual(h.calls[1].args[1],input());
  assert.equal(r.body.upload.path,receipt().path);assert.match(r.body.upload.path,/\.bin$/);
  assert.deepEqual(r.body.operation.source_object,sourceMember());
  for(const extra of [{content_sha256:sha(bytes)},{byte_length:String(bytes.length)},{path:'private/path'},
    {document_id:document},{purpose:'prior-pdf'},{source_object:sourceMember()},{actor_user_id:actor},
    {source_object_id:null},{source_id:null}]) {
    const invalid=harness();assert.equal((await invalid.run(input('begin-archive',extra))).status,400);
    assert.deepEqual(names(invalid),['getUser']);
  }
});

test('archive writes require every enable flag, but inspection and cancellation need no archive opt-in',async()=>{
  for(const disabled of ['enabled','sourceBoundEnabled','archiveEnabled']) for(const action of ['begin-archive','verify']) {
    const h=harness({[disabled]:false});assert.equal((await h.run(input(action))).status,503);
    assert.ok(names(h).every(n=>['getUser','get'].includes(n)));
  }
  for(const action of ['get','cancel']) {
    const h=harness({archiveEnabled:false,sourceBoundEnabled:false});assert.equal((await h.run(input(action))).status,200);
    assert.ok(!names(h).includes('openStream'));assert.ok(!names(h).includes('mint'));
  }
});

test('archive receipts cannot be downgraded, relabeled as PDFs, or detach source byte identity',async()=>{
  const bad=[{version:1},{version:2,purpose:'candidate-pdf',path:receipt().path.replace(/bin$/,'pdf')},
    {purpose:'candidate-pdf'},{path:receipt().path.replace(/bin$/,'pdf')},{archived_source_object_id:id(98)},
    {source_object:null},...[
      {kind:'unknown'},{bucket_id:'other'},{id:id(98)},{version:null},{byte_length:'1'},{content_sha256:'b'.repeat(64)},
    ].map(change=>({source_object:{...sourceMember(),...change}}))];
  for(const change of bad) {
    const h=harness({beginArchive:async()=>receipt(change)});assert.equal((await h.run()).status,502,JSON.stringify(change));
    assert.ok(!names(h).includes('mint'));
  }
});

test('every immutable source-object field remains checked across mint, claim and record',async()=>{
  for(const phase of ['get','claim','record']) for(const change of [
    {archived_source_object_id:id(99),source_object:{...sourceMember(),id:id(99)}},
    {source_object:{...sourceMember(),path:'other/source.json'}},
    {source_object:{...sourceMember(),version:id(99)}},
    {source_object:{...sourceMember(),kind:'pdf'}},
    {source_id:id(99)},{expected_source_generation_id:id(99)},
  ]) {
    const h=harness({[phase]:async()=>({...receipt(),...(phase==='claim'?{object,verification_claim_id:claim}:{}),
      ...(phase==='record'?verified():{}),...change})});
    const r=await h.run(input(phase==='get'?'begin-archive':'verify'));assert.equal(r.status,502);
    assert.equal(r.body.upload,undefined);assert.ok(!names(h).includes('begin'));assert.ok(!names(h).includes('beginV2'));
  }
});

test('complete JSON archive bytes produce the same checked proof as a PDF archive',async()=>{
  for(const kind of ['sidecar','pdf']) {
    const adapt=value=>({...value,source_object:{...sourceMember(),kind}});
    const h=harness({get:async()=>adapt(receipt()),claim:async()=>adapt(receipt({object,verification_claim_id:claim})),
      record:async()=>adapt(verified())});
    const r=await h.run(input('verify'));assert.equal(r.status,200);assert.equal(r.body.operation.source_object.kind,kind);
    assert.deepEqual(h.calls.find(c=>c.name==='record').args.slice(0,7),
      [actor,operation,claim,object.id,object.version,sha(bytes),String(bytes.length)]);
    assert.equal(h.calls.find(c=>c.name==='openStream').args[0],receipt().path);
  }
});

test('unavailable or canceled archives retain selected object ID but expose no old byte proof',async()=>{
  for(const phase of ['beginArchive','get','claim','record']) {
    const h=harness({[phase]:async()=>unavailable(phase==='record'?'verified':'reserved')});
    const r=await h.run(input(['claim','record'].includes(phase)?'verify':'begin-archive'));
    assert.equal(r.status,409);assert.equal(r.body.operation.archived_source_object_id,sourceObject);
    assert.equal(r.body.operation.source_object,null);assert.equal(r.body.operation.object,null);assert.equal(r.body.upload,undefined);
    if(phase!=='record')assert.ok(!names(h).includes('openStream'));
  }
  for(const state of ['source-unavailable','canceled']) {
    const h=harness({get:async()=>receipt({state,upload_state:'canceled'})});
    assert.equal((await h.run(input('get'))).status,502,'terminal source member must be null');
  }
});

test('private fields in source manifests and verification leases never reach the archive caller',async()=>{
  const h=harness({get:async()=>receipt({source_object:{...sourceMember(),private_token:'private-source-token'},
    private_history:'private-history',verification_claim_id:claim})});const r=await h.run(input('get'));
  assert.equal(r.status,200);assert.deepEqual(r.body.operation,receipt());
  assert.ok(!JSON.stringify(r.body).includes('private'));
});

test('archive rejection, short streams and lost record replies cannot falsely confirm or repeat bytes',async()=>{
  const wrong=new Uint8Array(bytes.length).fill(65);
  const negative=receipt({state:'rejected',upload_state:'rejected',object,rejection:{reason:'sha256_mismatch',
    observed_sha256:sha(wrong),byte_length:String(bytes.length),object:{id:object.id,version:object.version},rejected_at:'2030-01-01T00:00:00Z'}});
  const h=harness({openStream:async()=>stream(wrong),reject:async()=>negative});
  assert.deepEqual((await h.run(input('verify'))),{status:422,body:{operation:negative,error:{code:'byte_mismatch',
    message:'Uploaded bytes do not match this operation. Cancel it before preparing a different file.'}}});
  const short=harness({openStream:async()=>stream(bytes.slice(1))});assert.equal((await short.run(input('verify'))).status,422);
  assert.ok(!names(short).includes('record'));assert.ok(names(short).includes('release'));
  const lost=harness({record:async()=>{throw Error('lost private reply');}});assert.equal((await lost.run(input('verify'))).status,502);
  assert.ok(!names(lost).includes('release'));assert.equal(names(lost).filter(n=>n==='record').length,1);
});

test('SQL source loss recovers a v3 archive only through the same checked operation',async()=>{
  for(const phase of ['claim','record']) {
    let reads=0;const h=harness({get:async()=>++reads===1?receipt():unavailable(),
      [phase]:async()=>{throw Object.assign(Error('source changed'),{code:'23514'});}});
    const r=await h.run(input('verify'));assert.equal(r.status,409);assert.deepEqual(r.body.operation,unavailable());
    assert.equal(reads,2);assert.equal(names(h).filter(n=>n===phase).length,1);
    assert.ok(!names(h).includes('release'));
  }
});
