// Real cached Deno/SDK requests to localhost only. This is not hosted Storage,
// real JWT, RLS or transactional source-binding proof.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
if(process.env.SURVEY_GENERATION_SOURCE_BOUND_UPLOADS_HTTP_INTEGRATION!=='1'){
  console.log('Skipped: set SURVEY_GENERATION_SOURCE_BOUND_UPLOADS_HTTP_INTEGRATION=1 for local Deno/SDK HTTP tests.');
  process.exit(0);
}
const directory=fileURLToPath(new URL('../supabase/functions/document-generation-upload/',import.meta.url));
const index=new URL('../supabase/functions/document-generation-upload/index.ts',import.meta.url).href;
const config=fileURLToPath(new URL('../supabase/functions/document-generation-upload/deno.json',import.meta.url));
const id=n=>'85000000-0000-4000-8000-'+String(n).padStart(12,'0');
const actor=id(1),operation=id(2),document=id(3),generation=id(4),owner=id(5),sourceId=id(8);
const token='fixture-bound-caller',anon='fixture-bound-anon',service='fixture-bound-service';
const pdf=Buffer.from('%PDF-1.7\nsource-bound SDK stream\n%%EOF'),bad=Buffer.from(pdf).fill(0);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),digest=sha(pdf);
const path=owner+'/_generations/'+document+'/'+generation+'/'+operation+'.pdf';
const object={id:id(6),version:id(7),byte_length:String(pdf.length)};
const base=(purpose='candidate-pdf',expected=null)=>({version:2,actor_user_id:actor,operation_id:operation,
  document_id:document,generation_id:generation,owner_user_id:owner,source_id:sourceId,purpose,
  expected_source_generation_id:expected,content_sha256:digest,byte_length:String(pdf.length),
  source_sql_sha256:'a'.repeat(64),path,expires_at:'2099-09-09T12:00:00.000Z',
  state:'reserved',upload_state:'reserved',verified_at:null,rejection:null,object:null});
const terminal=(row,state='source-unavailable')=>({...row,state,
  upload_state:state==='canceled'?'canceled':row.upload_state,object:null,verified_at:null,rejection:null});
