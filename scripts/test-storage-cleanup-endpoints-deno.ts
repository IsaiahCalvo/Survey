// Actual Edge handlers and pinned SDK; synthetic HTTP/SQL/provider boundary.
// No inherited secrets, real accounts, server, or external network permission.
import assert from 'node:assert/strict';
const actor='11111111-1111-4111-8111-111111111111',path=`${actor}/fixture.pdf`;
const config:Record<string,string>={SUPABASE_URL:'https://storage-cleanup.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-service-key',SUPABASE_ANON_KEY:'fixture-anon-key',ARCHIVE_PURGE_CRON_SECRET:'fixture-cron-secret'};
let handler:(req:Request)=>Promise<Response>;
Object.defineProperty(Deno.env,'get',{value:(name:string)=>config[name]});
Object.defineProperty(Deno,'serve',{value:(value:typeof handler)=>{handler=value;}});
let calls:string[]=[],queue=new Set<string>(),objects=new Set<string>(),retired=new Set<string>();
let fault='',shared=false,checks=0,listCalls=0;
const reset=(problem='',referenced=false)=>{calls=[];queue=new Set([path]);objects=new Set([path]);retired=new Set();fault=problem;shared=referenced;listCalls=0;};
const ok=(data:unknown)=>Response.json(data);
const fail=()=>Response.json({code:'fixture_failure',message:'Synthetic boundary failure',error:'Synthetic boundary failure',statusCode:'500'},{status:500});
globalThis.fetch=async(input:Request|URL|string,init?:RequestInit)=>{
 const url=new URL(input instanceof Request?input.url:String(input));
 assert.equal(url.origin,config.SUPABASE_URL,'No external destination may be contacted');
 const method=init?.method||(input instanceof Request?input.method:'GET');
 const body=typeof init?.body==='string'?JSON.parse(init.body):{};
 calls.push(`${method} ${url.pathname}`);
 if(url.pathname==='/auth/v1/user')return fault==='auth'?Response.json({message:'not authenticated'},{status:401}):ok({id:actor,aud:'authenticated'});
 if(url.pathname==='/rest/v1/user_subscriptions')return ok([{stripe_customer_id:null}]);
 if(url.pathname===`/auth/v1/admin/users/${actor}`){assert.equal(method,'DELETE');assert.equal(objects.size,0);return ok({id:actor});}
 if(url.pathname==='/storage/v1/object/list/documents'){
   listCalls++;
   if(fault==='account_list')return fail();
   if(fault==='list_null')return ok(null);
   if(fault==='list_missing_name')return ok([{id:'22222222-2222-4222-8222-222222222222'}]);
   if(fault==='list_missing_id')return ok([{name:'fixture.pdf'}]);
   const children=new Map<string,{name:string,id:string|null}>();
   for(const name of objects){
     if(!name.startsWith(body.prefix+'/'))continue;
     const relative=name.slice(body.prefix.length+1),child=relative.split('/')[0];
     children.set(child,{name:child,id:relative.includes('/')?null:'22222222-2222-4222-8222-222222222222'});
   }
   const entries=[...children.values()].sort((a,b)=>a.name.localeCompare(b.name)).slice(body.offset,body.offset+body.limit);
   if(fault==='list_oversize')return ok(listCalls===1?Array(101).fill(entries[0]):[]);
   return ok(entries);
 }
 if(url.pathname==='/storage/v1/object/documents'){
   assert.equal(method,'DELETE');const paths=body.prefixes as string[];
   assert.ok(paths.every(p=>retired.has(p)),'Storage delete requires an earlier committed-retirement reply');
   if(fault==='remove')return fail();
   const removed=paths.filter(p=>objects.has(p));for(const p of paths)objects.delete(p);
   return ok(removed.map(name=>({name})));
 }
 if(url.pathname==='/rest/v1/archive_purge_runs'){assert.equal(method,'PATCH');return new Response(null,{status:204});}
 const rpc=url.pathname.split('/rest/v1/rpc/')[1];
 if(rpc==='sweep_expired_archives')return ok({run_id:'33333333-3333-4333-8333-333333333333',projects_purged:0,documents_purged:0,templates_purged:0,orphaned_paths:[],batch_limit:50,failed:0,skipped:0});
 if(rpc==='delete_account_owned_rows')return fault==='rows'?fail():ok({ok:true});
 if(rpc==='list_document_storage_cleanup')return fault==='list'?fail():ok({paths:[...queue]});
 if(rpc==='retire_document_storage_paths'){
   if(fault==='retire')return fail();
   if(shared)return ok({retired_paths:[],referenced_paths:body.p_paths});
   for(const p of body.p_paths){retired.add(p);queue.add(p);}return ok({retired_paths:body.p_paths,referenced_paths:[]});
 }
 if(rpc==='ack_document_storage_cleanup'){
   if(fault==='ack')return fail();
   const acknowledged=body.p_paths.filter((p:string)=>!objects.has(p));for(const p of acknowledged)queue.delete(p);
   return ok({acknowledged_paths:acknowledged,pending_paths:body.p_paths.filter((p:string)=>objects.has(p))});
 }
 throw Error(`Unexpected local boundary ${method} ${url.pathname}`);
};
await import('../supabase/functions/archive-purge-sweep/index.ts');
const sweep=handler!;
await import('../supabase/functions/delete-account/index.ts');
const account=handler!;
const request=(body:unknown,token='fixture-service-key')=>new Request('https://local-fixture.invalid',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
const check=async(name:string,work:()=>Promise<void>)=>{await work();checks++;console.log('PASS '+name);};
const called=(part:string)=>calls.some(call=>call.includes(part));
await check('unauthorized scheduled caller cannot touch cleanup',async()=>{reset();assert.equal((await sweep(request({},'user-token'))).status,401);assert.deepEqual(calls,[]);});
await check('dry run never claims or removes queued files',async()=>{reset();assert.equal((await sweep(request({dry_run:true}))).status,200);assert.equal(called('list_document_storage_cleanup'),false);assert.equal(called('/storage/'),false);assert.equal(queue.size,1);});
await check('zero new purges still recover the durable cleanup backlog',async()=>{reset();const result=await (await sweep(request({}))).json();assert.equal(result.unlinked,1);assert.equal(queue.size,0);assert.equal(objects.size,0);assert.ok(calls.findIndex(c=>c.includes('retire_document'))<calls.findIndex(c=>c.startsWith('DELETE /storage/')));});
await check('a reference appearing after queue selection keeps the PDF',async()=>{reset('',true);const result=await (await sweep(request({}))).json();assert.equal(result.unlinked,0);assert.equal(objects.size,1);assert.equal(called('/storage/'),false);});
for(const problem of ['retire','remove','list'])await check(`${problem} failure keeps scheduled cleanup pending`,async()=>{reset(problem);const result=await(await sweep(request({}))).json();assert.equal(result.unlinked,0);assert.ok(result.unlink_errors.length);assert.equal(queue.size,1);assert.equal(objects.size,1);if(problem!=='remove')assert.equal(called('/storage/'),false);});
await check('lost acknowledgement retries the same retired path, including absent metadata',async()=>{reset('ack');await sweep(request({}));assert.equal(objects.size,0);assert.equal(queue.size,1);fault='';const result=await(await sweep(request({}))).json();assert.equal(result.unlinked,1);assert.equal(queue.size,0);});
await check('account confirmation fails before any data access',async()=>{reset();assert.equal((await account(request({}))).status,400);assert.deepEqual(calls,[]);});
await check('account auth failure never deletes data',async()=>{reset('auth');assert.equal((await account(request({confirmation:'DELETE'}))).status,401);assert.equal(called('delete_account_owned_rows'),false);});
await check('account rows, safe storage cleanup, then auth deletion stay ordered',async()=>{reset();assert.equal((await account(request({confirmation:'DELETE'}))).status,200);const rows=calls.findIndex(c=>c.includes('delete_account_owned_rows')),retire=calls.findIndex(c=>c.includes('retire_document')),ack=calls.findIndex(c=>c.includes('ack_document_storage')),auth=calls.findIndex(c=>c.startsWith('DELETE /auth/'));assert.ok(rows>=0&&rows<retire&&retire<ack&&ack<auth);});
for(const problem of ['retire','remove'])await check(`${problem} failure prevents final account removal`,async()=>{reset(problem);assert.equal((await account(request({confirmation:'DELETE'}))).status,500);assert.equal(called('DELETE /auth/'),false);assert.equal(objects.size,1);});
await check('surviving shared reference prevents account storage/auth removal',async()=>{reset('',true);assert.equal((await account(request({confirmation:'DELETE'}))).status,500);assert.equal(objects.size,1);assert.equal(called('DELETE /auth/'),false);assert.equal(called('DELETE /storage/'),false);});
for(const problem of ['rows','account_list','list_null','list_missing_name','list_missing_id','list_oversize'])await check(`${problem} cannot be mistaken for completed account cleanup`,async()=>{reset(problem);assert.equal((await account(request({confirmation:'DELETE'}))).status,500);assert.equal(called('DELETE /auth/'),false);assert.equal(called('DELETE /storage/'),false);assert.equal(objects.size,1);if(problem==='rows')assert.equal(called('/storage/'),false);});
await check('nested Storage folders with null IDs preserve exact raw names during cleanup',async()=>{reset();objects=new Set([`${actor}/old folder/nested/drawing %?#.pdf`,path]);assert.equal((await account(request({confirmation:'DELETE'}))).status,200);assert.equal(objects.size,0);assert.equal(listCalls,3);assert.ok(retired.has(`${actor}/old folder/nested/drawing %?#.pdf`));});
await check('account inventory visits every page before retiring bounded batches',async()=>{reset();objects=new Set(Array.from({length:201},(_,i)=>`${actor}/drawing-${String(i).padStart(3,'0')}.pdf`));assert.equal((await account(request({confirmation:'DELETE'}))).status,200);assert.equal(listCalls,3);assert.equal(objects.size,0);assert.equal(retired.size,201);assert.equal(calls.filter(c=>c.startsWith('DELETE /storage/')).length,3);});
console.log(`PASS ${checks} actual Storage cleanup Edge endpoint checks; no external network requests`);
