// Opt-in, local HTTP transport proof. Fake Supabase responses do not prove
// hosted Storage versioning, RLS, JWT verification, or SQL transaction behavior.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

if (process.env.SURVEY_GENERATION_HTTP_INTEGRATION !== '1') {
  console.log('Skipped: set SURVEY_GENERATION_HTTP_INTEGRATION=1 for local Deno/SDK HTTP tests.');
  process.exit(0);
}
const directory = fileURLToPath(new URL('../supabase/functions/document-generation-upload/',import.meta.url));
const index = new URL('../supabase/functions/document-generation-upload/index.ts',import.meta.url).href;
const config = fileURLToPath(new URL('../supabase/functions/document-generation-upload/deno.json',import.meta.url));
const id = n => `81000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1), operation=id(2), document=id(3), generation=id(4), owner=id(5);
const token='fixture-caller-token', anon='fixture-anon-key', service='fixture-service-key';
const pdf=Buffer.from('%PDF-1.7\nlocal streamed SDK transport\n%%EOF');
const digest=createHash('sha256').update(pdf).digest('hex');
const path=`${owner}/_generations/${document}/${generation}/${operation}.pdf`;
const object={ id:id(6),version:id(7),byte_length:String(pdf.length) };
const base={ version:1,actor_user_id:actor,operation_id:operation,document_id:document,generation_id:generation,
  owner_user_id:owner,content_sha256:digest,byte_length:String(pdf.length),source_sql_sha256:'a'.repeat(64),
  path,expires_at:'2099-09-09T12:00:00.000Z',state:'reserved',verified_at:null,rejection:null,object:null };
const wrongPdf=Buffer.from(pdf).fill(0),wrongDigest=createHash('sha256').update(wrongPdf).digest('hex');
const rejection={reason:'sha256_mismatch',observed_sha256:wrongDigest,byte_length:String(pdf.length),
  object:{id:object.id,version:object.version},rejected_at:'2099-09-09T11:00:00Z'};
let mode='begin', claimId, negativeReceipt=null, calls=[], failures=[];
const json=(response,body,status=200) => { response.writeHead(status,{ 'Content-Type':'application/json' }); response.end(JSON.stringify(body)); };
const fake=createServer(async (request,response) => {
  try {
    const url=new URL(request.url,'http://127.0.0.1');
    let raw=''; for await (const chunk of request) { raw+=chunk; assert.ok(raw.length<16384); }
    const body=raw ? JSON.parse(raw) : null;
    const route=url.pathname, headers=request.headers;
    calls.push({ route,body,headers,method:request.method,query:url.searchParams });
    if (route==='/auth/v1/user') {
      assert.equal(headers.apikey,anon);
      if (headers.authorization!==`Bearer ${token}`) return json(response,{ msg:`bad token ${service}`,code:'bad_jwt' },401);
      return json(response,{ id:actor,aud:'authenticated',role:'authenticated',email:'fixture@example.invalid' });
    }
    assert.equal(request.method,route.startsWith('/storage/v1/object/')&&!route.includes('/upload/sign/')?'GET':'POST',route);
    if (route.startsWith('/rest/v1/rpc/')) {
      const name=route.split('/').at(-1);
      const admin=/^(claim_|record_|reject_|release_)/.test(name);
      assert.equal(headers.apikey,admin?service:anon);
      assert.equal(headers.authorization,`Bearer ${admin?service:token}`);
      if (name==='begin_document_generation_upload') {
        assert.deepEqual(body,{ p_document_id:document,p_operation_id:operation,p_content_sha256:digest,p_byte_length:String(pdf.length) });
        if (mode==='sql-error') return json(response,{ code:'42501',message:`SELECT secret ${service}`,details:token,hint:service },403);
        return json(response,negativeReceipt||base);
      }
      if (name==='get_document_generation_upload') {
        assert.deepEqual(body,{ p_operation_id:operation });
        if (mode==='revoked') return json(response,{ code:'42501',message:`SELECT secret ${service}` },403);
        if (mode==='canceled') return json(response,{ ...base,state:'canceled' });
        if (mode==='verified') return json(response,{ ...base,state:'verified',object,verified_at:'2099-09-09T11:00:00Z' });
        if(negativeReceipt)return json(response,negativeReceipt);
        return json(response,{ ...base,object:mode==='verify'?object:null });
      }
      if (name==='claim_document_generation_upload_verification') {
        assert.equal(body.p_actor_user_id,actor); assert.equal(body.p_operation_id,operation);
        assert.match(body.p_claim_id,/^[0-9a-f-]{36}$/); claimId=body.p_claim_id;
        if (mode==='busy') return json(response,{ code:'55P03',message:`SELECT secret ${service}` },409);
        return json(response,{ ...base,object,verification_claim_id:claimId });
      }
      if (name==='record_document_generation_upload_verification') {
        assert.deepEqual(body,{ p_actor_user_id:actor,p_operation_id:operation,p_claim_id:claimId,
          p_object_id:object.id,p_object_version:object.version,p_content_sha256:digest,p_byte_length:String(pdf.length) });
        return json(response,{ ...base,state:'verified',object:{ ...object,private_field:service },verified_at:'2099-09-09T11:00:00Z',verification_claim_id:claimId });
      }
      if (name==='release_document_generation_upload_verification') {
        assert.deepEqual(body,{ p_actor_user_id:actor,p_operation_id:operation,p_claim_id:claimId });
        return json(response,{ released:true });
      }
      if (name==='reject_document_generation_upload_verification') {
        assert.deepEqual(body,{p_actor_user_id:actor,p_operation_id:operation,p_claim_id:claimId,
          p_object_id:object.id,p_object_version:object.version,p_content_sha256:wrongDigest,p_byte_length:String(pdf.length)});
        negativeReceipt={...base,state:'rejected',object,rejection:{...rejection,private_field:service,
          object:{...rejection.object,private_field:service}}};
        if(mode==='lost-rejection'){response.destroy();return;}
        if(mode==='malformed-rejection')return json(response,{...negativeReceipt,rejection:{...rejection,observed_sha256:digest}});
        if(mode==='changed-rejection')return json(response,{...negativeReceipt,object:{...object,version:id(99)},
          rejection:{...rejection,object:{id:object.id,version:id(99)}}});
        return json(response,negativeReceipt);
      }
      throw new Error(`Unexpected fixture RPC ${name}`);
    }
    assert.equal(headers.apikey,service); assert.equal(headers.authorization,`Bearer ${service}`);
    if (route===`/storage/v1/object/upload/sign/documents/${path}`) {
      // In the pinned SDK false means omit x-upsert, not send a true header.
      assert.equal(headers['x-upsert'],undefined); assert.deepEqual(body,{});
      return json(response,{ url:`/object/upload/sign/documents/${path}?token=fixture-upload-token` });
    }
    assert.equal(route,`/storage/v1/object/documents/${path}`);
    assert.equal(headers['cache-control'],'no-cache'); assert.ok(url.searchParams.get('cacheNonce'));
    response.writeHead(200,{ 'Content-Type':'application/pdf' });
    const bodyBytes=['wrong-bytes','lost-rejection','malformed-rejection','changed-rejection'].includes(mode)?wrongPdf:mode==='short-body'?pdf.subarray(0,-1):pdf;
    // No content-length: real chunked HTTP body, consumed through SDK asStream.
    for (let offset=0;offset<bodyBytes.length;offset+=3) response.write(bodyBytes.subarray(offset,offset+3));
    response.end();
  } catch (error) { failures.push(error); json(response,{ message:'Fixture assertion failed' },500); }
});
const children=new Set();
async function start(enabled) {
  const origin=`http://127.0.0.1:${fake.address().port}`;
  const code=`
    const originalFetch=globalThis.fetch;
    globalThis.fetch=(input,init)=>{
      const target=new URL(input instanceof Request?input.url:String(input));
      if(target.origin!==${JSON.stringify(origin)}) throw new Error('Non-local fixture fetch denied');
      return originalFetch(input,init);
    };
    const originalServe=Deno.serve; let server;
    Deno.serve=(handler)=>server=originalServe({hostname:'127.0.0.1',port:0,
      onListen:({port})=>console.log('FIXTURE_READY:'+port)},handler);
    Deno.addSignalListener('SIGTERM',async()=>{if(server)await server.shutdown();Deno.exit(0);});
    await import(${JSON.stringify(index)});
  `;
  const child=spawn('deno',['eval','--config',config,'--node-modules-dir=none','--cached-only','--no-lock',code],{
    cwd:directory,env:{ PATH:process.env.PATH,HOME:process.env.HOME,
      SUPABASE_URL:origin,SUPABASE_ANON_KEY:anon,SUPABASE_SERVICE_ROLE_KEY:service,
      SURVEY_GENERATION_STORAGE_CONTRACT:enabled?'versioned-standard-v1':'disabled' },stdio:['ignore','pipe','pipe'],
  });
  const state={ child,output:'',closed:false,spawnError:null }; children.add(state);
  state.closedPromise=new Promise(resolve=>{ child.once('close',()=>{state.closed=true;resolve();}); });
  child.on('error',error=>{ state.spawnError=error; });
  return await new Promise((resolve,reject)=>{
    const finish=(error,port)=>{ clearTimeout(timer); child.stdout.off('data',inspect);
      error?reject(error):resolve({ url:`http://127.0.0.1:${port}`,state }); };
    const inspect=()=>{ const match=state.output.match(/FIXTURE_READY:(\d+)/); if(match)finish(null,match[1]); };
    const timer=setTimeout(()=>finish(new Error(`Deno fixture start timed out: ${state.output}`)),15000);
    for (const pipe of [child.stdout,child.stderr]) pipe.on('data',chunk=>{ state.output=(state.output+chunk).slice(-32768); });
    child.stdout.on('data',inspect);
    child.once('error',error=>finish(error));
    child.once('close',()=>finish(new Error(`Deno fixture exited before ready: ${state.output}`)));
  });
}
async function stop(state) {
  if (!state.closed) {
    state.child.kill('SIGTERM');
    const timer=setTimeout(()=>state.child.kill('SIGKILL'),2000);
    try { await state.closedPromise; } finally { clearTimeout(timer); }
  }
  children.delete(state);
  if(state.spawnError) throw state.spawnError;
}
async function call(server,action='begin',authorization=`Bearer ${token}`) {
  const body={ action,operation_id:operation,...(action==='begin'?{document_id:document,content_sha256:digest,byte_length:String(pdf.length)}:{}) };
  const response=await fetch(server.url,{ method:'POST',headers:{ Authorization:authorization,'Content-Type':'application/json' },body:JSON.stringify(body),signal:AbortSignal.timeout(10000) });
  const payload=await response.json();
  assert.deepEqual(failures,[]);
  return { status:response.status,body:payload };
}
const routes=()=>calls.map(call=>call.route);
const safeError=(result,status)=>{ assert.equal(result.status,status); for(const secret of [service,token,'SELECT secret','fixture-upload-token']) assert.ok(!JSON.stringify(result.body).includes(secret)); };
let cleanupPromise;
function cleanup() {
  return cleanupPromise??=(async()=>{
    const stopped=await Promise.allSettled([...children].map(stop));
    fake.closeAllConnections();
    await new Promise(resolve=>fake.close(resolve));
    assert.ok(stopped.every(result=>result.status==='fulfilled'),'Deno child cleanup failed');
    console.log('All local Deno children exited and fake HTTP server closed.');
  })();
}
const terminated=()=>{ void cleanup().then(()=>process.exit(143),()=>process.exit(1)); };
const interrupted=()=>{ void cleanup().then(()=>process.exit(130),()=>process.exit(1)); };
process.once('SIGTERM',terminated);process.once('SIGINT',interrupted);
let passed=0;
try {
  await new Promise((resolve,reject)=>{ fake.once('error',reject);fake.listen(0,'127.0.0.1',resolve); });
  const disabled=await start(false);
  safeError(await call(disabled),503);assert.deepEqual(calls,[]);passed++;
  await stop(disabled.state);
  const enabled=await start(true);
  safeError(await call(enabled,'begin','Bearer bad-fixture-token'),401);
  assert.deepEqual(routes(),['/auth/v1/user']);passed++;
  calls=[];
  const begun=await call(enabled);assert.equal(begun.status,200);
  assert.equal(begun.body.upload.path,path);assert.equal(begun.body.upload.token,'fixture-upload-token');
  assert.deepEqual(routes(),['/auth/v1/user','/rest/v1/rpc/begin_document_generation_upload',
    `/storage/v1/object/upload/sign/documents/${path}`,'/rest/v1/rpc/get_document_generation_upload']);passed++;
  mode='verify';calls=[];
  const verified=await call(enabled,'verify');assert.equal(verified.status,200);assert.equal(verified.body.operation.state,'verified');
  assert.deepEqual(verified.body.operation.object,object);assert.ok(!JSON.stringify(verified.body).includes(service));
  assert.deepEqual(routes(),['/auth/v1/user','/rest/v1/rpc/get_document_generation_upload',
    '/rest/v1/rpc/claim_document_generation_upload_verification',`/storage/v1/object/documents/${path}`,
    '/rest/v1/rpc/record_document_generation_upload_verification']);passed++;
  mode='verified';calls=[];assert.equal((await call(enabled,'verify')).status,200);
  assert.deepEqual(routes(),['/auth/v1/user','/rest/v1/rpc/get_document_generation_upload']);passed++;
  for (const [scenario,action,status] of [['sql-error','begin',403],['revoked','begin',403],['canceled','begin',409],['busy','verify',409],['short-body','verify',422]]) {
    mode=scenario;calls=[];safeError(await call(enabled,action),status);
    assert.ok(!routes().includes('/rest/v1/rpc/record_document_generation_upload_verification'));
    if(scenario==='short-body')assert.equal(routes().at(-1),'/rest/v1/rpc/release_document_generation_upload_verification');
    else assert.ok(!routes().some(route=>route.startsWith('/storage/v1/object/documents/')));
    passed++;
  }
  mode='wrong-bytes';calls=[];
  const rejected=await call(enabled,'verify');safeError(rejected,422);
  assert.deepEqual(rejected.body.operation.rejection,rejection);assert.equal(rejected.body.operation.state,'rejected');
  safeError(await call(enabled,'verify'),422);
  for(const action of ['get','begin']){
    const result=await call(enabled,action);assert.equal(result.status,200);assert.equal(result.body.operation.state,'rejected');
    if(action==='begin')assert.equal(result.body.upload,null);
  }
  assert.equal(routes().filter(route=>route===`/storage/v1/object/documents/${path}`).length,1);
  assert.equal(routes().filter(route=>route==='/rest/v1/rpc/reject_document_generation_upload_verification').length,1);
  assert.ok(!routes().some(route=>/release_document|record_document|upload\/sign/.test(route)));passed++;
  mode='lost-rejection';negativeReceipt=null;calls=[];
  safeError(await call(enabled,'verify'),502);
  const reconciled=await call(enabled,'get');assert.equal(reconciled.status,200);assert.equal(reconciled.body.operation.state,'rejected');
  safeError(await call(enabled,'verify'),422);
  assert.equal(routes().filter(route=>route===`/storage/v1/object/documents/${path}`).length,1);
  assert.ok(!routes().some(route=>/release_document|record_document/.test(route)));passed++;
  for(const scenario of ['malformed-rejection','changed-rejection']){
    mode=scenario;negativeReceipt=null;calls=[];
    const result=await call(enabled,'verify');safeError(result,502);assert.equal(result.body.error.code,'invalid_receipt');
    assert.equal(result.body.operation,undefined);
    assert.equal(routes().filter(route=>route===`/storage/v1/object/documents/${path}`).length,1);
    assert.ok(!routes().some(route=>/release_document|record_document/.test(route)));passed++;
  }
  await stop(enabled.state);
  console.log(`Document generation upload local HTTP checks passed: ${passed}`);
} finally {
  await cleanup();
  process.off('SIGTERM',terminated);process.off('SIGINT',interrupted);
}