const legacy=row=>{const result={...row,version:1};for(const key of ['source_id','purpose','expected_source_generation_id','upload_state'])delete result[key];return result;};
let saved=base(),mode='normal',claimId=null,calls=[],failures=[];
const json=(response,body,status=200)=>{response.writeHead(status,{'Content-Type':'application/json'});response.end(JSON.stringify(body));};
const alter=(row,phase)=>{
  if(mode===phase+'-unavailable')return terminal(row);
  if(mode===phase+'-source')return {...row,source_id:id(99)};
  if(mode===phase+'-purpose')return {...row,purpose:row.purpose==='prior-pdf'?'candidate-pdf':'prior-pdf'};
  if(mode===phase+'-generation')return {...row,expected_source_generation_id:id(99)};
  if(mode===phase+'-legacy')return legacy(row);
  return {...row,private_field:service,verification_claim_id:claimId};
};
const fake=createServer(async(request,response)=>{
  try{
    const url=new URL(request.url,'http://127.0.0.1'),route=url.pathname,headers=request.headers;
    let raw='';for await(const chunk of request){raw+=chunk;assert.ok(raw.length<16384);}
    const body=raw?JSON.parse(raw):null;
    calls.push({route,body,headers,method:request.method,query:url.searchParams});
    if(route==='/auth/v1/user'){
      assert.equal(request.method,'GET');assert.equal(headers.apikey,anon);
      if(headers.authorization!=='Bearer '+token)return json(response,{message:'secret '+service,code:'bad_jwt'},401);
      return json(response,{id:actor,aud:'authenticated',role:'authenticated'});
    }
    if(route.startsWith('/rest/v1/rpc/')){
      assert.equal(request.method,'POST');const name=route.split('/').at(-1);
      const admin=/^(claim_|record_|reject_|release_)/.test(name);
      assert.equal(headers.apikey,admin?service:anon);assert.equal(headers.authorization,'Bearer '+(admin?service:token));
      if(name==='begin_document_generation_upload_v2'){
        assert.deepEqual(body,{p_source_id:sourceId,p_operation_id:operation,p_purpose:saved.purpose,p_content_sha256:digest,p_byte_length:String(pdf.length)});
        if(mode==='denied')return json(response,{code:'42501',message:'SELECT secret '+service,details:token},403);
        return json(response,alter(saved,'begin'));
      }
      if(name==='begin_document_generation_upload'){
        assert.deepEqual(body,{p_document_id:document,p_operation_id:operation,p_content_sha256:digest,p_byte_length:String(pdf.length)});
        return json(response,saved); // Deliberately incompatible: v1 request must not accept v2.
      }
      if(name==='get_document_generation_upload'){
        assert.deepEqual(body,{p_operation_id:operation});
        if(mode==='revoke-after-mint')return json(response,{code:'42501',message:'SELECT secret '+service},403);
        if(mode==='cancel-after-mint')return json(response,terminal(saved,'canceled'));
        return json(response,alter(saved,'get'));
      }
      if(name==='cancel_document_generation_upload'){
        assert.deepEqual(body,{p_operation_id:operation});saved=terminal(saved,'canceled');return json(response,alter(saved,'cancel'));
      }
      const prefix={p_actor_user_id:actor,p_operation_id:operation};
      if(name==='claim_document_generation_upload_verification'){
        claimId=body.p_claim_id;assert.match(claimId,/^[0-9a-f-]{36}$/);assert.deepEqual(body,{...prefix,p_claim_id:claimId});
        if(mode==='busy')return json(response,{code:'55P03',message:'secret '+service},409);
        return json(response,alter({...saved,object,verification_claim_id:claimId},'claim'));
      }
      if(name==='record_document_generation_upload_verification'||name==='reject_document_generation_upload_verification'){
        const rejected=name.startsWith('reject_');
        assert.deepEqual(body,{...prefix,p_claim_id:claimId,p_object_id:object.id,p_object_version:object.version,
          p_content_sha256:rejected?sha(bad):digest,p_byte_length:String(pdf.length)});
        saved={...saved,state:rejected?'rejected':'verified',upload_state:rejected?'rejected':'verified',object,
          verified_at:rejected?null:'2099-09-09T11:00:00.000Z',rejection:rejected?{
            reason:'sha256_mismatch',observed_sha256:sha(bad),byte_length:String(pdf.length),
            object:{id:object.id,version:object.version},rejected_at:'2099-09-09T11:00:00.000Z'}:null};
        if(mode==='lost-record'&&!rejected){response.destroy();return;}
        return json(response,alter(saved,rejected?'reject':'record'));
      }
      if(name==='release_document_generation_upload_verification'){
        assert.deepEqual(body,{...prefix,p_claim_id:claimId});return json(response,{released:true});
      }
      throw new Error('Unexpected RPC '+name);
    }
    assert.equal(headers.apikey,service);assert.equal(headers.authorization,'Bearer '+service);
    if(route==='/storage/v1/object/upload/sign/documents/'+path){
      assert.equal(request.method,'POST');assert.deepEqual(body,{});assert.equal(headers['x-upsert'],undefined);
      return json(response,{url:'/object/upload/sign/documents/'+path+'?token=fixture-upload-token'});
    }
    assert.equal(request.method,'GET');assert.equal(route,'/storage/v1/object/documents/'+path);
    assert.equal(headers['cache-control'],'no-cache');assert.deepEqual([...url.searchParams.keys()],['cacheNonce']);
    assert.ok(url.searchParams.get('cacheNonce'));
    const bytes=mode==='bad-hash'||mode.startsWith('reject-')?bad:mode==='short'?pdf.subarray(0,-1):pdf;
    response.writeHead(200,{'Content-Type':'application/pdf'});
    for(let offset=0;offset<bytes.length;offset+=3)response.write(bytes.subarray(offset,offset+3));
    response.end();
  }catch(error){failures.push(error);if(!response.headersSent)json(response,{message:'Fixture assertion failed'},500);else response.destroy();}
});
const children=new Set();
async function start(capture,storage){
  const origin=`http://127.0.0.1:${fake.address().port}`;
  const code=`
    const originalFetch=globalThis.fetch;
    globalThis.fetch=(input,init)=>{
      const target=new URL(input instanceof Request?input.url:String(input));
      if(target.origin!==${JSON.stringify(origin)})throw new Error('Non-local fixture fetch denied');
      return originalFetch(input,init);
    };
    const originalServe=Deno.serve;let server;
    Deno.serve=(handler)=>server=originalServe({hostname:'127.0.0.1',port:0,
      onListen:({port})=>console.log('FIXTURE_READY:'+port)},handler);
    Deno.addSignalListener('SIGTERM',async()=>{if(server)await server.shutdown();Deno.exit(0);});
    await import(${JSON.stringify(index)});
  `;
  const child=spawn('deno',['eval','--config',config,'--node-modules-dir=none','--cached-only','--no-lock',code],{
    cwd:directory,env:{PATH:process.env.PATH,HOME:process.env.HOME,SUPABASE_URL:origin,
      SUPABASE_ANON_KEY:anon,SUPABASE_SERVICE_ROLE_KEY:service,
      SURVEY_GENERATION_SOURCE_CAPTURE:capture?'v1-metadata-only':'disabled',
      SURVEY_GENERATION_STORAGE_CONTRACT:storage?'versioned-standard-v1':'disabled'},stdio:['ignore','pipe','pipe'],
  });
  const state={child,output:'',closed:false,spawnError:null};children.add(state);
  state.closedPromise=new Promise(resolve=>child.once('close',()=>{state.closed=true;resolve();}));
  child.on('error',error=>{state.spawnError=error;});
  return await new Promise((resolve,reject)=>{
    let finished=false;
    const finish=(error,port)=>{if(finished)return;finished=true;clearTimeout(timer);child.stdout.off('data',inspect);
      error?reject(error):resolve({url:`http://127.0.0.1:${port}`,state});};
    const inspect=()=>{const match=state.output.match(/FIXTURE_READY:(\d+)/);if(match)finish(null,match[1]);};
    const timer=setTimeout(()=>finish(new Error(`Deno fixture start timed out: ${state.output}`)),15000);
    for(const pipe of [child.stdout,child.stderr])pipe.on('data',chunk=>{state.output=(state.output+chunk).slice(-32768);});
    child.stdout.on('data',inspect);child.once('error',error=>finish(error));
    child.once('close',()=>finish(new Error(`Deno fixture exited before ready: ${state.output}`)));
  });
}
async function stop(state){
  if(!state.closed){state.child.kill('SIGTERM');const timer=setTimeout(()=>state.child.kill('SIGKILL'),2000);
    try{await state.closedPromise;}finally{clearTimeout(timer);}}
  children.delete(state);if(state.spawnError)throw state.spawnError;
}

