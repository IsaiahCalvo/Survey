import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {handleDocumentGenerationDownload} from '../supabase/functions/document-generation-download/handler.js';

const actor='11111111-1111-4111-8111-111111111111',documentId='22222222-2222-4222-8222-222222222222';
const generationId='33333333-3333-4333-8333-333333333333',adoptionId='44444444-4444-4444-8444-444444444444';
const uploader='55555555-5555-4555-8555-555555555555';
const pdf=new TextEncoder().encode('%PDF-adopted'),json=new TextEncoder().encode('{"entities":[]}');
const sha=value=>createHash('sha256').update(value).digest('hex');
const archive=(kind,bytes,index)=>({kind,bucket_id:'documents',path:`owner/_generations/${kind}.bin`,
 id:`66666666-6666-4666-8666-${String(index).padStart(12,'0')}`,version:`77777777-7777-4777-8777-${String(index).padStart(12,'0')}`,
 byte_length:String(bytes.length),content_sha256:sha(bytes),source_object:{kind,bucket_id:'documents',path:`legacy/${kind}`,
  id:`88888888-8888-4888-8888-${String(index).padStart(12,'0')}`,version:`99999999-9999-4999-8999-${String(index).padStart(12,'0')}`,
  byte_length:String(bytes.length),content_sha256:sha(bytes),owner_id:uploader}});
const receipt=objects=>({version:1,state:'available',actor_user_id:actor,document_id:documentId,
 generation_id:generationId,adoption_operation_id:adoptionId,objects});
const request=body=>new Request('https://download.invalid',{method:'POST',headers:{Authorization:'Bearer token'},body:JSON.stringify(body)});
const stream=bytes=>({getReader(){let sent=false;return{read(){if(sent)return Promise.resolve({done:true});sent=true;return Promise.resolve({done:false,value:bytes});},cancel(){return Promise.resolve();},releaseLock(){}};}});
function deps(objects,bytesByKind={pdf,sidecar:json}){let reads=0;return{enabled:true,getUser:async()=>({id:actor}),
 readLegacyAdoption:async()=>{reads++;return structuredClone(receipt(objects));},readLegacySidecar:async()=>assert.fail(),readOpen:async()=>assert.fail(),
 openStream:async value=>stream(bytesByKind[value.kind]),get reads(){return reads;}};}

test('adoption archive status is payload-free and PDF-only never advertises JSON',async()=>{
 const d=deps([archive('pdf',pdf,1)]),response=await handleDocumentGenerationDownload(request({action:'legacy-adoption-archive-status',document_id:documentId,generation_id:generationId}),d);
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{version:2,state:'available',document_id:documentId,
  generation_id:generationId,adoption_operation_id:adoptionId,objects:[{kind:'pdf',byte_length:String(pdf.length),content_sha256:sha(pdf)}]});
 assert.equal(d.reads,1);
});

test('adoption archive downloads each exact retained kind and rechecks its receipt',async()=>{
 const objects=[archive('pdf',pdf,1),archive('sidecar',json,2)];
 for(const [kind,bytes] of [['pdf',pdf],['sidecar',json]]){
  const d=deps(objects),response=await handleDocumentGenerationDownload(request({action:'legacy-adoption-archive-download',
   document_id:documentId,generation_id:generationId,adoption_operation_id:adoptionId,kind}),d);
  assert.equal(response.status,200);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);assert.equal(d.reads,2);
 }
});

test('adoption archive denies missing kinds, changed receipts, and actor failures before success',async()=>{
 const pdfOnly=[archive('pdf',pdf,1)],missing=deps(pdfOnly);
 assert.equal((await handleDocumentGenerationDownload(request({action:'legacy-adoption-archive-download',document_id:documentId,
  generation_id:generationId,adoption_operation_id:adoptionId,kind:'sidecar'}),missing)).status,400);
 let reads=0;const changed=deps(pdfOnly);changed.readLegacyAdoption=async()=>{const value=receipt(pdfOnly);if(++reads===2)value.objects[0].version='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';return value;};
 assert.equal((await handleDocumentGenerationDownload(request({action:'legacy-adoption-archive-download',document_id:documentId,
  generation_id:generationId,adoption_operation_id:adoptionId,kind:'pdf'}),changed)).status,409);
 const denied=deps(pdfOnly);denied.readLegacyAdoption=async()=>{throw Object.assign(new Error('secret'),{code:'42501'});};
 assert.equal((await handleDocumentGenerationDownload(request({action:'legacy-adoption-archive-status',document_id:documentId,generation_id:generationId}),denied)).status,403);
});
