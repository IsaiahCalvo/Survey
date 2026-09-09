// Actual cached Deno/Supabase SDK against localhost only. This proves request
// paths, byte-stream consumption and receipts, not hosted physical versioning.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

if(process.env.SURVEY_GENERATION_SOURCE_BYTES_HTTP_INTEGRATION!=='1'){
  console.log('Skipped: set SURVEY_GENERATION_SOURCE_BYTES_HTTP_INTEGRATION=1 for local Deno/SDK HTTP tests.');
  process.exit(0);
}
const directory=fileURLToPath(new URL('../supabase/functions/document-generation-source-bytes/',import.meta.url));
const index=new URL('../supabase/functions/document-generation-source-bytes/index.ts',import.meta.url).href;
const config=fileURLToPath(new URL('../supabase/functions/document-generation-source-bytes/deno.json',import.meta.url));
const id=n=>`84000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),sourceId=id(2),documentId=id(3),generationId=id(4);
const token='fixture-bytes-caller',anon='fixture-bytes-anon',service='fixture-bytes-service';
const pdf=Buffer.from('%PDF-1.7\nSDK exact source bytes\n%%EOF');
const sidecar=Buffer.from('{"version":1,"label":"sidecar 😀"}');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const object=(kind,path,bytes,n)=>({kind,bucket_id:'documents',path,id:id(n),version:id(n+1),byte_length:String(bytes.length),content_sha256:null});
const objects=(reserved=false)=>[
  object('pdf',reserved==='complex'?'/leading//literal%2F/white space-雪?#%.pdf':reserved?'legacy/raw?#%.pdf':'legacy/source.pdf',pdf,5),
  object('sidecar',reserved==='complex'?'//leading/literal%2e%2e/side 😀.json':reserved?'legacy/side%20?#.json':'legacy/source_data.json',sidecar,7),
];
const base=(generation=null,reserved=false)=>({version:1,source_id:sourceId,actor_user_id:actor,document_id:documentId,
  generation_id:generation,source_sql_sha256:'a'.repeat(64),state:'unverified',objects:objects(reserved),
  verified_at:null,expires_at:'2099-09-09T12:00:00.000Z'});
let mode='normal',saved=base(),claimId=null,calls=[],failures=[];
const json=(response,body,status=200)=>{response.writeHead(status,{'Content-Type':'application/json'});response.end(JSON.stringify(body));};
const manifest=()=>saved.objects.map(row=>({...row,content_sha256:sha(row.kind==='pdf'?pdf:sidecar)}));
const fake=createServer(async(request,response)=>{
  try{
    const url=new URL(request.url,'http://127.0.0.1'),route=url.pathname;
    let raw='';for await(const chunk of request){raw+=chunk;assert.ok(raw.length<32768);}
    const body=raw?JSON.parse(raw):null,headers=request.headers;
    calls.push({route,body,headers,method:request.method,query:url.searchParams});
    if(route==='/auth/v1/user'){
      assert.equal(request.method,'GET');assert.equal(headers.apikey,anon);
      if(headers.authorization!==`Bearer ${token}`)return json(response,{msg:`bad token ${service}`,code:'bad_jwt'},401);
      return json(response,{id:actor,aud:'authenticated',role:'authenticated'});
    }
    assert.equal(headers.apikey,service);assert.equal(headers.authorization,`Bearer ${service}`);
    if(route.startsWith('/rest/v1/rpc/')){
      assert.equal(request.method,'POST');const name=route.split('/').at(-1);
      const prefix={p_actor_user_id:actor,p_source_id:sourceId};
      if(name==='get_document_generation_source_bytes'){
        assert.deepEqual(body,prefix);
        if(mode==='denied')return json(response,{code:'42501',message:`SELECT secret ${service}`,details:token},403);
        if(mode==='expired'||mode==='canceled')return json(response,{...saved,state:mode,objects:[],verified_at:null});
        if(mode==='wrong-actor')return json(response,{...saved,actor_user_id:id(99)});
        if(mode==='missing-pdf')return json(response,{...saved,objects:[]});
        if(mode==='null-version')return json(response,{...saved,objects:saved.objects.map((row,i)=>i?row:{...row,version:null})});
        if(mode==='null-size')return json(response,{...saved,objects:saved.objects.map((row,i)=>i?row:{...row,byte_length:null})});
        if(mode==='unsafe-number-size')return json(response,{...saved,objects:saved.objects.map((row,i)=>i?row:{...row,byte_length:9007199254740992})});
        return json(response,{...saved,private_field:service});
      }
      if(name==='claim_document_generation_source_bytes'){
        assert.match(body.p_claim_id,/^[0-9a-f-]{36}$/);claimId=body.p_claim_id;
        assert.deepEqual(body,{...prefix,p_claim_id:claimId});
        if(mode==='busy')return json(response,{code:'55P03',message:`SELECT secret ${service}`},409);
        if(mode==='wrong-claim-object')return json(response,{...saved,state:'verifying',verification_claim_id:claimId,
          verification_claim_expires_at:'2099-09-09T11:30:00.000Z',objects:saved.objects.map((row,i)=>i?row:{...row,version:id(99)})});
        if(mode==='wrong-claim-token')return json(response,{...saved,state:'verifying',verification_claim_id:id(99),
          verification_claim_expires_at:'2099-09-09T11:30:00.000Z'});
        return json(response,{...saved,state:'verifying',verification_claim_id:claimId,
          verification_claim_expires_at:'2099-09-09T11:30:00.000Z'});
      }
      if(name==='record_document_generation_source_bytes'){
        const expected=manifest();assert.deepEqual(body,{...prefix,p_claim_id:claimId,p_objects:expected});
        saved={...saved,state:'verified',objects:expected,verified_at:'2099-09-09T11:00:00.000Z'};
        if(mode==='lost-record'){response.destroy();return;}
        if(mode==='wrong-record-hash')return json(response,{...saved,objects:saved.objects.map((row,i)=>i?row:{...row,content_sha256:'0'.repeat(64)})});
        if(mode==='wrong-record-object')return json(response,{...saved,objects:saved.objects.map((row,i)=>i?row:{...row,version:id(99)})});
        return json(response,{...saved,verification_claim_id:claimId,
          verification_claim_expires_at:'2099-09-09T11:30:00.000Z',private_field:service,
          objects:saved.objects.map(row=>({...row,private_field:service}))});
      }
      if(name==='release_document_generation_source_bytes'){
        assert.deepEqual(body,{...prefix,p_claim_id:claimId});return json(response,{released:true});
      }
      throw new Error(`Unexpected RPC ${name}`);
    }
    assert.equal(request.method,'GET','no upload/copy/delete/signing allowed');
    const prefix='/storage/v1/object/documents/';assert.ok(route.startsWith(prefix),route);
    const exactPath=decodeURIComponent(route.slice(prefix.length));
    const row=saved.objects.find(object=>object.path===exactPath);
    assert.ok(row,`SDK requested a different object: ${JSON.stringify(exactPath)}`);
    assert.equal(headers['cache-control'],'no-cache');assert.ok(url.searchParams.get('cacheNonce'));
    assert.deepEqual([...url.searchParams.keys()],['cacheNonce'],'raw path must never inject query fields');
    if(mode==='missing-object')return json(response,{statusCode:404,message:`missing ${service}`,error:'Not found'},404);
    let bytes=row.kind==='pdf'?pdf:sidecar;
    if(mode===`short-${row.kind}`)bytes=bytes.subarray(0,-1);
    if(mode===`long-${row.kind}`)bytes=Buffer.concat([bytes,Buffer.from('x')]);
    response.writeHead(200,{'Content-Type':row.kind==='pdf'?'application/pdf':'application/json'});
    if(mode==='stream-error'&&row.kind==='sidecar'){
      response.write(bytes.subarray(0,3));response.socket?.destroy();return;
    }
    // Chunk boundaries split both PDF text and UTF-8 JSON. No content length.
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
async function call(server,{action='verify',authorization=`Bearer ${token}`,extra={}}={}){
  const response=await fetch(server.url,{method:'POST',headers:{Authorization:authorization,'Content-Type':'application/json'},
    body:JSON.stringify({action,source_id:sourceId,...extra}),signal:AbortSignal.timeout(10000)});
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'),'*');
  const body=await response.json();assert.deepEqual(failures,[]);return{status:response.status,body};
}
const routes=()=>calls.map(call=>call.route);
const streams=()=>calls.filter(call=>call.route.startsWith('/storage/'));
const rpc=name=>`/rest/v1/rpc/${name}_document_generation_source_bytes`;
function safeError(result,status){assert.equal(result.status,status,JSON.stringify(result.body));
  for(const secret of [token,service,anon,'SELECT secret'])assert.ok(!JSON.stringify(result.body).includes(secret));}
function success(result,expected){assert.equal(result.status,200,JSON.stringify(result.body));assert.deepEqual(result.body,{attestation:expected});}
function reset(scenario='normal',generation=null,reserved=false){mode=scenario;saved=base(generation,reserved);calls=[];claimId=null;}
let cleanupPromise;
function cleanup(){return cleanupPromise??=(async()=>{
  const stopped=await Promise.allSettled([...children].map(stop));fake.closeAllConnections();await new Promise(resolve=>fake.close(resolve));
  assert.ok(stopped.every(result=>result.status==='fulfilled'),'Deno cleanup failed');console.log('All local Deno children exited and fake HTTP server closed.');
})();}
const terminated=()=>{void cleanup().then(()=>process.exit(143),()=>process.exit(1));};
const interrupted=()=>{void cleanup().then(()=>process.exit(130),()=>process.exit(1));};
process.once('SIGTERM',terminated);process.once('SIGINT',interrupted);
let passed=0;
try{
  await new Promise((resolve,reject)=>{fake.once('error',reject);fake.listen(0,'127.0.0.1',resolve);});
  for(const flags of [[false,false],[true,false],[false,true]]){
    const disabled=await start(...flags);safeError(await call(disabled),503);assert.deepEqual(calls,[]);await stop(disabled.state);passed++;
  }
  const enabled=await start(true,true);
  safeError(await call(enabled,{authorization:'Bearer bad-fixture-token'}),401);assert.deepEqual(routes(),['/auth/v1/user']);passed++;
  for(const extra of [{actor_user_id:id(99)},{path:'other.pdf'},{claim_id:id(90)}]){
    reset();safeError(await call(enabled,{extra}),400);assert.ok(!routes().some(route=>route.startsWith('/rest/')));passed++;
  }
  reset();success(await call(enabled,{action:'get'}),saved);assert.deepEqual(routes(),['/auth/v1/user',rpc('get')]);passed++;
  for(const [generation,reserved] of [[null,false],[generationId,true],[generationId,'complex']]){
    reset('normal',generation,reserved);success(await call(enabled),saved);
    assert.equal(saved.state,'verified');assert.equal(streams().length,2);
    assert.deepEqual(routes().slice(0,3),['/auth/v1/user',rpc('get'),rpc('claim')]);assert.equal(routes().at(-1),rpc('record'));
    assert.deepEqual(streams().map(call=>decodeURIComponent(call.route.slice('/storage/v1/object/documents/'.length))),saved.objects.map(row=>row.path));
    assert.ok(!routes().includes(rpc('release')));passed++;
    calls=[];success(await call(enabled),saved);assert.deepEqual(routes(),['/auth/v1/user',rpc('get')]);passed++;
  }
  for(const path of ['legacy/../other.pdf','legacy/./source.pdf']){
    reset();saved.objects[0].path=path;safeError(await call(enabled),409);
    assert.deepEqual(routes(),['/auth/v1/user',rpc('get')]);passed++;
  }
  for(const scenario of ['short-pdf','long-pdf','short-sidecar','long-sidecar','stream-error']){
    reset(scenario);const result=await call(enabled);assert.ok(result.status>=400,JSON.stringify(result));
    assert.ok(!routes().includes(rpc('record')));assert.equal(routes().at(-1),rpc('release'));passed++;
  }
  for(const [scenario,status] of [['expired',409],['canceled',409],['denied',403],['busy',409],['wrong-actor',502]]){
    reset(scenario);safeError(await call(enabled),status);assert.equal(streams().length,0);assert.ok(!routes().includes(rpc('record')));passed++;
  }
  for(const scenario of ['expired','canceled']){
    reset(scenario);success(await call(enabled,{action:'get'}),{...saved,state:scenario,objects:[],verified_at:null});
    assert.deepEqual(routes(),['/auth/v1/user',rpc('get')]);passed++;
  }
  for(const scenario of ['missing-pdf','null-version','null-size','unsafe-number-size','wrong-claim-object','wrong-claim-token']){
    reset(scenario);safeError(await call(enabled),502);assert.equal(streams().length,0);
    assert.ok(!routes().includes(rpc('record')));assert.ok(!routes().includes(rpc('release')));passed++;
  }
  reset('missing-object');safeError(await call(enabled),503);assert.equal(streams().length,1);
  assert.ok(!routes().includes(rpc('record')));assert.equal(routes().at(-1),rpc('release'));passed++;
  for(const scenario of ['wrong-record-hash','wrong-record-object']){
    reset(scenario);safeError(await call(enabled),502);assert.equal(streams().length,2);assert.ok(!routes().includes(rpc('release')));passed++;
  }
  reset('lost-record');const unknown=await call(enabled);assert.ok(unknown.status>=500);assert.ok(!routes().includes(rpc('release')));
  mode='normal';const before=streams().length;success(await call(enabled,{action:'get'}),saved);success(await call(enabled),saved);
  assert.equal(streams().length,before);assert.equal(saved.state,'verified');passed++;
  assert.deepEqual(failures,[]);await stop(enabled.state);console.log(`Document generation source bytes local HTTP checks passed: ${passed}`);
}finally{await cleanup();process.off('SIGTERM',terminated);process.off('SIGINT',interrupted);}