async function call(server,action='begin',extra={},authorization='Bearer '+token){
  const input={action,operation_id:operation,...(action==='begin'?{source_id:sourceId,purpose:saved.purpose,content_sha256:digest,byte_length:String(pdf.length)}:{}),...extra};
  if(extra.legacy){delete input.legacy;delete input.source_id;delete input.purpose;input.document_id=document;}
  const response=await fetch(server.url,{method:'POST',headers:{Authorization:authorization,'Content-Type':'application/json'},
    body:JSON.stringify(input),signal:AbortSignal.timeout(10000)});
  assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('access-control-allow-origin'),'*');
  const body=await response.json();assert.deepEqual(failures,[]);return{status:response.status,body};
}
const routes=()=>calls.map(call=>call.route);
const rpc=name=>'/rest/v1/rpc/'+name;
const begin=rpc('begin_document_generation_upload_v2'),get=rpc('get_document_generation_upload');
const claim=rpc('claim_document_generation_upload_verification'),record=rpc('record_document_generation_upload_verification');
const reject=rpc('reject_document_generation_upload_verification'),release=rpc('release_document_generation_upload_verification');
const mint='/storage/v1/object/upload/sign/documents/'+path,download='/storage/v1/object/documents/'+path;
function reset(scenario='normal',purpose='candidate-pdf',expected=null){saved=base(purpose,expected);mode=scenario;calls=[];claimId=null;}
function safeError(result,status){assert.equal(result.status,status,JSON.stringify(result.body));
  for(const secret of [service,token,anon,'SELECT secret','fixture-upload-token'])assert.ok(!JSON.stringify(result.body).includes(secret));}
