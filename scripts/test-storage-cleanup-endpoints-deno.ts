// Actual Edge handlers and pinned SDK; synthetic HTTP/SQL/provider boundary.
// No inherited secrets, real accounts, server, or external network permission.
import assert from 'node:assert/strict';
const actor='11111111-1111-4111-8111-111111111111',path=`${actor}/fixture.pdf`;
const config:Record<string,string>={SUPABASE_URL:'https://storage-cleanup.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-service-key',SUPABASE_ANON_KEY:'fixture-anon-key',ARCHIVE_PURGE_CRON_SECRET:'fixture-cron-secret'};
let handler:(req:Request)=>Promise<Response>;
Object.defineProperty(Deno.env,'get',{value:(name:string)=>config[name]});
Object.defineProperty(Deno,'serve',{value:(value:typeof handler)=>{handler=value;}});
let calls:string[]=[],queue=new Set<string>(),objects=new Set<string>(),retired=new Set<string>();
let fault='',shared=false,checks=0,claimCalls=0,scanCursor:string|null=null;
const reset=(problem='',referenced=false)=>{calls=[];queue=new Set([path]);objects=new Set([path]);retired=new Set();fault=problem;shared=referenced;claimCalls=0;scanCursor=null;};
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
 if(url.pathname==='/storage/v1/object/list/documents')throw Error('Account cleanup must not recursively load a Storage inventory');
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
 if(rpc==='claim_account_storage_cleanup'){
   claimCalls++;assert.equal(body.target_user_id,actor);assert.equal(body.p_limit,100);
   if(fault==='account_list')return fail();
   if(fault==='list_null')return ok(null);
   if(fault==='list_missing_name')return ok({paths:[{}],has_remaining:true,cycle_complete:true});
   if(fault==='list_missing_id')return ok({paths:[path],cycle_complete:true});
   if(fault==='list_oversize')return ok({paths:Array(101).fill(path),has_remaining:true,cycle_complete:true});
   const raw=[...new Set([...objects,...queue])].filter(p=>scanCursor===null||p>scanCursor).sort().slice(0,100);
   const cycle=raw.length<100;scanCursor=cycle?null:raw.at(-1)!;
   return ok({paths:raw,has_remaining:objects.size>0||queue.size>0,cycle_complete:cycle});
 }
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
for(const problem of ['retire','remove'])await check(`${problem} failure prevents final account removal`,async()=>{reset(problem);const response=await account(request({confirmation:'DELETE'}));assert.equal(response.status,202);assert.equal((await response.json()).deleted,false);assert.equal(called('DELETE /auth/'),false);assert.equal(objects.size,1);});
await check('surviving shared reference prevents account storage/auth removal',async()=>{reset('',true);assert.equal((await account(request({confirmation:'DELETE'}))).status,202);assert.equal(objects.size,1);assert.equal(called('DELETE /auth/'),false);assert.equal(called('DELETE /storage/'),false);});
for(const problem of ['rows','account_list','list_null','list_missing_name','list_missing_id','list_oversize'])await check(`${problem} cannot be mistaken for completed account cleanup`,async()=>{reset(problem);assert.equal((await account(request({confirmation:'DELETE'}))).status,problem==='rows'?500:202);assert.equal(called('DELETE /auth/'),false);assert.equal(called('DELETE /storage/'),false);assert.equal(objects.size,1);if(problem==='rows')assert.equal(called('claim_account_storage_cleanup'),false);});
await check('nested exact raw names need no recursive inventory requests',async()=>{reset();objects=new Set([`${actor}/old folder/nested/drawing %?#.pdf`,path]);assert.equal((await account(request({confirmation:'DELETE'}))).status,200);assert.equal(objects.size,0);assert.equal(claimCalls,2);assert.ok(retired.has(`${actor}/old folder/nested/drawing %?#.pdf`));assert.equal(called('/storage/v1/object/list/'),false);});
await check('large account makes bounded progress and requires a fresh empty receipt on retry',async()=>{reset();queue.clear();objects=new Set(Array.from({length:201},(_,i)=>`${actor}/drawing-${String(i).padStart(3,'0')}.pdf`));const first=await account(request({confirmation:'DELETE'}));assert.equal(first.status,202);assert.deepEqual(await first.json(),{deleted:false,pending:true,code:'account-cleanup-pending',error:'Account cleanup is not finished. Retry deletion to continue; shared files may need review.'});assert.equal(claimCalls,3);assert.equal(called('DELETE /auth/'),false);assert.equal(objects.size,0);assert.equal(retired.size,201);assert.equal(calls.filter(c=>c.startsWith('DELETE /storage/')).length,3);assert.equal((await account(request({confirmation:'DELETE'}))).status,200);assert.equal(claimCalls,4);});
console.log(`PASS ${checks} actual Storage cleanup Edge endpoint checks; no external network requests`);
