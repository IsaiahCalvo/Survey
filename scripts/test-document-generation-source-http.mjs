// Opt-in actual Deno entry point + cached Supabase SDK, with localhost-only
// fake auth/RPC responses. This does not prove hosted JWT verification or RLS.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.env.SURVEY_GENERATION_SOURCE_HTTP_INTEGRATION !== '1') {
  console.log('Skipped: set SURVEY_GENERATION_SOURCE_HTTP_INTEGRATION=1 for local Deno/SDK HTTP tests.');
  process.exit(0);
}
const directory=fileURLToPath(new URL('../supabase/functions/document-generation-source/',import.meta.url));
const index=new URL('../supabase/functions/document-generation-source/index.ts',import.meta.url).href;
const config=fileURLToPath(new URL('../supabase/functions/document-generation-source/deno.json',import.meta.url));
const id=n=>`83000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),sourceId=id(2),documentId=id(3),generationId=id(4);
const token='fixture-source-caller',anon='fixture-source-anon',service='fixture-source-service';
const object={bucket_id:'documents',path:'legacy/raw?#%.pdf',id:id(5),version:null,byte_length:'123'};
const sourceRows={annotation_snapshot:null,annotation_updates:[],document_annotations:[],
  doc_yjs_state:null,doc_yjs_updates:[],survey_sessions:[],survey_items:[],active_generation:null};
const descriptor=(generation=null)=>({version:1,source_id:sourceId,actor_user_id:actor,
  document_id:documentId,generation_id:generation,state:'captured',source_byte_state:'unverified',
  source_sql_sha256:'a'.repeat(64),wal_head:'9007199254740993',expires_at:'2099-09-09T12:00:00.000Z',
  source_object:object,sidecar_objects:[{...object,id:id(6),path:'legacy/sidecar_data.json',byte_length:null}],
  visible_capture:{document:{id:documentId},sources:{...sourceRows,active_generation:generation===null?null:{
    baseline:{document_id:documentId,generation_id:generation,base_seq:'0',baseline_snapshot_base64:''},snapshot:null,updates:[]}},
    compare:{wal_head:'9007199254740993',covered_head:'9007199254740994'},
    scope:'sql-metadata-only'}});
let calls=[],failures=[],mode='normal',saved=descriptor(),expectedGeneration=null;
const json=(response,body,status=200)=>{response.writeHead(status,{'Content-Type':'application/json'});response.end(JSON.stringify(body));};
const fake=createServer(async(request,response)=>{
  try {
    const route=new URL(request.url,'http://127.0.0.1').pathname;
    let raw='';for await(const chunk of request){raw+=chunk;assert.ok(raw.length<16384);}
    const body=raw?JSON.parse(raw):null,headers=request.headers;
    calls.push({route,body,headers,method:request.method});
    if(route==='/auth/v1/user'){
      assert.equal(request.method,'GET');assert.equal(headers.apikey,anon);
      if(headers.authorization!==`Bearer ${token}`)return json(response,{msg:`bad caller ${service}`,code:'bad_jwt'},401);
      return json(response,{id:actor,aud:'authenticated',role:'authenticated'});
    }
    assert.ok(route.startsWith('/rest/v1/rpc/'),'metadata-only source endpoint must never call Storage');
    assert.equal(request.method,'POST');assert.equal(headers.apikey,service);
    assert.equal(headers.authorization,`Bearer ${service}`);
    const name=route.split('/').at(-1);
    assert.ok(['begin_document_generation_source','get_document_generation_source','cancel_document_generation_source'].includes(name));
    assert.deepEqual(body,name==='begin_document_generation_source'
      ?{p_actor_user_id:actor,p_document_id:documentId,p_source_id:sourceId,p_generation_id:expectedGeneration}
      :{p_actor_user_id:actor,p_source_id:sourceId});
    if(mode==='sql-denied')return json(response,{code:'42501',message:`SELECT secret ${service}`,details:token,hint:anon},403);
    if(name==='begin_document_generation_source')saved=descriptor(expectedGeneration);
    if(name==='cancel_document_generation_source')saved={...saved,state:'canceled',visible_capture:null,source_object:null,sidecar_objects:[]};
    if(mode==='lost-begin'&&name==='begin_document_generation_source'){response.destroy();return;}
    if(mode==='expired')return json(response,{...saved,state:'expired',visible_capture:null,source_object:null,sidecar_objects:[]});
    if(mode==='wrong-actor')return json(response,{...saved,actor_user_id:id(90)});
    if(mode==='wrong-source')return json(response,{...saved,source_id:id(91)});
    if(mode==='wrong-generation')return json(response,{...saved,generation_id:id(92)});
    if(mode==='foreign-survey')return json(response,{...saved,visible_capture:{...saved.visible_capture,
      sources:{...saved.visible_capture.sources,survey_sessions:[{id:id(70),user_id:id(90),document_id:documentId}]}}});
    if(mode==='orphan-survey-item')return json(response,{...saved,visible_capture:{...saved.visible_capture,
      sources:{...saved.visible_capture.sources,survey_items:[{id:id(71),session_id:id(70)}]}}});
    if(mode==='foreign-document-row')return json(response,{...saved,visible_capture:{...saved.visible_capture,
      sources:{...saved.visible_capture.sources,document_annotations:[{id:id(72),document_id:id(90)}]}}});
    if(mode==='terminal-leak')return json(response,{...saved,state:'canceled'});
    if(mode==='missing-object')return json(response,{...saved,source_object:null,sidecar_objects:[]});
    if(mode==='unknown-fields')return json(response,{...saved,private_field:service,
      source_object:{...saved.source_object,private_object:service},
      sidecar_objects:saved.sidecar_objects.map(row=>({...row,private_sidecar:service})),
      visible_capture:{...saved.visible_capture,private_capture:service,
        sources:{...saved.visible_capture.sources,private_source:service}}});
    return json(response,saved);
  }catch(error){failures.push(error);json(response,{message:'Fixture assertion failed'},500);}
});
const children=new Set();
async function start(enabled){
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
      SURVEY_GENERATION_SOURCE_CAPTURE:enabled?'v1-metadata-only':'disabled'},stdio:['ignore','pipe','pipe'],
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
    child.stdout.on('data',inspect);
    child.once('error',error=>finish(error));
    child.once('close',()=>finish(new Error(`Deno fixture exited before ready: ${state.output}`)));
  });
}
async function stop(state){
  if(!state.closed){state.child.kill('SIGTERM');const timer=setTimeout(()=>state.child.kill('SIGKILL'),2000);
    try{await state.closedPromise;}finally{clearTimeout(timer);}}
  children.delete(state);if(state.spawnError)throw state.spawnError;
}
async function call(server,{action='begin',authorization=`Bearer ${token}`,extra={},raw=null}={}){
  const body={action,source_id:sourceId,...(action==='begin'?{document_id:documentId,generation_id:expectedGeneration}:{}),...extra};
  const response=await fetch(server.url,{method:'POST',headers:{Authorization:authorization,'Content-Type':'application/json'},
    body:raw??JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'),'*');
  const payload=await response.json();assert.deepEqual(failures,[]);return{status:response.status,body:payload};
}
const routes=()=>calls.map(call=>call.route);
function safeError(result,status){assert.equal(result.status,status,JSON.stringify(result.body));
  for(const secret of [token,service,anon,'SELECT secret'])assert.ok(!JSON.stringify(result.body).includes(secret));}
function sourceResult(result,expected){assert.equal(result.status,200,JSON.stringify(result.body));assert.deepEqual(result.body,{source:expected});}
let cleanupPromise;
function cleanup(){return cleanupPromise??=(async()=>{
  const stopped=await Promise.allSettled([...children].map(stop));fake.closeAllConnections();
  await new Promise(resolve=>fake.close(resolve));assert.ok(stopped.every(result=>result.status==='fulfilled'),'Deno child cleanup failed');
  console.log('All local Deno children exited and fake HTTP server closed.');
})();}
const terminated=()=>{void cleanup().then(()=>process.exit(143),()=>process.exit(1));};
const interrupted=()=>{void cleanup().then(()=>process.exit(130),()=>process.exit(1));};
process.once('SIGTERM',terminated);process.once('SIGINT',interrupted);
let passed=0;
try{
  await new Promise((resolve,reject)=>{fake.once('error',reject);fake.listen(0,'127.0.0.1',resolve);});
  const disabled=await start(false);safeError(await call(disabled),503);assert.deepEqual(calls,[]);passed++;await stop(disabled.state);
  const enabled=await start(true);
  calls=[];safeError(await call(enabled,{authorization:''}),401);assert.deepEqual(calls,[]);passed++;
  safeError(await call(enabled,{authorization:'Bearer bad-fixture-token'}),401);assert.deepEqual(routes(),['/auth/v1/user']);passed++;
  calls=[];safeError(await call(enabled,{extra:{actor_user_id:id(90)}}),400);assert.deepEqual(routes(),['/auth/v1/user']);passed++;
  calls=[];safeError(await call(enabled,{raw:'{malformed'}),400);assert.deepEqual(routes(),['/auth/v1/user']);passed++;
  calls=[];safeError(await call(enabled,{extra:{generation_id:undefined}}),400);assert.deepEqual(routes(),['/auth/v1/user']);passed++;
  for(const gen of [null,generationId]){
    expectedGeneration=gen;calls=[];sourceResult(await call(enabled),descriptor(gen));
    assert.deepEqual(routes(),['/auth/v1/user','/rest/v1/rpc/begin_document_generation_source']);passed++;
  }
  calls=[];sourceResult(await call(enabled,{action:'get'}),descriptor(generationId));
  assert.deepEqual(routes(),['/auth/v1/user','/rest/v1/rpc/get_document_generation_source']);passed++;
  mode='unknown-fields';calls=[];sourceResult(await call(enabled,{action:'get'}),descriptor(generationId));passed++;
  mode='missing-object';sourceResult(await call(enabled,{action:'get'}),{...descriptor(generationId),source_object:null,sidecar_objects:[]});passed++;
  mode='normal';calls=[];sourceResult(await call(enabled,{action:'cancel'}),{...descriptor(generationId),
    state:'canceled',visible_capture:null,source_object:null,sidecar_objects:[]});
  assert.deepEqual(routes(),['/auth/v1/user','/rest/v1/rpc/cancel_document_generation_source']);passed++;
  sourceResult(await call(enabled,{action:'get'}),saved);passed++;
  saved=descriptor(generationId);mode='expired';
  sourceResult(await call(enabled,{action:'get'}),{...saved,state:'expired',
    visible_capture:null,source_object:null,sidecar_objects:[]});passed++;
  for(const scenario of ['sql-denied','wrong-actor','wrong-source','wrong-generation',
    'foreign-survey','orphan-survey-item','foreign-document-row','terminal-leak']){
    mode=scenario;calls=[];safeError(await call(enabled),scenario==='sql-denied'?403:502);
    assert.deepEqual(routes(),['/auth/v1/user','/rest/v1/rpc/begin_document_generation_source']);passed++;
  }
  mode='lost-begin';calls=[];safeError(await call(enabled),503);mode='normal';sourceResult(await call(enabled,{action:'get'}),descriptor(generationId));
  const repeated=calls.filter(call=>call.route.endsWith('/begin_document_generation_source'));
  assert.ok(repeated.length>=1&&repeated.length<=2,'cached SDK/HTTP retry stays bounded');
  assert.ok(repeated.every(call=>JSON.stringify(call.body)===JSON.stringify(repeated[0].body)),
    'lost reply retries never invent a new source identity');passed++;
  assert.deepEqual(failures,[]);await stop(enabled.state);
  console.log(`Document generation source local HTTP checks passed: ${passed}`);
}finally{await cleanup();process.off('SIGTERM',terminated);process.off('SIGINT',interrupted);}