function operationIs(result,expected=saved){assert.deepEqual(result.body.operation,expected);assert.ok(!JSON.stringify(result.body.operation).includes(service));}
function unavailable(result){safeError(result,409);operationIs(result,terminal(saved));assert.equal(result.body.upload,undefined);}
let cleanupPromise;
function cleanup(){return cleanupPromise??=(async()=>{
  const stopped=await Promise.allSettled([...children].map(stop));fake.closeAllConnections();await new Promise(resolve=>fake.close(resolve));
  assert.ok(stopped.every(result=>result.status==='fulfilled'),'Deno cleanup failed');console.log('All local Deno children exited and fake HTTP server closed.');
})(); }
const terminated=()=>{void cleanup().then(()=>process.exit(143),()=>process.exit(1));};
const interrupted=()=>{void cleanup().then(()=>process.exit(130),()=>process.exit(1));};
process.once('SIGTERM',terminated);process.once('SIGINT',interrupted);
let passed=0;
try{
  await new Promise((resolve,reject)=>{fake.once('error',reject);fake.listen(0,'127.0.0.1',resolve);});
  const disabled=await start(true,false);safeError(await call(disabled),503);assert.deepEqual(calls,[]);await stop(disabled.state);passed++;
  const captureOff=await start(false,true);
  reset();safeError(await call(captureOff),503);assert.deepEqual(routes(),['/auth/v1/user']);passed++;
  reset();safeError(await call(captureOff,'verify'),503);assert.deepEqual(routes(),['/auth/v1/user',get]);passed++;
  reset();const readable=await call(captureOff,'get');assert.equal(readable.status,200);operationIs(readable);passed++;
  reset();const canceled=await call(captureOff,'cancel');assert.equal(canceled.status,200);operationIs(canceled);assert.equal(saved.state,'canceled');passed++;
  await stop(captureOff.state);
  const enabled=await start(true,true);
  reset();safeError(await call(enabled,'begin',{},'Bearer bad-token'),401);assert.deepEqual(routes(),['/auth/v1/user']);passed++;
  for(const extra of [{document_id:document},{actor_user_id:id(99)},{purpose:'other'},{source_id:null},{claim_id:id(99)}]){
    reset();safeError(await call(enabled,'begin',extra),400);assert.deepEqual(routes(),['/auth/v1/user']);passed++;
  }
  for(const purpose of ['prior-pdf','candidate-pdf'])for(const expected of [null,id(9)]){
    reset('normal',purpose,expected);const begun=await call(enabled);assert.equal(begun.status,200);operationIs(begun);
    assert.equal(begun.body.upload.path,path);assert.equal(begun.body.upload.token,'fixture-upload-token');
    assert.deepEqual(routes(),['/auth/v1/user',begin,mint,get]);passed++;
    calls=[];saved.object=object;const verified=await call(enabled,'verify');assert.equal(verified.status,200);operationIs(verified);
    assert.deepEqual(routes(),['/auth/v1/user',get,claim,download,record]);passed++;
    calls=[];const replay=await call(enabled,'verify');assert.equal(replay.status,200);operationIs(replay);
    assert.deepEqual(routes(),['/auth/v1/user',get]);passed++;
  }
  for(const phase of ['begin','get','claim','record','reject'])for(const field of ['source','purpose','generation','legacy']){
    if(phase==='begin'&&field==='generation')continue; // Only SQL knows the captured expected generation before begin.
    reset(phase+'-'+field);const action=['begin','get'].includes(phase)?'begin':'verify';
    const result=await call(enabled,action);safeError(result,502);assert.equal(result.body.operation,undefined);
    if(phase==='begin')assert.deepEqual(routes(),['/auth/v1/user',begin]);
    if(phase==='get')assert.deepEqual(routes(),['/auth/v1/user',begin,mint,get]);
    if(phase==='claim')assert.ok(!routes().includes(download));
    if(['record','reject'].includes(phase))assert.ok(!routes().includes(release));
    passed++;
  }
  reset();safeError(await call(enabled,'begin',{legacy:true}),502);assert.ok(!routes().includes(mint));passed++;
  for(const phase of ['begin','get','claim']){
    reset(phase+'-unavailable');unavailable(await call(enabled,phase==='claim'?'verify':'begin'));
    assert.ok(!routes().includes(download));if(phase!=='get')assert.ok(!routes().includes(mint));passed++;
  }
  for(const phase of ['record','reject']){
    reset(phase+'-unavailable');unavailable(await call(enabled,'verify'));
    assert.equal(routes().filter(route=>route===download).length,1);
    assert.equal(routes().at(-1),phase==='record'?record:reject);
    assert.ok(!routes().includes(release));passed++;
  }
  reset('get-unavailable');const inspect=await call(enabled,'get');assert.equal(inspect.status,200);operationIs(inspect,terminal(saved));passed++;
  reset('get-unavailable');unavailable(await call(enabled,'verify'));assert.deepEqual(routes(),['/auth/v1/user',get]);passed++;
  for(const [scenario,status] of [['denied',403],['revoke-after-mint',403],['cancel-after-mint',409]]){
    reset(scenario);safeError(await call(enabled),status);assert.ok(!routes().includes(download));passed++;
  }
  reset('short');safeError(await call(enabled,'verify'),422);assert.equal(routes().at(-1),release);assert.ok(!routes().includes(record));passed++;
  reset('bad-hash');const rejected=await call(enabled,'verify');safeError(rejected,422);operationIs(rejected);assert.equal(saved.state,'rejected');
  assert.ok(routes().includes(reject));assert.ok(!routes().includes(release));calls=[];
  safeError(await call(enabled,'verify'),422);assert.deepEqual(routes(),['/auth/v1/user',get]);passed++;
  reset('lost-record');safeError(await call(enabled,'verify'),502);assert.ok(!routes().includes(release));
  mode='normal';calls=[];const recovered=await call(enabled,'verify');assert.equal(recovered.status,200);operationIs(recovered);
  assert.deepEqual(routes(),['/auth/v1/user',get]);passed++;
  assert.deepEqual(failures,[]);await stop(enabled.state);
  console.log('Document generation source-bound uploads local HTTP checks passed: '+passed);
}finally{await cleanup();process.off('SIGTERM',terminated);process.off('SIGINT',interrupted);}
